import type { CardDef, CardId } from '../model/types';
import { defOf } from './registry';
import { cardKind } from './kinds';
import { BAL } from '../model/data';

/**
 * 答题要求是卡牌数据里的隐藏属性：0 = 不问；正数 = 这一场要答对几次才免答。
 * 它不从费用推导 —— 费用管这一回合的形状，答题要求管这一场的学习量。
 *
 * 前端任何地方都不读这个函数的返回值做展示；它只服务于结算、题量和测试。
 */
export function askOf(card: CardDef | null | undefined): number {
  if (!card || cardKind(card) !== 'knowledge') return 0;
  // 数据写负数是作者错误；按 0 处理，别让一张坏卡永远问不完。
  return Math.max(0, card.ask);
}

/** 本场已经答对几次（读 `G.charge`，由 combat/play 维护）。 */
const charged = (charge: Record<string, number>, id: string): number => charge[id] ?? 0;

/** 答不答题；charge 显式传入，不在这里读 G。 */
export const needsAsk = (id: CardId | null | undefined, charge: Record<string, number>): boolean => {
  if (!id) return false;
  const card = defOf(id);
  if (cardKind(card) !== 'knowledge') return false;
  return charged(charge, card.id) < askOf(card);
};

/**
 * 一场预抽多少题：按牌组知识卡的答题要求总和估算。
 *
 * 算式是整数乘除（总和 × 3 ÷ 5 + 3 道余量），不是百分比：牌组里每 5 次答题领 3 道，
 * 多出来的 3 道留给"答错重打同一张"。写成 0.6 的话，改牌组时没人算得出
 * 「本场还剩几道新题」会变成多少 —— 而那是玩家在战斗界面看得见的数。
 */
export function battleQuestionCount(deck: CardId[]): number {
  let need = 0;
  for (const id of deck) {
    const card = defOf(id);
    if (cardKind(card) !== 'knowledge') continue;
    // 精炼只改攻/挡，不改答题要求。
    need += askOf(card);
  }
  const n = Math.round((need * BAL.qPer) / BAL.qOf) + BAL.qPad;
  return Math.max(6, Math.min(20, n));
}
