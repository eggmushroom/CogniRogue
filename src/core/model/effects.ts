import type { Eff, EffMods } from './types';

/**
 * 卡牌效果。卡面的攻/挡只是底数，效果决定这些数字怎么花出去。
 *
 * 设计原则：效果不是随机贴的种类，而是「这张卡所对应的认知方式」。
 * 洞察 = 看穿表象（无视格挡）、巩固 = 稳住防线、内化 = 把知识变成自己的血、
 * 串联 = 把两件事连起来打、专注 = 少打一下换一张牌。
 *
 * 效果由内置卡牌库 `cards/catalog.ts` 的 `eff` 字段声明（题库不定义数值）。
 */
export interface EffDef {
  key: Eff;
  /** 卡面徽章上的两字名 */
  name: string;
  /** 帮助面板里的一句话 */
  hint: string;
  /** 六字以内的定位，用在帮助面板的效果表里 */
  tagline: string;
  /** 攻/挡倍率，乘在卡面 stat 上 */
  atk: number;
  blk: number;
  /** 分几段结算，每段单独吃敌方格挡 */
  times: number;
  /** 无视敌方格挡 */
  pierce?: boolean;
  /** 按实际造成的伤害比例回血 */
  heal?: number;
  /** 额外抽牌 */
  draw?: number;
  color: string;
}

export const EFFS: Record<Eff, EffDef> = {
  strike: {
    key: 'strike', name: '猛击', atk: 1, blk: 0.7, times: 1, color: '#e08048',
    hint: '攻守均衡的基准效果。没有短板，也没有偏科。', tagline: '攻守均衡',
  },
  pierce: {
    key: 'pierce', name: '洞察', atk: 0.95, blk: 0, times: 1, pierce: true, color: '#4fd6cf',
    hint: '无视敌方格挡。对爱堆防的精英和 Boss，这一条就是全部价值。', tagline: '无视格挡',
  },
  guard: {
    key: 'guard', name: '巩固', atk: 0.6, blk: 2, times: 1, color: '#6f9ee8',
    hint: '伤害减半，格挡接近翻倍。用来撑过要挨重击的那一回合。', tagline: '格挡翻倍',
  },
  drain: {
    key: 'drain', name: '内化', atk: 0.85, blk: 0, times: 1, heal: 0.5, color: '#d06fa8',
    hint: '按实际造成的伤害回复生命。血线吃紧时长局里最耐用的一张。', tagline: '按伤害回血',
  },
  chain: {
    key: 'chain', name: '串联', atk: 0.52, blk: 0, times: 2, color: '#e0a84c',
    hint: '分两段结算。打无格挡的目标总伤更高，打有格挡的目标会被吃两次。', tagline: '两段结算',
  },
  focus: {
    key: 'focus', name: '专注', atk: 0.7, blk: 0, times: 1, draw: 1, color: '#a78bfa',
    hint: '伤害偏低，但抽一张牌。手牌见底时它能把你这一回合接上。', tagline: '抽一张牌',
  },
};

/** 一次出牌的结算结果。伤害拆成段，因为「串联」要打两下。 */
export interface EffOut {
  key: Eff;
  /** 每段伤害（已含连击倍率） */
  hits: number[];
  blk: number;
  healRatio: number;
  draw: number;
  pierce: boolean;
}

/**
 * 结算一次效果。`mods` 是这张卡自己的签名改动（见 EffMods），逐字段覆盖原型默认 ——
 * 展示（卡面、答题面板）和结算（出牌）必须传同一份，卡面写的和实际发生的才不会两张皮。
 *
 * `repeat` 是 X 费牌用的：花掉的每一点行动力结算一次，花 3 点就是三倍的段数、
 * 三倍的格挡。它是**乘在段数上**的，不是乘在每段数值上 —— 因为"造成 X 次效果"
 * 和"造成一次 X 倍伤害"在打有格挡的敌人时完全不是一回事，前者每段各吃一次格挡。
 */
export function resolveEff(
  key: Eff, atk: number, blk: number, mult = 1, mods?: EffMods, repeat = 1,
): EffOut {
  const d = EFFS[key] ?? EFFS.strike;
  // 底数是 0 就是"这张牌不打伤害"（基础格挡），不要被四舍五入抬成 1 点。
  const per = atk <= 0 ? 0 : Math.max(1, Math.round(atk * (mods?.atkMul ?? d.atk) * mult));
  const n = Math.max(1, Math.round(repeat));
  return {
    key: d.key,
    hits: Array.from({ length: (mods?.times ?? d.times) * n }, () => per),
    blk: Math.round(blk * (mods?.blkMul ?? d.blk)) * n,
    healRatio: mods?.heal ?? d.heal ?? 0,
    draw: (mods?.draw ?? d.draw ?? 0) * n,
    pierce: !!d.pierce,
  };
}

/**
 * 纯文本描述，给题目面板、帮助面板这类只有一行字的地方用。
 *
 * `x` 是给 X 费牌写的：那一行必须说清"这是**每一点**行动力的效果"，
 * 否则玩家会以为「造成 8×2 伤害」就是全部，花 3 点也只打两次。
 */
export function effSummary(key: Eff, atk: number, blk: number, mods?: EffMods, x = false): string {
  const o = resolveEff(key, atk, blk, 1, mods);
  const dmg = o.hits.length > 1 ? `${o.hits[0]}×${o.hits.length} 伤害` : `${o.hits[0]} 伤害`;
  const tail = o.pierce ? '无视格挡'
    : o.blk > 0 ? `${o.blk} 格挡`
    : o.healRatio > 0 ? `回血 ${Math.max(1, Math.round(o.hits[0] * o.hits.length * o.healRatio))}`
    : o.draw > 0 ? `抽 ${o.draw} 张`
    : '';
  const body = dmg + (tail ? ' · ' + tail : '');
  return x ? `${EFFS[key].name}：每点行动力 ${body}` : `${EFFS[key].name}：${body}`;
}
