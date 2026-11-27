import type { CardId } from '../model/types';
import { defOf } from './registry';
import { cardKind } from './kinds';
import { BAL } from '../model/data';

/** 按牌组中的知识卡数量预抽题，另留余量给答错或重复出牌。 */
export function battleQuestionCount(deck: CardId[]): number {
  const knowledge = deck.filter((id) => cardKind(defOf(id)) === 'knowledge').length;
  const n = Math.round((knowledge * BAL.qPer) / BAL.qOf) + BAL.qPad;
  return Math.max(6, Math.min(20, n));
}
