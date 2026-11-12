import { BAL } from '../model/data';
import { G } from './state';
import { clamp } from './util';

/**
 * 三种资源（生命 / 格挡 / 行动力）的唯一写入通道。
 * 不变量：ap 夹在 0..apCap；事件扣血下限 1；block 是设置不是累加。函数返回实际生效的量。
 * 资源只能从这里写，`tools/stagecheck.ts` 的源码扫描断言会拦下绕过。
 */

/** 加格挡；非正数返回 0，返回实际加了多少。 */
export function grantBlock(n: number): number {
  if (!(n > 0)) return 0;
  const add = Math.round(n);
  G.block += add;
  return add;
}

/** 把格挡设成某个值，不累加；回合开始时用。 */
export function setBlock(n: number): void {
  G.block = Math.max(0, Math.round(n));
}

/** 扣血，`floor` 是下限；返回实际掉血量。 */
export function loseHp(n: number, floor = 0): number {
  if (!(n > 0)) return 0;
  const before = G.hp;
  G.hp = Math.max(floor, G.hp - Math.round(n));
  return before - G.hp;
}

/** 回血，不超过上限；返回实际回血量。 */
export function healHp(n: number): number {
  if (!(n > 0)) return 0;
  const before = G.hp;
  G.hp = Math.min(G.maxHp, G.hp + Math.round(n));
  return G.hp - before;
}

/** 回满血。 */
export function refillHp(): void {
  G.hp = G.maxHp;
}

/** 抬高生命上限，返回新上限。 */
export function raiseMaxHp(n: number): number {
  if (n > 0) G.maxHp += Math.round(n);
  return G.maxHp;
}

/** 免死：把血设成 n，最少 1。 */
export function reviveHp(n: number): number {
  G.hp = Math.max(1, Math.min(G.maxHp, Math.round(n)));
  return G.hp;
}

/** 扣行动力，夹在 `0..BAL.apCap`；返回实际扣量。 */
export function spendAp(n: number): number {
  const before = G.ap;
  G.ap = clamp(G.ap - n, 0, BAL.apCap);
  return before - G.ap;
}

/** 加行动力，夹在 `0..BAL.apCap`；返回实际加量。 */
export function gainAp(n: number): number {
  const before = G.ap;
  G.ap = clamp(G.ap + n, 0, BAL.apCap);
  return G.ap - before;
}

/** 回合开始把行动力重置成上限。 */
export function resetAp(): void {
  G.ap = clamp(G.apMax, 0, BAL.apCap);
}
