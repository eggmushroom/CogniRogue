import type { CardDef, CardKind, CardType } from '../model/types';

/**
 * cards/kinds —— 卡牌身份的**唯一**判定入口。
 *
 * 身份轴管的是规则：要不要答题、进不进记忆调度、打出后进弃牌堆还是回抽牌堆。
 * 它和 `Eff`（数值怎么花）、`topic`（知识归属）是三条独立的轴，不要混用。
 *
 * 增益不再是一张牌（见 `PowerId`），所以这里只剩"知识卡 / 基础牌 / 杂念"三种。
 */
export function cardKind(card: CardDef | null | undefined): CardKind {
  if (!card) return 'junk'; // defOf(null) 返回的正是杂念，语义对齐
  if (card.kind) return card.kind;
  if (card.junk) return 'junk';
  return 'knowledge';
}

/**
 * 类别轴（攻击 / 防御 / 技能）。
 *
 * 三类不是为了给卡面贴标签，而是回答"这一局里它能干什么"：
 * 攻击把行动力换成伤害，防御换格挡，技能换节奏（抽牌）。
 * 知识卡按效果自动归类，所以卡池一动，三类的配比跟着动；需要手写覆盖时
 * 在卡面表里加 `type` 即可。
 */
export function cardType(card: CardDef | null | undefined): CardType {
  if (!card) return 'skill';
  if (card.type) return card.type;
  if (cardKind(card) === 'junk') return 'skill';
  switch (card.eff) {
    case 'guard': return 'defense';
    case 'focus': return 'skill';
    default: return 'attack';
  }
}

/** 三类的中文名与配色。卡面徽章、牌组画廊、奖励池的筛选用同一份。 */
export const CARD_TYPE_META: Record<CardType, { name: string; color: string }> = {
  attack: { name: '攻击', color: '#e08048' },
  defense: { name: '防御', color: '#6f9ee8' },
  skill: { name: '技能', color: '#a78bfa' },
};
