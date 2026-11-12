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

// combat 只负责标 `G.pending`；真正开奖励/过幕/结算由这里接管。
// 注册发生在 journey 加载时，战斗代码不再反向 import journey。
setSettleHandler(settlePending);

/**
 * journey/run —— 一局的编排层。
 *
 * 开一局（记忆推进 → 固定起手 → 生成第一幕地图）、进入节点、反馈面板关闭后
 * 决定下一步去哪。它把 library / map / combat 串起来，但自己不实现规则。
 *
 * 100 层的结构在 `nextStage()` 这一件事上：幕 Boss 死掉不是结局，是**换地图**。
 * 只有第五幕的 Boss 会真的结束这一局。
 */
export function startRun(mode: ModeId | null = null, extraPowers: PowerId[] = []) {
  tickDue();
  // 上一局如果是中途退出的，答题流水只进了内存；开局前落一次盘，
  // 免得"没打完的那一局"把章节记忆丢掉。
  saveStageMem();
  // 新开一局 = 丢掉上一个断点。否则首页会一直挂着一条"继续"，指向已经被覆盖的地图。
  clearRun();
  // 初始牌组 = 8 张基础牌（4 斩击 + 4 格挡）+ 2 张随机知识卡。
  // 模式带进来的能力直接进 `powers`，和后面捡到的增益走完全同一条通道。
  const deck = basicDeck().concat(startDeck());
  const modeDef = mode ? MODE_BY_ID[mode] : null;
  // `extraPowers` 只给模拟 / 调试用：`--boon=xxx` 仍然可以单独 A/B 一张牌，
  // 不改变正式开局只能选三个模式这件事。
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
  // 三种"一次"的账各按自己的生命周期清：整局一次在新开一局时清，
  // 每幕一次在第一幕开始时清（否则上一局的账会带进来）；
  // 每场一次由 `startBattle` 清，这里不用管。
  clearRunOnce();
  clearStageOnce();
  // 模式带的能力如果是「拾取即结算」类，和精英掉落的走同一条通道。
  for (const id of startPowers) applyInstant(id);
  // 第一幕的题库从来源题库里切出来。卡和题解耦之后，这一步才是"这一章问什么"
  // 的唯一入口；牌组、卡面、奖励都不参与。
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
  // 这一章的答题流水先落盘，再换阶段 —— 阶段记忆按 topic 存，
  // 换完再存就会写到下一章头上。
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
  // 过幕 = 换一幕，"每幕一次"的账在这里清（账本 / 地图册）。
  clearStageOnce();
  // 上限从规则表来：`BAL.stageMaxHp` 是底数，茶在这一档上再加 10。
  // 以前这里写死 `BAL.stageMaxHp`，加一张改上限的牌就得改这一行。
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
  // 幕 Boss 也是精英那一档：过幕掉一个增益（`openPowerDrop` 当场生效）。
  openPowerDrop();
}

/**
 * 「再来一局」回到开局选卡，而不是复用上一局那张。
 * 带什么上路是每局开始前的决定，不该被上一局替玩家记住。
 */
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
