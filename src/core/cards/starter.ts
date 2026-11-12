import { CATALOG } from './catalog';
import { shuffle } from '../infra/util';
import type { CardId, CardGrade } from '../model/types';
import { cardGrade } from './grade';

/**
 * 起手 8 基础 + 2 张 C/B 知识卡。两张不重复，保底一张联动卡。
 * 高阶牌只从战后奖励和精英掉落里来。
 */
const STARTER_KNOWLEDGE = 2;
/** 起手只允许这两档：C（0 费）和 B（1 费）。 */
const STARTER_GRADES: CardGrade[] = ['C', 'B'];

export const starterPool = () => CATALOG.filter((c) => STARTER_GRADES.includes(cardGrade(c)));

export function startDeck(): CardId[] {
  // 起手不塞自伤牌，自伤牌仍在奖励池。
  const pool = starterPool().filter((c) => !c.mods?.selfHp);
  const linked = shuffle(pool.filter((c) => c.link)).slice(0, 1);
  const rest = shuffle(pool.filter((c) => !c.link)).slice(0, STARTER_KNOWLEDGE - linked.length);
  return [...linked, ...rest].map((c) => c.id);
}
