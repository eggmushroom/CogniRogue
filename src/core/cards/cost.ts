import type { CardCost, CardDef } from '../model/types';
import { G } from '../infra/state';

/**
 * cards/cost —— 出牌的价格。
 *
 * 费用是这个游戏里**唯一一种同时管两件事**的数：
 *   1. 打得出去吗 —— 手上得先有这么多点行动力（`canPay`）；
 *   2. 答对之后净花几点 —— 有「借书证」时一手最多退 1 点（`BAL.refund`），
 *      所以 1 费免费、2 费净花 1 点、3 费净花 2 点；没有借书证则退 0 点。
 *
 * 高费牌不是"更强的一手"，而是"更大的一张票"：3 点的牌打对，用一次答题换掉别人
 * 三次答题的输出；打错**不扣行动力**，但这一手没打出来、还消耗本场一道新题。
 * 所以牌组里塞几张高费牌，和"你有多确定自己会"直接挂钩 —— 这正好是这个游戏想让人
 * 面对的那件事。
 *
 * X 费牌（`cost: 'x'`）把"价格"变成一个变量：它吃掉你剩下的全部行动力，
 * 花了几点就结算几次。1 点行动力时它是一张小牌，3 点时它是一张终结技 ——
 * 而对手牌来说，"留多少点给它"变成了一项实时决定。
 */
export const DEFAULT_COST = 1;

/** 这张牌印在牌面上的价格。不写就是 1。 */
export const costOf = (c: CardDef): CardCost => c.cost ?? DEFAULT_COST;

export const isXCost = (c: CardDef): boolean => costOf(c) === 'x';

/** 牌面左上角那个费用数字：'0' / '1' / '2' / '3' / 'X'。 */
export const costGlyph = (c: CardDef): string => String(costOf(c)).toUpperCase();

/**
 * 现在打这张牌要付几点。X 费牌 = 此刻剩下的全部行动力。
 *
 * 注意它读的是"此刻"：X 费牌的费用在手里是活的，不是印死的。
 */
export function costNow(c: CardDef): number {
  return isXCost(c) ? G.ap : (costOf(c) as number);
}

/**
 * 现在打得出去吗。
 *
 * X 费牌要求至少 1 点：0 点也能"打出去"的话，它会变成一张 0 次效果的废牌 ——
 * 玩家点下去只看到行动力没变、什么都没发生，那不是规则，是 bug 的观感。
 */
export function canPay(c: CardDef): boolean {
  return isXCost(c) ? G.ap > 0 : G.ap >= (costOf(c) as number);
}

/**
 * 答对之后退回多少点。
 *
 * 退款上限由 `rulesOf().refund` 传入：有「借书证」时最多退 1 点，没有就是 0。
 * 1 费牌在有借书证时答对等于免费，2 费净花 1 点、3 费净花 2 点。
 * 于是行动力同时买两样东西：犯错的机会，和一次打得更重的机会。
 */
export const refundOf = (spent: number, cap = 0): number => Math.min(spent, cap);
