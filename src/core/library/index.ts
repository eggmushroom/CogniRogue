/**
 * library —— 知识内容工具包。
 *
 * parse    把 md / JSON 解析成题库 + 格式诊断（主题是可选分组）
 * bank     当前题库（唯一可外部替换的东西）+ 格式校验 + 主题优先/全局兜底的题池
 * memory   跨局记忆与起手牌组
 * question 每次出题的选项乱序视图
 *
 * 依赖方向：library 只依赖左边的 model / infra / cards。
 * 卡池 `PACK` 住在 `cards/pack.ts` —— 它是卡牌数据，不是知识内容；
 * 这里读它只是为了排复习顺序，不是把题库和卡池焊在一起。
 */
export * from './parse';
export * from './bank';
export * from './memory';
export * from './question';
