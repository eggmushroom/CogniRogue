/** 服务侧主题记忆由原文索引、题目目录和学习进度组成，生成时按主题组合读取。 */
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { BAL } from '../../src/core/model/data';
import type { Question } from '../../src/core/model/types';
import type { GenQuestion } from './emit';
import { headingsOf, sliceLines } from './chunk';
import { pageRange, type Plan, type PlanTopic } from './plan';

export interface SourceSection {
  id: string;
  title: string;
  summary?: string;
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
  questions: Record<string, { stem: string; options: string[]; answer: number; sectionIds?: string[] }>;
}

interface QuestionStats { ok: number; bad: number; attempts: number[] }

interface TopicSourceIndex {
  topicId: string;
  topic: string;
  source: string;
  /** 章节标题与文件 ID，PDF 同时保留物理页码。 */
  sections?: SourceSection[];
}

interface TopicQuestionCatalog { knowledge: Record<string, KnowledgeMem> }

interface TopicLearningProgress {
  cursor: number;
  stats: Record<string, QuestionStats>;
}

export interface TopicMem extends TopicSourceIndex, TopicQuestionCatalog, TopicLearningProgress {
  v: typeof MEM_V;
}

export const MEM_V = 7;
const LEGACY_MEM_V = 6;

/** 玩家导出的快照里，这一段和 `library/stagemem.ts` 的 `StudySnapshot` 对齐。 */
export type StudySnapshot = {
  v: 2;
  topics: Record<string, { ok: number; bad: number; q: Record<string, { ok: number; bad: number; attempts?: number[] }> }>;
} | {
  v: 3;
  topicId: string;
  after: number;
  through: number;
  records: Array<{ seq: number; type: 'answer' | 'reset'; qid: string; right?: boolean | 0 | 1; choice?: number | null }>;
};

type MemoryPart = 'source' | 'questions' | 'progress';

function memoryPath(dir: string, topicId: string, part?: MemoryPart): string {
  if (!/^t_[a-f0-9]{24}$/.test(topicId)) throw new Error(`Invalid topic ID: ${topicId}`);
  return resolve(dir, part ? `${topicId}.${part}.json` : `${topicId}.json`);
}

function readMemoryFile<T>(file: string, topicId: string, version: number): T | undefined {
  if (!existsSync(file)) return undefined;
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  if (raw?.v !== version || raw.topicId !== topicId) throw new Error(`Invalid topic memory: ${file}`);
  return raw as T;
}

function memoryFile(dir: string, topicId: string, part: MemoryPart, data: object) {
  return {
    target: memoryPath(dir, topicId, part),
    content: JSON.stringify({ v: MEM_V, topicId, ...data }, null, 2) + '\n',
  };
}

export function sourceIndexFile(dir: string, { topicId, topic, source, sections }: TopicSourceIndex) {
  return memoryFile(dir, topicId, 'source', { topic, source, sections });
}

/** 暂存新建或发生变化的组件，与题库一起提交。缺少的组件在此时从旧格式迁移。 */
export function changedTopicMemFiles(dir: string, mem: TopicMem) {
  const { topicId, knowledge, cursor, stats } = mem;
  return [
    sourceIndexFile(dir, mem),
    memoryFile(dir, topicId, 'questions', { knowledge }),
    memoryFile(dir, topicId, 'progress', { cursor, stats }),
  ].filter(({ target, content }) => !existsSync(target) || readFileSync(target, 'utf8') !== content);
}

export function newTopicMem(topic: string, source: string, topicId = `t_${createHash('sha256').update(`${source}\0${topic}`).digest('hex').slice(0, 24)}`): TopicMem {
  return { v: MEM_V, topicId, topic, source, knowledge: {}, cursor: 0, stats: {} };
}

export function readTopicMem(dir: string, topic: string, source: string, topicId: string): TopicMem {
  const index = readMemoryFile<TopicSourceIndex>(memoryPath(dir, topicId, 'source'), topicId, MEM_V);
  const catalog = readMemoryFile<TopicQuestionCatalog>(memoryPath(dir, topicId, 'questions'), topicId, MEM_V);
  const progress = readMemoryFile<TopicLearningProgress>(memoryPath(dir, topicId, 'progress'), topicId, MEM_V);
  // 重新划分可以先于出题迁移索引，逐个组件回退到 v6。
  const legacy = index && catalog && progress ? undefined : readMemoryFile<Omit<TopicMem, 'v'>>(
    memoryPath(dir, topicId), topicId, LEGACY_MEM_V,
  );
  return {
    ...newTopicMem(topic, source, topicId),
    sections: (index ?? legacy)?.sections,
    knowledge: (catalog ?? legacy)?.knowledge ?? {},
    cursor: (progress ?? legacy)?.cursor ?? 0,
    stats: (progress ?? legacy)?.stats ?? {},
  };
}

