import type { CardInst } from '../model/types';
import { G } from '../infra/state';
import { poolFor } from '../library/bank';
import { defOf, isBasicCardId, isPowerId } from '../cards/registry';
import { cardKind } from '../cards/kinds';

/**
 * combat/unlock —— **本场战斗**的卡种锁状态。
 *
 * 和 library/memory 的跨局记忆是两件事：这里每进一场战斗都清空，
 * 精炼过的卡（up）开局就是解锁状态。
 */

/** 卡种是否已解锁。key 是 card id：同种的多张牌共享一个锁。 */
export const isUnlocked = (id: string) => !!G.unlocked[id];

/** 这一场这个卡种是不是已经因为测试模式答错而作废。 */
export const isForgotten = (id: string) => !!G.forgotten[id];

/** 牌组里有多少"卡种"、其中多少个这场已经解锁 —— 画在顶栏上。 */
export function unlockStats() {
  // 增益牌和基础牌没有锁，不该进分母：否则拿了三张增益牌 + 三张基础牌，
  // 顶栏就变成"永远差八种解锁"，那个数字会彻底失去意义。
  const ids = new Set(
    G.deck.filter((e) => !isPowerId(e.id) && !isBasicCardId(e.id)).map((e) => e.id),
  );
  let n = 0;
  ids.forEach((id) => { if (G.unlocked[id]) n += 1; });
  return { n, total: ids.size };
}

/** 这张牌这回合还能不能答题（没解锁、没作废、且这回合没答错过）。 */
export function canAsk(ent: CardInst | null | undefined): boolean {
  if (!ent) return false;
  const card = defOf(ent);
  // 与 askCard 用同一条取池规则：主题没题会回退到全部题目，别在这里把入口关掉
  if (cardKind(card) !== 'knowledge' || !poolFor(card.topic).list.length) return false;
  if (G.unlocked[card.id]) return false;
  if (G.forgotten[card.id]) return false;
  return !G.failedTurn[card.id];
}
