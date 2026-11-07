/**
 * combat —— 战斗工具包。
 *
 * unlock 管本场卡种锁，deck 管牌堆循环，foe 管敌人招式与敌人回合，
 * play 管开局与玩家出牌的四条路径（答题 / 免答 / 快攻 / 基础牌）。
 * 四个文件按「状态 → 循环 → 对手 → 出手」排，不互相倒着引用。
 */
export * from './unlock';
export * from './deck';
export * from './foe';
export * from './play';
