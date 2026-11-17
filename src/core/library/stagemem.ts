import type { StageDigest } from '../model/types';
import { readStore, storeAvailable, writeStore } from '../infra/storage';

/**
 * 按章节记的学习档案：章节 + 题号的正确/错误次数，出题和结算页读它。
 * 不参与战斗结算，只在答题后记账、结算 / 过幕时落盘。
 */

const KEY = 'cognirogue.stage.v1';

interface QStat { ok: number; bad: number }
interface StageMemEntry {
  ok: number;
  bad: number;
  q: Record<string, QStat>;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const countOf = (v: unknown): number => (isNum(v) && v > 0 ? Math.floor(v) : 0);

/** 读坏条目时保留能读的字段，不整份拒绝 —— 跨局积累的错题不该因一行 JSON 全丢。 */
function parseStageMem(raw: string): Record<string, StageMemEntry> {
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
    const out: Record<string, StageMemEntry> = Object.create(null);
    for (const topic of Object.keys(data)) {
      const v = (data as Record<string, unknown>)[topic];
      if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
      const e = v as Record<string, unknown>;
      const q: Record<string, QStat> = Object.create(null);
      const rawQ = e.q;
      if (rawQ && typeof rawQ === 'object' && !Array.isArray(rawQ)) {
        for (const qid of Object.keys(rawQ as Record<string, unknown>)) {
          const s = (rawQ as Record<string, unknown>)[qid];
          if (!s || typeof s !== 'object' || Array.isArray(s)) continue;
          const qs = s as Record<string, unknown>;
          q[qid] = { ok: countOf(qs.ok), bad: countOf(qs.bad) };
        }
      }
      out[topic] = { ok: countOf(e.ok), bad: countOf(e.bad), q };
    }
    return out;
  } catch {
    return {};
  }
}

function loadStageMem(): Record<string, StageMemEntry> {
  return parseStageMem(readStore(KEY) ?? '{}');
}

export let STAGE_MEM: Record<string, StageMemEntry> = loadStageMem();

export function stageMemOf(topic: string): StageMemEntry {
  if (!STAGE_MEM[topic]) STAGE_MEM[topic] = { ok: 0, bad: 0, q: Object.create(null) };
  return STAGE_MEM[topic];
}

export function saveStageMem() {
  // 无头模拟没有 localStorage；先问一句，避免每局序列化一份越来越大的章节记忆。
  if (!storeAvailable()) return;
  writeStore(KEY, JSON.stringify(STAGE_MEM));
}

export function resetStageMemory() {
  STAGE_MEM = {};
  saveStageMem();
}

/** 答完一道题记一笔。按**章节**归档，题号只用于定位具体是哪道题。 */
export function recordAnswer(a: { stageTopic: string; qid: string; right: boolean }) {
  const e = stageMemOf(a.stageTopic);
  if (a.right) e.ok += 1;
  else e.bad += 1;
  const s = (e.q[a.qid] ??= { ok: 0, bad: 0 });
  if (a.right) s.ok += 1;
  else s.bad += 1;
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

/** 一章的摘要：只报正确率，结算页读它。 */
export function stageDigest(topic: string): StageDigest {
  const e = stageMemOf(topic);
  const total = e.ok + e.bad;
  return { ok: e.ok, bad: e.bad, mastery: total ? e.ok / total : 0 };
}

/**
 * 章节记忆的快照，给「导出错题」用。
 *
 * 这是玩家侧数据离开浏览器的**唯一**一条路：游戏运行时对外通信是 0 次，
 * 所以想按错题重出题，只能由玩家自己把这份快照交给生成工具。
 * 形状和存档一样，但**不复用存档键**：存档是断点，这是给别人读的数据。
 */
export interface StudySnapshot {
  /** 快照版本。生成工具只认这个数，换格式就抬它。 */
  v: 1;
  /** 主题 → 累计对错 + 每道题（按 `qid`）累计对错。 */
  topics: Record<string, { ok: number; bad: number; q: Record<string, { ok: number; bad: number }> }>;
}

export const STUDY_SNAPSHOT_V = 1;

export function studySnapshot(): StudySnapshot {
  return { v: STUDY_SNAPSHOT_V, topics: STAGE_MEM };
}
