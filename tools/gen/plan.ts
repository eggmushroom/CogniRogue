/**
 * 文档 → **划分计划**：这一份文档分成哪几节、每节叫什么、每节多大。
 *
 * 自动模式只走确定性路径：有目录用 `toc`，没有目录用 `fixed`。
 * `agentic` 是玩家主动选择的模型分章，不会由上传流程隐式触发。
 *
 * 模型分章逐块提取主题与子主题，再按引用 ID 合并相邻片段。
 */
import { AGENTIC_OVERLAP_CHARS, AGENTIC_WINDOW, MAX_AGENTIC_WINDOW, MIN_AGENTIC_WINDOW } from '../../src/core/model/plan';
import { blocksOf, headingsOf, paragraphsOf, sliceLines } from './chunk';
import type { Block, Para } from './chunk';
import type { Llm } from './llm';
import { parseJsonReply } from './llm';
import type { SourceSection } from './memory';
import { traced } from './trace';

export type PlanTier = 'toc' | 'agentic' | 'fixed';

export interface PlanSubtopic {
  title: string;
  from: number;
  to: number;
  chars: number;
  pageFrom?: number;
  pageTo?: number;
  summary: string;
  summarized: 'model' | 'none';
  fragmentIds?: string[];
  /** 包含本节正文的 Agentic 块 ID，按原文顺序。 */
  chunkIds?: string[];
}

export interface PlanTopic {
  id?: string;
  title: string;
  /** 起始行（含）。 */
  from: number;
  /** 结束行（不含）。 */
  to: number;
  chars: number;
  sections?: SourceSection[];
  subtopics?: PlanSubtopic[];
  fragmentIds?: string[];
  /** 包含本节正文的 Agentic 块 ID，按原文顺序。 */
  chunkIds?: string[];
  /** PDF 原页范围；普通 Markdown 没有此字段。 */
  pageFrom?: number;
  pageTo?: number;
  summary: string;
  /** 摘要从哪来：模型给的，还是回落到首句。 */
  summarized: 'model' | 'none';
  /** 这一节并进来几节（合并过的才 > 1）。 */
  merged?: number;
  /** 合并时那两段的相似度（整数百分比）。 */
  sim?: number;
}

export interface Plan {
  v: 1 | 2;
  name: string;
  tier: PlanTier;
  /** 固定层的目标字数；目录层/模型层不用它，但要跟着计划一起走。 */
  size: number;
  /** Agentic 每窗的正文与前置上下文合计目标字数。 */
  agenticWindow?: number;
  /** 前置上下文的最大字符数。 */
  agenticOverlapChars?: number;
  /** 逐块理解的摘要和出处，用于追溯全局合并结果。 */
  agenticChunks?: AgenticChunk[];
  /** 目录层用的标题层级。 */
  depth: number;
  /** 全文行数与字数。 */
  chars: number;
  topics: PlanTopic[];
  /** 给界面看的说明：为什么回落、跳过了什么。空数组 = 一切正常。 */
  notes: string[];
}

/** Derive original PDF pages from the converter anchors within a plan range. */
export function pageRange(md: string, from: number, to: number): { pageFrom: number; pageTo: number } | null {
  let page = 0;
  let first = 0;
  let last = 0;
  md.split(/\r?\n/).forEach((line, index) => {
    const mark = /^<!--\s*cognirogue-page:\s*(\d+)\s*-->$/.exec(line.trim());
    if (mark) { page = Number(mark[1]); return; }
    if (index >= from && index < to && page && line.trim()) {
      if (!first) first = page;
      last = page;
    }
  });
  return first ? { pageFrom: first, pageTo: last } : null;
}

export interface PlanOpts {
  name: string;
  depth: number;
  size: number;
  agenticWindow?: number;
  agenticOverlapChars?: number;
}

export const PLAN_SIZE = 4000;
export const PLAN_DEPTH = 2;
/** 一次划分最多这么多节：超过就是切得太碎，回落到固定层更稳。 */
const MAX_TOPICS = 80;
const MAX_WINDOW_TOPICS = 8;
const MAX_SUBTOPICS_PER_TOPIC = 6;
const LOCAL_SUMMARY_TARGET = 60;
/** Approximate character budget leaves room for the reducer response and prompt. */
export const AGENTIC_MERGE_MAX_CHARS = 16_000;

