import type { CardDef, CardId, PowerId } from '../model/types';
import { G } from '../infra/state';
import { PACK } from './pack';
import { BASICS } from './basics';

/**
 * 手牌定义只有一种形状：`CardDef`。PACK / BASICS / JUNK 是三个**池**，不是三套框架：
 *   · PACK    可获取的知识卡（战后奖励、事件、藏书票）
 *   · BASICS  开局牌组的 8 张实例（不可获取，可精炼、遗忘）
 *   · JUNK    杂念等状态牌（不进奖励池）
 * 查表只走这一张 Map；新增手牌就是往对应的池里加一张 CardDef。
 * 增益（能力牌）不在这张表里，它走 `PowerDef`，见 `model/data.ts` 的 `POWERS`。
 */
const JUNK: CardDef = {
  id: '__junk', name: '杂念', atk: 0, blk: 0, ask: 0,
  eff: 'strike', junk: true, kind: 'junk',
};

export const JUNK_ID = JUNK.id;

/** 卡表是常量，查表每帧都会走；用 Map 而不是线性 find。 */
const CARD_BY_ID = new Map<string, CardDef>();
for (const c of PACK.cards) CARD_BY_ID.set(c.id, c);
for (const c of BASICS) if (!CARD_BY_ID.has(c.id)) CARD_BY_ID.set(c.id, c);
CARD_BY_ID.set(JUNK_ID, JUNK);

/** 精炼标记：精炼过的牌 id 以 `+` 结尾。 */
export const UP_MARK = '+';

/** 查表前先剥掉 `+` 后缀，`defOf` 也走这一步。 */
export const baseIdOf = (id: CardId): CardId =>
  (id.endsWith(UP_MARK) ? id.slice(0, -UP_MARK.length) : id);

/** 这一张牌精炼过没有。 */
export const isUpgraded = (id: CardId): boolean => id.endsWith(UP_MARK);

/** 把一张牌变成它的精炼版本。已经精炼过的原样返回（不会变成 `++`）。 */
export const upgradedId = (id: CardId): CardId => (isUpgraded(id) ? id : id + UP_MARK);

export const defOf = (id: CardId | null | undefined): CardDef => {
  if (!id) return JUNK;
  return CARD_BY_ID.get(baseIdOf(id)) ?? JUNK;
};

/**
 * 只看 id 能不能还原成牌。`defOf` 遇未知 id 回落杂念，不能用来校验。
 */
export const isKnownCardId = (id: string): boolean => {
  const base = baseIdOf(id);
  return base !== JUNK_ID && CARD_BY_ID.has(base);
};

/** 这一局是不是已经拿到了这种增益。 */
export const hasPower = (id: PowerId) => G.powers.includes(id);

/** 精炼加成 = 底数 3 + 「抛光布」写进 G.upGrade 的档位。 */
const UP_GAIN = 3;

/** 这一张牌的精炼加成：基础 3 点 + 抛光布那一档。 */
export const upGain = (): number => UP_GAIN + G.upGrade;

/** 精炼只作用于这一张 id，同名另一张不跟着变。 */
export function statOf(id: CardId) {
  const d = defOf(id);
  const up = isUpgraded(id) ? upGain() : 0;
  return {
    atk: (d.atk || 0) + up,
    blk: (d.blk || 0) + up,
  };
}