/** 从题库回补旧题的选项；题库 DSL 不含证据，不覆盖未变化题目的记忆。 */
export function syncBankQuestions(mem: TopicMem, questions: readonly Question[]): void {
  for (const q of questions) {
    const knowledge = q.knowledgeId ? mem.knowledge[q.knowledgeId] : undefined;
    if (!knowledge) continue;
    const saved = knowledge.questions[q.qid];
    if (saved?.stem === q.q && saved.answer === q.answer
        && saved.options.length === q.options.length && saved.options.every((option, i) => option === q.options[i])) continue;
    knowledge.questions[q.qid] = { stem: q.q, options: q.options.slice(), answer: q.answer };
  }
}

export function topicIdOf(sourceId: string, source: string, topic: PlanTopic, disambiguate = false): string {
  const headings = headingsOf(source).filter((heading) => heading.line <= topic.from);
  const heading = headings.at(-1);
  const path = headings.reduce<typeof headings>((path, item) => {
    while (path.length && path.at(-1)!.level >= item.level) path.pop();
    path.push(item);
    return path;
  }, []).map((item) => item.text).join('\0');
  const duplicates = headings.filter((item) => item.text === (heading?.text ?? topic.title) && item.line <= topic.from).length;
  const identity = `${sourceId}\0${path || topic.title}\0${duplicates}`
    + (disambiguate ? `\0${topic.title}\0${topic.from}` : '');
  return `t_${createHash('sha256').update(identity).digest('hex').slice(0, 24)}`;
}

