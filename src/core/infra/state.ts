import { BAL } from '../model/data';
import type { GameState, LogLine, Panel } from '../model/types';

/**
 * 全局唯一的可变状态。所有工具包读写同一份 `G`，Node 无头模拟与浏览器共用。
 */
export const G: GameState = {
  screen: 'title', mode: null, stage: 1, stageTopic: '', panel: { k: 'none' }, log: [], deck: [], powers: [],
  hp: BAL.baseHp, maxHp: BAL.baseHp, block: 0, ap: BAL.baseAp, apMax: BAL.baseAp,
  turn: 1, enemy: null, draw: [], discard: [], hand: [],
  map: [], pos: null, node: null, seen: {}, eventsSeen: [],
  charge: {}, qLeft: [], qPicked: {}, answers: [],
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

/** 只增不减：界面靠"比上次大了多少"判断有新消息。 */
let logSeq = 0;

/**
 * 一条玩家可见的即时反馈。**这是 core 里唯一允许"往外说话"的通道**：
 * 结算、敌人行动、事件选项都只把结果写成一条记录，界面负责显示（`scenes/feed.ts`）。
 *
 * `seq` 不是给人的：界面按它判断"这一帧有没有新的一条"。没有它就只能比较数组长度，
 * 而数组满了会 `shift()`，长度恒定在 60 —— 一场长战斗打到后面，新的记录会被判成
 * "没有变化"，提示条从此不再更新。
 *
 * 上限 60 条，避免整局无限累积。
 */
export function log(msg: string, kind: LogLine['kind'] = '') {
  logSeq += 1;
  G.log.push({ msg, kind, seq: logSeq });
  if (G.log.length > 60) G.log.shift();
}

/**
 * 清空记录。**序号不归零**：界面只按 `seq > lastSeq` 判断新消息，
 * 归零会让它以为"再也不会来新的"。清空只影响现在能读到什么，不影响序号。
 */
export function clearLog() {
  G.log = [];
}

/**
 * 这条记录该不该当场给玩家看。
 *
 * `turn` 是分节标题（「── 第 2 幕 · 契约 ──」「这一场准备了 6 道新题」），
 * 属于旧战斗记录面板的排版产物：它们讲的是"这一段是什么"，不是"刚才发生了什么"，
 * 做成一行一闪而过的提示只会把结果挤掉。判断放在这里而不是界面里，
 * 是为了让"哪些会显示"有一处可断言的真相 —— 测试读它，绘制也读它。
 */
export function playerFacing(l: LogLine): boolean {
  return l.kind !== 'turn';
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
