import type { CardDef, CardKind } from '../model/types';

/**
 * cards/kinds —— 卡牌身份的**唯一**判定入口。
 *
 * 身份轴管的是规则：要不要答题、进不进记忆调度、打出后飞向弃牌堆还是增益槽。
 * 它和 `Eff`（数值怎么花）、`topic`（知识归属）是三条独立的轴，不要混用。
 *
 * 重构前这一层没有字段，各处在 `card.junk` / `card.power` 上各自推导，
 * 加第四种牌就要改十来个地方。现在新包一律通过 cardKind() 问身份；
 * 旧 JSON 卡牌数据没写 `kind` 时按原有标记回落，行为完全一致。
 */
export function cardKind(card: CardDef | null | undefined): CardKind {
  if (!card) return 'junk'; // defOf(null) 返回的正是杂念，语义对齐
  if (card.kind) return card.kind;
  if (card.junk) return 'junk';
  if (card.power) return 'power';
  return 'knowledge';
}

export const isKnowledgeCard = (c: CardDef | null | undefined) => cardKind(c) === 'knowledge';
export const isPowerCard = (c: CardDef | null | undefined) => cardKind(c) === 'power';
export const isJunkCard = (c: CardDef | null | undefined) => cardKind(c) === 'junk';
