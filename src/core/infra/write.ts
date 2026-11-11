import { BAL } from '../model/data';
import { G } from './state';
import { clamp } from './util';

/**
 * infra/write —— 玩家三种资源（生命 / 格挡 / 行动力）的**唯一写入通道**。
 *
 * ## 为什么需要它
 *
 * 这三种资源原来是 17 处裸写：`G.block +=` 出现 5 次、`G.hp -=` 2 次、
 * `G.hp = Math.min(...)` 1 次、`G.ap -=` 3 次、`clamp(G.ap, 0, 10)` 3 次，
 * 散在 deck / play / foe / events / run 五个文件里。
 *
 * 那不是"代码不好看"的问题，是**不变量没人守**：
 *
 *   - `G.ap` 必须在 `0..BAL.apCap`。漏一次 clamp，X 费牌答对之后能连开三张。
 *   - `G.hp` 在战斗里可以掉到 0（那是死亡），在事件里绝不能（`loss()` 写死了
 *     下限 1）；同一个 `-=` 承担两种语义，靠读代码的人记住自己在哪个上下文。
 *   - `G.block` 只能加，且回合开始是**重置**而不是累加 —— 两件事长得一样。
 *
 * 现在这三种情况各有名字：`loseHp`（可致死）/ `loseHp(n, 1)`（不可致死）、
 * `grantBlock` / `setBlock`。写错了函数名会在评审时看出来，写错了 `+=` 不会。
 *
 * ## 这个文件刻意不做的事
 *
 * **不打日志、不发事件。** 那两样都依赖上下文（"谁给的"、"该飘在哪"），
 * 调用点比这里知道得多；搬进来的话每个调用点都得把文案当参数传，反而更绕。
 * 这里只守不变量，并返回**实际生效的量** —— 满血时 `healHp` 返回 0，
 * 反馈面板就不会凭空多报一个 +N。
 *
 * ## 怎么防止有人绕过去
 *
 * `tools/stagecheck.ts` 有一条源码扫描断言：`G.hp` / `G.block` / `G.ap` 的
 * 赋值与自增，只允许出现在本文件里。绕过去会在 `npm run stage` 当场红。
 */

/**
 * 加格挡。非正数直接返回 0（调用点常直接把卡面数字传进来，0 和负数很常见）。
 * 返回实际加了多少 —— 目前格挡没有上限，所以永远是入参本身。
 */
export function grantBlock(n: number): number {
  if (!(n > 0)) return 0;
  const add = Math.round(n);
  G.block += add;
  return add;
}

/**
 * 把格挡**设成**某个值，不是加。回合开始时用（长明灯 + 开局缓冲）。
 *
 * 和 `grantBlock` 分开，是因为"这一回合从 3 点开始"和"现在多 3 点"是两件事，
 * 而它们在旧代码里都写成 `G.block =` 和 `G.block +=` —— 差一个字符，差一个语义。
 */
export function setBlock(n: number): void {
  G.block = Math.max(0, Math.round(n));
}

/**
 * 扣血。`floor` 是**下限**，默认 0 —— 0 意味着这一下可以打死你。
 *
 * 战斗伤害、反伤用默认值；事件里的"失去 N 点生命"传 `floor = 1`，
 * 因为随机事件不该成为一局的终点（那条规则原本是 `events.ts` 里一个
 * 孤零零的 `Math.max(1, ...)`，看不出它在表达"事件不致死"）。
 *
 * 返回实际掉了多少 —— 撞上下限时它小于入参。
 */
export function loseHp(n: number, floor = 0): number {
  if (!(n > 0)) return 0;
  const before = G.hp;
  G.hp = Math.max(floor, G.hp - Math.round(n));
  return before - G.hp;
}

/** 回血，不超过上限。返回实际回了多少（满血时是 0）。 */
export function healHp(n: number): number {
  if (!(n > 0)) return 0;
  const before = G.hp;
  G.hp = Math.min(G.maxHp, G.hp + Math.round(n));
  return G.hp - before;
}

/** 回满。开局、过幕时用。 */
export function refillHp(): void {
  G.hp = G.maxHp;
}

/**
 * 抬高生命上限，返回新的上限。
 *
 * 上限和当前值分开写：书脊要一起抬（"立刻变厚"），过幕只要上限（随后 `refillHp`）。
 * 两者都不带血量的下限判断 —— 上限永远是正的。
 */
export function raiseMaxHp(n: number): number {
  if (n > 0) G.maxHp += Math.round(n);
  return G.maxHp;
}

/**
 * 把血**设成**某个值，用于"免死"这类不讲加减的场合（许愿条）。
 *
 * 不走 `healHp` 是因为它表达的是"从 0 拉到 N"，而不是"回 N 点"：
 * 满血时 `healHp` 返回 0，这里却必须真的把 0 血拉起来。
 */
export function reviveHp(n: number): number {
  G.hp = Math.max(1, Math.min(G.maxHp, Math.round(n)));
  return G.hp;
}

/** 扣行动力，夹在 `0..BAL.apCap`。返回实际扣了多少。 */
export function spendAp(n: number): number {
  const before = G.ap;
  G.ap = clamp(G.ap - n, 0, BAL.apCap);
  return before - G.ap;
}

/** 加行动力（答对退款、荧光笔），夹在 `0..BAL.apCap`。返回实际加了多少。 */
export function gainAp(n: number): number {
  const before = G.ap;
  G.ap = clamp(G.ap + n, 0, BAL.apCap);
  return G.ap - before;
}

/** 回合开始把行动力重置成上限（上限由 `rulesOf().apMax` 先写进 `G.apMax`）。 */
export function resetAp(): void {
  G.ap = clamp(G.apMax, 0, BAL.apCap);
}
