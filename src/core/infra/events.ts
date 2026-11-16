import type { Eff, PowerId } from '../model/types';

/**
 * 逻辑层与表现层唯一的边界。core 只发事件，表现层在 main.ts 订阅并演出。
 */
export type GameEvent =
  | { t: 'dmg'; n: number; absorbed: number; eff?: Eff; seq?: number }
  | { t: 'blk'; n: number }
  /** 玩家自己受伤；敌人攻击不走这里。 */
  | { t: 'hurt'; n: number }
  | { t: 'heal'; n: number }
  /** 敌人回血，落点在敌人血条。 */
  | { t: 'foeHeal'; n: number }
  /** 敌人一段攻击落地；与玩家的多段伤害共用同一个执行器与节拍。 */
  | {
      t: 'enemyHit';
      n: number;
      absorbed: number;
      seq: number;
      times: number;
      totalAbsorbed: number;
    }
  /** 敌人非攻击动作（举盾 / 塞牌 / 强化 / 观察）。 */
  | { t: 'enemyAct'; k: 'def' | 'jam' | 'buff' | 'calm'; n: number }
  | { t: 'power'; id: PowerId }
  | { t: 'fizzle'; eff?: Eff }
  /**
   * 一句已经算完的结算话术。给「选完牌才收的代价」这类**没有对应状态条**的写入用：
   * 生命条会变，但玩家不知道自己为什么掉了 10 点。文案由 core 给，表现层只负责显示。
   */
  | { t: 'note'; text: string };

type FxListener = (e: GameEvent) => void;
const fxListeners: FxListener[] = [];

export function onFx(l: FxListener): () => void {
  fxListeners.push(l);
  return () => {
    const i = fxListeners.indexOf(l);
    if (i >= 0) fxListeners.splice(i, 1);
  };
}

export function emit(e: GameEvent) {
  for (const l of fxListeners) l(e);
}
