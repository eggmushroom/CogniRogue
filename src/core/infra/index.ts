/**
 * infra —— 运行时基础设施工具包。
 *
 * 随机数 / 存档 / 事件总线 / 唯一状态对象。只依赖 model，
 * 是 library、cards、map、combat、journey 共同的底座。
 */
export * from './util';
export * from './storage';
export * from './events';
export * from './state';
