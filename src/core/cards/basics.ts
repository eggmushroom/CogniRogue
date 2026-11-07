import type { CardDef, CardInst } from '../model/types';

/**
 * cards/basics —— **初始牌组**。它和其余所有牌是两套东西。
 *
 * 固定几张基础牌，一局开始就在牌组里：不答题、不进记忆调度、不可获取、
 * 不会被精炼或删除。它们是"保底输出"——不会因为你答错、忘掉、或这一回合
 * 抽到的全是够不着的知识卡，就整手牌都打不出去。
 *
 * 为什么需要它们：知识卡全都要答题，答错这一手就作废，测试模式甚至会把卡种
 * 作废。于是"不会"的代价会变成"什么都不能做"——这一回合只剩下快攻。
 * 基础牌就是这个下限：数值刻意压得比知识卡低，所以它保证你**不会卡死**，
 * 但不保证你**打得赢**。想赢还是得答题、解锁、用 ×1.5 的免答牌。
 *
 * 数量也是刻意压低的：它们进牌组、占抽牌位，抽到基础牌就等于少抽一张知识卡。
 * 所以只给 3 张（比 StS 的 10 张起始牌少得多），够兜底，不至于把牌组稀释成
 * "一半是保底牌"。
 */
export const BASICS: CardDef[] = [
  {
    id: 'base:strike', topic: '基础', name: '基础斩击', kp: '牌组的保底输出',
    atk: 4, blk: 0, eff: 'strike', kind: 'basic', type: 'attack',
  },
  {
    id: 'base:strike', topic: '基础', name: '基础斩击', kp: '牌组的保底输出',
    atk: 4, blk: 0, eff: 'strike', kind: 'basic', type: 'attack',
  },
  {
    id: 'base:guard', topic: '基础', name: '基础格挡', kp: '牌组的保底防线',
    atk: 0, blk: 3, eff: 'guard', kind: 'basic', type: 'defense',
  },
];

/** 基础牌的 id 集合：解锁统计、精炼、删卡、结算都要把它们排除在外。 */
export const BASIC_IDS = new Set(BASICS.map((c) => c.id));

export const isBasicId = (id: string): boolean => BASIC_IDS.has(id);

/** 一局开始时的初始牌组实例。每次开局都要新的对象，别共享引用。 */
export const basicDeck = (): CardInst[] => BASICS.map((c) => ({ id: c.id, up: 0 }));

/** 按 id 找基础牌定义（`defOf` 的兜底链里用）。 */
export const basicDef = (id: string): CardDef | undefined => BASICS.find((c) => c.id === id);
