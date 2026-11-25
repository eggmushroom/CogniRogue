import type { StageDigest } from '../model/types';
import { readStore, storeAvailable, writeStore } from '../infra/storage';
import { G } from '../infra/state';
import { activeBankId } from './bank';

const ANSWERS_KEY = 'cognirogue.answers.pending.v2';
const MEMORY_KEY = 'cognirogue.stage-memory.v2';

interface QStat { ok: number; bad: number; attempts: number[] }
interface StageMemEntry {
  ok: number;
  bad: number;
  q: Record<string, QStat>;
}

export interface AnswerRecordBase {
  id: string;
  bankId: string;
  runId?: string;
  topic: string;
  qid: string;
  archived: boolean;
}

export type AnswerRecord = AnswerRecordBase & (
  | { type: 'answer'; right: boolean; choice: number }
  | { type: 'reset' }
  | { type: 'archive' }
);

type NewAnswerRecord = Omit<AnswerRecordBase, 'id' | 'archived'> & (
  | { type: 'answer'; right: boolean; choice: number }
  | { type: 'reset' }
  | { type: 'archive' }
);

let history: AnswerRecord[] = loadAnswerHistory();
export let STAGE_MEM: Record<string, StageMemEntry> = loadStageMemory();

function applyRecord(record: AnswerRecord) {
  if (record.type === 'archive') return;
  const e = stageMemOf(record.topic);
  if (record.type === 'reset') {
    delete e.q[record.qid];
    return;
  }
  const field = record.right ? 'ok' : 'bad';
  e[field] += 1;
  const stat = (e.q[record.qid] ??= { ok: 0, bad: 0, attempts: [] });
  stat[field] += 1;
  stat.attempts.push(record.choice);
}

export function stageMemOf(topic: string): StageMemEntry {
  if (!STAGE_MEM[topic]) STAGE_MEM[topic] = { ok: 0, bad: 0, q: Object.create(null) };
  return STAGE_MEM[topic];
}

export function resetStageMemory() {
  history = [];
  STAGE_MEM = {};
  saveAnswerHistory();
  saveStageMemory();
}

function loadAnswerHistory(): AnswerRecord[] {
  try {
    const rows: unknown = JSON.parse(readStore(ANSWERS_KEY) ?? '[]');
    return Array.isArray(rows) ? rows as AnswerRecord[] : [];
  } catch {
    return [];
  }
}

function saveAnswerHistory() {
  if (storeAvailable()) writeStore(ANSWERS_KEY, JSON.stringify(history));
}

function loadStageMemory(): Record<string, StageMemEntry> {
  try {
    const value: unknown = JSON.parse(readStore(MEMORY_KEY) ?? '{}');
    return value && typeof value === 'object' ? value as Record<string, StageMemEntry> : {};
  } catch {
    return {};
  }
}

function saveStageMemory() {
  if (storeAvailable()) writeStore(MEMORY_KEY, JSON.stringify(STAGE_MEM));
}

function appendRecord(record: NewAnswerRecord) {
  const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  const entry: AnswerRecord = { ...record, id, archived: record.type === 'archive' };
  history.push(entry);
  applyRecord(entry);
  saveAnswerHistory();
  saveStageMemory();
}

export function answerHistory(): Exclude<AnswerRecord, { type: 'archive' }>[] {
  return history.filter((record) => record.type !== 'archive');
}

/** Pending archive tombstones share the existing offline answer queue and retry policy. */
export function pendingAnswerEvents(): AnswerRecord[] {
  return history;
}

export function archiveAnswerRun(runId: string, bankId?: string) {
  const bank = bankId ?? history.find((record) => record.runId === runId)?.bankId ?? activeBankId();
  let changed = false;
  for (const record of history) {
    if (record.runId === runId && record.bankId === bank && record.type !== 'archive' && !record.archived) {
      record.archived = true;
      changed = true;
    }
  }
  if (!history.some((record) => record.type === 'archive' && record.runId === runId && record.bankId === bank)) {
    const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    history.push({ id, bankId: bank,
      runId, type: 'archive', topic: '', qid: '', archived: true });
    changed = true;
  }
  if (changed) saveAnswerHistory();
}

export function markAnswersUploaded(events: Array<{ id: string; archived: boolean }>) {
  const sent = new Map(events.map((event) => [event.id, event.archived]));
  const next = history.filter((record) => sent.get(record.id) !== record.archived);
  if (next.length === history.length) return;
  history = next;
  saveAnswerHistory();
}

/** 每次作答都更新掌握统计，并记录归档与同步状态。 */
export function recordAnswer(a: { stageTopic: string; qid: string; right: boolean; choice: number }) {
  appendRecord({ bankId: G.runBankId || activeBankId(), runId: G.runId || undefined,
    type: 'answer', topic: a.stageTopic, qid: a.qid, right: a.right, choice: a.choice });
}

/**
 * 一道题累计**答对**过几次（只数对，不数错）。
 *
 * 退役判据读它，不另存一份计数：同一个数字存两处，迟早出现
 * 「记忆说答对 3 次、题库说还能抽」的矛盾。不存在的题返回 0，
 * 所以这里**不**用 `stageMemOf()` —— 那是写路径，会顺手建一个空条目。
 *
 * 答错不消耗寿命：没学会的题会一直回来，这就是错题重练，不用另做错题本。
 */
export function rightCount(topic: string, qid: string): number {
  return STAGE_MEM[topic]?.q[qid]?.ok ?? 0;
}

/**
 * 一道题累计答错过几次。只给题库面板看「这道题我栽过」用 —— 判据不读它：
 * 寿命只由答对次数决定，答错不扣也不加（没学会的题本来就会回来）。
 * 同样走只读路径，不建空条目。
 */
export function wrongCount(topic: string, qid: string): number {
  return STAGE_MEM[topic]?.q[qid]?.bad ?? 0;
}

/**
 * 把一道题的答题记录清空（答对、答错都归零），它于是不再算掌握。
 *
 * 只给题库面板里那颗「重置」用。章节上的累计（`e.ok` / `e.bad`）不动：
 * 那是"答过多少次"的历史，正确率读它 —— 让一次重置去改统计，
 * 等于把"我练过多少"这件事一起抹掉。
 */
export function clearQuestionMemory(bankId: string, topic: string, qid: string): void {
  appendRecord({ bankId, type: 'reset', topic, qid });
}

/** 一章的摘要：只报正确率，结算页读它。 */
export function stageDigest(topic: string): StageDigest {
  const e = stageMemOf(topic);
  const total = e.ok + e.bad;
  return { ok: e.ok, bad: e.bad, mastery: total ? e.ok / total : 0 };
}

/**
 * 章节记忆的快照，给「导出错题」用。
 *
 * 服务可用时答题事件会同步到本机；离线生成仍可通过这份快照导入历史。
 * 形状和存档不同：存档是断点，这是给生成器读的数据。
 */
export interface StudySnapshot {
  /** 快照版本。生成工具只认这个数，换格式就抬它。 */
  v: 2;
  /** 主题 → 累计对错 + 每道题的累计对错与原题选项作答序列（1-based）。 */
  topics: Record<string, { ok: number; bad: number; q: Record<string, { ok: number; bad: number; attempts: number[] }> }>;
}

export const STUDY_SNAPSHOT_V = 2;

export function studySnapshot(): StudySnapshot {
  return { v: STUDY_SNAPSHOT_V, topics: STAGE_MEM };
}
