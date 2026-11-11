/**
 * combat/pending —— 战斗结束的结算入口。
 *
 * combat 层不认识 journey：它只负责把 `G.pending` 标出来。真正"开奖励 / 过幕 /
 * 结算失败"是 journey 的事，由 journey 在加载时把 `settlePending` 注册进来。
 *
 * 这是一个很小的控制反转点，但它是 combat → journey 那条反向依赖的替代品：
 * 没有注册时 `requestSettle()` 是 no-op，core/combat 仍能单独跑。
 */
type SettleHandler = () => void;

let settle: SettleHandler | null = null;

export function setSettleHandler(handler: SettleHandler) {
  settle = handler;
}

export function requestSettle() {
  settle?.();
}
