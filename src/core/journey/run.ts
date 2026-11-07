import { BAL } from '../model/data';
import type { GameState } from '../model/types';
import { G, log } from '../infra/state';
import { pick } from '../infra/util';
import { startDeck, tickDue } from '../library/memory';
import { availableNodes, genMap } from '../map/gen';
import { startBattle } from '../combat/play';
import { EVENTS } from './events';
import { openReward } from './rewards';
import { endRun } from './report';

/**
 * journey/run —— 一局的编排层。
 *
 * 开一局（记忆推进 → 按记忆组牌 → 生成地图）、进入节点、反馈面板关闭后
 * 决定下一步去哪。它把 library / map / combat 串起来，但自己不实现规则。
 */
export function startRun() {
  tickDue();
  const deck = startDeck();

  Object.assign(G, {
    screen: 'map', panel: { k: 'none' }, log: [], deck,
    draw: [], discard: [], hand: [],
    map: genMap(), pos: null, seen: {}, node: null,
    hp: BAL.baseHp, maxHp: BAL.baseHp, block: 0,
    ap: BAL.baseAp, apMax: BAL.baseAp, turn: 1, enemy: null,
    powers: [], topicAtk: {}, unlocked: {}, failedTurn: {}, qSeen: {}, forgotten: {},
    topicWrong: {},
    okThisTurn: 0, topOk: 0, cardsPlayed: 0, binderUsed: false,
    frees: 0, unlocks: 0,
    runOk: 0, runBad: 0, floors: 0, learnMiss: 0, reviewMiss: 0, pending: null, busy: false,
  } satisfies Partial<GameState>);

  log('── 你走进记忆的档案馆 ──', 'turn');
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

/** 关掉反馈面板后，把待处理的胜负推进到奖励 / 结算。 */
export function dismissFeedback() {
  G.busy = false;
  G.panel = { k: 'none' };
  if (G.pending === 'clear') openReward();
  else if (G.pending === 'win') endRun(true);
  else if (G.pending === 'dead') endRun(false);
}

export function restart() {
  startRun();
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
