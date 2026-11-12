/**
 * core 的跨 tick 调度器。默认是浏览器的 setTimeout；无头模拟 / 结构检查把它换成
 * 同步执行，这样 `G.busy` 的 200ms 输入锁不会把测试挂住，也就不用去偷改全局 setTimeout。
 */
type Scheduler = (ms: number, fn: () => void) => void;

let schedule: Scheduler = (ms, fn) => setTimeout(fn, ms);

export function setScheduler(next: Scheduler) {
  schedule = next;
}

export function after(ms: number, fn: () => void) {
  schedule(ms, fn);
}
