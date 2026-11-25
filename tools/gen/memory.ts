/**
 * 每个主题一份记忆文档：**这个主题已经出过什么、玩家在哪些知识点上栽跟头**。
 *
 * 为什么要单独存一份、而不是每次从题库现场统计：题库是生成物，会被整份重写；
 * 记忆必须活得比题库长。玩家在 `algo/binary-worst` 上连错五次这件事，
 * 重写题库时不能丢 —— 丢了就等于每轮重新开始猜"他哪里不会"。
 *
 * 两份记忆各管一段，不许混：
 *   - 这里是**服务侧**主题记忆（本机文件），记录知识点、答题战绩与已消费事件；
 *   - 玩家浏览器保留掌握统计与未确认的答题事件（`library/stagemem.ts`）；
 *   - 服务端按题号保存流水，再由生成器通过 `mergeSnapshot()` 消费。
 */
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { headingsOf, sliceLines } from './chunk';
import { pageRange, type Plan, type PlanTopic } from './plan';

export interface SourceSection {
  id: string;
  title: string;
  parentId?: string;
  pageFrom?: number;
  pageTo?: number;
}

export interface SectionDocument {
  id: string;
  content: string;
}

export function sourceSectionId(source: string, path: string[], occurrence = 1): string {
  return `sec_${createHash('sha256').update(`${source}\0${path.join('\0')}\0${occurrence}`).digest('hex').slice(0, 16)}`;
}

export interface KnowledgeMem {
  /** 用于核对及复用知识点 ID 的规范名称。 */
  label: string;
  /** 上一次生成的题干：内容变了就该重出，没变就跳过。 */
  stem: string;
  /** 生成过几次。 */
  gen: number;
  questions: Record<string, { stem: string; options: string[]; answer: number }>;
}

interface QuestionStats { ok: number; bad: number; attempts: number[] }

export interface TopicMem {
  v: typeof MEM_V;
  topicId: string;
  topic: string;
  /** 这份记忆对应的源文档，换书时能看出记忆属于哪本。 */
  source: string;
  knowledge: Record<string, KnowledgeMem>;
  cursor: number;
  stats: Record<string, QuestionStats>;
  /** 章节标题与文件 ID；PDF 同时保留物理页码。 */
  sections?: SourceSection[];
}

export const MEM_V = 6;

/** 玩家导出的快照里，这一段和 `library/stagemem.ts` 的 `StudySnapshot` 对齐。 */
export type StudySnapshot = {
  v: 2;
  topics: Record<string, { ok: number; bad: number; q: Record<string, { ok: number; bad: number; attempts?: number[] }> }>;
} | {
  v: 3;
  topicId: string;
  after: number;
  through: number;
  records: Array<{ seq: number; type: 'answer' | 'reset'; qid: string; right?: boolean | 0 | 1; choice?: number }>;
};

export function memFile(dir: string, topicId: string): string {
  if (!/^t_[a-f0-9]{24}$/.test(topicId)) throw new Error(`Invalid topic ID: ${topicId}`);
  return join(dir, `${topicId}.json`);
}

export function newTopicMem(topic: string, source: string, topicId = `t_${createHash('sha256').update(`${source}\0${topic}`).digest('hex').slice(0, 24)}`): TopicMem {
  return { v: MEM_V, topicId, topic, source, knowledge: {}, cursor: 0, stats: {} };
}

export function readTopicMem(dir: string, topic: string, source: string, topicId: string): TopicMem {
  const file = memFile(dir, topicId);
  if (!existsSync(file)) return newTopicMem(topic, source, topicId);
  const raw = JSON.parse(readFileSync(file, 'utf8')) as TopicMem;
  if (raw.v !== MEM_V || raw.topicId !== topicId) throw new Error(`Invalid topic memory: ${topicId}`);
  return { ...raw, topic, source };
}

