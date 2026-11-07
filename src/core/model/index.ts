/**
 * model —— 领域模型工具包。
 *
 * 只放「是什么」：类型、静态数据表、效果倍率。不持有可变状态，不认识 DOM，
 * 也不 import 任何其他工具包。所有上层包都从这一层取词汇表。
 */
export * from './types';
export * from './data';
export * from './effects';
