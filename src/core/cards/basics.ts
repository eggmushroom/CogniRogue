import { resolveEff } from '../model/effects';
import type { CardDef, CardId } from '../model/types';

/**
 * 初始基础牌：4 张基础斩击 + 4 张基础格挡。不答题，不可获取，但可以精炼、遗忘。
 * 数值低于知识卡，只保证这一回合有牌可打，不保证打得赢。
 */
const STRIKE: CardDef = {
  id: 'base:strike', topic: '基础', name: '基础斩击',
  atk: 4, blk: 0, cost: 1, eff: 'strike', kind: 'basic', type: 'attack',
};

const GUARD: CardDef = {
  id: 'base:guard', topic: '基础', name: '基础格挡',
  atk: 0, blk: 3, cost: 1, eff: 'guard', kind: 'basic', type: 'defense',
};

export const BASICS: CardDef[] = [
  STRIKE, STRIKE, STRIKE, STRIKE,
  GUARD, GUARD, GUARD, GUARD,
];

/** 基础牌的 id 集合：奖励池、随机起手都要把它们排除在外（它们不"获取"，只在开局给）。 */
export const BASIC_IDS = new Set(BASICS.map((c) => c.id));

export const isBasicId = (id: string): boolean => BASIC_IDS.has(id);

/** 初始牌组是一串 id，精炼过的那张换成带 `+` 的 id。 */
export const basicDeck = (): CardId[] => BASICS.map((c) => c.id);

/** 按 id 找基础牌定义（`defOf` 的兜底链里用）。 */
export const basicDef = (id: string): CardDef | undefined => BASICS.find((c) => c.id === id);

/** 帮助面板用：数值从卡面推导，不手写。 */
export function basicsSummary(): string {
  const groups: { name: string; count: number; hit: number; blk: number }[] = [];
  for (const c of BASICS) {
    const o = resolveEff(c.eff, c.atk, c.blk);
    const g = groups.find((x) => x.name === c.name);
    if (g) { g.count += 1; continue; }
    groups.push({ name: c.name, count: 1, hit: o.hits[0], blk: o.blk });
  }
  return groups
    .map((g) => {
      const nums = [g.hit > 0 ? `${g.hit} 伤` : '', g.blk > 0 ? `${g.blk} 挡` : ''].filter(Boolean);
      return `${g.name} ×${g.count}（${nums.join('/')}）`;
    })
    .join('、');
}
