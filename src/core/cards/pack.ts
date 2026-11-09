import { CATALOG } from './catalog';
import type { Pack } from '../model/types';

/**
 * cards/pack —— **内置卡牌库**，常量，不接受外部输入。
 *
 * 以前这里是一个 `let PACK`，`loadPack(md)` 会把整副牌换掉 —— 卡数、卡名、
 * 攻挡、效果、主题甚至 card id 全跟着外部文件变。「开局固定卡组」和
 * 「奖励从卡牌库随机抽」因此根本没有稳定的底座，旧存档还会因为 id 变化
 * 把牌组实例解析成杂念。
 *
 * 现在卡面由 `cards/catalog.ts` 写死，玩家从标题页导入的 md 只换题库
 * （见 `library/bank.ts`）。PACK 从头到尾都是同一副牌。
 *
 * 它属于 cards 而不是 library：卡池是**卡牌数据**，不是知识内容。
 * library 的复习调度要读它（`startDeck` 得知道有哪些卡才排得出起手牌组），
 * 所以依赖方向是 library → cards，而不是反过来。
 */
export const PACK: Pack = { name: '内置卡牌库', cards: CATALOG };

export const topics = (): string[] => [...new Set(PACK.cards.map((c) => c.topic))];
