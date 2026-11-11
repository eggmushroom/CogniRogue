/**
 * library —— 知识内容工具包。
 *
 * parse    把 md / JSON 解析成题库 + 格式诊断（主题是可选分组）
 * bank     来源题库 / 当前阶段题库 / 每题稳定题号
 * stage    按课程表把来源题库切成每一幕的 BANK
 * stagemem 按章节记的学习档案（题号 + 章节，不是卡）
 * memory   跨局记忆与起手牌组
 * question 每次出题的选项乱序视图
 *
 * 依赖方向：library 只依赖左边的 model / infra / cards。
 * 卡池 `PACK` 住在 `cards/pack.ts` —— 它是卡牌数据，不是知识内容；
 * 这里读它只是为了排复习顺序，不是把题库和卡池焊在一起。
 */
export * from './parse';
export * from './bank';
export * from './stage';
export * from './stagemem';
export * from './memory';
export * from './question';
