import { POWERS, POWER_BY_ID } from '../model/data';
import type { CardDef, CardId, PowerDef, PowerId } from '../model/types';
import { G } from '../infra/state';
import { PACK } from './pack';
import { basicDef, isBasicId } from './basics';
import { isPowerCard } from './kinds';

/**
 * cards/registry —— 卡牌定义的查找表。
 *
 * 牌组里只是一串 id（见 `CardId`），卡面全部由这里按 id 还原。
 * 知识卡来自内置卡牌库 catalog（PACK），增益牌与杂念由本文件造出来 —— 它们和知识卡走
 * **完全相同**的通道，所以「增益是牌而不是遗物」在数据层就成立。
 *
 * ## 精炼为什么是一个 id 后缀
 *
 * 精炼只作用于**玩家挑中的那一张**，所以"哪一张被精炼过"必须是这张牌自己的属性，
 * 而不是它牌名的属性。实现上就是：被精炼的那一张换一个 id —— `base:strike+`。
 *
 *   - 牌组仍然是一串 id（`CardId`），抽牌堆/手牌/弃牌堆也一样，没有实例对象；
 *   - 每张牌都有自己的 id，所以"打出去的到底是哪一张"永远答得出来
 *     （旧实现把精炼挂在对象身份上，`indexOf` 一旦碰到重建的对象就认不出，
 *     基础斩击偶发失效就是这么来的）；
 *   - 同名的另一张仍然是 `base:strike`，它不会跟着变强 —— 这正是玩家要的语义。
 *
 * 代价是 `defOf` 要先剥掉后缀，而"这张牌精炼过没有"变成一次字符串判断。
 * 这两件事都只在本文件里发生，别处拿到的永远是完整的卡面。
 */

const JUNK: CardDef = {
  id: '__junk', topic: '杂念', name: '杂念', atk: 0, blk: 0,
  eff: 'strike', junk: true, kind: 'junk',
};

export const JUNK_ID = JUNK.id;

export const powerCardId = (id: PowerId) => 'pow:' + id;

const POWER_CARD: Record<string, CardDef> = Object.fromEntries(
  POWERS.map((p): [string, CardDef] => [powerCardId(p.id), {
    id: powerCardId(p.id), topic: '增益', name: p.name,
    atk: 0, blk: 0, cost: p.cost, eff: 'strike', power: p.id, kind: 'power',
  }]),
);

/** 精炼标记：被精炼的那一张牌的 id 以它结尾。 */
export const UP_MARK = '+';

/**
 * 剥掉精炼标记，拿到"这是哪一种牌"。所有查表都必须先过这一步，
 * 否则 `base:strike+` 会被当成一个不认识的 id 回落成杂念。
 */
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
  return PACK.cards.find((c) => c.id === base) ?? POWER_CARD[base] ?? basicDef(base) ?? JUNK;
};

/**
 * 这个 id 能不能还原成一张真的牌。**只看"能不能找到"，不看 `defOf`**：
 * `defOf` 对未知 id 会回退成杂念，用它判断会把坏 id 当成合法。
 *
 * 存档校验用。杂念不算 —— 它只在一场战斗的弃牌堆里临时出现，
 * 牌组里出现 `__junk` 一定是存档坏了。
 */
export const isKnownCardId = (id: string): boolean => {
  const base = baseIdOf(id);
  return base !== JUNK_ID
    && (PACK.cards.some((c) => c.id === base) || !!POWER_CARD[base] || isBasicId(base));
};

export const powerCardOf = (id: PowerId): CardDef => POWER_CARD[powerCardId(id)];
export const powerOf = (c: CardDef | null | undefined): PowerDef | null =>
  isPowerCard(c) && c?.power ? POWER_BY_ID[c.power] : null;

/** 本场是否已经打出过这种增益牌。 */
export const hasPower = (id: PowerId) => G.powers.includes(id);
export const powerById = (id: string): PowerDef | null => POWER_BY_ID[id] ?? null;

/** 牌组里有哪些增益牌（去重）。地图页和结算页要显示"这一局带了什么进场"。 */
export function deckPowers(): PowerDef[] {
  const seen: Record<string, boolean> = {};
  G.deck.forEach((id) => { seen[baseIdOf(id)] = true; });
  return Object.keys(seen)
    .map((id) => POWER_CARD[id]?.power)
    .filter((p): p is PowerId => !!p)
    .map((p) => POWER_BY_ID[p]);
}

/** 精炼一次的加成：攻/挡底数各 +3（再按效果折算）。 */
export const UP_GAIN = 3;

/**
 * 卡面数值。精炼读的是**这一张牌自己的 id**，所以牌组里两张基础斩击
 * 可以一张 4 伤一张 7 伤 —— 这正是"精炼只针对单张卡"的意思。
 */
export function statOf(id: CardId) {
  const d = defOf(id);
  const up = isUpgraded(id) ? UP_GAIN : 0;
  return {
    atk: (d.atk || 0) + up,
    blk: (d.blk || 0) + up,
  };
}

/** 这个 id 是不是一张增益牌。奖励池、结算页都要排除它。 */
export const isPowerId = (id: string) => !!POWER_CARD[baseIdOf(id)];
