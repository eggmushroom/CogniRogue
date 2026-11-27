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
import type { Llm } from './llm';
import { createHash } from 'node:crypto';
import { questionId } from '../../src/core/library/parse';
import { traced } from './trace';
import { parseJsonReply } from './llm';
import type { GenQuestion } from './emit';

type CandidateQuestion = GenQuestion & { sectionIds: string[] };

export interface TopicJob {
  topic: string;
  topicId?: string;
  /** 当前主题的原文索引，给模型申请 JIT 读取。 */
  toc: string;
  /** 记忆注入文本，见 `memory.ts` 的 `memText()`。 */
  memory: string;
  /** 这一轮要几道题。 */
  per: number;
  /** 按划分阶段分配的原文 ID 取独立章节文件，JIT 用。 */
  read: (sectionId: string) => string | null;
  onModelRequest?: (hasSource: boolean) => void;
}

export interface TopicResult {
  questions: CandidateQuestion[];
  /** 本轮实际读取的原文，供审核使用。 */
  sources: ReadonlyMap<string, string>;
  /** 被扔掉的题与原因：写进报表，不静默吞。 */
  dropped: Array<{ reason: string; stem: string }>;
  /** 用掉几轮 JIT 取数。 */
  rounds: number;
  /** 模型真的去读了哪些节。 */
  reads: string[];
}

/** 位置依赖的选项文案：和 `core/library/parse.ts` 的判据保持一致。 */
const POSITIONAL = /^(以上|下述|前面|全都|全部都是|以上皆|以上均|其余|其他都)/;

const OUTPUT_FORMAT = '{"questions":[{"knowledge":"知识点名称","stem":"…","options":["…","…"],"answer":0,"explain":"…","noShuffle":false,"sectionIds":["已读取的章节 ID"]}]}';

function systemPrompt(per: number, nativeTools: boolean): string {
  const read = nativeTools
    ? '用索引里的 sectionId 调用 read_source，按需取小节。'
    : '取小节时只交付 {"read":["索引中的章节 ID"],"questions":[]}，等待程序返回正文。';
  return [
    `为当前主题生成 ${per} 道单选题，每题一个不同知识点。不为凑数出不确定的题。`,
    `取证：出题前先读正文。${read} 目录和记忆用于选题，不当作事实依据。`,
    '命题：先确定正文直接支持的结论，再写可独立作答的题干。凡影响答案的条件都放进题干。若问代码能否编译或会输出什么，明确必要的类型、定义、导入和输入，不用省略号代替影响结论的代码。教材若只给出某种写法，就问这段代码如何运行，不把它说成唯一合法写法。',
    '验题：只按题干给出的条件逐一判断 2–4 个选项。必须恰有一个选项全文正确；不得靠标答或解析补条件。题干、标答和解析的范围一致；遇到「必须」「只能」「全部」这类说法，考虑是否有合法反例，有疑问就改成只问该例。解析只说明本题结论为何成立，不加题外断言，不按字母或位置指代选项。',
    '选题：先按记忆中的本轮优先复练顺序，每个有原文依据的目标出一道变式题，换一个情景或考查角度，原样复用其 knowledge 名称。剩余名额补未覆盖的知识点，避开已有题目的知识点。新知识点用简短名称，不生成 ID。sectionIds 只列本轮读过且支持答案和解析的章节；answer 用 0 基下标；noShuffle 仅在选项语义依赖顺序时为 true。',
    `交付题目时只返回以下结构的 JSON 对象，不加围栏或其他文字：${OUTPUT_FORMAT}`,
  ].join('\n');
}

function topicContext(job: TopicJob): string {
  return [`# 主题\n${job.topic}`, `# 本主题的原文索引\n${job.toc}`, `# 出题记忆\n${job.memory}`].join('\n\n');
}

/**
 * 校验题库格式并解析要交给审核模型的章节。
 *
 * 位置依赖的选项自动补 `noShuffle`：DSL 要作者**显式声明**，是因为游戏不许
 * 靠文案猜语义；而这里我们就是作者，声明一次、写进产物，
 * 游戏那一侧仍然只读标记，不猜。
 */
function normalize(raw: unknown, sourceById: ReadonlyMap<string, string>): { q?: CandidateQuestion; why?: string; stem?: string } {
  const r = raw as (Record<string, unknown> & { stem?: unknown; options?: unknown; answer?: unknown; explain?: unknown; noShuffle?: unknown }) | null;
  if (!r || typeof r !== 'object' || Array.isArray(r)) return { why: '不是对象' };
  // 一处换行就能毁掉整份产物：DSL 是一行题干 + 若干行选项，
  // 模型把题干写成两行，第 2 行就不再是选项，整份被解析器拒掉（一次 4 道这么挂过）。
  // 空白在这里压平，代价是丢掉作者刻意的排版 —— 题干本来也不该有排版。
  const keys = ['knowledge', 'stem', 'options', 'answer', 'explain', 'noShuffle', 'sectionIds'];
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
  const requested = r.sectionIds;
  // 引用缺失或写错时回退到本轮已读原文，由审核模型判断是否有足够依据。
  const sectionIds = Array.isArray(requested) && requested.length > 0
    && requested.every((id): id is string => typeof id === 'string' && sourceById.has(id))
    ? [...new Set(requested)] : [...sourceById.keys()];
  return {
    q: { knowledgeId, knowledgeLabel: knowledge, qid: questionId('', stem), stem, options, answer, explain: markdown(r.explain), noShuffle, sectionIds },
  };
}

