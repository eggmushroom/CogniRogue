import { POWER_BY_ID } from '../model/data';
import type { CardDef, CardId, PowerDef, PowerId } from '../model/types';
import { G } from '../infra/state';
import { PACK } from './pack';
import { basicDef, isBasicId } from './basics';

/**
 * 卡牌定义查找表：牌组只存 id，卡面按 id 还原。增益不在表里。
 */

const JUNK: CardDef = {
  id: '__junk', topic: '杂念', name: '杂念', atk: 0, blk: 0,
  eff: 'strike', junk: true, kind: 'junk',
};

export const JUNK_ID = JUNK.id;

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
  const base = baseIdOf(id);
  if (base === JUNK_ID) return JUNK;
  // 基础牌固定在内置表里，不进 PACK（PACK 是"可获取的知识卡池"）
  return PACK.cards.find((c) => c.id === base) ?? basicDef(base) ?? JUNK;
};

/**
 * 只看 id 能不能还原成牌。`defOf` 遇未知 id 回落杂念，不能用来校验。
 */
export const isKnownCardId = (id: string): boolean => {
  const base = baseIdOf(id);
  return base !== JUNK_ID
    && (PACK.cards.some((c) => c.id === base) || isBasicId(base));
};

/** 这一局是不是已经拿到了这种增益。 */
export const hasPower = (id: PowerId) => G.powers.includes(id);
export const powerById = (id: string): PowerDef | null => POWER_BY_ID[id] ?? null;

/** 精炼加成 = 底数 3 + 「抛光布」写进 G.upGrade 的档位。 */
export const UP_GAIN = 3;

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
