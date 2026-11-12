/** 表现层共用的小几何 / 缓动；不引依赖，也不参与任何规则。 */

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** 三次缓出：起手快、落位慢。 */
export const easeOut = (p: number) => 1 - Math.pow(1 - p, 3);
