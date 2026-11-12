/**
 * combat 的公共 API：牌堆（deck）、题池（questions）、敌人回合（foe）、出牌（play）。
 * 答错不扣行动力、不封牌，代价落在本场新题池上。
 */
export * from './deck';
export * from './questions';
export * from './foe';
export * from './pending';
export * from './play';
