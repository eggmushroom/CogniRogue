import { BAL } from '../model/data';
import type { GameState, LogLine } from '../model/types';

/**
 * infra/state —— 全局唯一的可变状态。
 *
 * 所有工具包都读写同一份 `G`，但谁都不另开一份状态：这样 `tools/sim.ts`
 * 在 Node 里 import 同一批函数，跑出来的就是浏览器里那套规则。
 * 类型形状放在 model/types.ts，这里只负责「实例 + 读它的小函数」。
 */
export const G: GameState = {
  screen: 'title', mode: 'learn', stage: 1, panel: { k: 'none' }, log: [], deck: [], powers: [],
  hp: BAL.baseHp, maxHp: BAL.baseHp, block: 0, ap: BAL.baseAp, apMax: BAL.baseAp,
  turn: 1, enemy: null, draw: [], discard: [], hand: [],
  map: [], pos: null, node: null, seen: {}, topicAtk: {},
  failedTurn: {}, qSeen: {},
  topicWrong: {}, okThisTurn: 0, topOkTopic: null,
  cardsPlayed: 0, binderUsed: false, answerDraws: 0, answerDrawsThisTurn: 0, missDrawsThisTurn: 0,
  apDown: 0, drawCut: 0,
  runOk: 0, runBad: 0, floors: 0,
  pending: null, busy: false,
};

export function log(msg: string, kind: LogLine['kind'] = '') {
  G.log.push({ msg, kind });
  if (G.log.length > 60) G.log.shift();
}

/** 本局错得最多的主题。敌人机制、事件、结算页都要问同一个问题，只在这里算一次。 */
export function topTopic(): string | null {
  let best: string | null = null;
  let n = 0;
  for (const t in G.topicWrong) if (G.topicWrong[t] > n) { n = G.topicWrong[t]; best = t; }
  return best;
}

/**
 * 战斗胜负的判定点。放在状态层而不是某个出牌函数里，是因为玩家出牌、
 * 敌人回合、事件扣血都会改变血量 —— 判定必须是同一个，不能各写一份。
 */
export function checkPending() {
  if (!G.enemy) return;
  if (G.enemy.hp <= 0) G.pending = G.node && G.node.type === 'boss' ? 'win' : 'clear';
  else if (G.hp <= 0) G.pending = 'dead';
}
