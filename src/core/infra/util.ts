export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function shuffle<T>(arr: readonly T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];

/**
 * 抽一个 1–100 的整数，代表"百分之几"。
 *
 * 概率一律写成整数份数（`roll() <= 62` 就是六成二），不写 `Math.random() < 0.62`。
 * 小数概率在代码里看不出是几份之一，改的时候只能估；整数份数能直接和地图配比
 * （38 / 20 / 26 / 16 份）对上账，也不会在两个地方各写一份 0.62 慢慢走偏。
 */
export const roll = (): number => 1 + Math.floor(Math.random() * 100);

