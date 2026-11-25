import { BAL, MODE_BY_ID, STAGES } from '../model/data';
import type { ModeId, PowerId, Question } from '../model/types';
import { G, newRunState, resetBattleFields } from '../infra/state';
import { shuffle } from '../infra/util';
import { raiseMaxHp, refillHp } from '../infra/write';
import { basicDeck } from '../cards/basics';
import { startDeck } from '../cards/starter';
import { applyInstant, clearStageOnce, rulesOf } from '../cards/powers';
import { activeBankId, sourceBank } from '../library/bank';
import { buildRunPool, runLabel } from '../library/stage';
import { availableNodes, genStage } from '../map/gen';
import { requestSettle, setSettleHandler, startBattle } from '../combat';
import { drawEvent } from './events';
import { openReward, openPowerDrop } from './rewards';
import { endRun } from './report';
import { clearRun } from './save';

// combat 只标出 G.pending，结算由这里接管
// 注册发生在 journey 加载时，战斗代码不再反向 import journey。
setSettleHandler(settlePending);

/** 没指定主题时随机抽 `BAL.topicsMin`–`BAL.topicsMax` 个：这就是「从所有主题里随机抽」那条路。 */
function pickTopics(): string[] {
  const all = Object.keys(sourceBank().byTopic);
  if (!all.length) return [];
  const want = BAL.topicsMin + Math.floor(Math.random() * (BAL.topicsMax - BAL.topicsMin + 1));
  return shuffle(all).slice(0, Math.min(want, all.length));
}

function newRunId() {
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 一局的编排：开局、进节点、结算后决定下一步。 */
/** 幕 Boss 死掉是换图，只有第五幕的 Boss 结束一局。 */
export function startRun(mode: ModeId | null = null, extraPowers: PowerId[] = [], topics?: string[], pool?: Question[], bankId = activeBankId()) {
  clearRun();
  const deck = basicDeck().concat(startDeck());
  const modeDef = mode ? MODE_BY_ID[mode] : null;
  // extraPowers 只给模拟 / 调试用
  const startPowers = [...new Set([...(modeDef?.powers ?? []), ...extraPowers])];
  // 主题最多 `BAL.topicsMax` 个：多出来的忽略，而不是报错（题库里可能只有一两个池）
  const picked = (topics?.length ? topics : pickTopics()).slice(0, BAL.topicsMax);

  // 整局状态换一份新的；这里只覆盖“这一局特有的选择”，不手抄字段清单。
  Object.assign(G, newRunState(), {
    screen: 'map', mode, deck, map: genStage(1), powers: startPowers,
    topics: picked, stageTopic: runLabel(picked), runBankId: bankId, runId: newRunId(),
  });
  // 模式能力若是「拾取即结算」类，和精英掉落走同一条通道
  for (const id of startPowers) applyInstant(id);
  // 整局共用一份临时题库：按主题连续排列，五幕都从它里面抽
  if (pool) {
    G.runQuestions = pool;
    G.runQueue = pool.map((q) => q.qid);
    G.runCursor = 0;
  } else buildRunPool(picked);
}

export function enterNode(key: string) {
  if (G.busy || G.screen !== 'map' || G.panel.k !== 'none') return;
  if (!availableNodes().includes(key)) return;
  const [r, i] = key.split(':').map(Number);
  const nd = G.map[r][i];
  G.node = nd;
  G.seen[key] = true;
  if (nd.type === 'rest') { G.panel = { k: 'rest' }; return; }
  if (nd.type === 'event') { G.panel = { k: 'event', ev: drawEvent() }; return; }
  startBattle(nd);
}

/** 把待处理的胜负推进一步，所有战斗结束路径都必须走这里 */
export function settlePending() {
  if (G.pending === 'clear') openReward();
  else if (G.pending === 'win') {
    if (G.stage < STAGES.length) nextStage();
    else endRun(true);
  } else if (G.pending === 'dead') endRun(false);
}

export function dismissFeedback() {
  G.panel = { k: 'none' };
  requestSettle();
}

/** 过幕三件事：换图并清走过的标记；上限 +stageMaxHp 且回满；再掉一个增益。 */
/** 层号跨幕连续，玩家看到的是 41 → 42。 */
function nextStage() {
  const next = G.stage + 1;
  G.stage = next;
  // 新的一章，本局“本章答题”重新计数；整局统计不动。
  G.stageOk = 0;
  G.stageBad = 0;
  G.pos = null;
  G.node = null;
  G.seen = {};
  G.map = genStage(next);
  resetBattleFields();
  G.carryBlock = 0;
  clearStageOnce();
  const grown = rulesOf().stageMaxHp;
  raiseMaxHp(grown);
  refillHp();
  G.panel = { k: 'none' };
  G.screen = 'map';
  G.busy = false;

  openPowerDrop();
}

/** 再来一局回到开局选卡 */
export function restart() {
  backToTitle();
  G.panel = { k: 'boon' };
}

export function backToTitle() {
  Object.assign(G, newRunState());
}
