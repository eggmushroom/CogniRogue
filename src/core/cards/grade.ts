import type { CardDef, CardGrade, CardId } from '../model/types';
import { defOf } from './registry';
import { cardKind } from './kinds';

/**
 * cards/grade —— 卡牌等级与"打几次才免答"。
 *
 * 等级不是稀有度，是**这张牌愿意为它的数值付几次答题**：
 *
 *   C（0 费）  0 次  —— 一开局就能直接打，不用答题
 *   B（1 费）  1 次  —— 这一场答对一次之后，本场再打就免答
 *   A（2 费）  2 次
 *   S（3 费 / X 费）3 次
 *
 * 为什么按费用分而不是手写：费用已经是强度的唯一刻度（0 费半价、3 费约 3.3 倍），
 * 再单独维护一张等级表，就会出现"两张同费同强度的牌一个 C 一个 S"的怪事。
 * 费用一变等级跟着变，这条推导只在 `cardGrade()` 里写一次。
 *
 * **计数每场清零**（`G.charge`）：一场战斗里答对 `need` 次，这张牌这一场就免答了。
 * 不跨场累计，是因为跨场累计到第 3 幕之后几乎全部免答，学习循环会空掉；
 * 每场重算则让"这一场我先答哪张"变成一个真实的开局决定。
 */
export const GRADE_NEED: Record<CardGrade, number> = { C: 0, B: 1, A: 2, S: 3 };

/** 等级配色。卡面徽章、牌组列表、奖励页共用。 */
export const GRADE_META: Record<CardGrade, { color: string; label: string }> = {
  C: { color: '#8b98ad', label: 'C' },
  B: { color: '#6f9ee8', label: 'B' },
  A: { color: '#c88ce0', label: 'A' },
  S: { color: '#e8b64c', label: 'S' },
};

/**
 * 这张牌的等级。只对知识卡有意义：基础牌不答题、增益牌不答题，各走各的路。
 *
 * X 费归 S：它花光一回合剩下的全部行动力，实际输出本来就按点数放大，
 * 是牌组里最贵的一档。
 */
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

/**
 * 这张牌现在还答不答题。`false` = 已经攒够，这一场剩下的时间里直接打。
 *
 * 参数显式传 charge 表，而不是在这里读 G：`tools/sim.ts` 与阶段检查
 * 都是先造状态再问这句话，隐式读全局会让他们没法按自己的节奏推进。
 */
export const needsAsk = (id: CardId | null | undefined, charge: Record<string, number>): boolean => {
  if (!id) return false;
  const card = defOf(id);
  if (cardKind(card) !== 'knowledge') return false;
  return charged(charge, card.id) < gradeNeed(card);
};

/**
 * 一场战斗要预抽多少道题。
 *
 * 依据是**这副牌这一场大概会问几次**：牌组里每张知识卡按等级算
 * （C 不问、B 1 次、A 2 次、S 3 次），乘"一场会翻多少遍牌组"的系数。
 * 一场约 4 回合、每回合抽 5 张，10 张的牌组会被翻两遍，但真正被点开的
 * 知识卡只有两三张 —— 所以系数取 0.6，再加 3 道重试余量。
 *
 * 上下限 6–20：低于 6 道时一场打到一半就没题了；高于 20 道时
 * 一章的题（12–18 道 × 每道最多 3 次）撑不过两场，"这一章问过什么"的感受会糊掉。
 */
export function battleQuestionCount(deck: CardId[]): number {
  let need = 0;
  for (const id of deck) {
    const card = defOf(id);
    if (cardKind(card) !== 'knowledge') continue;
    // C 级（0 费）不答题，所以不占题量：等级是 0，这里直接加 0。
    // 精炼只加数值、不改等级：等级跟费用走，而费用不因精炼而变。
    need += gradeNeed(card);
  }
  const n = Math.round(need * 0.6) + 3;
  return Math.max(6, Math.min(20, n));
}
