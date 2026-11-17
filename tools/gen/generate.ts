/**
 * 一个主题 = 一个子 agent：自己一份上下文、自己一份记忆、自己交一批题。
 *
 * 这里**没有**多 agent 框架。所谓自下而上，落在这份文件里就是：
 * 每个主题独立跑、只读自己那一节和记忆、交回结构化结果，
 * 由 `main.ts` 汇总成一份题库和一个报表。合起来的行为是确定的、可测的，
 * 而不是"一群 agent 商量出来的"。
 *
 * JIT 取数也在这里：模型先看目录，觉得缺上下文就返回 `"read": [路径]`，
 * 我们把那一节原文追加进去再问一轮。它决定"要读什么"，
 * 但"目录长什么样"由 `chunk.ts` 的确定性切分决定 —— 两边各做自己擅长的那半。
 */
import type { Chunk } from './chunk';
import type { Llm } from './llm';
import { parseJsonReply } from './llm';
import type { GenQuestion } from './emit';

export interface TopicJob {
  topic: string;
  /** 这一节自己的正文块（同一 path 被预算切开的那些）。 */
  chunks: Chunk[];
  /** 整份文档的目录，给模型判断"还缺什么"。 */
  toc: string;
  /** 记忆注入文本，见 `memory.ts` 的 `memText()`。 */
  memory: string;
  /** 这一轮要几道题。 */
  per: number;
  /** 按路径取原文，JIT 用。 */
  read: (path: string[]) => string | null;
}

export interface TopicResult {
  questions: GenQuestion[];
  /** 被扔掉的题与原因：写进报表，不静默吞。 */
  dropped: Array<{ reason: string; stem: string }>;
  /** 用掉几轮 JIT 取数。 */
  rounds: number;
  /** 模型真的去读了哪些节。 */
  reads: string[];
}

/** 位置依赖的选项文案：和 `core/library/parse.ts` 的判据保持一致。 */
const POSITIONAL = /^(以上|下述|前面|全都|全部都是|以上皆|以上均|其余|其他都)/;

const SYSTEM = [
  '你是教材的出题人。只依据用户给的那一节内容出题，不许引入这一节之外的知识。',
  '每道题只考一个知识点，概念名用「主题/子话题」的形式，小写、稳定、可复用；',
  '同一个概念只出一道题，概念名重复会被丢弃。',
  '选项 2–4 个，干扰项必须是同一个知识点范围内似是而非的错法，不要凑字数。',
  '答案用 0 基下标给出。',
  '如果某个选项的语义依赖它的位置（例如「以上都对」），必须在这一题写 "noShuffle": true。',
  '只输出 JSON 对象，不要解释、不要代码围栏。',
].join('\n');

function userPrompt(job: TopicJob, extra: string[]): string {
  const body = job.chunks.map((c) => c.text).join('\n\n');
  const parts = [
    `# 主题\n${job.topic}`,
    `# 这本书的目录（你只负责上面这个主题，需要别的节可以用 read 申请）\n${job.toc}`,
    `# 这一节的内容\n${body}`,
    `# 这个主题的出题记忆\n${job.memory}`,
    extra.length ? `# 你上几轮申请读的内容\n${extra.join('\n\n')}` : '',
    [
      '# 要你做的事',
      `出 ${job.per} 道题，覆盖这一节的不同知识点，避开记忆里已经稳了的概念。`,
      '需要先读别的节才能出好题时，只返回 {"read": [["第一章","1.2 排序"]], "questions": []}，',
      '路径就是目录里的标题名，按层级写成数组；我们会把那一节原文给你再问一轮。不需要就直接出题。',
      '输出格式：{"questions":[{"concept":"…","stem":"…","options":["…","…"],"answer":0,"explain":"…","noShuffle":false}]}',
    ].join('\n'),
  ];
  return parts.filter(Boolean).join('\n\n');
}

