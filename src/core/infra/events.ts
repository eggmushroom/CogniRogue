import type { Eff, PowerId } from '../model/types';

/**
 * infra/events —— 逻辑层与表现层之间唯一的边界。
 *
 * core 刻意不认识 canvas / DOM：它只广播「发生了什么」，由 main.ts 决定怎么演。
 * 同一套规则因此能原样跑在浏览器里，也能跑在 tools/sim.ts 的无头模拟里。
 *
 * `emit` 只给 core 内部各工具包调用；表现层只用 `onFx` 订阅。
 */
export type GameEvent =
  | { t: 'dmg'; n: number; absorbed: number; eff?: Eff; seq?: number }
  | { t: 'blk'; n: number }
  /** 玩家自己受伤（事件选项扣血）。敌人打的那一下不走这里，见 enemyAct。 */
  | { t: 'hurt'; n: number }
  | { t: 'heal'; n: number }
  /**
   * 敌人回血（目前只有 leech）。
   *
   * 和 heal 分开，是因为同一个 `+n` 要落在屏幕两端：玩家的落在提灯上，
   * 敌人的落在它自己的血条上。合成一个事件就得在表现层猜"这次回的是谁"。
   */
  | { t: 'foeHeal'; n: number }
  /**
   * 敌人这一回合做了什么。
   *
   * 刻意把"动作"而不是"结果"作为事件：以前只有掉血才发 hurt，于是格挡全挡下、
   * 举盾、塞杂念、变强、观察期全都是静默的 —— 玩家只能从日志里倒推敌人动过。
   * 现在每个分支都发一次，表现层按 k 编排身体动作和飞行物。
   */
  | {
      t: 'enemyAct';
      k: 'atk' | 'def' | 'jam' | 'buff' | 'calm';
      /** 主数值：伤害 / 护甲 / 杂念张数 / 攻击加成 */
      n: number;
      /** 攻击段数，多段要分几次飞出去 */
      times?: number;
      /** 实际掉血；0 表示被格挡全挡下，表现层要演"撞在盾上"而不是"挨了一下" */
      taken?: number;
      absorbed?: number;
    }
  /** 打出一张增益牌：表现层让它飞向顶栏的增益槽，而不是弃牌堆 */
  | { t: 'power'; id: PowerId }
  /** 答错：这一手打出去了，但没到 —— 表现层让它半路散掉 */
  | { t: 'fizzle'; eff?: Eff }
  | { t: 'kill' }
  | { t: 'clear' }
  | { t: 'shake'; power: number };

type FxListener = (e: GameEvent) => void;
const fxListeners: FxListener[] = [];

export function onFx(l: FxListener) {
  fxListeners.push(l);
}

export function emit(e: GameEvent) {
  for (const l of fxListeners) l(e);
}
