/**
 * cards —— 卡牌工具包。
 *
 * catalog 是**内置且不可替换**的知识卡面表（83 张），basics 是**初始牌组**
 * （固定 5 张、不可获取），kinds 回答「这张牌是什么身份 / 类别」，
 * registry 回答「这个 id 的卡面是什么」。表现层想知道任何关于卡牌定义的事，
 * 都应该来这里，而不是自己去翻题库或 PACK。
 */
export * from './basics';
export * from './catalog';
export * from './kinds';
export * from './registry';
