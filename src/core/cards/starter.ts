import { CATALOG } from './catalog';
import { shuffle } from '../infra/util';
import type { CardId, CardGrade } from '../model/types';
import { cardGrade } from './grade';

/**
 * cards/starter —— 开局那 2 张随机知识卡。
 *
 * 起手一共 10 张：`cards/basics.ts` 的 8 张基础牌（4 斩击 + 4 格挡）
 * 加这里的 2 张知识卡。基础牌是保底，知识卡才是这一局的"赌注"。
 *
 * ## 为什么起手只给 B 级及以下
 *
 * 起手随机到一张 S 级（3 费 / X 费）牌时，第一层就能打出 26 点伤害 ——
 * 敌人那时只有十几点血，前十几层会变成一路平推。难度曲线于是不再由塔的层数决定，
 * 而由"开局那一掷"决定，这正好是 roguelike 最不该有的那种随机（见 `BAL.hp` 的注释：
 * 血量只负责"打不打得完"，开局强度不该从这里漏出去）。
 *
 * 所以开局从 **C / B 两档**里抽（0–1 费），A / S 只在战后奖励和精英掉落里出现。
 * 高阶牌因此是"这一局挣来的"，而不是"开局抽到的"。
 *
 * 两张**不重复**：抽到同一张卡的两份副本，等于第一层就少了一个选择。
 * 这里只从 `CATALOG`（知识卡）里抽，基础斩击/格挡不在其中 —— 它们不可获取。
 */
const STARTER_KNOWLEDGE = 2;
/** 起手只允许这两档：C（0 费）和 B（1 费）。 */
const STARTER_GRADES: CardGrade[] = ['C', 'B'];

export const starterPool = () => CATALOG.filter((c) => STARTER_GRADES.includes(cardGrade(c)));

export function startDeck(): CardId[] {
  return shuffle(starterPool()).slice(0, STARTER_KNOWLEDGE).map((c) => c.id);
}
