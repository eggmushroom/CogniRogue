import { G } from '../infra/state';
import { BAL, planFor } from '../model/data';
import type { Question, QuestionBank } from '../model/types';
import { allQuestions, bankGeneration, flattenBank, setActiveBank, sourceBank } from './bank';
import { answeredCount } from './stagemem';

/**
 * 阶段题库：每一幕对应课程的一章，对应一份 BANK。
 * 卡只决定打多少，点开牌时才从当前阶段题库抽题。
 * 三层是：来源题库 → 阶段题库（派生，不落盘）→ 题目快照（`G.panel.q`）。
 */

/** 当前挂在 `BANK` 上的阶段，以及它来自哪一版来源题库。 */
let ACTIVE_STAGE = 0;
let ACTIVE_GEN = -1;

/**
 * 切到第 `stage` 幕的题库。章节名对不上任何题池时回退到来源题库的全部题目。
 */
export function enterStage(stage: number): void {
  const plan = planFor(stage);
  const src = sourceBank();
  const own = src.byTopic[plan.topic] ?? [];
  const list = own.length ? own : flattenBank(src);
  const bank: QuestionBank = {
    name: `${src.name} · ${plan.topic}`,
    byTopic: { [plan.topic]: list },
    issues: [],
  };
  setActiveBank(bank);
  ACTIVE_STAGE = stage;
  ACTIVE_GEN = bankGeneration();
  G.stageTopic = plan.topic;
}

/** 阶段号或来源题库变了，就重新切一次。调用点可以每帧问，不贵。 */
function ensureStageBank() {
  if (ACTIVE_STAGE !== G.stage || ACTIVE_GEN !== bankGeneration()) enterStage(G.stage);
}

/**
 * 这道题还能不能抽到：答满 `BAL.retireAt` 次就退役。
 *
 * 按题目**自己的**主题查记忆。题池回退到全部题目时按 `G.stageTopic` 查会记错账 ——
 * 主题轮换之后，同一个 qid 在不同幕会被当成两个不同的题。
 */
export function isRetired(q: Question): boolean {
  return answeredCount(q.topic, q.qid) >= BAL.retireAt;
}

/** 本幕还有几道题没退役。更新层靠它判断"这个主题是不是答完了"。 */
export function liveCount(): number {
  ensureStageBank();
  return allQuestions().filter((q) => !isRetired(q)).length;
}

/** 点开一张牌时用的题池：当前阶段还没有退役的题目。曝光计数按本局记，和切阶段无关。 */
export function stagePool(): Question[] {
  ensureStageBank();
  const all = allQuestions();
  const live = all.filter((q) => !isRetired(q));
  // 一个主题的题全部答满之后，可抽的确实是空的。这里退回全部而不是返回空数组：
  // 返回空会让知识卡变成点不开的死牌，玩家连"再答一次"的机会都没有。
  // 「这个主题该重出了」由 liveCount() 告诉更新层，不该罚在玩家手上。
  return live.length ? live : all;
}
