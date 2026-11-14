import { G } from '../infra/state';
import { effFace, resolveEff } from '../model/effects';
import type { EffOut } from '../model/effects';
import type { CardId } from '../model/types';
import { BASICS } from '../cards/basics';
import { defOf } from '../cards/registry';
import { applyCardBonus, rulesOf } from '../cards/powers';
import { liveStatOf } from './link';

/**
 * 一张牌「此刻打出去会发生什么」的唯一入口。
 *
 * 卡面（gfx/ui.ts）、答题面板（scenes/overlay.ts）、真实结算（combat/play.ts）
 * 都必须读它，否则就会出现第二套折算。
 *
 * 次序是刻意的：**底数 → 常驻加成 → 临时加成 → 整手削减**。所有加成作用在
 * 已经算好的每段伤害上，削减放最后 —— 它减的是"这一手最终交付多少"，
 * 先减就会被后面的 ×2 放大成反效果。
 */
export interface StrikeOpts {
  /** 预览另一套底数时用（精炼选牌要画「选完之后」的卡面）。 */
  atk?: number;
  blk?: number;
  /** X 费：乘在段数上，不乘在每段数值上。 */
  repeat?: number;
  /** 牌组、奖励、精炼预览只看这张牌本身，不叠战场上的一次性加成。 */
  noBoost?: boolean;
  /** 整手削减（装订线）：每段伤害与格挡各减几点（整数），最低 0。 */
  cut?: { atk: number; blk: number };
}

/** 临时加成作用在结果上：`mul` 乘每段，`add` 加每段。格挡不吃「伤害 ×2」。 */
function applyBoost(out: EffOut, b: { mul: number; add: number } | null): EffOut {
  if (!b || (b.mul === 1 && b.add === 0)) return out;
  return {
    ...out,
    hits: out.hits.map((h) => (h > 0 ? h * b.mul + b.add : h)),
  };
}

/**
 * 整手削减：装订线的「答错也打，但打折」。
 *
 * 必须是**最后一步**。写进 `resolveEff` 的话，削减会先落在某一段上，
 * 再被「续火 ×2」翻倍 —— 同一张牌，答错反而比答对打得更多。
 * 只削伤害与格挡：抽牌、回血、自伤都不属于"这一手的产出"。
 */
function applyCut(out: EffOut, c: { atk: number; blk: number } | undefined): EffOut {
  if (!c || (c.atk <= 0 && c.blk <= 0)) return out;
  return {
    ...out,
    hits: out.hits.map((h) => Math.max(0, h - c.atk)),
    blk: Math.max(0, out.blk - c.blk),
  };
}

/** 纯读：不写任何状态，可以在每帧画卡面时调用。 */
export function planStrike(id: CardId, opts: StrikeOpts = {}): EffOut {
  const card = defOf(id);
  const live = liveStatOf(id);
  const proto = resolveEff(
    card.eff,
    opts.atk ?? live.atk,
    opts.blk ?? live.blk,
    card.mods,
    opts.repeat ?? 1,
  );
  const boosted = applyBoost(applyCardBonus(proto, rulesOf()), opts.noBoost ? null : G.nextBoost);
  return applyCut(boosted, opts.cut);
}

/**
 * 帮助面板的初始牌组说明。数值同样只从 planStrike 出，不自己拼一份原型：
 * 否则帮助页会趁压书石在场时写「4 伤」，而玩家打出去是 5。
 */
export function basicsSummary(): string {
  const groups: { name: string; count: number; hit: number; blk: number }[] = [];
  for (const c of BASICS) {
    const g = groups.find((x) => x.name === c.name);
    if (g) { g.count += 1; continue; }
    const f = effFace(planStrike(c.id, { noBoost: true }));
    groups.push({ name: c.name, count: 1, hit: f.per, blk: f.blk });
  }
  return groups
    .map((g) => {
      const nums = [g.hit > 0 ? `${g.hit} 伤` : '', g.blk > 0 ? `${g.blk} 挡` : ''].filter(Boolean);
      return `${g.name} ×${g.count}（${nums.join('/')}）`;
    })
    .join('、');
}
