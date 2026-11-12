import type { CardDef, CardKind, CardType } from '../model/types';

/** 卡牌身份的唯一判定入口：知识卡 / 基础牌 / 杂念。 */
export function cardKind(card: CardDef | null | undefined): CardKind {
  if (!card) return 'junk'; // defOf(null) 返回杂念，语义对齐
  if (card.kind) return card.kind;
  if (card.junk) return 'junk';
  return 'knowledge';
}

/** 类别轴：攻击 / 防御 / 技能，按效果自动归类。 */
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
