import { BAL, MODE_BY_ID, STAGES, STAGE_ROWS, planFor, stageOf } from '../model/data';
import type { GameState, ModeId, PowerId } from '../model/types';
import { G, log, resetTurnState } from '../infra/state';
import { raiseMaxHp, refillHp } from '../infra/write';
import { pick } from '../infra/util';
import { basicDeck } from '../cards/basics';
import { startDeck } from '../cards/starter';
import { applyInstant, clearRunOnce, clearStageOnce, rulesOf } from '../cards/powers';
import { enterStage } from '../library/stage';
import { saveStageMem } from '../library/stagemem';
import { tickDue } from '../library/memory';
import { availableNodes, curFloor, FLOOR_MAX, genStage } from '../map/gen';
import { setSettleHandler, startBattle } from '../combat';
import { EVENTS } from './events';
import { openReward, openPowerDrop } from './rewards';
import { endRun } from './report';
import { clearRun } from './save';

// combat 只标出 G.pending，结算由这里接管
// 注册发生在 journey 加载时，战斗代码不再反向 import journey。
setSettleHandler(settlePending);

/** 一局的编排：开局、进节点、结算后决定下一步。 */
/** 幕 Boss 死掉是换图，只有第五幕的 Boss 结束一局。 */
export function startRun(mode: ModeId | null = null, extraPowers: PowerId[] = []) {
  tickDue();
  // 开局前先把上一局的答题流水落盘
  saveStageMem();
  clearRun();
  const deck = basicDeck().concat(startDeck());
  const modeDef = mode ? MODE_BY_ID[mode] : null;
  // extraPowers 只给模拟 / 调试用
  const startPowers = [...new Set([...(modeDef?.powers ?? []), ...extraPowers])];

  Object.assign(G, {
    screen: 'map', mode, stage: 1, stageTopic: '', panel: { k: 'none' }, log: [], deck,
    draw: [], discard: [], hand: [],
    map: genStage(1), pos: null, seen: {}, node: null,
    hp: BAL.baseHp, maxHp: BAL.baseHp, block: 0,
    ap: BAL.baseAp, apMax: BAL.baseAp, turn: 1, enemy: null,
    powers: startPowers, qPicked: {}, qLeft: [], charge: {}, answers: [],
    topicWrong: {},
    answerDraws: 0, syllabusTurn: 0,
    onceUsed: {},
    apDown: 0, drawCut: 0, carryBlock: 0, upGrade: 0,
    runOk: 0, runBad: 0, floors: 0,
    pending: null, pendingCost: 0, busy: false,
  } satisfies Partial<GameState>);
  resetTurnState();
  clearRunOnce();
  clearStageOnce();
  // 模式能力若是「拾取即结算」类，和精英掉落走同一条通道
  for (const id of startPowers) applyInstant(id);
  // 题库按幕从来源题库里切出来
  enterStage(1);

  const st = stageOf(1);
  log(`── 你走进记忆的档案馆${modeDef ? ` · ${modeDef.name}模式` : ''} ──`, 'turn');
  log(`第一幕 · ${st.name} —— 本章「${G.stageTopic}」，题目从这一章的题库里抽`, 'turn');
  log(`全塔 ${FLOOR_MAX} 层，每 ${STAGE_ROWS} 层一幕，幕末有 Boss`, 'turn');
}

export function enterNode(key: string) {
  if (G.busy || G.screen !== 'map' || G.panel.k !== 'none') return;
  if (!availableNodes().includes(key)) return;
  const [r, i] = key.split(':').map(Number);
  const nd = G.map[r][i];
  G.node = nd;
  G.seen[key] = true;
  if (nd.type === 'rest') { G.panel = { k: 'rest' }; return; }
  if (nd.type === 'event') { G.panel = { k: 'event', ev: pick(EVENTS) }; return; }
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
  G.busy = false;
  G.panel = { k: 'none' };
  settlePending();
}

/** 过幕三件事：换图并清走过的标记；上限 +stageMaxHp 且回满；再掉一个增益。 */
/** 层号跨幕连续，玩家看到的是 41 → 42。 */
function nextStage() {
  const next = G.stage + 1;
  // 流水先落盘再换阶段，否则写到下一章头上
  saveStageMem();
  G.stage = next;
  enterStage(next);
  G.pos = null;
  G.node = null;
  G.seen = {};
  G.map = genStage(next);
  G.enemy = null;
  G.pending = null;
  G.hand = [];
  G.draw = [];
  G.discard = [];
  G.apDown = 0;
  G.drawCut = 0;
  G.carryBlock = 0;
  clearStageOnce();
  const grown = rulesOf().stageMaxHp;
  raiseMaxHp(grown);
  refillHp();
  G.panel = { k: 'none' };
  G.screen = 'map';
  G.busy = false;

  const st = stageOf(next);
  const plan = planFor(next);
  log(`── 第 ${next} 幕 · ${st.name}：${st.sub} ──`, 'turn');
  log(`${plan.title}：题目从这一章的题库里抽，牌还是那副牌`, 'turn');
  log(`你在幕间喘了口气：生命回满，上限 +${grown}（现在 ${G.maxHp}）`, 'hi');
  log(`现在在第 ${curFloor()} / ${FLOOR_MAX} 层`, '');
  openPowerDrop();
}

/** 再来一局回到开局选卡 */
export function restart() {
  backToTitle();
  G.panel = { k: 'boon' };
}

export function backToTitle() {
  G.screen = 'title';
  G.panel = { k: 'none' };
  G.deck = [];
  G.powers = [];
  G.enemy = null;
  G.map = [];
  G.pos = null;
  G.log = [];
}
