/**
 * cards —— 卡牌工具包。
 *
 * catalog 是**内置且不可替换**的知识卡面表（83 张），pack 是它的卡池常量
 * （`PACK`），basics 是**初始牌组**（固定 3 张、不可获取），kinds 回答
 * 「这张牌是什么身份 / 类别」，registry 回答「这个 id 的卡面是什么」，
 * cost 回答「打出它要付几点」。
 * 表现层想知道任何关于卡牌定义的事，都应该来这里，而不是自己去翻题库。
 *
 * 卡池住在这里而不是 library：它是卡牌数据，不是知识内容。library 的复习
 * 调度读 `PACK` 排起手牌组，所以依赖方向是 library → cards。
 */
export * from './basics';
export * from './catalog';
export * from './cost';
export * from './kinds';
export * from './pack';
export * from './registry';
