/** 进度存档的键；换版本改这里。 */
export const LS_KEY = 'cognirogue.v1';

/**
 * 有没有可用的本地存储。Node 里没有 localStorage，写入口要先问这一句，
 * 否则每局都会白白序列化一次章节记忆。
 */
export function storeAvailable(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage !== null;
  } catch {
    return false;
  }
}

/**
 * localStorage 的安全封装：Node 里没有它，隐私模式下 setItem 也会抛。
 * 两种情况都不该让规则崩掉。
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
