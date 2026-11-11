import { resolveEff } from '../model/effects';
import type { CardDef, CardId } from '../model/types';

/**
 * cards/basics —— **初始基础牌**。它和知识卡是两套东西。
 *
 * 开局固定 8 张：4 张基础斩击 + 4 张基础格挡。不答题、不进记忆调度、
 * **无法从游戏中获取**，但**可以精炼、可以遗忘** —— 它们是这一局的地板，
 * 不是圣物。把一次精炼花在基础斩击上，代价是那次机会没花在知识卡上。
 *
 * 精炼**按张**算（`cards/registry.ts` 的 `UP_MARK`）：四张基础斩击是四张独立的牌，
 * 花一次精炼只把其中一张变成 7 伤，其余三张还是 4 伤。它们是"地板"，
 * 所以强化它永远划算但永远不解决问题 —— 它换不来任何答题机会。
 *
 * 它们保证"保底输出"——不会因为你答错、忘掉、或这一回合抽到的全是够不着的
 * 知识卡，就整手牌都打不出去。
 *
 * 为什么需要它们：知识卡全都要答题，答错这一手就作废。于是"不会"的代价
 * 会变成"什么都不能做"——这一回合一张牌都打不出去。基础牌就是这个下限：
 * 数值刻意压得比知识卡低，所以它保证你**不会卡死**，但不保证你**打得赢**。
 * 想赢还是得答对题，把知识卡打出去。
 *
 * 为什么是 4+4：起手 10 张（8 基础 + 2 张随机知识），抽 5 张时大约一半是
 * 基础牌。少于这个数，开局几回合会频繁出现"手里全是够不着的知识卡"；
 * 多于这个数，牌组会被保底牌稀释成"一半是基础牌"，构筑就没有空间了。
 * 基础牌不进入战后奖励池，也不会出现在事件里 —— 它们只属于开局。
 */
const STRIKE: CardDef = {
  id: 'base:strike', topic: '基础', name: '基础斩击',
  atk: 4, blk: 0, cost: 1, eff: 'strike', kind: 'basic', type: 'attack',
};

const GUARD: CardDef = {
  id: 'base:guard', topic: '基础', name: '基础格挡',
  atk: 0, blk: 3, cost: 1, eff: 'guard', kind: 'basic', type: 'defense',
};

export const BASICS: CardDef[] = [
  STRIKE, STRIKE, STRIKE, STRIKE,
  GUARD, GUARD, GUARD, GUARD,
];

/** 基础牌的 id 集合：奖励池、随机起手都要把它们排除在外（它们不"获取"，只在开局给）。 */
export const BASIC_IDS = new Set(BASICS.map((c) => c.id));

export const isBasicId = (id: string): boolean => BASIC_IDS.has(id);

/**
 * 一局开始时的初始牌组。**是一串 id**（8 张里有 4 张完全相同）——
 * 牌组只记"这张牌出现了几次"，见 `CardId`。精炼过的那一张会换成带 `+` 的 id。
 */
export const basicDeck = (): CardId[] => BASICS.map((c) => c.id);

/** 按 id 找基础牌定义（`defOf` 的兜底链里用）。 */
export const basicDef = (id: string): CardDef | undefined => BASICS.find((c) => c.id === id);

/**
 * 帮助面板用的一句话：初始牌组里每张牌各是什么数值。
 *
 * 数字必须从卡面推导，不能手写 —— 「基础格挡 6 挡」里的 6 是 resolveEff
 * 把 blk 3 乘上巩固的 2 倍算出来的，写死迟早和牌面打架。
 * 结果形如：`基础斩击 ×4（4 伤）、基础格挡 ×4（6 挡）`。
 */
export function basicsSummary(): string {
  const groups: { name: string; count: number; hit: number; blk: number }[] = [];
  for (const c of BASICS) {
    const o = resolveEff(c.eff, c.atk, c.blk);
    const g = groups.find((x) => x.name === c.name);
    if (g) { g.count += 1; continue; }
    groups.push({ name: c.name, count: 1, hit: o.hits[0], blk: o.blk });
  }
  return groups
    .map((g) => {
      const nums = [g.hit > 0 ? `${g.hit} 伤` : '', g.blk > 0 ? `${g.blk} 挡` : ''].filter(Boolean);
      return `${g.name} ×${g.count}（${nums.join('/')}）`;
    })
    .join('、');
}
