import { BAL } from '../model/data';
import type { GameState, LogLine } from '../model/types';

/**
 * 全局唯一的可变状态。所有工具包读写同一份 `G`，Node 无头模拟与浏览器共用。
 */
export const G: GameState = {
  screen: 'title', mode: null, stage: 1, stageTopic: '', panel: { k: 'none' }, log: [], deck: [], powers: [],
  hp: BAL.baseHp, maxHp: BAL.baseHp, block: 0, ap: BAL.baseAp, apMax: BAL.baseAp,
  turn: 1, enemy: null, draw: [], discard: [], hand: [],
  map: [], pos: null, node: null, seen: {},
  charge: {}, qLeft: [], qPicked: {}, answers: [],
  topicWrong: {}, okThisTurn: 0, topOkTopic: null,
  markerRefund: 0, syllabusTurn: 0,
  onceUsed: {}, onceStage: {}, onceRun: {},
  carryBlock: 0, upGrade: 0,
  answerDraws: 0, answerDrawsThisTurn: 0,
  drawnThisTurn: 0, cardsThisTurn: 0, cardPlays: {}, nextBoost: null,
  apDown: 0, drawCut: 0,
  runOk: 0, runBad: 0, floors: 0,
  pending: null, pendingCost: 0, busy: false,
};

export function log(msg: string, kind: LogLine['kind'] = '') {
  G.log.push({ msg, kind });
  if (G.log.length > 60) G.log.shift();
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