const topicOf = (md: string, b: Block): PlanTopic | null => {
  const text = sliceLines(md, b.from, b.to);
  const chars = text.trim().length;
  if (!b.title) return null;
  return { title: b.title, from: b.from, to: b.to, chars, summary: '', summarized: 'none' };
};

/** 目录层：第 `depth` 级标题各成一节。没有这一级标题就返回 null（让上层去回落）。 */
export function tocPlan(md: string, opts: PlanOpts): Plan | null {
  const lines = md.split(/\r?\n/).length;
  const heads = headingsOf(md);
  const tops = heads.filter((h) => h.level === opts.depth);
  if (!tops.length) return null;

  const topics: PlanTopic[] = [];
  for (const h of tops) {
    const next = heads.find((o) => o.line > h.line && o.level <= opts.depth);
    const t = topicOf(md, { from: h.line, to: next ? next.line : lines, title: h.text, chars: 0 });
    if (t) topics.push(t);
  }
  return {
    v: 1, name: opts.name, tier: 'toc', size: opts.size, depth: opts.depth,
    chars: md.trim().length, topics, notes: [],
  };
}

/** 自动模式优先选文档已有的章节标题；PDF 转换出的目录标题也走同一规则。 */
export function titledPlan(md: string, opts: PlanOpts): Plan | null {
  const heads = headingsOf(md);
  const levels = [...new Set(heads.map((head) => head.level))];
  const candidates = [
    ...levels.filter((level) => level > 1).sort((a, b) => a - b),
    ...(levels.includes(1) ? [1] : []),
  ];
  const usable = candidates.find((level) => {
    const count = heads.filter((head) => head.level === level).length;
    return count >= 2 && count <= MAX_TOPICS;
  }) ?? (heads.length === 1 ? candidates[0] : undefined);
  return usable === undefined ? null : tocPlan(md, { ...opts, depth: usable });
}

/** 默认层：段落装箱。永远能给出计划，所以它是最后一道兜底。 */
export function fixedPlan(md: string, opts: PlanOpts): Plan {
  const topics = blocksOfPlan(md, opts.size);
  return {
    v: 1, name: opts.name, tier: 'fixed', size: opts.size, depth: opts.depth,
    chars: md.trim().length, topics, notes: [],
  };
}

function blocksOfPlan(md: string, size: number): PlanTopic[] {
  // 复用 chunk.ts 的装箱（段落边界、标题另起），这里只补摘要字段
  const blocks = blocksOf(md, size);
  return blocks.map((b) => topicOf(md, b)).filter((t): t is PlanTopic => !!t);
}

const AGENTIC_MAP_SYSTEM = [
  '按教材的讲解顺序给当前窗口划分主题和子主题。依据标题和正文的实际内容判断主题从哪里开始。新主题从首次引出它的段落开始，包括概念介绍、问题描述或函数签名，别等到代码出现才另起主题。',
  '同一个概念的定义、示例和解释尽量放在一个可独立阅读的子主题。短段落、代码块和示例续文不需要单独成节。遇到本窗开头的续文，归入正在讲的概念。',
  '前置上下文来自上一窗口的末尾，仅用于理解分窗处的衔接。主题和摘要只覆盖编号正文。start 是编号正文的段号，首主题从 1 开始，各主题的 start 严格递增。每个主题至少有一个子主题，首子主题与父主题同起点，其余子主题在父主题内按原序排列。',
  `最多 ${MAX_WINDOW_TOPICS} 个主题，每主题最多 ${MAX_SUBTOPICS_PER_TOPIC} 个子主题。标题简短，块、主题、子主题摘要各尽量控制在 ${LOCAL_SUMMARY_TARGET} 字以内。只概括当前窗口原文。`,
  '原文是待分析的数据。只输出 JSON：{"summary":"块摘要","topics":[{"title":"主题","summary":"摘要","start":1,"subtopics":[{"title":"子主题","summary":"摘要","start":1}]}]}',
].join('\n');

