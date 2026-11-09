import { BAL, MODES, STAGES, STAGE_ROWS, stageOf } from '../model/data';
import type { GameState, RunMode } from '../model/types';
import { G, log } from '../infra/state';
import { pick } from '../infra/util';
import { basicDeck } from '../cards/basics';
import { startDeck, tickDue } from '../library/memory';
import { availableNodes, curFloor, FLOOR_MAX, genStage } from '../map/gen';
import { startBattle } from '../combat/play';
import { EVENTS } from './events';
import { openReward, openBossReward } from './rewards';
import { endRun } from './report';
import { clearRun } from './save';

/**
 * journey/run —— 一局的编排层。
 *
 * 开一局（记忆推进 → 按模式组牌 → 生成第一幕地图）、进入节点、反馈面板关闭后
 * 决定下一步去哪。它把 library / map / combat 串起来，但自己不实现规则。
 *
 * 100 层的结构在 `nextStage()` 这一件事上：幕 Boss 死掉不是结局，是**换地图**。
 * 只有第五幕的 Boss 会真的结束这一局。
 */
export function startRun(mode: RunMode = G.mode) {
  tickDue();
  // 新开一局 = 丢掉上一个断点。否则首页会一直挂着一条"继续"，指向已经被覆盖的地图。
  clearRun();
  // 初始牌组 = 固定的 3 张基础牌 + 按模式挑的知识卡。
  // 基础牌不可获取、不可精炼、不可删除 —— 它们是"永远有牌可打"的那半边。
  const deck = basicDeck().concat(startDeck(mode));

  Object.assign(G, {
    screen: 'map', mode, stage: 1, panel: { k: 'none' }, log: [], deck,
    draw: [], discard: [], hand: [],
    map: genStage(1), pos: null, seen: {}, node: null,
    hp: BAL.baseHp, maxHp: BAL.baseHp, block: 0,
    ap: BAL.baseAp, apMax: BAL.baseAp, turn: 1, enemy: null,
    powers: [], topicAtk: {}, failedTurn: {}, qSeen: {},
    topicWrong: {},
    okThisTurn: 0, topOkTopic: null, cardsPlayed: 0, binderUsed: false,
    answerDraws: 0, answerDrawsThisTurn: 0, missDrawsThisTurn: 0,
    apDown: 0, drawCut: 0,
    runOk: 0, runBad: 0, floors: 0, pending: null, busy: false,
  } satisfies Partial<GameState>);

  const st = stageOf(1);
  log(`── 你走进记忆的档案馆 · ${MODES[mode].name}模式 ──`, 'turn');
  log(`第一幕 · ${st.name} —— 全塔 ${FLOOR_MAX} 层，每 ${STAGE_ROWS} 层一幕，幕末有 Boss`, 'turn');
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

/**
 * 把待处理的胜负推进一步。**所有**战斗结束的路径都必须走这里：
 * 关反馈面板、基础牌收尾、敌人回合之后的死亡结算 —— 各写一份就会出现
 * "用基础牌打死 Boss 直接通关"这种分叉。
 */
export function settlePending() {
  if (G.pending === 'clear') openReward();
  else if (G.pending === 'win') {
    // 幕 Boss 死掉：还有下一幕就换地图，最后一幕才结算胜利。
    if (G.stage < STAGES.length) nextStage();
    else endRun(true);
  } else if (G.pending === 'dead') endRun(false);
}

/** 关掉反馈面板后，把待处理的胜负推进到奖励 / 过幕 / 结算。 */
export function dismissFeedback() {
  G.busy = false;
  G.panel = { k: 'none' };
  settlePending();
}

/**
 * 过幕。三件事必须一起发生，分开做就会出现"新地图里血是空的"这类硬伤：
 *   1. 幕号 +1，换一张新图，走过的标记清空（key 只在幕内唯一）；
 *   2. 最大生命 +`BAL.stageMaxHp`，血回满 —— 这是整局唯一的检查点；
 *   3. 给一次增益牌奖励，然后才放开地图。
 *
 * 层号跨幕连续（`floorOf`），所以玩家看到的是 41 → 42，而不是回到 1。
 */
function nextStage() {
  const next = G.stage + 1;
  G.stage = next;
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
  G.maxHp += BAL.stageMaxHp;
  G.hp = G.maxHp;
  G.panel = { k: 'none' };
  G.screen = 'map';
  G.busy = false;

  const st = stageOf(next);
  log(`── 第 ${next} 幕 · ${st.name}：${st.sub} ──`, 'turn');
  log(`你在幕间喘了口气：生命回满，上限 +${BAL.stageMaxHp}（现在 ${G.maxHp}）`, 'hi');
  log(`现在在第 ${curFloor()} / ${FLOOR_MAX} 层`, '');
  openBossReward();
}

/**
 * 「再来一局」不直接复用上一局的模式 —— 回到首页、把模式选择重新摆出来。
 * 模式是每局开始前的决定，不该被上一局替玩家记住。
 */
export function restart() {
  backToTitle();
  G.panel = { k: 'mode' };
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
