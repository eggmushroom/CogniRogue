/**
 * 一个主题 = 一个子 agent：自己一份上下文、自己一份记忆、自己交一批题。
 *
 * 这里**没有**多 agent 框架。所谓自下而上，落在这份文件里就是：
 * 每个主题独立跑、只读自己那一节和记忆、交回结构化结果，
 * 由 `main.ts` 汇总成一份题库和一个报表。合起来的行为是确定的、可测的，
 * 而不是"一群 agent 商量出来的"。
 *
 * JIT 取数也在这里：模型先看目录，需要上下文时按章节 ID 请求原文，
 * 我们把那一节原文追加进去再问一轮。它决定"要读什么"，
 * 但"目录长什么样"由 `chunk.ts` 的确定性切分决定 —— 两边各做自己擅长的那半。
 */
import type { Chunk } from './chunk';
import type { Llm } from './llm';
import { createHash } from 'node:crypto';
import { questionId } from '../../src/core/library/parse';
import { parseJsonReply } from './llm';
import type { GenQuestion } from './emit';

export interface TopicJob {
  topic: string;
  topicId?: string;
  /** 这一节自己的正文块（同一 path 被预算切开的那些）。 */
  chunks: Chunk[];
  /** 当前主题的原文索引，给模型申请 JIT 读取。 */
  toc: string;
  /** 记忆注入文本，见 `memory.ts` 的 `memText()`。 */
  memory: string;
  /** 这一轮要几道题。 */
  per: number;
  /** 按划分阶段分配的原文 ID 取独立章节文件，JIT 用。 */
  read: (sectionId: string) => string | null;
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
  '你是教材的出题人。只能依据通过 read 提供的原文出题，不许凭目录或常识猜答案。',
  '每道题只考一个知识点，knowledge 用简短、明确的知识点名称；不要生成 ID。',
  '复练旧知识点时，knowledge 名称必须逐字照抄记忆中的名称；同一名称表示同一知识点。',
  '选项 2–4 个，干扰项必须是同一个知识点范围内似是而非的错法，不要凑字数。',
  '答案用 0 基下标给出。',
  '如果某个选项的语义依赖它的位置（例如「以上都对」），必须在这一题写 "noShuffle": true。',
  '原文索引项是「sectionId | 标题 | parentId」；工具调用只能使用索引中的 sectionId，不得传标题。',
  '只输出 JSON 对象，不要解释、不要代码围栏。',
].join('\n');