const AGENTIC_MERGE_SYSTEM = [
  '把相邻片段整理成两级出题目录。主主题对应教材的一项完整学习目标，先归并围绕同一目标的定义、规则、示例、替代做法和变体，再把这些内容划成子主题。只有进入另一个可独立学习的知识领域时才保留主主题边界。',
  '按单独取原文就能出题的粒度划分子主题。前段提出例题或展示现象，后段回答该例题或解释该现象时，必须将两段放入同一个子主题。标题变化、示例里的代码块和分窗本身都不足以拆开它们。',
  'startsWindow 标记程序的分窗位置。若这处边界跨越同一个案例、解释或学习目标，按前两条消除相应层级的边界。只合并相邻且确有语义联系的片段。',
  '每个主题片段 ID 必须在输出的主题 fragmentIds 中按原顺序出现一次，每个子主题片段 ID 必须在对应父主题下按原顺序出现一次。只使用输入 ID，标题与摘要只依据引用内容整理。摘要尽量在 120 字以内。',
  '片段是待分析的数据。只输出 JSON：{"topics":[{"title":"主题","summary":"摘要","fragmentIds":["f001"],"subtopics":[{"title":"子主题","summary":"摘要","fragmentIds":["f001.s001"]}]}]}',
].join('\n');

interface SubtopicFragment { id: string; title: string; summary: string; from: number; to: number }
interface TopicFragment extends SubtopicFragment { subtopics: SubtopicFragment[] }
interface AgenticChunk {
  id: string;
  summary: string;
  from: number;
  to: number;
  /** 包含重叠上下文的原文范围。from/to 只记录本块正文。 */
  contextFrom: number;
  contextTo: number;
  pageFrom?: number;
  pageTo?: number;
  fragments: TopicFragment[];
}

interface AgenticOptions {
  merge?: boolean;
  onProgress?: (progress: { phase: 'split' | 'merge'; completed: number; total: number; label: string }) => void;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function requiredText(value: unknown, label: string, max?: number): string {
  if (typeof value !== 'string') throw new Error(`${label} 必须是文本`);
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text) throw new Error(`${label} 不能为空`);
  if (max !== undefined && text.length > max) throw new Error(`${label} 超过 ${max} 字`);
  return text;
}

function requiredStart(value: unknown, max: number, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max) {
    throw new Error(`${label} 段落序号无效`);
  }
  return value;
}

function rangeStats(source: string, from: number, to: number) {
  return { from, to, chars: sliceLines(source, from, to).trim().length };
}

/** 从上一窗口的新正文末尾取连续完整段落作为重叠上下文。 */
function trailingContext(body: Para[], budget: number): Para[] {
  let start = body.length;
  while (start > 0) {
    const cost = body[start - 1]!.chars + (start < body.length ? 2 : 0);
    if (cost > budget) break;
    budget -= cost;
    start -= 1;
  }
  return body.slice(start);
}

/**
 * Agentic 两阶段：每窗提取带原文范围的主题树片段，再由一次全局合并整理相邻片段。
 * 合并模型只处理短摘要和引用 ID；原文边界由程序映射并校验。
 */
