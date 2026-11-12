import { CATALOG } from './catalog';
import type { Pack } from '../model/types';

/**
 * 内置卡牌库，常量，不接受外部输入。玩家导入的 md 只换题库。
 */
export const PACK: Pack = { name: '内置卡牌库', cards: CATALOG };
