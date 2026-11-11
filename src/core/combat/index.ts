/**
 * combat —— 战斗工具包。
 *
 * deck 管牌堆循环，questions 管一场战斗预抽的题池，
 * foe 管敌人招式与敌人回合，
 * play 管开局与玩家出牌的三条路径（答题 / 免答直打 / 基础牌 / 增益牌）。
 *
 * 这里原来还有一个 unlock.ts 管"本场卡种锁"，整条删掉了：
 * 一场只有 2–3 回合，"答对一次就免答 ×1.5"的收割期比洗一次牌还短。
 * 现在"答错锁牌"也删了 —— 答错不扣行动力、不封牌，代价落在本场新题池上。
 */
export * from './deck';
export * from './questions';
export * from './foe';
export * from './pending';
export * from './play';
