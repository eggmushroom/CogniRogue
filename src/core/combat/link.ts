import { G } from '../infra/state';
import { baseIdOf, defOf, statOf } from '../cards/registry';
import type { CardId } from '../model/types';

/**
 * 卡与卡的机制联动：攻击底数可由本回合抽牌数、当前格挡、本场打出次数换算，
 * 也可给下一张牌留倍率 / 加数。
 * `liveStatOf` 只算**底数**（纯读）；一次性加成由 `strike.ts::planStrike` 作用在
 * 结果上，卡面、答题面板、结算都读 planStrike。写状态只发生在 `commitLink`。
 */

export interface LiveStat {
  atk: number;
  blk: number;
  /** 这一手数值是怎么算出来的，写进判定面板 */
  reasons: string[];
  /** 有没有待兑现的一次性加成；数值不在这里生效，见 planStrike */
  boosted: boolean;
}

/** 此刻把这张牌打出去，它的攻/挡底数是多少。纯读，不写 G。 */
export function liveStatOf(id: CardId): LiveStat {
  const base = statOf(id);
  const link = defOf(id).link;
  const reasons: string[] = [];
  let atk = base.atk;

  if (link) {
    if (link.atkFrom) {
      const unit = link.atkFrom === 'drawn' ? G.drawnThisTurn : G.block;
      const per = link.per ?? 1;
      atk = (link.floor ?? 0) + Math.max(0, Math.round(unit * per));
      reasons.push(link.atkFrom === 'drawn'
        ? `本回合抽了 ${unit} 张牌 → 底数 ${atk}`
        : `当前 ${unit} 点格挡 → 底数 ${atk}`);
    }
    if (link.grow) {
      const n = G.cardPlays[baseIdOf(id)] ?? 0;
      if (n > 0) {
        atk += n * link.grow;
        reasons.push(`本场已打出 ${n} 次 → +${n * link.grow}`);
      }
    }
  }

  // 一次性加成不在这里改底数：`planStrike` 把它作用在已经算好的每段伤害上。
  // 乘在底数上会被效果原型倍率二次缩放再取整，「下一张伤害 ×2」就不成立了。
  // 这里只留一句给面板看的因果说明，数值由 planStrike 兑现。
  const b = G.nextBoost;
  if (b) {
    reasons.push(`「${b.from}」留给下一张：伤害 ×${b.mul}${b.add ? ` +${b.add}` : ''}`);
  }

  return { atk: Math.max(0, atk), blk: base.blk, reasons, boosted: !!b };
}

/**
 * 一手真的结算完之后记账：消耗上一张的加成、记下这张打过一次、
 * 需要时给下一张留一笔。返回一句要写进结算说明的话。
 */
export function commitLink(id: CardId): string {
  const card = defOf(id);
  const link = card.link;
  const key = baseIdOf(id);
  const notes: string[] = [];

  if (G.nextBoost) {
    notes.push(`「${G.nextBoost.from}」的加成已兑现`);
    G.nextBoost = null;
  }
  G.cardPlays[key] = (G.cardPlays[key] ?? 0) + 1;
  if (link?.grow) notes.push(`「${card.name}」本场第 ${G.cardPlays[key]} 次`);
  if (link && ((link.nextMul ?? 1) !== 1 || (link.nextAdd ?? 0) !== 0)) {
    const mul = link.nextMul ?? 1;
    const add = link.nextAdd ?? 0;
    G.nextBoost = { mul, add, from: card.name };
    notes.push(`下一张牌 ×${mul}${add ? ` +${add}` : ''}`);
  }
  return notes.join(' · ');
}

/**
 * 战斗里那行**状态**说明。只在手牌里真有会读它的牌时才提，
 * 免得每回合挂一串和这一手无关的数字。这不是连击计数，是「数值从哪来」。
 */
export function linkStatus(): string[] {
  const out: string[] = [];
  if (G.nextBoost) {
    const b = G.nextBoost;
    out.push(`下一张 ×${b.mul}${b.add ? ` +${b.add}` : ''} · 来自「${b.from}」`);
  }
  const hands = G.hand.map(defOf);
  if (hands.some((c) => c.link?.atkFrom === 'drawn')) out.push(`本回合抽牌 ${G.drawnThisTurn}`);
  if (hands.some((c) => c.link?.atkFrom === 'block')) out.push(`当前格挡 ${G.block}`);
  for (const c of hands) {
    if (!c.link?.grow) continue;
    const n = G.cardPlays[baseIdOf(c.id)] ?? 0;
    if (n > 0) out.push(`「${c.name}」已打 ${n} 次`);
  }
  return out;
}