function userPrompt(job: TopicJob, extra: string[]): string {
  const body = job.chunks.map((c) => c.text).join('\n\n');
  const parts = [
    `# 主题\n${job.topic}`,
    `# 本主题的原文索引（read_source 只接受 sectionId）\n${job.toc}`,
    body ? `# 已读取的原文\n${body}` : '',
    `# 这个主题的出题记忆\n${job.memory}`,
    extra.length ? `# 你上几轮申请读的内容\n${extra.join('\n\n')}` : '',
    [
      '# 要你做的事',
      `出 ${job.per} 道题，覆盖这一节的不同知识点，避开记忆里已经稳了的概念。`,
      '对记忆中需要重练的概念，可以换一个问法生成新题；新题的 knowledge 名称必须对应一个知识点；复练时从记忆中逐字复用名称。程序会分配 ID。',
      !body && !extra.length ? '先从索引选择相关章节 ID 读取。每个文件只包含对应小节，需要更多内容时再读取其他 ID。本轮禁止直接出题。' : '',
      '需要原文或更多上下文时，只返回 {"read": ["sec_0123456789abcdef"], "questions": []}，sectionId 必须来自原文索引。',
      '输出格式：{"questions":[{"knowledge":"知识点名称","stem":"…","options":["…","…"],"answer":0,"explain":"…","noShuffle":false}]}',
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
  const r = raw as (Record<string, unknown> & { stem?: unknown; options?: unknown; answer?: unknown; explain?: unknown; noShuffle?: unknown }) | null;
  if (!r || typeof r !== 'object' || Array.isArray(r)) return { why: '不是对象' };
  // 一处换行就能毁掉整份产物：DSL 是一行题干 + 若干行选项，
  // 模型把题干写成两行，第 2 行就不再是选项，整份被解析器拒掉（一次 4 道这么挂过）。
  // 空白在这里压平，代价是丢掉作者刻意的排版 —— 题干本来也不该有排版。
  const keys = ['knowledge', 'stem', 'options', 'answer', 'explain', 'noShuffle'];
  if (Object.keys(r).some((key) => !keys.includes(key))) return { why: '包含未知字段', stem: '' };
  const flat = (s: unknown) => typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '';
  const knowledge = flat(r.knowledge);
  const markdown = (s: unknown) => String(s ?? '').replace(/\r\n?/g, '\n').trim();
  const stem = markdown(r.stem);
  const options = Array.isArray(r.options) ? r.options.map(markdown) : [];
  const answer = Number(r.answer);

  if (!knowledge || knowledge.length > 80 || /[\r\n\x00-\x1f]/.test(knowledge)) return { why: 'knowledge 必须是 1–80 字的单行知识点名称', stem };
  if (typeof r.stem !== 'string' || !Array.isArray(r.options) || r.options.some((option) => typeof option !== 'string') || typeof r.answer !== 'number' || !Number.isInteger(r.answer) || (r.noShuffle !== undefined && typeof r.noShuffle !== 'boolean') || (r.explain !== undefined && typeof r.explain !== 'string')) return { why: '题目字段类型无效', stem };
  if (!stem) return { why: '缺少题干', stem };
  if (options.length < 2 || options.length > 4) return { why: `${options.length} 个选项`, stem };
  if (options.some((o) => !o)) return { why: '有空选项', stem };
  if (new Set(options).size !== options.length) return { why: '选项重复', stem };
  if (!Number.isInteger(answer) || answer < 0 || answer >= options.length) {
    return { why: `答案下标 ${r.answer} 越界`, stem };
  }

  const noShuffle = r.noShuffle === true || options.some((o) => POSITIONAL.test(o));
  const knowledgeId = `k_${createHash('sha256').update(knowledge.normalize('NFKC').toLocaleLowerCase('zh-CN')).digest('hex').slice(0, 16)}`;
  return {
    q: { knowledgeId, knowledgeLabel: knowledge, qid: questionId('', stem), stem, options, answer, explain: markdown(r.explain), noShuffle },
  };
}

/** 跑一个主题：可能先读几轮别的节，再出题。 */
export async function generateTopic(job: TopicJob, llm: Llm, maxRounds = 3): Promise<TopicResult> {
  const extra: string[] = [];
  const reads: string[] = [];
  const dropped: TopicResult['dropped'] = [];

  if (llm.tool) {
    const messages: Array<{ role: 'user' | 'assistant' | 'tool'; content: string; toolCallId?: string; calls?: Array<{ id: string; name: string; arguments: string }> }> = [
      { role: 'user', content: [
        `# 主题\n${job.topic}`, `# 原文索引（只能通过 read_source 获取正文）\n${job.toc}`, `# 记忆\n${job.memory}`,
        `出 ${job.per} 道题；只依据 read_source 返回的原文。请先调用工具读取必要小节，再输出 JSON：{"questions":[{"knowledge":"知识点名称","stem":"…","options":["…","…"],"answer":0,"explain":"…","noShuffle":false}]}`,
      ].join('\n\n') },
    ];
    const toolSpec = [{ name: 'read_source', description: '按划分计划里的原文 ID 读取对应章节文件。只读取出题确实需要的内容。',
      parameters: { type: 'object', properties: { sectionId: { type: 'string', pattern: '^sec_[a-f0-9]{16}$', description: '原文索引中列出的章节 ID' } }, required: ['sectionId'], additionalProperties: false } }];
    for (let round = 0; round <= maxRounds; round++) {
      const response = await llm.tool(SYSTEM, messages, toolSpec);
      if (response.calls.length) {
        messages.push({ role: 'assistant', content: response.text, calls: response.calls });
        for (const call of response.calls) {
          let sectionId = '';
          try { const args = JSON.parse(call.arguments); sectionId = typeof args.sectionId === 'string' ? args.sectionId : ''; } catch { /* invalid tool arguments yield a bounded error */ }
          if (!sectionId) response.reportToolResult?.(call.id, { ok: false, detail: '参数无效' });
          const text = call.name === 'read_source' && sectionId ? job.read(sectionId) : null;
          if (text) {
            response.reportToolResult?.(call.id, { ok: true, detail: `已读取 ${text.length} 字符` });
            reads.push(sectionId);
            messages.push({ role: 'tool', toolCallId: call.id, content: text });
          } else {
            if (sectionId) response.reportToolResult?.(call.id, { ok: false, detail: 'sectionId 不在当前主题索引中' });
            messages.push({ role: 'tool', toolCallId: call.id, content: '读取失败：sectionId 不在当前主题原文索引中。请使用索引中列出的 ID。' });
          }
        }
        continue;
      }
      const parsed = parseJsonReply(response.text) as { questions?: unknown[] };
      const rawQuestions = Array.isArray(parsed.questions) ? parsed.questions : [];
      if (!reads.length) return { questions: [], dropped: [{ reason: 'agent 未通过 read_source 读取原文', stem: '' }], rounds: round, reads };
      const seen = new Set<string>();
      const questions: GenQuestion[] = [];
      for (const raw of rawQuestions) {
        const { q, why, stem } = normalize(raw);
        if (!q) { dropped.push({ reason: why ?? '不合格', stem: stem ?? '' }); continue; }
        q.qid = questionId(job.topicId ?? job.topic, q.stem);
        if (seen.has(q.qid)) { dropped.push({ reason: `题目重复「${q.stem.slice(0, 32)}」`, stem: q.stem }); continue; }
        seen.add(q.qid); questions.push(q);
        if (questions.length >= job.per) break;
      }
      return { questions, dropped, rounds: round, reads };
    }
    return { questions: [], dropped: [{ reason: `JIT 取数超过 ${maxRounds} 轮仍没出题`, stem: '' }], rounds: maxRounds, reads };
  }

  for (let round = 0; round <= maxRounds; round++) {
    const reply = await llm.ask(SYSTEM, userPrompt(job, extra));
    const parsed = parseJsonReply(reply) as { questions?: unknown[]; read?: unknown };

    const want = Array.isArray(parsed.read) ? parsed.read.filter((id): id is string => typeof id === 'string') : [];
    const questions = Array.isArray(parsed.questions) ? parsed.questions : [];
    const hasSource = job.chunks.length > 0 || extra.length > 0;

    // 空题 + 申请读数：这是 JIT 的正常一轮，不是失败
    if ((!hasSource || !questions.length) && want.length && round < maxRounds) {
      let got = 0;
      for (const sectionId of want) {
        const text = job.read(sectionId);
        if (!text) continue;
        got += 1;
        reads.push(sectionId);
        extra.push(`## ${sectionId}\n${text}`);
      }
      if (got) continue;
      // 一条都读不到：别再来一轮同样的空转
      return { questions: [], dropped: [{ reason: `申请的原文 ID 读不到：${want.join(' / ')}`, stem: '' }], rounds: round, reads };
    }
    if (!hasSource) return { questions: [], dropped: [{ reason: '未读取原文', stem: '' }], rounds: round, reads };

    const seen = new Set<string>();
    const out: GenQuestion[] = [];
    for (const raw of questions) {
      const { q, why, stem } = normalize(raw);
      if (!q) { dropped.push({ reason: why ?? '不合格', stem: stem ?? '' }); continue; }
      q.qid = questionId(job.topicId ?? job.topic, q.stem);
      if (seen.has(q.qid)) { dropped.push({ reason: `题目重复「${q.stem.slice(0, 32)}」`, stem: q.stem }); continue; }
      seen.add(q.qid);
      out.push(q);
      if (out.length >= job.per) break;
    }
    return { questions: out, dropped, rounds: round, reads };
  }

  return { questions: [], dropped: [...dropped, { reason: `JIT 取数超过 ${maxRounds} 轮仍没出题`, stem: '' }], rounds: maxRounds, reads };
}
