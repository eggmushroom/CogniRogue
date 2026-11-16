import { CATALOG } from './catalog';
import { shuffle } from '../infra/util';
import type { CardId } from '../model/types';
import { costOf } from './cost';
import { cardKind } from './kinds';

/**
 * 起手 8 基础 + 2 张 0–1 费知识卡。两张不重复，保底一张联动卡。
 * 2 费以上的知识卡只从战后奖励和精英掉落里来。
 */
const STARTER_KNOWLEDGE = 2;

/** 起手只允许 0–1 费；X 费不进入起手池。 */
const starterPool = () => CATALOG.filter((c) => {
  if (cardKind(c) !== 'knowledge') return false;
  const cost = costOf(c);
  return typeof cost === 'number' && cost <= 1;
});

export function startDeck(): CardId[] {
  // 起手不塞自伤牌，自伤牌仍在奖励池。
  const pool = starterPool().filter((c) => !c.mods?.selfHp);
  const linked = shuffle(pool.filter((c) => c.link)).slice(0, 1);
  const rest = shuffle(pool.filter((c) => !c.link)).slice(0, STARTER_KNOWLEDGE - linked.length);
  return [...linked, ...rest].map((c) => c.id);
}
