/**
 * cards —— 卡牌工具包。
 *
 * catalog 是**内置且不可替换**的知识卡面表（83 张），pack 是它的卡池常量
 * （`PACK`），basics 是**开局基础牌**（4 斩击 + 4 格挡，不可获取），starter 是
 * 开局另外那 **2 张随机知识卡**（从 catalog 里抽，不与基础牌混在一起），
 * grade 是**卡牌等级**（C/B/A/S = 这一段要答对几次才免答）。
 * kinds 回答「这张牌是什么身份 / 类别」，registry 回答「这个 id 的卡面是什么」，
 * cost 回答「打出它要付几点」。
 * 表现层想知道任何关于卡牌定义的事，都应该来这里，而不是自己去翻题库。
 *
 * 卡池和起手都住在这里：它们是卡牌数据，不是知识内容。
 */
export * from './basics';
export * from './catalog';
export * from './cost';
export * from './grade';
export * from './kinds';
export * from './legacy';
export * from './pack';
export * from './registry';
export * from './starter';