/** Both CLI entry points materialize the same sections before starting an agent. */
export function prepareSections(plan: Plan, sourceId: string, source: string): SectionDocument[] {
  const files = plan.topics.flatMap((topic) => {
    topic.id = topicIdOf(sourceId, source, topic, plan.tier === 'agentic');
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
  if (topic.subtopics?.length) {
    const files = topic.subtopics.map((subtopic) => {
      const id = sourceSectionId(mem.source, [mem.topicId, 'subtopic', String(subtopic.from), String(subtopic.to)]);
      return {
        section: { id, title: subtopic.title, summary: subtopic.summary, ...pageRange(source, subtopic.from, subtopic.to) },
        file: { id, content: sliceLines(source, subtopic.from, subtopic.to).trim() + '\n' },
      };
    });
    mem.sections = files.map(({ section }) => section);
    return files.map(({ file }) => file);
  }
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

/** 追加同一主题的流水。整批通过校验后才更新统计和游标。 */
export function mergeSnapshot(
  mem: TopicMem,
  snapshot: StudySnapshot,
  knowledgeIdByQid: Record<string, string>,
): { merged: number; orphan: number } {
  const questionKnowledge = new Map(Object.entries(knowledgeIdByQid));
  for (const [id, knowledge] of Object.entries(mem.knowledge)) {
    for (const qid of Object.keys(knowledge.questions)) questionKnowledge.set(qid, id);
  }
  let orphan = 0;
  const touched = new Set<string>();
  const accept = (qid: string) => {
    const id = questionKnowledge.get(qid);
    if (!id) { orphan++; return false; }
    touched.add(id);
    return true;
  };
  if (snapshot.v === 3) {
    if (snapshot.topicId !== mem.topicId || !Number.isSafeInteger(snapshot.after) || snapshot.after < 0
        || !Number.isSafeInteger(snapshot.through) || snapshot.through < snapshot.after) {
      throw new Error('Invalid feedback scope');
    }
    if (snapshot.through <= mem.cursor) return { merged: 0, orphan: 0 };
    if (snapshot.after !== mem.cursor) throw new Error('Feedback does not follow the committed cursor');

    let cursor = mem.cursor;
    const updates = new Map<string, QuestionStats | null>();
    for (const row of snapshot.records) {
      if (!Number.isSafeInteger(row.seq) || row.seq <= cursor || row.seq > snapshot.through) throw new Error('Invalid feedback order');
      if (!row.qid || (row.type !== 'answer' && row.type !== 'reset')) throw new Error('Invalid feedback event');
      const validRight = row.right === true || row.right === false || row.right === 0 || row.right === 1;
      const validChoice = row.choice == null || (Number.isInteger(row.choice) && row.choice >= 1 && row.choice <= 4);
      if (row.type === 'answer' && (!validRight || !validChoice)) {
        throw new Error('Invalid feedback answer');
      }
      cursor = row.seq;
      if (!accept(row.qid)) continue;
      if (row.type === 'reset') { updates.set(row.qid, null); continue; }
      let stat = updates.get(row.qid);
      if (!stat) {
        const old = stat === undefined && Object.hasOwn(mem.stats, row.qid) ? mem.stats[row.qid] : undefined;
        stat = old ? { ...old, attempts: old.attempts.slice() } : { ok: 0, bad: 0, attempts: [] };
        updates.set(row.qid, stat);
      }
      stat[row.right ? 'ok' : 'bad']++;
      if (row.choice != null) stat.attempts.push(row.choice);
    }
    if (cursor !== snapshot.through) throw new Error('Incomplete feedback');
    const entries = new Map(Object.entries(mem.stats));
    for (const [qid, stat] of updates) {
      if (stat) entries.set(qid, stat);
      else entries.delete(qid);
    }
    mem.stats = Object.fromEntries(entries);
    mem.cursor = cursor;
  } else if (snapshot.v === 2) {
    const questions = snapshot.topics[mem.topicId]?.q;
    if (questions) {
      mem.stats = Object.fromEntries(Object.entries(questions).filter(([qid]) => accept(qid)).map(([qid, stat]) =>
        [qid, { ok: stat.ok, bad: stat.bad, attempts: stat.attempts?.slice() ?? [] }]));
    }
  } else throw new Error('Unsupported feedback version');
  return { merged: touched.size, orphan };
}

/** 审核通过的新题追加到原知识点。重复提交同一题号时保留原记录。 */
export function recordApprovedQuestions(mem: TopicMem, questions: readonly GenQuestion[]): void {
  for (const q of questions) {
    const knowledge = (mem.knowledge[q.knowledgeId] ??= {
      label: q.knowledgeLabel ?? q.knowledgeId, stem: q.stem, gen: 0, questions: {},
    });
    if (Object.hasOwn(knowledge.questions, q.qid)) continue;
    knowledge.questions[q.qid] = { stem: q.stem, options: q.options.slice(), answer: q.answer, sectionIds: q.sectionIds?.slice() };
    knowledge.stem = q.stem;
    knowledge.gen++;
  }
}

export type LearningState = 'unanswered' | 'learning' | 'review' | 'mastered';

/** 状态随逐题作答实时推导。题量和历史汇总无需重复落盘。 */
export function knowledgeProgress(mem: TopicMem) {
  return Object.entries(mem.knowledge).map(([id, knowledge]) => {
    let ok = 0, bad = 0;
    for (const qid of Object.keys(knowledge.questions)) {
      ok += mem.stats[qid]?.ok ?? 0;
      bad += mem.stats[qid]?.bad ?? 0;
    }
    const state: LearningState = ok + bad === 0 ? 'unanswered'
      : bad > 0 && (ok < BAL.retireAt || bad >= ok) ? 'review'
      : ok >= BAL.retireAt ? 'mastered' : 'learning';
    return { id, knowledge, ok, bad, state };
  });
}

const CONTEXT_LIMIT = 40;
const RECENT_CHOICES = 8;
const REVIEW_EXAMPLES = 2;

export function memText(mem: TopicMem, per = CONTEXT_LIMIT): string {
  const progress = knowledgeProgress(mem);
  if (!progress.length) return `（主题「${mem.topic}」还没有出过题，这是第一轮。）`;

  const priority = progress.filter(row => row.state === 'review')
    .sort((a, b) => b.bad - a.bad || a.ok - b.ok || a.id.localeCompare(b.id));
  const targets = priority.slice(0, per);
  const out = [`主题「${mem.topic}」已有 ${progress.length} 个知识点。`];
  if (targets.length) {
    out.push('', `本轮优先复练 ${targets.length} 个知识点（共 ${priority.length} 个待复练）：`);
    for (const { id, knowledge, ok, bad } of targets) {
      const choices = Object.entries(knowledge.questions)
        .filter(([qid]) => mem.stats[qid]?.bad > 0 && mem.stats[qid].attempts.length > 0)
        .sort(([a], [b]) => mem.stats[b].bad - mem.stats[a].bad || a.localeCompare(b))
        .slice(0, REVIEW_EXAMPLES)
        .map(([qid, question]) => {
          const seq = mem.stats[qid].attempts.slice(-RECENT_CHOICES);
          const options = question.options.map((option, index) => `${index + 1}=${option.slice(0, 120)}`).join('；');
          return `${qid}: [${seq.join(',')}]（${options}；正确选项 ${question.answer + 1}）`;
        });
      out.push(`- ${knowledge.label} [${id}]｜${knowledge.stem.slice(0, 120)}｜玩家 ${ok} 对 ${bad} 错`
        + (choices.length ? `｜原题选项选择顺序（1-based，最近 ${RECENT_CHOICES} 次）${choices.join('；')}` : ''));
    }
  }
  const otherGroups = [
    ['其余待复练', priority.slice(targets.length)],
    ['待作答', progress.filter(row => row.state === 'unanswered')],
    ['学习中', progress.filter(row => row.state === 'learning')],
    ['已掌握', progress.filter(row => row.state === 'mastered')],
  ] as const;
  for (const [label, group] of otherGroups) {
    if (group.length) out.push(`${label}（${group.length}）：${group.slice(0, CONTEXT_LIMIT).map(row => row.knowledge.label).join('、')}`);
  }
  return out.join('\n');
}

export function sourceIndexText(mem: TopicMem): string {
  return (mem.sections ?? []).map((section) => {
    const pages = section.pageFrom ? `｜PDF 第 ${section.pageFrom}-${section.pageTo} 页` : '';
    return `- ${section.id} | ${section.title}${section.parentId ? ` | parent ${section.parentId}` : ''}${pages}${section.summary ? `｜${section.summary}` : ''}`;
  }).join('\n');
}
