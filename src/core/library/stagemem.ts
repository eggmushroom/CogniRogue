import type { AnswerRecord, StageDigest } from '../model/types';
import { readStore, storeAvailable, writeStore } from '../infra/storage';

/**
 * 按章节记的学习档案：`MEM` 记卡，这里记章节 + 题号。
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
export function parseStageMem(raw: string): Record<string, StageMemEntry> {
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
export function recordAnswer(a: Pick<AnswerRecord, 'stageTopic' | 'qid' | 'right'>) {
  const e = stageMemOf(a.stageTopic);
  if (a.right) e.ok += 1;
  else e.bad += 1;
  const s = (e.q[a.qid] ??= { ok: 0, bad: 0 });
  if (a.right) s.ok += 1;
  else s.bad += 1;
}

/**
 * 一章的摘要：正确率 + 错得最多的题。
 *
 * 只输出题号、不输出题干：摘要是给 agent 做生成依据的，不是第二份题库；
 * 题面在题库里，拿题号去查即可。
 */
export function stageDigest(stage: number, topic: string): StageDigest {
  const e = stageMemOf(topic);
  const total = e.ok + e.bad;
  const weak = Object.keys(e.q)
    .map((qid) => ({ qid, ok: e.q[qid].ok, bad: e.q[qid].bad }))
    .filter((x) => x.bad > 0)
    .sort((a, b) => b.bad - a.bad || a.ok - b.ok)
    .slice(0, 8);
  return {
    stage,
    topic,
    ok: e.ok,
    bad: e.bad,
    mastery: total ? e.ok / total : 0,
    weak,
  };
}
