import type { CardDef, CardId } from '../model/types';

/**
 * 初始基础牌：4 张基础斩击 + 4 张基础格挡。不答题，不可获取，但可以精炼、遗忘。
 * 数值低于知识卡，只保证这一回合有牌可打，不保证打得赢。
 *
 * 它们和知识卡共用 `CardDef` 与 `planStrike()`，不是另一套卡牌框架；区别只是
 * 这 8 张实例属于「开局池」，不进奖励池。所以它们必须跟着 `npm run cards` 一起看：
 * 效果原型去掉倍率时，基础格挡从 6 点悄悄掉到 3 点，新手第一幕的存活层数少了一半，
 * 而所有断言都是绿的。
 */
const STRIKE: CardDef = {
  id: 'base:strike', name: '基础斩击',
  atk: 4, blk: 0, cost: 1, ask: 0, eff: 'strike', kind: 'basic', type: 'attack',
  // 纯攻击牌：精炼只加伤害。基础牌是"保底"，精炼方向也该是直的。
  up: { atk: 6 },
};

const GUARD: CardDef = {
  id: 'base:guard', name: '基础格挡',
  atk: 0, blk: 6, cost: 1, ask: 0, eff: 'guard', kind: 'basic', type: 'defense',
  // 纯防御牌：只加格挡，不凭空长出攻击。
  up: { blk: 6 },
};

export const BASICS: CardDef[] = [
  STRIKE, STRIKE, STRIKE, STRIKE,
  GUARD, GUARD, GUARD, GUARD,
];

/** 基础牌的 id 集合：奖励池、随机起手都要把它们排除在外（它们不"获取"，只在开局给）。 */
const BASIC_IDS = new Set(BASICS.map((c) => c.id));

export const isBasicId = (id: string): boolean => BASIC_IDS.has(id);

/** 初始牌组是一串 id，精炼过的那张换成带 `+` 的 id。 */
export const basicDeck = (): CardId[] => BASICS.map((c) => c.id);
