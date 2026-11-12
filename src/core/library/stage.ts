import { G } from '../infra/state';
import { planFor } from '../model/data';
import type { Question, QuestionBank, StageBank } from '../model/types';
import { allQuestions, bankGeneration, flattenBank, setActiveBank, sourceBank } from './bank';

/**
 * 阶段题库：每一幕对应课程的一章，对应一份 BANK。
 * 卡只决定打多少，点开牌时才从当前阶段题库抽题，`card.topic` 不参与。
 * 三层是：来源题库 → 阶段题库（派生，不落盘）→ 题目快照（`G.panel.q`）。
 */

/** 当前挂在 `BANK` 上的阶段，以及它来自哪一版来源题库。 */
let ACTIVE_STAGE = 0;
let ACTIVE_GEN = -1;

/**
 * 切到第 `stage` 幕的题库。章节名对不上任何题池时回退到来源题库的全部题目。
 */
export function enterStage(stage: number): StageBank {
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
  return { v: 1, plan, bank };
}

/** 阶段号或来源题库变了，就重新切一次。调用点可以每帧问，不贵。 */
export function ensureStageBank() {
  if (ACTIVE_STAGE !== G.stage || ACTIVE_GEN !== bankGeneration()) enterStage(G.stage);
}

/** 点开一张牌时用的题池：当前阶段的全部题目。曝光计数按本局记，和切阶段无关。 */
export function stagePool(): Question[] {
  ensureStageBank();
  return allQuestions();
}
