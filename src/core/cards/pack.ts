import { CATALOG } from './catalog';
import type { Pack } from '../model/types';

/**
 * 内置**奖励池**，常量，不接受外部输入。玩家导入的 md 只换题库。
 * 它只装可获取的知识卡；基础牌在 `basics.ts` 的开局池里，杂念在 `registry.ts`。
 * 三个池共用同一个 `CardDef`，不要因为"它们不在 PACK 里"就另建一套卡牌类型。
 */
export const PACK: Pack = { name: '内置卡牌库', cards: CATALOG };
