import { POWERS, POWER_BY_ID } from '../model/data';
import type { CardDef, CardInst, PowerDef, PowerId } from '../model/types';
import { G } from '../infra/state';
import { PACK } from '../library/pack';
import { isPowerCard } from './kinds';

/**
 * cards/registry —— 卡牌定义的查找表。
 *
 * 一张牌在牌组里只是 `CardInst`（id + 是否精炼），卡面全部由这里按 id 还原。
 * 知识卡来自内置卡牌库 catalog（PACK），增益牌与杂念由本文件造出来 —— 它们和知识卡走
 * **完全相同**的通道，所以「增益是牌而不是遗物」在数据层就成立。
 */

const JUNK: CardDef = {
  id: '__junk', topic: '杂念', name: '杂念', atk: 0, blk: 0,
  eff: 'strike', junk: true, kind: 'junk',
};

export const powerCardId = (id: PowerId) => 'pow:' + id;

const POWER_CARD: Record<string, CardDef> = Object.fromEntries(
  POWERS.map((p): [string, CardDef] => [powerCardId(p.id), {
    id: powerCardId(p.id), topic: '增益', name: p.name,
    atk: 0, blk: 0, eff: 'strike', power: p.id, kind: 'power',
  }]),
);

export const defOf = (ent: CardInst | null | undefined): CardDef => {
  if (!ent) return JUNK;
  if (ent.junk) return JUNK;
  return PACK.cards.find((c) => c.id === ent.id) ?? POWER_CARD[ent.id] ?? JUNK;
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
  G.deck.forEach((e) => { seen[e.id] = true; });
  return Object.keys(seen)
    .map((id) => POWER_CARD[id]?.power)
    .filter((p): p is PowerId => !!p)
    .map((p) => POWER_BY_ID[p]);
}

export function statOf(ent: CardInst) {
  const d = defOf(ent);
  const up = ent.up ? 3 : 0;
  return {
    atk: (d.atk || 0) + up + (G.topicAtk[d.topic] || 0),
    blk: (d.blk || 0) + up,
  };
}

/** 这个 id 是不是一张增益牌。奖励池、解锁统计、结算页都要排除它。 */
export const isPowerId = (id: string) => !!POWER_CARD[id];