/**
 * 校验并修正一道题。
 *
 * 位置依赖的选项自动补 `noShuffle`：DSL 要作者**显式声明**，是因为游戏不许
 * 靠文案猜语义；而这里我们就是作者，声明一次、写进产物，
 * 游戏那一侧仍然只读标记，不猜。
 */
function normalize(raw: unknown): { q?: GenQuestion; why?: string; stem?: string } {
  const r = raw as Partial<GenQuestion> | null;
  if (!r || typeof r !== 'object') return { why: '不是对象' };
  // 一处换行就能毁掉整份产物：DSL 是一行题干 + 若干行选项，
  // 模型把题干写成两行，第 2 行就不再是选项，整份被解析器拒掉（一次 4 道这么挂过）。
  // 空白在这里压平，代价是丢掉作者刻意的排版 —— 题干本来也不该有排版。
  const flat = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const concept = flat(r.concept);
  const stem = flat(r.stem);
  const options = Array.isArray(r.options) ? r.options.map(flat) : [];
  const answer = Number(r.answer);

  if (!concept) return { why: '缺少概念名', stem };
  if (!stem) return { why: '缺少题干', stem };
  if (options.length < 2 || options.length > 4) return { why: `${options.length} 个选项`, stem };
  if (options.some((o) => !o)) return { why: '有空选项', stem };
  if (new Set(options).size !== options.length) return { why: '选项重复', stem };
  if (!Number.isInteger(answer) || answer < 0 || answer >= options.length) {
    return { why: `答案下标 ${r.answer} 越界`, stem };
  }

  const noShuffle = r.noShuffle === true || options.some((o) => POSITIONAL.test(o));
  return {
    q: { concept, stem, options, answer, explain: flat(r.explain), noShuffle },
  };
}

/** 跑一个主题：可能先读几轮别的节，再出题。 */
export async function generateTopic(job: TopicJob, llm: Llm, maxRounds = 3): Promise<TopicResult> {
  const extra: string[] = [];
  const reads: string[] = [];
  const dropped: TopicResult['dropped'] = [];

  for (let round = 0; round <= maxRounds; round++) {
    const reply = await llm.ask(SYSTEM, userPrompt(job, extra));
    const parsed = parseJsonReply(reply) as { questions?: unknown[]; read?: unknown };

    // 路径既接受标题名数组，也接受「A > B」这种从目录抄下来的字符串
    const asPath = (p: unknown): string[] =>
      Array.isArray(p) ? p.map(String) : String(p).split('>').map((s) => s.trim()).filter(Boolean);
    const want = Array.isArray(parsed.read) ? parsed.read.map(asPath) : [];
    const questions = Array.isArray(parsed.questions) ? parsed.questions : [];

    // 空题 + 申请读数：这是 JIT 的正常一轮，不是失败
    if (!questions.length && want.length && round < maxRounds) {
      let got = 0;
      for (const path of want) {
        const text = job.read(path);
        if (!text) continue;
        got += 1;
        reads.push(path.join(' > '));
        extra.push(`## ${path.join(' > ')}\n${text}`);
      }
      if (got) continue;
      // 一条都读不到：别再来一轮同样的空转
      return { questions: [], dropped: [{ reason: `申请的节读不到：${want.map((p) => p.join(' > ')).join(' / ')}`, stem: '' }], rounds: round, reads };
    }

    const seen = new Set<string>();
    const out: GenQuestion[] = [];
    for (const raw of questions) {
      const { q, why, stem } = normalize(raw);
      if (!q) { dropped.push({ reason: why ?? '不合格', stem: stem ?? '' }); continue; }
      if (seen.has(q.concept)) { dropped.push({ reason: `概念「${q.concept}」重复`, stem: q.stem }); continue; }
      seen.add(q.concept);
      out.push(q);
      if (out.length >= job.per) break;
    }
    return { questions: out, dropped, rounds: round, reads };
  }

  return { questions: [], dropped: [...dropped, { reason: `JIT 取数超过 ${maxRounds} 轮仍没出题`, stem: '' }], rounds: maxRounds, reads };
}
