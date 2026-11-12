/**
 * core 的公共 API。这一层只改 G、只发 GameEvent，不碰 canvas 和 DOM。
 * 依赖方向（单向）：model → infra → cards → library → map → combat → journey，
 * 由 `tools/deps.mjs` 校验。场景代码建议直接 import 具体工具包。
 */
export * from './model';
export * from './infra';
export * from './cards';
export * from './library';
export * from './map';
export * from './combat';
export * from './journey';
