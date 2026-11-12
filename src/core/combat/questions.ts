import type { Question } from '../model/types';
import { G } from '../infra/state';
import { shuffle } from '../infra/util';
import { battleQuestionCount } from '../cards/grade';
import { stagePool } from '../library/stage';

/**
 * combat/questions：一场战斗的题目池，开战前抽好。
 * 每题每局最多问 3 次；新题用完进复用，不自动补回。
 */
export const MAX_PICK_PER_RUN = 3;

/** 本局还没到 3 次上限的题。 */
function eligible(list: Question[]): Question[] {
  return list.filter((q) => (G.qPicked[q.qid] ?? 0) < MAX_PICK_PER_RUN);
}

/**
 * 开战抽题：题量由牌组算（battleQuestionCount），只放未到上限的题；
 * 只有真被问到的题算曝光，预抽本身不占配额。
 */
export function drawBattleQuestions() {
  const list = stagePool();
  // 题量只由牌组算，课表只认基础牌，不再改题量。
  const want = battleQuestionCount(G.deck);
  // 已到上限的题不放进去，否则顶栏读数虚高；新题用完由 takeQuestion 进入复用。
  G.qLeft = shuffle(eligible(list)).slice(0, want);
}

/**
 * 取一道题：先取本场新题；池空后取本章被问得最少的一道，不返回 null、不锁牌。
 * 新题不自动补回，补回会让答错的代价重新变成无限。
 */
export function takeQuestion(): Question | null {
  while (G.qLeft.length) {
    const q = G.qLeft.pop()!;
    // 坏状态兜底：qLeft 里理论上不会有已到上限的题。
    if ((G.qPicked[q.qid] ?? 0) >= MAX_PICK_PER_RUN) continue;
    G.qPicked[q.qid] = (G.qPicked[q.qid] ?? 0) + 1;
    return q;
  }
  // 新题用完：取被问得最少的一道重复问，不让知识卡整场作废。
  const list = stagePool();
  if (!list.length) return null;
  const min = Math.min(...list.map((q) => G.qPicked[q.qid] ?? 0));
  const reuse = shuffle(list.filter((q) => (G.qPicked[q.qid] ?? 0) === min))[0];
  if (!reuse) return null;
  G.qPicked[reuse.qid] = (G.qPicked[reuse.qid] ?? 0) + 1;
  return reuse;
}