export async function agenticPlan(
  md: string, opts: PlanOpts, llm: Llm, { merge = true, onProgress }: AgenticOptions = {},
): Promise<Plan | null> {
  const paras = paragraphsOf(md);
  if (!paras.length) return null;
  const windowSize = opts.agenticWindow ?? AGENTIC_WINDOW;
  if (!Number.isInteger(windowSize) || windowSize < MIN_AGENTIC_WINDOW || windowSize > MAX_AGENTIC_WINDOW) {
    throw new RangeError(`agentic window must be an integer from ${MIN_AGENTIC_WINDOW} to ${MAX_AGENTIC_WINDOW}`);
  }

  const overlapBudget = opts.agenticOverlapChars ?? AGENTIC_OVERLAP_CHARS;
  if (!Number.isInteger(overlapBudget) || overlapBudget < 0 || overlapBudget > windowSize) {
    throw new RangeError(`agentic overlap must be an integer from 0 to ${windowSize} characters`);
  }
  const windows: Array<{ body: Para[]; context: Para[] }> = [];
  let current: (typeof windows)[number] = { body: [], context: [] };
  let chars = 0;
  for (const paragraph of paras) {
    if (paragraph.chars > MAX_AGENTIC_WINDOW) {
      throw new Error(`第 ${paragraph.from + 1} 行开始的单段超过 ${MAX_AGENTIC_WINDOW} 字，请先拆分此段`);
    }
    const separator = chars ? 2 : 0;
    if (current.body.length && chars + separator + paragraph.chars > windowSize) {
      windows.push(current);
      // 保证当前窗口至少容纳一个完整的新段落，超长单段独占一窗。
      const budget = Math.min(overlapBudget, windowSize - paragraph.chars - 2);
      const context = trailingContext(current.body, budget);
      current = { body: [paragraph], context };
      chars = paragraph.chars + context.reduce((sum, item) => sum + item.chars + 2, 0);
    } else {
      current.body.push(paragraph);
      chars += separator + paragraph.chars;
    }
  }
  if (current.body.length) windows.push(current);
  if (windows.length > MAX_TOPICS) throw new Error(`文档需要 ${windows.length} 个窗口，请增大窗口或拆分文档`);

  const fragments: TopicFragment[] = [];
  const agenticChunks: AgenticChunk[] = [];
  const lines = md.split(/\r?\n/).length;
  const total = windows.length + (merge ? 1 : 0);

  for (let w = 0; w < windows.length; w += 1) {
    onProgress?.({ phase: 'split', completed: w, total, label: `正在理解第 ${w + 1}/${windows.length} 块` });
    const { body: win, context } = windows[w]!;
    const numbered = win.map((p, i) => `⟪${i + 1}⟫ ${p.text}`).join('\n\n');
    const user = [
      ...(context.length ? [`# 前置上下文\n\n${context.map(({ text }) => text).join('\n\n')}`] : []),
      `# 窗口 ${w + 1}/${windows.length} 的编号原文\n\n${numbered}`,
    ].join('\n\n');

    let parsed: Record<string, unknown> | null;
    try {
      parsed = await traced('plan.chunk', { chunk: w + 1, total: windows.length }, async () =>
        objectValue(parseJsonReply(await llm.ask(AGENTIC_MAP_SYSTEM, user))));
    } catch (err) {
      throw new Error(`第 ${w + 1} 窗主题理解失败：${(err as Error).message}`);
    }
    const raw = Array.isArray(parsed?.topics) ? parsed.topics : [];
    if (!raw.length || raw.length > MAX_WINDOW_TOPICS) throw new Error(`第 ${w + 1} 窗主题数量无效`);
    const chunkSummary = requiredText(parsed?.summary, `第 ${w + 1} 窗摘要`);
    const chunkStart = fragments.length;
    const chunkEndLine = windows[w + 1]?.body[0]?.from ?? lines;

    const starts = raw.map((value, i) => {
      const topic = objectValue(value);
      const label = `第 ${w + 1} 窗主题 ${i + 1}`;
      return {
        children: topic?.subtopics,
        title: requiredText(topic?.title, `${label} 标题`, 64),
        summary: requiredText(topic?.summary, `${label} 摘要`),
        at: requiredStart(topic?.start, win.length, label),
      };
    });
    if (starts[0]!.at !== 1 || starts.some((entry, i) => i > 0 && entry.at <= starts[i - 1]!.at)) {
      throw new Error(`第 ${w + 1} 窗主题起点无效`);
    }
    for (let i = 0; i < starts.length; i += 1) {
      const entry = starts[i]!;
      const nextTopic = starts[i + 1];
      const from = win[entry.at - 1]!.from;
      const to = nextTopic ? win[nextTopic.at - 1]!.from : chunkEndLine;
      const rawSubs = Array.isArray(entry.children) ? entry.children : [];
      if (!rawSubs.length || rawSubs.length > MAX_SUBTOPICS_PER_TOPIC) throw new Error(`主题「${entry.title}」的子主题数量无效`);
      const subs = rawSubs.map((value, j) => {
        const sub = objectValue(value);
        const label = `主题「${entry.title}」的子主题 ${j + 1}`;
        return {
          title: requiredText(sub?.title, `${label} 标题`, 64),
          summary: requiredText(sub?.summary, `${label} 摘要`),
          at: requiredStart(sub?.start, win.length, label),
        };
      });
      if (subs[0]!.at !== entry.at || subs.some((sub, j) => sub.at < entry.at
        || (!!nextTopic && sub.at >= nextTopic.at) || (j > 0 && sub.at <= subs[j - 1]!.at))) {
        throw new Error(`主题「${entry.title}」的子主题起点无效`);
      }
      const id = `f${String(fragments.length + 1).padStart(3, '0')}`;
      const subtopics = subs.map((sub, j) => {
        const subFrom = win[sub.at - 1]!.from;
        const subTo = j + 1 < subs.length ? win[subs[j + 1]!.at - 1]!.from : to;
        return { id: `${id}.s${String(j + 1).padStart(3, '0')}`, title: sub.title, summary: sub.summary,
          from: subFrom, to: subTo };
      });
      fragments.push({ id, title: entry.title, summary: entry.summary, from, to, subtopics });
    }
    const chunkStartLine = win[0].from;
    agenticChunks.push({ id: `chunk_${String(w + 1).padStart(3, '0')}`,
      summary: chunkSummary, from: chunkStartLine, to: chunkEndLine,
      contextFrom: context[0]?.from ?? chunkStartLine, contextTo: chunkEndLine,
      ...pageRange(md, chunkStartLine, chunkEndLine), fragments: fragments.slice(chunkStart) });
  }

  const topics = merge ? await mergeFragments(md, agenticChunks, llm, () => {
    onProgress?.({ phase: 'merge', completed: windows.length, total, label: '正在全局合并主题' });
  }) : fragments.map((fragment) => ({ ...plannedFragment(md, fragment, [fragment.id]),
    subtopics: fragment.subtopics.map((subtopic) => plannedFragment(md, subtopic, [subtopic.id])) }));
  if (topics.length > MAX_TOPICS) throw new Error(`主题超过 ${MAX_TOPICS} 个，请拆分文档`);
  const coveringChunks = ({ from, to }: Pick<PlanSubtopic, 'from' | 'to'>) => agenticChunks
    .filter((chunk) => chunk.from < to && chunk.to > from).map((chunk) => chunk.id);
  return { v: 1, name: opts.name, tier: 'agentic', size: opts.size, depth: opts.depth,
    agenticWindow: windowSize, agenticOverlapChars: overlapBudget, agenticChunks, chars: md.trim().length, notes: [],
    topics: topics.map((topic) => ({ ...topic, chunkIds: coveringChunks(topic),
      subtopics: topic.subtopics?.map((subtopic) => ({ ...subtopic, chunkIds: coveringChunks(subtopic) })) })) };
}

