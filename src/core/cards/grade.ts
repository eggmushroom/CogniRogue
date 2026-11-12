import type { CardDef, CardGrade, CardId } from '../model/types';
import { defOf } from './registry';
import { cardKind } from './kinds';

/**
 * 卡牌等级跟费用走：C 0 / B 1 / A 2 / S 3 或 X。等级就是本场要答对的次数。
 */
export const GRADE_NEED: Record<CardGrade, number> = { C: 0, B: 1, A: 2, S: 3 };

/** 等级配色。卡面徽章、牌组列表、奖励页共用。 */
export const GRADE_META: Record<CardGrade, { color: string; label: string }> = {
  C: { color: '#8b98ad', label: 'C' },
  B: { color: '#6f9ee8', label: 'B' },
  A: { color: '#c88ce0', label: 'A' },
  S: { color: '#e8b64c', label: 'S' },
};

/** X 费归 S。 */
export function cardGrade(card: CardDef | null | undefined): CardGrade {
  if (!card) return 'C';
  if (cardKind(card) !== 'knowledge') return 'C';
  const c = card.cost ?? 1;
  if (c === 'x') return 'S';
  if (c >= 3) return 'S';
  if (c === 2) return 'A';
  if (c === 1) return 'B';
  return 'C';
}

/** 这张牌这一场要答对几次才免答。 */
export const gradeNeed = (card: CardDef | null | undefined): number => GRADE_NEED[cardGrade(card)];

/** 本场已经答对几次（读 `G.charge`，由 combat/play 维护）。 */
export const charged = (charge: Record<string, number>, id: string): number => charge[id] ?? 0;

/** 答不答题；charge 显式传入，不在这里读 G。 */
export const needsAsk = (id: CardId | null | undefined, charge: Record<string, number>): boolean => {
  if (!id) return false;
  const card = defOf(id);
  if (cardKind(card) !== 'knowledge') return false;
  return charged(charge, card.id) < gradeNeed(card);
};

/**
 * 一场预抽多少题：按牌组知识卡的等级总和估算，乘 0.6 加 3 道余量，限 6–20。
 */
export function battleQuestionCount(deck: CardId[]): number {
  let need = 0;
  for (const id of deck) {
    const card = defOf(id);
    if (cardKind(card) !== 'knowledge') continue;
    // 等级跟费用走，精炼不加等级。
    need += gradeNeed(card);
  }
  const n = Math.round(need * 0.6) + 3;
  return Math.max(6, Math.min(20, n));
}
