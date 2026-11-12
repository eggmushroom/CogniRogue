import type { MemEntry } from '../model/types';
import { LS_KEY, readStore, writeStore } from '../infra/storage';
import { LEGACY_CARD_IDS } from '../cards/legacy';

/**
 * 卡牌熟练度与 FSRS-lite 调度状态：只管记不记得。
 * 起手牌组在 cards/ 下；本场免答计数在 `combat` 的 `G.charge`。
 * 学习进度看 `stagemem.ts`（按章节），这里不提供百分比。
 */
const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** 计数类字段：负数、小数、字符串都不该进记忆表 —— 它们会在结算页变成 NaN%。 */
const countOf = (v: unknown): number => isFiniteNum(v) && v > 0 ? Math.floor(v) : 0;

/**
 * 把一段 JSON 读成安全的记忆表：能留的字段留，读不懂的回落默认值。
 * 不整份拒绝：一条坏记录不该把跨局积累的掌握度全丢掉。
 */
export function parseMem(raw: string): Record<string, MemEntry> {
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
    // 无原型表：JSON 里的 "__proto__" 只会变成一条普通键，不会污染原型链
    const out: Record<string, MemEntry> = Object.create(null);
    for (const rawId of Object.keys(data)) {
      // 旧档案里的 key 是题干前缀；先迁到稳定 card id，再写回 MEM。
      const id = LEGACY_CARD_IDS[rawId] ?? rawId;
      const v = (data as Record<string, unknown>)[rawId];
      if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
      const e = v as Record<string, unknown>;
      out[id] = {
        stab: isFiniteNum(e.stab) && e.stab >= 1 ? e.stab : 1,
        due: isFiniteNum(e.due) ? Math.round(e.due) : 0,
        reps: countOf(e.reps),
        lapses: countOf(e.lapses),
        ok: countOf(e.ok),
        bad: countOf(e.bad),
      };
    }
    return out;
  } catch {
    return {};
  }
}

function loadMem(): Record<string, MemEntry> {
  return parseMem(readStore(LS_KEY) ?? '{}');
}

export let MEM: Record<string, MemEntry> = loadMem();

export function memOf(id: string): MemEntry {
  if (!MEM[id]) MEM[id] = { stab: 1, due: 0, reps: 0, lapses: 0, ok: 0, bad: 0 };
  return MEM[id];
}

export function saveMem() {
  writeStore(LS_KEY, JSON.stringify(MEM));
}

export function resetMemory() {
  MEM = {};
  saveMem();
}

/** 每开一局，所有卡片的到期日往前挪一格（单位是「局」，不是天）。 */
export function tickDue() {
  for (const id in MEM) MEM[id].due -= 1;
  saveMem();
}
