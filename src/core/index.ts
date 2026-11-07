/**
 * core —— 纯逻辑层的公共 API。
 *
 * 这一层不认识 canvas、不认识 DOM：它只改 G、只发 GameEvent。
 * 表现层（main.ts / gfx / scenes）订阅事件自己决定怎么演；
 * 同一套规则因此能原样跑在 tools/sim.ts 的无头模拟里。
 *
 * 工具包地图（依赖方向严格单向，左边不依赖右边）：
 *
 *   model    领域模型：类型、静态数据表、六种效果倍率
 *   infra    运行时底座：随机数、存档、事件总线、唯一状态 G
 *   library  知识内容：题库解析 / 当前题库（可外部替换）/ 跨局记忆与起手牌组
 *   cards    卡牌：内置卡面表（不可替换）、身份分类（kind）、id → 卡面注册表
 *   map      地图：八层拓扑生成与可达性
 *   combat   战斗：本场锁、牌堆循环、敌人回合、玩家出牌
 *   journey  一局推进：节点、奖励、事件、结算
 *
 * 新代码建议直接 import 具体工具包（例如 `../core/cards`），
 * 从 import 就能看出这个场景用了哪些能力；`core/game.ts` 只是旧入口的兼容门面。
 */
export * from './model';
export * from './infra';
export * from './library';
export * from './cards';
export * from './map';
export * from './combat';
export * from './journey';
