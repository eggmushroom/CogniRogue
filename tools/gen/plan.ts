/**
 * 文档 → **划分计划**：这一份文档分成哪几节、每节叫什么、每节多大。
 *
 * 自动模式只走确定性路径：有目录用 `toc`，没有目录用 `fixed`。
 * `agentic` 是玩家主动选择的模型分章，不会由上传流程隐式触发。
 *
 * 摘要默认取首句；只在明确选择模型分章时请求模型摘要，并用于相邻节合并。
 *
 * 为什么摘要要比对而不是直接信模型"把这两章合并"：合并的判据必须可复现、
 * 可回放。两段摘要 2-gram 交集的比例是整数，同一份计划跑两次结论一样。
 */
import { blocksOf, headingsOf, paragraphsOf, sliceLines } from './chunk';
import type { Block } from './chunk';
import type { Llm } from './llm';
import { parseJsonReply } from './llm';
import type { SourceSection } from './memory';

export type PlanTier = 'toc' | 'agentic' | 'fixed';

export interface PlanTopic {
  id?: string;
  title: string;
  /** 起始行（含）。 */
  from: number;
  /** 结束行（不含）。 */
  to: number;
  chars: number;
  sections?: SourceSection[];
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
    if (mark) page = Number(mark[1]);
    if (index >= from && index < to && page) {
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
}

export const PLAN_SIZE = 4000;
export const PLAN_DEPTH = 2;
/** 一窗多少字喂给模型分章。太大到不了模型的上限，太小切点会被窗口切断。 */
export const AGENTIC_WINDOW = 6000;
/** 一节少于这么多字就不值得单独成为一节（并没有内容可出题）。 */
const MIN_TOPIC = 300;
/** 一次划分最多这么多节：超过就是切得太碎，回落到固定层更稳。 */
const MAX_TOPICS = 80;

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

const AGENTIC_SYSTEM = [
  '你是教材编辑，只依据用户给的原文分章，不引入原文以外的知识。',
  '每一章必须从某一段的开始处切，不许从段落中间切。',
  '只输出 JSON，不要解释、不要代码围栏。',
].join('\n');

interface WindowTopic { title?: unknown; start?: unknown }

/**
 * 模型层：按窗口把段落编号交给模型，让它给"从第几段开始是新的一章"。
 *
 * 分窗而不是一次全书：一次吃完 50 万字既超上下文，切点也会糊。
 * 每窗独立判、窗与窗之间强制在窗首断一次 —— 窗口边界由我们定，不从模型嘴里问。
 */
export async function agenticPlan(
  md: string, opts: PlanOpts, llm: Llm, onLog?: (s: string) => void,
): Promise<Plan | null> {
  const paras = paragraphsOf(md);
  if (!paras.length) return null;

  // 按字数装窗，窗内段落不拆
  const windows: Array<Array<{ from: number; to: number; text: string }>> = [];
  let cur: Array<{ from: number; to: number; text: string }> = [];
  let chars = 0;
  for (const p of paras) {
    if (cur.length && chars + p.chars > AGENTIC_WINDOW) { windows.push(cur); cur = []; chars = 0; }
    cur.push({ from: p.from, to: p.to, text: p.text });
    chars += p.chars;
  }
  if (cur.length) windows.push(cur);

  const topics: PlanTopic[] = [];
  const lines = md.split(/\r?\n/).length;

  for (let w = 0; w < windows.length; w += 1) {
    const win = windows[w];
    const numbered = win.map((p, i) => `⟪${i + 1}⟫ ${p.text}`).join('\n\n');
    const user = [
      `# 这本小册子的一窗（第 ${w + 1} / ${windows.length} 窗）`,
      numbered,
      '# 要你做的事',
      '把这一窗按内容分成若干章，每章从某一号段落开始。',
      '只返回：{"topics":[{"title":"不超过 12 个字","start":1}]}',
      'start 是段落序号（1 基），第一项必须是 1，之后严格递增。',
    ].join('\n\n');

    let parsed: { topics?: unknown };
    try {
      parsed = parseJsonReply(await llm.ask(AGENTIC_SYSTEM, user)) as { topics?: unknown };
    } catch (err) {
      onLog?.(`第 ${w + 1} 窗分章失败：${(err as Error).message}`);
      return null;
    }
    const raw = Array.isArray(parsed.topics) ? parsed.topics as WindowTopic[] : [];
    if (!raw.length) { onLog?.(`第 ${w + 1} 窗没有返回任何章`); return null; }

    const starts: Array<{ title: string; at: number }> = [];
    for (const t of raw) {
      const at = Number(t.start);
      const title = String(t.title ?? '').replace(/\s+/g, ' ').trim();
      if (!title || !Number.isInteger(at) || at < 1 || at > win.length) return null;
      if (starts.length && at <= starts[starts.length - 1].at) return null;
      starts.push({ title, at });
    }
    // 窗首必须是一章的开头：窗是我们在段落边界上切的，不是模型选的
    if (starts[0].at !== 1) starts.unshift({ title: `第 ${w + 1} 节`, at: 1 });

    for (let i = 0; i < starts.length; i += 1) {
      const s = starts[i];
      const from = win[s.at - 1].from;
      const to = i + 1 < starts.length ? win[starts[i + 1].at - 1].from : (w + 1 < windows.length ? windows[w + 1][0].from : lines);
      const text = sliceLines(md, from, to);
      const charsOut = text.trim().length;
      if (charsOut < 1) continue;
      topics.push({ title: s.title, from, to, chars: charsOut, summary: '', summarized: 'none' });
    }
    onLog?.(`第 ${w + 1} / ${windows.length} 窗：${starts.length} 节`);
  }

  if (topics.length > MAX_TOPICS) return null;
  // 太碎的节并进前一个（第一个并进后一个）。它们的边界是模型给的，
  // 但"太碎"的判据是我们的：几百字的分节出不了题，只会在出题时被丢掉。
  const kept: PlanTopic[] = [];
  for (const t of topics) {
    if (t.chars < MIN_TOPIC && kept.length) {
      const prev = kept[kept.length - 1];
      prev.to = t.to;
      prev.chars = sliceLines(md, prev.from, prev.to).trim().length;
      continue;
    }
    kept.push(t);
  }
  while (kept.length > 1 && kept[0].chars < MIN_TOPIC) {
    kept[1].from = kept[0].from;
    kept[1].chars = sliceLines(md, kept[1].from, kept[1].to).trim().length;
    kept.shift();
  }

  return {
    v: 1, name: opts.name, tier: 'agentic', size: opts.size, depth: opts.depth,
    chars: md.trim().length, topics: kept,
    notes: kept.length ? [] : ['模型没有给出可用的分章'],
  };
}

const SUMMARY_SYSTEM = [
  '你是教材编辑。用一句话概括给你的这一节讲了什么。',
  '只讲事实：它定义了什么、讲了什么做法、给了什么例子。不要评价，不要复述标题，不要说"本节"。',
  '不超过 60 字。只输出那一句话。',
].join('\n');

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

/**
 * 给每一节补摘要。有模型就一节一次调用（失败的那节回落到首句，不中断整份计划）；
 * 没有模型就全用首句，并把"跳过模型"写进 notes。
 */
export async function summarizePlan(
  plan: Plan, md: string, llm: Llm | null, onLog?: (s: string) => void,
): Promise<Plan> {
  const notes = [...plan.notes];
  const topics: PlanTopic[] = [];
  for (const t of plan.topics) {
    const text = sliceLines(md, t.from, t.to);
    let summary = '';
    if (llm) {
      try {
        const reply = await llm.ask(SUMMARY_SYSTEM, `# 这一节\n${text.slice(0, 2500)}`);
        summary = reply.replace(/\s+/g, ' ').replace(/^["'「]|["'」]$/g, '').trim().slice(0, 120);
      } catch (err) {
        onLog?.(`「${t.title}」摘要失败：${(err as Error).message}`);
      }
    }
    topics.push(summary
      ? { ...t, summary, summarized: 'model' }
      : { ...t, summary: firstSentence(text), summarized: 'none' });
  }
  if (!llm) notes.push('没有配模型：摘要用首句代替，没做合并判断。');
  return { ...plan, topics, notes };
}

/** 两段摘要的 2-gram 交集与并集。判据只认这两个整数。 */
export function overlap(a: string, b: string): { inter: number; union: number } {
  const grams = (s: string) => {
    const t = s.replace(/[\s\p{P}\p{S}]/gu, '');
    const out = new Set<string>();
    for (let i = 0; i + 1 < t.length; i += 1) out.add(t.slice(i, i + 2));
    return out;
  };
  const A = grams(a);
  const B = grams(b);
  let inter = 0;
  for (const g of A) if (B.has(g)) inter += 1;
  return { inter, union: A.size + B.size - inter };
}

/** 相似度（整数百分比）。只给显示用；判据走 `similarEnough()` 的交叉相乘。 */
export function similarity(a: string, b: string): number {
  const { inter, union } = overlap(a, b);
  return union ? Math.floor((inter * 100) / union) : 0;
}

/** `inter / union >= pct / 100` 的整数写法：不引入浮点，也就没有边界抖动。 */
export function similarEnough(a: string, b: string, pct: number): boolean {
  const { inter, union } = overlap(a, b);
  return union > 0 && inter * 100 >= pct * union;
}

export interface MergeOpts {
  /** 相似度下限（整数百分比）。 */
  pct: number;
  /** 合并后一节最多多少字。 */
  maxChars: number;
  /** 最多把几节并成一节。 */
  maxParts: number;
}

export const MERGE_PCT = 55;
export const MERGE_MAX_CHARS = 8000;
export const MERGE_MAX_PARTS = 4;

/**
 * 相邻合并：单遍、从前向后，能并就并。
 *
 * 单遍是刻意的：并完之后摘要变了却又拿去比下一节，结论会依赖遍历顺序，
 * 同一份计划两种顺序能给出不同结果。这里只在**原始摘要**之间比较。
 */
export function mergePlan(plan: Plan, opts: MergeOpts = {
  pct: MERGE_PCT, maxChars: MERGE_MAX_CHARS, maxParts: MERGE_MAX_PARTS,
}): Plan {
  const out: PlanTopic[] = [];
  for (const t of plan.topics) {
    const prev = out[out.length - 1];
    const parts = prev ? (prev.merged ?? 1) : 0;
    const fits = !!prev && parts < opts.maxParts && prev.chars + t.chars <= opts.maxChars;
    if (prev && fits && similarEnough(prev.summary, t.summary, opts.pct)) {
      const sim = similarity(prev.summary, t.summary);
      prev.to = t.to;
      prev.chars += t.chars;
      prev.merged = parts + 1;
      prev.sim = sim;
      // 摘要留在长的那一份上：它更能代表合并后的一节
      if (t.summary.length > prev.summary.length) {
        prev.summary = t.summary;
        prev.summarized = t.summarized;
      }
      continue;
    }
    out.push({ ...t });
  }
  return { ...plan, topics: out };
}

/** 计划渲染成给模型的目录：名字 + 规模 + 摘要。也是 JIT 的索引。 */
export function planTocText(plan: Plan): string {
  return plan.topics
    .map((t) => `- ${t.title} · ${t.chars} 字${t.summary ? ` · ${t.summary}` : ''}`)
    .join('\n');
}

/** 有一节文本的原文。生成一侧按计划取正文，别处不许自己 slice。 */
export function planText(md: string, t: PlanTopic): string {
  return sliceLines(md, t.from, t.to);
}
