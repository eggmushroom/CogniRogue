import type { CardCost, CardDef } from '../model/types';
import { G } from '../infra/state';

/**
 * 出牌价格。费用同时管打不打得出去和答对后净花几点；X 费吃掉剩余行动力。
 * 高费牌打错不扣行动力，但这一手没打出来，还消耗本场一道新题。
 */
export const DEFAULT_COST = 1;

/** 这张牌印在牌面上的价格。不写就是 1。 */
export const costOf = (c: CardDef): CardCost => c.cost ?? DEFAULT_COST;

export const isXCost = (c: CardDef): boolean => costOf(c) === 'x';

/** 牌面左上角那个费用数字：'0' / '1' / '2' / '3' / 'X'。 */
export const costGlyph = (c: CardDef): string => String(costOf(c)).toUpperCase();

/** 此刻要付几点；X 费读当前行动力。 */
export function costNow(c: CardDef): number {
  return isXCost(c) ? G.ap : (costOf(c) as number);
}

/** X 费至少 1 点，否则是一张 0 次效果的废牌。 */
export function canPay(c: CardDef): boolean {
  return isXCost(c) ? G.ap > 0 : G.ap >= (costOf(c) as number);
}

/** 答对退点，上限由 rulesOf().refund 传入。 */
export const refundOf = (spent: number, cap = 0): number => Math.min(spent, cap);
