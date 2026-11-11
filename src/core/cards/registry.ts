import { POWER_BY_ID } from '../model/data';
import type { CardDef, CardId, PowerDef, PowerId } from '../model/types';
import { G } from '../infra/state';
import { PACK } from './pack';
import { basicDef, isBasicId } from './basics';

/**
 * cards/registry —— 卡牌定义的查找表。
 *
 * 牌组里只是一串 id（见 `CardId`），卡面全部由这里按 id 还原。
 * 知识卡来自内置卡牌库 catalog（PACK），杂念由本文件造出来。
 *
 * **增益不在这张表里**：它不是牌，没有卡面，也永远不会出现在牌组 / 手牌 / 牌堆里。
 * 上一版曾把增益做成 `pow:` 前缀的牌并塞进这张表，于是 `defOf` 要认它、
 * 存档校验要认它、牌组画廊要排除它 —— 一条并不存在的东西被三处特判。
 * 现在它只剩 `G.powers` 里的一串 id，查表由 `powerById` 负责。
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
  return PACK.cards.find((c) => c.id === base) ?? basicDef(base) ?? JUNK;
};

/**
 * 这个 id 能不能还原成一张真的牌。**只看"能不能找到"，不看 `defOf`**：
 * `defOf` 对未知 id 会回退成杂念，用它判断会把坏 id 当成合法。
 *
 * 存档校验用。杂念不算 —— 它只在一场战斗的弃牌堆里临时出现，
 * 牌组里出现 `__junk` 一定是存档坏了。
 * 旧档里的 `pow:` 同样落在"不认识"这一边，由 `save.ts` 在读取时剔掉。
 */
export const isKnownCardId = (id: string): boolean => {
  const base = baseIdOf(id);
  return base !== JUNK_ID
    && (PACK.cards.some((c) => c.id === base) || isBasicId(base));
};

/** 这一局是不是已经拿到了这种增益。 */
export const hasPower = (id: PowerId) => G.powers.includes(id);
export const powerById = (id: string): PowerDef | null => POWER_BY_ID[id] ?? null;

/**
 * 精炼一次的加成：攻/挡底数各 +3（再按效果折算）。
 *
 * 「抛光布」把这一档再抬 2 点 —— 但它是从 `G.upGrade` 读的，不是从这里改常量：
 * 本文件在最底层，反向 import `cards/powers.ts` 会成环（那边要 `hasPower`）。
 * 拾取时把数字写进 G，这里只读一个数，依赖方向不倒。
 */
export const UP_GAIN = 3;

/** 这一张牌的精炼加成：基础 3 点 + 抛光布那一档。 */
export const upGain = (): number => UP_GAIN + G.upGrade;

/**
 * 卡面数值。精炼读的是**这一张牌自己的 id**，所以牌组里两张基础斩击
 * 可以一张 4 伤一张 7 伤 —— 这正是"精炼只针对单张卡"的意思。
 */
export function statOf(id: CardId) {
  const d = defOf(id);
  const up = isUpgraded(id) ? upGain() : 0;
  return {
    atk: (d.atk || 0) + up,
    blk: (d.blk || 0) + up,
  };
}
