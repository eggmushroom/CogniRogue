import { G } from '../infra/state';
import { planFor } from '../model/data';
import type { Question, QuestionBank, StageBank } from '../model/types';
import { allQuestions, bankGeneration, flattenBank, setActiveBank, sourceBank } from './bank';

/**
 * library/stage —— 阶段题库。
 *
 * 每一幕（20 层）对应课程里的一章，也就对应一份 BANK。卡和题是解耦的：
 * 卡面只决定打多少、怎么打；点开一张牌时，才从**当前阶段的题库**里抽一道题。
 * `card.topic` 不再参与抽题 —— 一张「折半之刃」卡在第三章抽到「形容词与副词」的词，
 * 是正常行为，不是错配。
 *
 * 三层数据必须分清：
 *   1. 来源题库（`bank.ts` 的 `SOURCE`）：内置 400 道临时单词题，或玩家导入的那份；
 *   2. 阶段题库（这里的 `BANK`）：来源题库按章节切出来的一片；
 *   3. 题目快照（`G.panel.q`）：点开那一刻抽到的那一道，答题期间不随题库变。
 *
 * 第 2 层是纯派生，不落盘：换题库后下一次进阶段会重新切，存档里只需要阶段号。
 */

/** 当前挂在 `BANK` 上的阶段，以及它来自哪一版来源题库。 */
let ACTIVE_STAGE = 0;
let ACTIVE_GEN = -1;

/**
 * 切到第 `stage` 幕的题库。
 *
 * 章节名对不上任何题池时回退到**来源题库的全部题目**，而不是让这一章变成
 * 空题池：自定义题库只写一个主题也很常见，不该因此整局点不开牌。
 * 返回值是这一阶段的完整描述，给调试和阶段摘要用。
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

/**
 * 点开一张牌时用的题池：当前阶段的全部题目。
 *
 * 阶段切换时旧阶段已经被抽走的题不会跟着回来 —— 曝光计数由 `qPicked`
 * 按本局统一记，和阶段切换无关。
 */
export function stagePool(): Question[] {
  ensureStageBank();
  return allQuestions();
}
