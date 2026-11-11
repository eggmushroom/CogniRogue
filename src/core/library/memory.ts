import type { MemEntry } from '../model/types';
import { LS_KEY, readStore, writeStore } from '../infra/storage';
import { LEGACY_CARD_IDS } from '../cards/legacy';

/**
 * library/memory —— 卡牌熟练度 + FSRS-lite 调度状态。
 *
 * 只管「记不记得」：持久化、稳固度、到期日。
 * 起手牌组在 cards/ 下（basics + starter）—— 那是牌面数据，不是记忆调度。
 * 战斗中"这一回合已经答对几次"（免答计数）是**本场**状态，归 combat 的
 * `G.charge`，不要和这里混在一起。
 *
 * **这里没有任何百分比。** 曾经有一个 `memRatio()` 把稳固度归一成"掌握 63%"，
 * 画在奖励页和牌组列表里 —— 那是卡题绑定时代的遗留：那时一张卡对应一道题，
 * "这张卡你答对过几次"还能读成"这个知识点你多熟"。卡题解耦之后，
 * 同一张卡在五章里抽到五章的题，`MEM[card.id]` 只是一个战斗熟练度计数，
 * 拿它当"掌握度"会直接误导玩家。要读学习进度，去 `stagemem.ts` 按章节看。
 */
const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** 计数类字段：负数、小数、字符串都不该进记忆表 —— 它们会在结算页变成 NaN%。 */
const countOf = (v: unknown): number => isFiniteNum(v) && v > 0 ? Math.floor(v) : 0;

/**
 * 把一段 JSON 读成安全的记忆表。
 *
 * 导出是给结构检查用的：坏条目（null / 字符串 / 缺字段）以前会被原样塞进 `MEM`，
 * `tickDue` 读 null 会抛、`memOf` 读 undefined 会算出 NaN。
 * 这里不拒绝整个文件 —— 玩家跨局积累的掌握度不该因为一条坏记录全丢；
 * 能留的字段就留，读不懂的字段回落到默认值。
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