function plannedFragment(md: string, { title, summary, from, to }: Omit<SubtopicFragment, 'id'>, fragmentIds: string[]): PlanSubtopic {
  return { title, summary, ...rangeStats(md, from, to), ...pageRange(md, from, to), summarized: 'model', fragmentIds };
}

async function mergeFragments(md: string, chunks: AgenticChunk[], llm: Llm, onMerge: () => void): Promise<PlanTopic[]> {
  const fragments = chunks.flatMap((chunk) => chunk.fragments);
  const windowStarts = new Set(chunks.slice(1).map((chunk) => chunk.from));
  const payload = JSON.stringify(fragments.map((fragment) => ({
    id: fragment.id, title: fragment.title, summary: fragment.summary,
    ...(windowStarts.has(fragment.from) ? { startsWindow: true } : {}),
    subtopics: fragment.subtopics.map(({ id, title, summary }) => ({ id, title, summary })),
  })));
  const mergeUser = `# 原文顺序中的 ${fragments.length} 个主题片段\n\n${payload}`;
  if (AGENTIC_MERGE_SYSTEM.length + mergeUser.length > AGENTIC_MERGE_MAX_CHARS) {
    throw new Error(`全局合并输入超过 ${AGENTIC_MERGE_MAX_CHARS} 字安全预算；请增大窗口或拆分文档`);
  }
  onMerge();
  let result: Record<string, unknown> | null;
  try {
    result = await traced('plan.merge', { fragments: fragments.length }, async () =>
      objectValue(parseJsonReply(await llm.ask(AGENTIC_MERGE_SYSTEM, mergeUser))));
  } catch (err) {
    throw new Error(`全局主题合并失败：${(err as Error).message}`);
  }
  const groups = Array.isArray(result?.topics) ? result.topics : [];
  if (!groups.length || groups.length > MAX_TOPICS) throw new Error('全局合并主题数量无效');

  const topics: PlanTopic[] = [];
  let topicOffset = 0;
  for (const value of groups) {
    const group = objectValue(value);
    if (!group || !Array.isArray(group.fragmentIds) || !group.fragmentIds.length) throw new Error('合并结果缺少主题片段引用');
    const refs = group.fragmentIds;
    const members = fragments.slice(topicOffset, topicOffset + refs.length);
    if (members.length !== refs.length || refs.some((id, i) => id !== members[i]!.id)) throw new Error('合并主题引用无效或顺序错误');
    if (members.some((member, i) => i > 0 && members[i - 1]!.to !== member.from)) throw new Error('合并主题包含不连续原文');
    const children = members.flatMap((member) => member.subtopics);
    const rawChildren = Array.isArray(group.subtopics) ? group.subtopics : [];
    if (!rawChildren.length) throw new Error('合并主题缺少子主题');
    let childOffset = 0;
    const subtopics = rawChildren.map((value) => {
      const child = objectValue(value);
      if (!child || !Array.isArray(child.fragmentIds) || !child.fragmentIds.length) throw new Error('合并子主题缺少片段引用');
      const childRefs = child.fragmentIds;
      const membersOfChild = children.slice(childOffset, childOffset + childRefs.length);
      if (membersOfChild.length !== childRefs.length || childRefs.some((id, i) => id !== membersOfChild[i]!.id)) {
        throw new Error('合并子主题引用无效或顺序错误');
      }
      if (membersOfChild.some((member, i) => i > 0 && membersOfChild[i - 1]!.to !== member.from)) throw new Error('合并子主题包含不连续原文');
      childOffset += childRefs.length;
      const from = membersOfChild[0]!.from;
      const to = membersOfChild[membersOfChild.length - 1]!.to;
      return plannedFragment(md, { title: requiredText(child.title, '合并子主题标题', 64),
        summary: requiredText(child.summary, '合并子主题摘要'), from, to }, membersOfChild.map(({ id }) => id));
    });
    if (childOffset !== children.length) throw new Error('全局合并遗漏子主题片段');
    const from = members[0]!.from;
    const to = members[members.length - 1]!.to;
    topics.push({ ...plannedFragment(md, { title: requiredText(group.title, '合并主题标题', 64),
      summary: requiredText(group.summary, '合并主题摘要'), from, to }, members.map(({ id }) => id)), subtopics,
      ...(members.length > 1 ? { merged: members.length } : {}) });
    topicOffset += refs.length;
  }
  if (topicOffset !== fragments.length) throw new Error('全局合并遗漏主题片段');
  return topics;
}

/** 一节的首句：没有模型时的摘要回落，也是摘要失败时的兜底。 */
export function firstSentence(text: string, max = 60): string {
  const flat = text
    .split('\n')
    .filter((l) => !/^\s*#{1,6}\s/.test(l) && !/^\s*<!--\s*cognirogue-page:/.test(l))
    .map((l) => l.replace(/^[#>*\s]+/, '').trim())
    .filter((l) => l && !l.startsWith('```') && !/^[\w-]+\.md$/i.test(l))
    .join(' ');
  const cut = flat.split(/[。！？；.!?;]/)[0] ?? flat;
  return (cut || flat).slice(0, max);
}

/** 有一节文本的原文。生成一侧按计划取正文，别处不许自己 slice。 */
export function planText(md: string, t: PlanTopic): string {
  return sliceLines(md, t.from, t.to);
}
