/**
 * 每个主题一份记忆文档：**这个主题已经出过什么、玩家在哪些概念上栽跟头**。
 *
 * 为什么要单独存一份、而不是每次从题库现场统计：题库是生成物，会被整份重写；
 * 记忆必须活得比题库长。玩家在 `algo/binary-worst` 上连错五次这件事，
 * 重写题库时不能丢 —— 丢了就等于每轮重新开始猜"他哪里不会"。
 *
 * 两份记忆各管一段，不许混：
 *   - 这里是**作者侧**记忆（仓库里，可读可写），记录概念与累计战绩；
 *   - 玩家浏览器里的 `cognirogue.stage.v1` 是**玩家侧**记忆（`library/stagemem.ts`）。
 * 游戏运行时对外通信是 0 次，所以玩家侧数据只能由玩家手动导出
 * （结算页「导出错题」），再由 `mergeSnapshot()` 并进来。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ConceptMem {
  /** 上一次生成的题干：内容变了就该重出，没变就跳过。 */
  stem: string;
  /** 生成过几次。 */
  gen: number;
  /** 玩家侧累计对错，只有导出过才有数。 */
  ok: number;
  bad: number;
}

export interface TopicMem {
  v: 1;
  topic: string;
  /** 这份记忆对应的源文档，换书时能看出记忆属于哪本。 */
  source: string;
  concepts: Record<string, ConceptMem>;
}

export const MEM_V = 1;

/** 玩家导出的快照里，这一段和 `library/stagemem.ts` 的 `StudySnapshot` 对齐。 */
export interface StudySnapshot {
  v: number;
  topics: Record<string, { ok: number; bad: number; q: Record<string, { ok: number; bad: number }> }>;
}

/** 文件名用主题名，去掉路径分隔符这类在 Windows 上非法的字符。 */
export function memFile(dir: string, topic: string): string {
  const slug = topic.replace(/[\\/:*?"<>|\s]+/g, '_');
  return join(dir, `${slug}.json`);
}

export function newTopicMem(topic: string, source: string): TopicMem {
  return { v: MEM_V, topic, source, concepts: {} };
}

export function readTopicMem(dir: string, topic: string, source: string): TopicMem {
  try {
    const raw = JSON.parse(readFileSync(memFile(dir, topic), 'utf8')) as TopicMem;
    if (raw?.v !== MEM_V) return newTopicMem(topic, source);
    return { v: MEM_V, topic, source: source || raw.source, concepts: raw.concepts ?? {} };
  } catch {
    // 没有记忆文件是常态（第一次生成），不是错误
    return newTopicMem(topic, source);
  }
}

export function writeTopicMem(dir: string, mem: TopicMem): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(memFile(dir, mem.topic), JSON.stringify(mem, null, 2) + '\n', 'utf8');
}

/**
 * 把玩家快照并进记忆。
 *
 * 快照按 `qid` 记，而 `qid = hash(主题 + 概念)`，所以必须先有
 * 「qid → 概念」的映射（由当前题库算出来，见 `emit.ts` 的 `conceptByQid`）。
 * 映射不到的题直接跳过：那是上一版题库留下的号，硬记会记到错的 Concept 上。
 */
export function mergeSnapshot(
  mem: TopicMem,
  snapshot: StudySnapshot,
  conceptByQid: Record<string, string>,
): { merged: number; orphan: number } {
  const per: Record<string, { ok: number; bad: number }> = {};
  let orphan = 0;
  for (const [qid, stat] of Object.entries(snapshot.topics[mem.topic]?.q ?? {})) {
    const concept = conceptByQid[qid];
    if (!concept) { orphan += 1; continue; }
    const acc = (per[concept] ??= { ok: 0, bad: 0 });
    acc.ok += stat.ok;
    acc.bad += stat.bad;
  }
  let merged = 0;
  for (const [concept, stat] of Object.entries(per)) {
    const c = (mem.concepts[concept] ??= { stem: '', gen: 0, ok: 0, bad: 0 });
    // 快照是**累计值**，直接覆盖而不是累加：同一份导出并两次不该翻倍
    c.ok = stat.ok;
    c.bad = stat.bad;
    merged += 1;
  }
  return { merged, orphan };
}

/** 一个概念"该重出"的判据：错得多，或者还没出过。 */
export function isWeak(c: ConceptMem): boolean {
  return c.gen === 0 || c.bad >= 2 || (c.ok + c.bad > 0 && c.bad * 2 >= c.ok + c.bad);
}

/** 注入给模型的那段文字：它读得懂的、只讲事实的一小段。 */
export function memText(mem: TopicMem, limit = 40): string {
  const entries = Object.entries(mem.concepts);
  if (!entries.length) return `（主题「${mem.topic}」还没有出过题，这是第一轮。）`;

  const weak = entries.filter(([, c]) => isWeak(c));
  const show = (list: [string, ConceptMem][]) =>
    list.slice(0, limit).map(([id, c]) => {
      const seen = c.ok + c.bad;
      const stat = seen ? `玩家 ${c.ok} 对 ${c.bad} 错` : '还没有玩家数据';
      return `- ${id}｜${c.stem.slice(0, 40)}｜出过 ${c.gen} 次｜${stat}`;
    }).join('\n');

  const out = [`主题「${mem.topic}」已覆盖 ${entries.length} 个概念。`];
  if (weak.length) {
    out.push('', `这 ${weak.length} 个概念要重出或换问法（错得多，或者从没出过）：`, show(weak));
  }
  const solid = entries.filter(([, c]) => !isWeak(c));
  if (solid.length) out.push('', '这些已经稳了，除非要补新角度，不要重复出：', show(solid));
  return out.join('\n');
}
