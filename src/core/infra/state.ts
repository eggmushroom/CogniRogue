import { BAL } from '../model/data';
import type { GameState, Panel } from '../model/types';

/**
 * 一局（或标题页）的完整默认状态。**全量**返回 `GameState`：以后给 `GameState`
 * 加字段，这里会编译报错，逼着把“新局 / 续档 / 回标题”的初始化一起想清楚。
 *
 * 战斗内部的重置仍然走 `resetBattleFields()` / `resetTurnState()`；这个函数只在
 * 新局、读档、回标题这种“整份换掉”的时机调用。
 */
export function newRunState(): GameState {
  return {
    screen: 'title', mode: null, stage: 1, stageTopic: '', panel: { k: 'none' }, deck: [], powers: [],
    hp: BAL.baseHp, maxHp: BAL.baseHp, block: 0, ap: BAL.baseAp, apMax: BAL.baseAp,
    turn: 1, enemy: null, draw: [], discard: [], hand: [],
    map: [], pos: null, node: null, seen: {}, eventsSeen: [],
    charge: {}, qLeft: [], qPicked: {}, topics: [], runQueue: [], runCursor: 0, qSolved: {},
    topicWrong: {}, okThisTurn: 0, topOkTopic: null,
    markerRefund: 0, syllabusTurn: 0,
    onceUsed: {}, onceStage: {}, onceRun: {},
    carryBlock: 0, upGrade: 0,
    answerDraws: 0, answerDrawsThisTurn: 0,
    drawnThisTurn: 0, cardsThisTurn: 0, cardPlays: {}, nextBoost: null,
    apDown: 0, drawCut: 0,
    runOk: 0, runBad: 0, stageOk: 0, stageBad: 0, floors: 0,
    pending: null, pendingCost: 0, pendingHeal: 0, busy: false,
  };
}

/**
 * 全局唯一的可变状态。所有工具包读写同一份 `G`，Node 无头模拟与浏览器共用。
 */
export const G: GameState = newRunState();

/**
 * 只读窄化：把 `G.panel` 收窄成某一类面板，不是这一类就返回 null。
 *
 * `G.panel` 是判别联合，`if (G.panel.k === 'question')` 只在同一个函数体里有效。
 * 跨调用点读内部字段（测试断言、调试接口、事件处理里已经不在那个分支的地方）
 * 以前只能 `as unknown as { view: {...} }` —— 手写一份结构体，编译器的检查就断了，
 * 面板字段一改名这些断言会静默读 `undefined` 而不是报错。
 *
 * 这个访问器替代的就是那些断言：读面板内部只有这一条路，生产代码和测试共用。
 */
export function panelOf<K extends Panel['k']>(k: K): Extract<Panel, { k: K }> | null {
  const p = G.panel;
  return p.k === k ? (p as Extract<Panel, { k: K }>) : null;
}

/** 一回合内会重置的字段集中在这里；`charge` 按场清，`nextBoost` 跨回合保留。 */
export function resetTurnState() {
  G.okThisTurn = 0;
  G.topOkTopic = null;
  G.markerRefund = 0;
  G.answerDrawsThisTurn = 0;
  G.drawnThisTurn = 0;
  G.cardsThisTurn = 0;
}

/**
 * 进入下一场 / 过幕 / 开局 / 续档前要清的场次字段。`deck`、血量和这一局牌组不在这里。
 * 所有“开新场”的路径都应该先过它，避免下一场还带着上一场的免答计数或题池。
 * 它只碰 `G`，所以放在 infra：combat / journey 都从这里取，不再各写一份清单。
 */
export function resetBattleFields() {
  G.enemy = null;
  G.panel = { k: 'none' };
  G.pending = null;
  G.busy = false;
  G.turn = 1;
  G.draw = [];
  G.discard = [];
  G.hand = [];
  G.charge = {};
  G.syllabusTurn = 0;
  G.cardPlays = {};
  G.nextBoost = null;
  G.drawnThisTurn = 0;
  G.cardsThisTurn = 0;
  G.apDown = 0;
  G.drawCut = 0;
  // 索引贴/事件留下的跨回合或跨节点残账不能带进下一场。
  G.carryBlock = 0;
  G.pendingCost = 0;
  G.pendingHeal = 0;
  G.qLeft = [];
}

/** 本局错得最多的主题，只算一次。 */
export function topTopic(): string | null {
  let best: string | null = null;
  let n = 0;
  for (const t in G.topicWrong) if (G.topicWrong[t] > n) { n = G.topicWrong[t]; best = t; }
  return best;
}

/** 免死钩子；infra 位于依赖链底部，规则由 `cards/powers.ts` 注册进来。 */
type DeathGuard = () => boolean;

let deathGuard: DeathGuard | null = null;

export function setDeathGuard(fn: DeathGuard) {
  deathGuard = fn;
}

/** 战斗胜负的唯一判定点。 */
export function checkPending() {
  if (!G.enemy) return;
  if (G.enemy.hp <= 0) G.pending = G.node && G.node.type === 'boss' ? 'win' : 'clear';
  else if (G.hp <= 0) {
    if (deathGuard?.()) return;
    G.pending = 'dead';
  }
}
