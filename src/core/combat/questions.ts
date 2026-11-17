import type { Question } from '../model/types';
import { G } from '../infra/state';
import { shuffle } from '../infra/util';
import { battleQuestionCount } from '../cards/ask';
import { nextQuestions, runPool } from '../library/stage';

/**
 * combat/questions：一场战斗的题目池，开战前抽好。
 *
 * 题目来自本局的**临时题库**（`library/stage.ts`），那是一条按主题连续排列的队列：
 * 战斗开始时从队列头往后取，所以一局会先把一个主题走完、再进下一个。
 * 每题每局最多问 3 次；新题用完进复用，不自动补回。
 */
export const MAX_PICK_PER_RUN = 3;

/**
 * 开战抽题：题量由牌组算（battleQuestionCount），从临时题库的队列里依次取。
 *
 * 两种题跳过，都不占这一场的名额（否则顶栏读数虚高）：
 *   · 本局已经答对的 —— 学会了就别再占位置；
 *   · 本局已经抽满 MAX_PICK_PER_RUN 次的 —— 一道一直答错的题会被连抽十几次，
 *     把别的题全挤掉。
 */
export function drawBattleQuestions() {
  const want = battleQuestionCount(G.deck);
  const picked: Question[] = [];
  while (picked.length < want) {
    const q = nextQuestions(1)[0];
    if (!q) break;
    if (G.qSolved[q.qid]) continue;
    if ((G.qPicked[q.qid] ?? 0) >= MAX_PICK_PER_RUN) continue;
    picked.push(q);
  }
  G.qLeft = picked;
}

/**
 * 取一道题：先取本场新题；池空后复用，不返回 null、不锁牌。
 * 复用时优先找**还没答对**的题，全都答对了才回头找答对的。
 * 新题不自动补回，补回会让答错的代价重新变成无限。
 */
export function takeQuestion(): Question | null {
  while (G.qLeft.length) {
    const q = G.qLeft.pop()!;
    if (G.qSolved[q.qid]) continue;
    // 坏状态兜底：qLeft 里理论上不会有已到上限的题。
    if ((G.qPicked[q.qid] ?? 0) >= MAX_PICK_PER_RUN) continue;
    G.qPicked[q.qid] = (G.qPicked[q.qid] ?? 0) + 1;
    return q;
  }
  // 队列走完了：在**整局临时题库**里挑被问得最少的一道重复问，不让知识卡整场作废。
  const list = runPool();
  if (!list.length) return null;
  const unsolved = list.filter((q) => !G.qSolved[q.qid]);
  const pool = unsolved.length ? unsolved : list;
  const min = Math.min(...pool.map((q) => G.qPicked[q.qid] ?? 0));
  const reuse = shuffle(pool.filter((q) => (G.qPicked[q.qid] ?? 0) === min))[0];
  if (!reuse) return null;
  G.qPicked[reuse.qid] = (G.qPicked[reuse.qid] ?? 0) + 1;
  return reuse;
}
