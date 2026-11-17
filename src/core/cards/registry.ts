import type { CardCost, CardDef, CardId, CardLink, EffMods, PowerId } from '../model/types';
import { EFFS } from '../model/effects';
import { G } from '../infra/state';
import { PACK } from './pack';
import { BASICS } from './basics';
import { costOf } from './cost';

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

/**
 * 把一张定义按它的 `up` 声明折成精炼版本。
 *
 * `up` 说明这张牌该长在哪：只写 `{ draw: 1 }` 的牌精炼后只多抽一张，不碰攻挡 ——
 * 「抽 1 张的牌精炼成抽 2 张」不能靠底数硬凑。
 *
 * 抛光布（`G.upGrade`）抬的是**这张牌已经声明要加的那几格**：声明了 atk 就 atk 多给，
 * 声明了 blk 就 blk 多给，两边都声明就两边都给。不能退回「一律攻挡各 +N」——
 * 那正是这次要消灭的规则，而且会让纯专注牌凭空长出攻击。
 *
 * 这里**没有**「没写 `up` 就默认 +N」的分支：`npm run cards` 强制每张牌都写 `up`。
 * 留一条默认路径曾经把抛光布变成空转 —— 默认分支永远走不到，`G.upGrade` 写了也没人读。
 */
function applyUp(d: CardDef): CardDef {
  const u = d.up;
  const extra = G.upGrade;
  const dAtk = u?.atk !== undefined ? u.atk + extra : 0;
  const dBlk = u?.blk !== undefined ? u.blk + extra : 0;
  const mods: EffMods | undefined = u && (
    u.healPer !== undefined || u.draw !== undefined || u.selfHp !== undefined || u.times !== undefined
  )
    ? {
      ...d.mods,
      ...(u.healPer !== undefined ? { healPer: (d.mods?.healPer ?? 0) + u.healPer } : {}),
      ...(u.draw !== undefined ? { draw: (d.mods?.draw ?? EFFS[d.eff].draw ?? 0) + u.draw } : {}),
      // 自伤可以降到 0，但不该变成回血：负数没有意义。
      ...(u.selfHp !== undefined ? { selfHp: Math.max(0, (d.mods?.selfHp ?? 0) + u.selfHp) } : {}),
      ...(u.times !== undefined ? { times: (d.mods?.times ?? EFFS[d.eff].times) + u.times } : {}),
    }
    : d.mods;

  const link: CardLink | undefined = u && d.link && (u.grow !== undefined || u.nextMul !== undefined)
    ? {
      ...d.link,
      ...(u.grow !== undefined ? { grow: (d.link.grow ?? 0) + u.grow } : {}),
      ...(u.nextMul !== undefined ? { nextMul: (d.link.nextMul ?? 1) + u.nextMul } : {}),
    }
    : d.link;

  // 降费只对固定费用有意义：X 费没有"降到几点"这回事，写在上面的 up.cost 会被忽略。
  const baseCost = costOf(d);
  const cost = u?.cost && baseCost !== 'x'
    ? (Math.max(0, (baseCost as number) - u.cost) as CardCost)
    : d.cost;

  return {
    ...d,
    atk: Math.max(0, d.atk + dAtk),
    blk: Math.max(0, d.blk + dBlk),
    ...(mods !== d.mods ? { mods } : {}),
    ...(link !== d.link ? { link } : {}),
    ...(cost !== d.cost ? { cost } : {}),
  };
}

/**
 * 精炼后的定义按「id + 当时的抛光布档位」缓存：卡面每帧都会画，不能每帧重新拼对象。
 *
 * 键里带 `G.upGrade` 是必须的：抛光布中途拿到会改变折出来的数值，
 * 只按 id 缓存会把拿到之前算好的那份一直发下去 —— 卡面写着 +2、实际没加。
 */
const UP_BY_ID = new Map<string, CardDef>();

/**
 * 查表。**带 `+` 的 id 返回已经折过 `up` 的定义**，所以
 * `defOf` / `costOf` / `planStrike` / 卡面全都自动读到精炼后的数值，
 * 不需要每个调用点各自再问一次"这张精炼过没有"。
 */
export const defOf = (id: CardId | null | undefined): CardDef => {
  if (!id) return JUNK;
  const base = baseIdOf(id);
  const raw = CARD_BY_ID.get(base);
  if (!raw) return JUNK;
  if (!isUpgraded(id)) return raw;
  const key = `${base}|${G.upGrade}`;
  let up = UP_BY_ID.get(key);
  if (!up) {
    up = applyUp(raw);
    UP_BY_ID.set(key, up);
  }
  return up;
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

/**
 * 牌组里每种卡（按**定义 id** 算，精炼前后是同一张）各有几份。
 *
 * 战后奖励、事件发牌、增益发牌三处都要按这个数判上限。它们各自抄过一份
 * 同样的累加，改口径时必然漏掉一处 —— 所以只留这一个入口。
 */
export function deckCopies(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of G.deck) out[baseIdOf(id)] = (out[baseIdOf(id)] || 0) + 1;
  return out;
}

/**
 * 这张牌此刻的攻 / 挡底数。
 *
 * 精炼（含抛光布那一档）已经折进 `defOf` 了，所以这里**只读定义**，
 * 不再自己算一遍 —— 早先这里加一次、`defOf` 不加，两个数字来源迟早对不上。
 */
export function statOf(id: CardId) {
  const d = defOf(id);
  return { atk: d.atk || 0, blk: d.blk || 0 };
}
