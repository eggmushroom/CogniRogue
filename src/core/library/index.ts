/**
 * library —— 知识内容工具包。
 *
 * parse   把 md / JSON 解析成题库 + 格式诊断（主题是可选分组）
 * bank    当前题库（唯一可外部替换的东西）+ 格式校验 + 主题优先/全局兜底的题池
 * pack    内置卡牌库（恒定常量，不可替换）
 * memory  跨局记忆与起手牌组
 * question 每次出题的选项乱序视图
 *
 * 依赖方向：model ← infra ← library；bank / pack 只按**具体文件**
 * 引用 cards/catalog，不经过 cards/index，避免和 registry 形成环。
 */
export * from './parse';
export * from './bank';
export * from './pack';
export * from './memory';
export * from './question';
