import type { Eff, EffMods } from './types';

/**
 * 卡牌效果：卡牌上的攻/挡就是打出去的数，效果只决定这些数怎么花出去。
 *
 * **原型里没有系数。** 早先原型自带 `atk: 0.52`、`blk: 2.4` 这类倍率，于是每张牌
 * 都有两个数值来源：卡表的底数、原型的倍率。改一个数要考虑另一个，
 * 卡面上写「7 伤」其实是「底数 12 × 0.6 取整」。现在这一层只有四件事：
 * 分几段、破不破格挡、回不回血、抽不抽牌 —— 强弱全写在 `catalog.ts`。
 */
export interface EffDef {
  key: Eff;
  name: string;
  /** 分几段结算，每段单独吃敌方格挡 */
  times: number;
  pierce?: boolean;
  /** 额外抽牌 */
  draw?: number;
  color: string;
}

export const EFFS: Record<Eff, EffDef> = {
  strike: { key: 'strike', name: '猛击', times: 1, color: '#e08048' },
  pierce: { key: 'pierce', name: '洞察', times: 1, pierce: true, color: '#4fd6cf' },
  guard: { key: 'guard', name: '巩固', times: 1, color: '#6f9ee8' },
  drain: { key: 'drain', name: '内化', times: 1, color: '#d06fa8' },
  chain: { key: 'chain', name: '串联', times: 2, color: '#e0a84c' },
  focus: { key: 'focus', name: '专注', times: 1, draw: 1, color: '#a78bfa' },
};

/** 一次出牌的结算结果。字段全是整数：这张牌打出去，就是这些数。 */
export interface EffOut {
  key: Eff;
  /** 每段伤害；`hits.length` 是段数 */
  hits: number[];
  blk: number;
  /** 每段命中回复几点生命；0 表示不回血 */
  healPer: number;
  draw: number;
  /** 打出后自伤；卡面和结算共用 */
  selfHp: number;
  pierce: boolean;
}

/**
 * 结算一次效果。`mods` 是这张卡的签名改动；展示与结算必须传同一份。
 * `repeat` 是 X 费，乘在**段数**上（每段各吃一次敌方格挡），不是乘在每段数值上。
 *
 * 这里只做整数加法与乘法，不取整、不折算。装订线的削减在
 * `combat/strike.ts::planStrike` 的最后一步做 —— 它是"这一手的产出减多少"，
 * 必须等所有加成落完再减，否则削减会先落在某一段上再被后面的加成翻倍。
 */
export function resolveEff(
  key: Eff, atk: number, blk: number, mods?: EffMods, repeat = 1,
): EffOut {
  const d = EFFS[key] ?? EFFS.strike;
  const n = Math.max(1, Math.round(repeat));
  const times = (mods?.times ?? d.times) * n;
  // 底数是 0 就是"这张牌不打伤害"（基础格挡），不要抬成 1 点。
  const per = atk > 0 ? atk : 0;
  return {
    key: d.key,
    hits: Array.from({ length: times }, () => per),
    blk: (blk > 0 ? blk : 0) * n,
    healPer: mods?.healPer ?? 0,
    draw: (mods?.draw ?? d.draw ?? 0) * n,
    // 自伤是这张牌的一次性代价，不随 X 费的 repeat 翻倍。
    selfHp: mods?.selfHp ?? 0,
    pierce: !!d.pierce,
  };
}

/**
 * 一张牌卡面上要写的数字。卡面（ui.ts）和答题面板（effSummaryOf）都读它，
 * 免得"最多回复 / 最多抽"这类公式各算一份，改一处漏一处。
 */
export interface EffFace {
  /** 每段伤害 */
  per: number;
  /** 段数 */
  hits: number;
  blk: number;
  pierce: boolean;
  /** 整张牌最多回多少血；0 表示不是回血牌 */
  healMax: number;
  /** 抽牌上限（X 费按每点算） */
  drawMax: number;
  /** 打出后失去的生命 */
  selfHp: number;
}

export function effFace(out: EffOut): EffFace {
  const per = out.hits[0] ?? 0;
  return {
    per,
    hits: out.hits.length,
    blk: out.blk,
    pierce: out.pierce,
    // 回血要真有伤害才回，所以 0 伤的牌不算回血牌。
    healMax: out.healPer > 0 && per > 0 ? out.healPer * out.hits.length : 0,
    drawMax: out.draw,
    selfHp: out.selfHp,
  };
}

/**
 * 从 `planStrike` 给出的结果生成同一段文案。
 * 文案只认 EffOut，不接收 atk/blk：卡面写的数就是打出来的数。
 *
 * `x` 是给 X 费牌写的：那一行必须说清"这是**每一点**行动力的效果"，
 * 否则玩家会以为「造成 8×2 伤害」就是全部，花 3 点也只打两次。
 */
export function effSummaryOf(o: EffOut, key: Eff, x = false): string {
  const f = effFace(o);
  const dmg = f.hits > 1 ? `${f.per}×${f.hits} 伤害` : `${f.per} 伤害`;
  const tail = [
    f.pierce ? '无视格挡' : '',
    f.blk > 0 ? `${f.blk} 格挡` : '',
    f.healMax > 0 ? `最多回血 ${f.healMax}` : '',
    f.drawMax > 0 ? `最多抽 ${f.drawMax} 张` : '',
    f.selfHp > 0 ? `失去 ${f.selfHp} 生命` : '',
  ].filter(Boolean).join(' · ');
  const body = dmg + (tail ? ' · ' + tail : '');
  return x ? `${EFFS[key].name}：每点行动力 ${body}` : `${EFFS[key].name}：${body}`;
}
