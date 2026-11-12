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
  /** 敌人动作；`taken` 为 0 表示被格挡全挡下。 */
  | {
      t: 'enemyAct';
      k: 'atk' | 'def' | 'jam' | 'buff' | 'calm';
      n: number;
      times?: number;
      taken?: number;
      absorbed?: number;
    }
  | { t: 'power'; id: PowerId }
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
