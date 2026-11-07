import type { CardDef, CardKind, CardType } from '../model/types';

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
/** 初始牌组里的基础牌：不答题、不可获取、永远在牌组里。 */
export const isBasicCard = (c: CardDef | null | undefined) => cardKind(c) === 'basic';

/**
 * 类别轴（攻击 / 防御 / 技能 / 能力）。
 *
 * 四类不是为了给卡面贴标签，而是回答"这一局里它能干什么"：
 * 攻击把行动力换成伤害，防御换格挡，技能换节奏（抽牌），能力把本场规则换掉。
 * 知识卡按效果自动归类，所以卡池一动，四类的配比跟着动；需要手写覆盖时
 * 在卡面表里加 `type` 即可。
 */
export function cardType(card: CardDef | null | undefined): CardType {
  if (!card) return 'skill';
  if (card.type) return card.type;
  if (cardKind(card) === 'power') return 'power';
  if (cardKind(card) === 'junk') return 'skill';
  switch (card.eff) {
    case 'guard': return 'defense';
    case 'focus': return 'skill';
    default: return 'attack';
  }
}

/** 四类的中文名与配色。卡面徽章、牌组画廊、奖励池的筛选用同一份。 */
export const CARD_TYPE_META: Record<CardType, { name: string; color: string }> = {
  attack: { name: '攻击', color: '#e08048' },
  defense: { name: '防御', color: '#6f9ee8' },
  skill: { name: '技能', color: '#a78bfa' },
  power: { name: '能力', color: '#e8c86c' },
};
