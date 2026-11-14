import type { CardDef, CardId } from '../model/types';

/**
 * 初始基础牌：4 张基础斩击 + 4 张基础格挡。不答题，不可获取，但可以精炼、遗忘。
 * 数值低于知识卡，只保证这一回合有牌可打，不保证打得赢。
 *
 * 这里的 `atk` / `blk` 就是**打出去的那个数**，和知识卡一个口径。所以这两张
 * 必须跟着 `npm run cards` 一起看 —— 它们曾经不在卡表里，效果原型去掉倍率时
 * 基础格挡从 6 点悄悄掉到 3 点，新手第一幕的存活层数少了一半，而所有断言都是绿的。
 */
const STRIKE: CardDef = {
  id: 'base:strike', topic: '基础', name: '基础斩击',
  atk: 4, blk: 0, cost: 1, eff: 'strike', kind: 'basic', type: 'attack',
};

const GUARD: CardDef = {
  id: 'base:guard', topic: '基础', name: '基础格挡',
  atk: 0, blk: 6, cost: 1, eff: 'guard', kind: 'basic', type: 'defense',
};

export const BASICS: CardDef[] = [
  STRIKE, STRIKE, STRIKE, STRIKE,
  GUARD, GUARD, GUARD, GUARD,
];

/** 基础牌的 id 集合：奖励池、随机起手都要把它们排除在外（它们不"获取"，只在开局给）。 */
export const BASIC_IDS = new Set(BASICS.map((c) => c.id));

export const isBasicId = (id: string): boolean => BASIC_IDS.has(id);

/** 初始牌组是一串 id，精炼过的那张换成带 `+` 的 id。 */
export const basicDeck = (): CardId[] => BASICS.map((c) => c.id);

/** 按 id 找基础牌定义（`defOf` 的兜底链里用）。 */
export const basicDef = (id: string): CardDef | undefined => BASICS.find((c) => c.id === id);
