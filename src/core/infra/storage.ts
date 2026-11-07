/** 进度存档的键。换版本时改这里，别在业务代码里散落字符串。 */
export const LS_KEY = 'cognirogue.v1';

/**
 * localStorage 的安全封装。
 *
 * core 要能在 Node 里跑无头模拟（tools/sim.ts），那里根本没有 localStorage；
 * 浏览器隐私模式下 setItem 也会抛。两种情况都不该让规则崩掉 —— 记忆只影响
 * 组牌与难度，不是这一局能不能继续的前提。
 */
export function readStore(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStore(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* 写不进去就当这局没存，不影响当前牌局 */
  }
}
