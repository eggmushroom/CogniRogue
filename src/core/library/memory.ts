import { BAL } from '../model/data';
import type { CardInst, MemEntry, RunMode } from '../model/types';
import { LS_KEY, readStore, writeStore } from '../infra/storage';
import { PACK } from './pack';

/**
 * library/memory —— FSRS-lite 复习调度。
 *
 * 只管「记不记得」：持久化、稳固度、到期日、按记忆状态组起手牌组。
 * 战斗中的解锁 / 作废是**本场**状态，归 combat/unlock，不要和这里混在一起。
 */
function loadMem(): Record<string, MemEntry> {
  try {
    return JSON.parse(readStore(LS_KEY) ?? '{}') as Record<string, MemEntry>;
  } catch {
    return {};
  }
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

/**
 * 起始牌组：**按这一局选的模式取牌**，而不是按卡片自己处在哪个阶段。
 *
 *   学习：没碰过的优先 —— 这一局是来见新东西的
 *   复习：逾期的最优先，其次是学过但还没到期的 —— 这一局是来过一遍的
 *   测试：稳固度最高的优先 —— 这一局是来验已经"会了"的东西的
 *
 * 三种排序都先分桶再按 due / stab 排；桶内顺序稳定，所以同一份记忆开局可复现。
 */
export function startDeck(mode: RunMode): CardInst[] {
  const seen = (id: string) => { const m = memOf(id); return m.ok + m.bad > 0; };
  const bucket = (c: (typeof PACK.cards)[number]) => {
    const m = memOf(c.id);
    if (mode === 'learn') return seen(c.id) ? 2 : 0;
    if (mode === 'test') return isMastered(c.id) ? 0 : seen(c.id) ? 1 : 2;
    // review：逾期 > 学过但没到期 > 没碰过
    return m.due <= 0 && seen(c.id) ? 0 : seen(c.id) ? 1 : 2;
  };
  const sorted = PACK.cards.slice().sort((a, b) => {
    const d = bucket(a) - bucket(b);
    if (d) return d;
    if (mode === 'test') {
      return memOf(b.id).stab - memOf(a.id).stab || memOf(a.id).due - memOf(b.id).due;
    }
    return memOf(a.id).due - memOf(b.id).due;
  });
  return sorted.slice(0, Math.min(10, sorted.length)).map((c) => ({ id: c.id, up: 0 }));
}

/**
 * 这张卡的稳固度是否已经够「掌握」。只用于测试模式的选牌，
 * 不再决定答错价码 —— 价码由 `MODES[G.mode]` 决定。
 */
export function isMastered(id: string): boolean {
  return memOf(id).stab >= BAL.reviewStab;
}

/**
 * 记忆条的归一化。
 *
 * 用 `stab / (stab + 2×门槛)` 而不是线性除：这样「掌握」的门槛**正好落在 1/3**，
 * 而且越往上越平 —— 稳固度能长到 60，线性归一的话十几点就顶到 100%，
 * 一张"刚学会"的牌和一张"滚瓜烂熟"的牌看上去一模一样。
 */
export const memRatio = (id: string) => {
  const s = Math.max(0, memOf(id).stab);
  return s / (s + BAL.reviewStab * 2);
};