export function topicIdOf(sourceId: string, source: string, topic: PlanTopic): string {
  const headings = headingsOf(source).filter((heading) => heading.line <= topic.from);
  const heading = headings.at(-1);
  const path = headings.reduce<typeof headings>((path, item) => {
    while (path.length && path.at(-1)!.level >= item.level) path.pop();
    path.push(item);
    return path;
  }, []).map((item) => item.text).join('\0');
  const duplicates = headings.filter((item) => item.text === (heading?.text ?? topic.title) && item.line <= topic.from).length;
  return `t_${createHash('sha256').update(`${sourceId}\0${path || topic.title}\0${duplicates}`).digest('hex').slice(0, 24)}`;
}

/** Both CLI entry points materialize the same sections before starting an agent. */
export function prepareSections(plan: Plan, sourceId: string, source: string): SectionDocument[] {
  const files = plan.topics.flatMap((topic) => {
    topic.id = topicIdOf(sourceId, source, topic);
    const mem = newTopicMem(topic.title, sourceId, topic.id);
    const documents = indexTopicMemory(mem, source, topic);
    topic.sections = mem.sections;
    return documents;
  });
  plan.v = 2;
  return files;
}

/** 划分时切出独立原文文件；JIT 后续只凭 ID 读取，不再扫描整本书。 */
export function indexTopicMemory(mem: TopicMem, source: string, topic: PlanTopic): SectionDocument[] {
  const headings = headingsOf(source);
  const heads = headings.filter((head) => head.line > topic.from && head.line < topic.to);
  const atTopic = headings.find((head) => head.line === topic.from);
  const rootLevel = atTopic?.level ?? 0;
  type Node = { id: string; title: string; parentId?: string; level: number; from: number; path: string[] };
  const root: Node = { id: '', title: topic.title, level: rootLevel, from: topic.from, path: [mem.topicId] };
  const nodes: Node[] = [root];
  const stack: Node[] = [root];
  const occurrences = new Map<string, number>();
  const makeId = (path: string[]) => {
    const key = path.join('\0');
    const occurrence = (occurrences.get(key) ?? 0) + 1;
    occurrences.set(key, occurrence);
    return sourceSectionId(mem.source, path, occurrence);
  };
  root.id = makeId(root.path);
  for (const head of heads) {
    while (stack.length > 1 && stack[stack.length - 1]!.level >= head.level) stack.pop();
    const parent = stack[stack.length - 1]!;
    const path = [...parent.path, head.text];
    const node: Node = { id: makeId(path), title: head.text, parentId: parent.id, level: head.level, from: head.line, path };
    nodes.push(node);
    stack.push(node);
  }
  const files = nodes.map((node, index) => {
    const to = nodes[index + 1]?.from ?? topic.to;
    const pages = pageRange(source, node.from, to);
    return {
      metadata: { id: node.id, title: node.title, ...(node.parentId ? { parentId: node.parentId } : {}), ...(pages ?? {}) },
      file: { id: node.id, content: sliceLines(source, node.from, to).trim() + '\n' },
    };
  });
  mem.sections = files.map((entry) => entry.metadata);
  return files.map((entry) => entry.file);
}