function finalize(job: TopicJob, rawQuestions: unknown[], sourceById: ReadonlyMap<string, string>, rounds: number, reads: string[]): TopicResult {
  const questions: CandidateQuestion[] = [];
  const dropped: TopicResult['dropped'] = [];
  const seen = new Set<string>();
  for (const raw of rawQuestions) {
    const { q, why, stem } = normalize(raw, sourceById);
    if (!q) { dropped.push({ reason: why ?? '不合格', stem: stem ?? '' }); continue; }
    q.qid = questionId(job.topicId ?? job.topic, q.stem);
    if (seen.has(q.qid)) { dropped.push({ reason: `题目重复「${q.stem.slice(0, 32)}」`, stem: q.stem }); continue; }
    seen.add(q.qid);
    questions.push(q);
    if (questions.length >= job.per) break;
  }
  return { questions, sources: sourceById, dropped, rounds, reads };
}

/** 跑一个主题：模型先按需读取章节，再生成候选题。 */
// A large topic may need several JIT reads before the model can synthesize questions.
export async function generateTopic(job: TopicJob, llm: Llm, maxRounds = 6): Promise<TopicResult> {
  const extra: string[] = [];
  const reads: string[] = [];
  const sourceById = new Map<string, string>();
  const context = topicContext(job);
  const system = systemPrompt(job.per, Boolean(llm.tool));
  const empty = (reason: string, rounds: number): TopicResult => ({
    questions: [], sources: sourceById, dropped: [{ reason, stem: '' }], rounds, reads,
  });

  if (llm.tool) {
    const messages: Array<{ role: 'user' | 'assistant' | 'tool'; content: string; toolCallId?: string; calls?: Array<{ id: string; name: string; arguments: string }> }> = [
      { role: 'user', content: context },
    ];
    const toolSpec = [{ name: 'read_source', description: '按划分计划里的原文 ID 读取对应章节文件。只读取出题确实需要的内容。',
      parameters: { type: 'object', properties: { sectionId: { type: 'string', pattern: '^sec_[a-f0-9]{16}$', description: '原文索引中列出的章节 ID' } }, required: ['sectionId'], additionalProperties: false } }];
    for (let round = 0; round <= maxRounds; round++) {
      job.onModelRequest?.(sourceById.size > 0);
      const model = llm.tool;
      const response = await traced('generation.round', { round: round + 1, loadedSections: sourceById.size }, () =>
        model(system, messages, toolSpec));
      if (response.calls.length) {
        messages.push({ role: 'assistant', content: response.text, calls: response.calls });
        for (const call of response.calls) {
          let sectionId = '';
          try { const args = JSON.parse(call.arguments); sectionId = typeof args.sectionId === 'string' ? args.sectionId : ''; } catch { /* invalid tool arguments yield a bounded error */ }
          const text = call.name === 'read_source' && sectionId ? job.read(sectionId) : null;
          if (text) {
            reads.push(sectionId);
            sourceById.set(sectionId, text);
            messages.push({ role: 'tool', toolCallId: call.id, content: text });
          } else {
            messages.push({ role: 'tool', toolCallId: call.id, content: '读取失败：sectionId 不在当前主题原文索引中。请使用索引中列出的 ID。' });
          }
        }
        continue;
      }
      const parsed = parseJsonReply(response.text) as { questions?: unknown[] };
      const rawQuestions = Array.isArray(parsed.questions) ? parsed.questions : [];
      if (!reads.length) return empty('agent 未通过 read_source 读取原文', round);
      return finalize(job, rawQuestions, sourceById, round, reads);
    }
    return empty(`JIT 取数超过 ${maxRounds} 轮仍没出题`, maxRounds);
  }

  for (let round = 0; round <= maxRounds; round++) {
    job.onModelRequest?.(sourceById.size > 0);
    const reply = await llm.ask(system, extra.length ? `${context}\n\n# 已读取的原文\n${extra.join('\n\n')}` : context);
    const parsed = parseJsonReply(reply) as { questions?: unknown[]; read?: unknown };

    const want = Array.isArray(parsed.read) ? parsed.read.filter((id): id is string => typeof id === 'string') : [];
    const questions = Array.isArray(parsed.questions) ? parsed.questions : [];
    const hasSource = sourceById.size > 0;

    // 空题 + 申请读数：这是 JIT 的正常一轮，不是失败
    if ((!hasSource || !questions.length) && want.length && round < maxRounds) {
      let got = 0;
      for (const sectionId of want) {
        const text = job.read(sectionId);
        if (!text) continue;
        got += 1;
        reads.push(sectionId);
        sourceById.set(sectionId, text);
        extra.push(`## ${sectionId}\n${text}`);
      }
      if (got) continue;
      // 一条都读不到：别再来一轮同样的空转
      return empty(`申请的原文 ID 读不到：${want.join(' / ')}`, round);
    }
    if (!hasSource) return empty('未读取原文', round);

    return finalize(job, questions, sourceById, round, reads);
  }

  return empty(`JIT 取数超过 ${maxRounds} 轮仍没出题`, maxRounds);
}
