import { BAL } from '../model/data';
import type { CardInst, MemEntry } from '../model/types';
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
 * 起始牌组：**逾期该复习的先上，然后是没碰过的新卡，最后是还没到期的**。
 *
 * 这里以前只按 `due` 升序取前 10 —— 新卡的 due 一直是 0 并随局数一起递减，
 * 于是永远排在学过的卡前面，结果就成了"掌握得越好的卡越不会再出现"，
 * 和"该复习的必须出现"正好相反。复习期那档惩罚要能生效，这个分桶必须先修对。
 */
export function startDeck(): CardInst[] {
  const bucket = (c: (typeof PACK.cards)[number]) => {
    const m = memOf(c.id);
    if (m.ok === 0 && m.bad === 0) return 1; // 从没碰过：等逾期卡排完再上
    return m.due <= 0 ? 0 : 2;              // 0 逾期 / 2 还没到期
  };
  const sorted = PACK.cards.slice().sort(
    (a, b) => bucket(a) - bucket(b) || memOf(a.id).due - memOf(b.id).due,
  );
  return sorted.slice(0, Math.min(10, sorted.length)).map((c) => ({ id: c.id, up: 0 }));
}

/**
 * 这张卡在不在「复习期」—— 看的是记忆稳固度，不是"做过几遍"。
 *
 * 稳固度会掉（答错一次 ×0.4），所以一张卡只能靠"连续答对"爬进复习期，
 * 再错一次就自己退回学习期。惩罚因此是自限的：同一张牌不会一直坑你。
 *
 * 刻意不做成全局模式开关：一副牌里永远同时有学过的和没学过的，惩罚按卡算，
 * 才谈得上"按学习阶段分档"；否则要么整局太软，要么整局太硬。
 */
export function isReview(id: string): boolean {
  return memOf(id).stab >= BAL.reviewStab;
}

/** 学习期 / 复习期。表现层拿它决定卡面下沿写哪一句规则。 */
export const phaseOf = (id: string): 'learn' | 'review' => (isReview(id) ? 'review' : 'learn');

/**
 * 记忆条的归一化。
 *
 * 用 `stab / (stab + 2×门槛)` 而不是线性除：这样复习期的门槛**正好落在 1/3**，
 * 而且越往上越平 —— 稳固度能长到 60，线性归一的话十几点就顶到 100%，
 * 一张"刚学会"的牌和一张"滚瓜烂熟"的牌看上去一模一样。
 */
export const memRatio = (id: string) => {
  const s = Math.max(0, memOf(id).stab);
  return s / (s + BAL.reviewStab * 2);
};