export function readMemorySection(mem: TopicMem, directory: string, id: string): string | null {
  if (!/^sec_[a-f0-9]{16}$/.test(id) || !mem.sections?.some((section) => section.id === id)) return null;
  const file = join(directory, `${id}.md`);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

/** A reset is a change to one question, never subtraction from a shared counter. */
export function mergeSnapshot(
  mem: TopicMem,
  snapshot: StudySnapshot,
  knowledgeIdByQid: Record<string, string>,
): { merged: number; orphan: number } {
  let orphan = 0;
  const touched = new Set<string>();
  const accept = (qid: string) => {
    const id = knowledgeIdByQid[qid];
    if (!id) { orphan++; return false; }
    touched.add(id);
    return true;
  };
  if (snapshot.v === 3) {
    if (snapshot.topicId !== mem.topicId || snapshot.through < snapshot.after) throw new Error('Invalid feedback scope');
    if (snapshot.through <= mem.cursor) return { merged: 0, orphan: 0 };
    if (snapshot.after !== mem.cursor) throw new Error('Feedback does not follow the committed cursor');
    for (const row of snapshot.records) {
      if (row.seq <= mem.cursor || row.seq > snapshot.through) throw new Error('Invalid feedback order');
      mem.cursor = row.seq;
      if (!accept(row.qid)) continue;
      if (row.type === 'reset') { delete mem.stats[row.qid]; continue; }
      const stat = (mem.stats[row.qid] ??= { ok: 0, bad: 0, attempts: [] });
      stat[row.right ? 'ok' : 'bad']++;
      if (row.choice != null) stat.attempts.push(row.choice);
    }
    if (mem.cursor !== snapshot.through) throw new Error('Incomplete feedback');
  } else if (snapshot.v === 2) {
    const questions = snapshot.topics[mem.topicId]?.q;
    if (questions) {
      mem.stats = {};
      for (const [qid, stat] of Object.entries(questions)) if (accept(qid)) {
        mem.stats[qid] = { ok: stat.ok, bad: stat.bad, attempts: stat.attempts?.slice() ?? [] };
      }
    }
  } else throw new Error('Unsupported feedback version');
  return { merged: touched.size, orphan };
}

function tally(mem: TopicMem, c: KnowledgeMem) {
  let ok = 0, bad = 0;
  for (const qid of Object.keys(c.questions)) {
    ok += mem.stats[qid]?.ok ?? 0;
    bad += mem.stats[qid]?.bad ?? 0;
  }
  return { ok, bad };
}

function isWeak(c: KnowledgeMem, { ok, bad }: ReturnType<typeof tally>): boolean {
  return c.gen === 0 || bad >= 2 || (ok + bad > 0 && bad * 2 >= ok + bad);
}

/** 注入给模型的那段文字：它读得懂的、只讲事实的一小段。 */
export function memText(mem: TopicMem, limit = 40): string {
  const entries = Object.entries(mem.knowledge);
  if (!entries.length) return `（主题「${mem.topic}」还没有出过题，这是第一轮。）`;

  const weak = entries.filter(([, c]) => isWeak(c, tally(mem, c)));
  const show = (list: [string, KnowledgeMem][]) =>
    list.slice(0, limit).map(([id, c]) => {
      const { ok, bad } = tally(mem, c);
      const stat = ok + bad ? `玩家 ${ok} 对 ${bad} 错` : '还没有玩家数据';
      const choices = Object.entries(c.questions).flatMap(([qid, question]) => {
        const seq = mem.stats[qid]?.attempts;
        if (!seq?.length) return [];
        const options = question?.options.map((option, index) => `${index + 1}=${option}`).join('；');
        const answer = question ? `；正确选项 ${question.answer + 1}` : '';
        return [`${qid}: [${seq.join(',')}]${options ? `（${options}${answer}）` : ''}`];
      }).join('；');
      return `- ${c.label} [${id}]｜${c.stem.slice(0, 40)}｜出过 ${c.gen} 次｜${stat}${choices ? `｜原题选项选择顺序（1-based）${choices}` : ''}`;
    }).join('\n');

  const out = [`主题「${mem.topic}」已覆盖 ${entries.length} 个知识点。`];
  if (weak.length) {
    out.push('', `这 ${weak.length} 个知识点要重出或换问法（错得多，或者从没出过）：`, show(weak));
  }
  const solid = entries.filter(([, c]) => !isWeak(c, tally(mem, c)));
  if (solid.length) out.push('', '这些已经稳了，除非要补新角度，不要重复出：', show(solid));
  return out.join('\n');
}

export function sourceIndexText(mem: TopicMem): string {
  return (mem.sections ?? []).map((section) => {
    const pages = section.pageFrom ? `｜PDF 第 ${section.pageFrom}-${section.pageTo} 页` : '';
    return `- ${section.id} | ${section.title}${section.parentId ? ` | parent ${section.parentId}` : ''}${pages}`;
  }).join('\n');
}
