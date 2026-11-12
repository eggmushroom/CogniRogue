/**
 * 战斗结束的结算入口：combat 只标 `G.pending`，真正开奖励 / 过幕 / 结算由 journey
 * 注册进来。没有注册时 `requestSettle()` 是 no-op。
 */
type SettleHandler = () => void;

let settle: SettleHandler | null = null;

export function setSettleHandler(handler: SettleHandler) {
  settle = handler;
}

export function requestSettle() {
  settle?.();
}
