import { BAL } from '../model/data';
import type { EffOut } from '../model/effects';
import type { CardId, PowerId } from '../model/types';
import { G, setDeathGuard } from '../infra/state';
import { healHp, raiseMaxHp, reviveHp } from '../infra/write';
import { shuffle } from '../infra/util';
import { PACK } from './pack';
import { isBasicId } from './basics';
import { baseIdOf, hasPower, isUpgraded, upgradedId } from './registry';

/**
 * 增益的唯一读取入口：always 由 `rulesOf()` 折成数字，fight / stage / run
 * 由 `onceThisFight` / `onceThisStage` / `onceThisRun` 兑现，instant 由 `applyInstant` 兑现。
 */

/** 结算层只读数字，不读牌名；字段名都是结算层要问的问题。 */
export interface Rules {
  apMax: number;
  refund: number;
  draw: number;
  turnBlock: number;
  startBlock: number;
  answerDraw: number;
  basicBlock: number;
  rewardPicks: number;
  /** 复习点回复几点生命 */
  restHp: number;
  atkBonus: number;
  blkBonus: number;
  dmgCut: number;
  carryBlock: number;
  endBlock: number;
  inkDraw: number;
  reshuffleBlock: number;
  healOnKill: number;
  stageMaxHp: number;
  maxCopies: number;
}

/** 回合开始时的上一手牌数；默认读当前手牌，那个时机不准。 */
export interface RulesCtx {
  handLeft?: number;
  hard?: boolean;
}

/**
 * **常驻规则**：只按持有的增益算，不看回合数、手牌数、敌人类型。
 *
 * 为什么单独一层：`rulesOf()` 会读 `G.turn` / `G.hand` / `G.enemy`，在战斗之外
 * 调用（帮助页、结算报告、战后统计）会带出那里没有的瞬时修正 —— 于是这些界面
 * 只好改成直读 `BAL` 声明值，界面上的数字和实际生效的数字就成了两套。
 * 静态层任何时刻调用都是同一个值，界面文案从这里派生，不会再出现第二份真值。
 *
 * 静态层回答的是「这条规则是什么」，不是「此刻生不生效」——例如 `startBlock`
 * 在非首回合也是满值，要不要清零由 `rulesOf()` 决定。
 */
export function rulesStatic(): Rules {
  return {
    apMax: BAL.baseAp,
    refund: hasPower('librarycard') ? BAL.refund : 0,
    draw: BAL.drawPerTurn + (hasPower('board') ? BAL.boardDraw : 0),
    turnBlock: hasPower('lamp') ? BAL.lampBlock : 0,
    startBlock: BAL.startBlock + (hasPower('paperweight') ? BAL.paperweightBlock : 0),
    answerDraw: hasPower('mirrorcard') ? BAL.answerDrawCap : 0,
    basicBlock: hasPower('syllabus') ? BAL.syllabusBlock : 0,
    rewardPicks: BAL.rewardPicks + (hasPower('sticky') ? BAL.stickyChoice : 0),
    restHp: BAL.restHp + (hasPower('mend') ? BAL.mendRest : 0),
    atkBonus: hasPower('press') ? BAL.pressAtk : 0,
    blkBonus: hasPower('code') ? BAL.codeBlk : 0,
    dmgCut: hasPower('nightlight') ? BAL.nightCut : 0,
    carryBlock: hasPower('tab') ? BAL.tabCarry : 0,
    endBlock: hasPower('feather') ? BAL.featherBlock : 0,
    inkDraw: hasPower('ink') ? BAL.inkDraw : 0,
    reshuffleBlock: hasPower('archive') ? BAL.archiveBlock : 0,
    healOnKill: hasPower('stamp') ? BAL.stampHeal : 0,
    stageMaxHp: BAL.stageMaxHp + (hasPower('tea') ? BAL.teaMaxHp : 0),
    maxCopies: BAL.maxCopies + (hasPower('shelf') ? BAL.shelfCopies : 0),
  };
}

/** 把 `G.powers` 折成一组数字。纯读，不写 G。 */
export function rulesOf(ctx: RulesCtx = {}): Rules {
  const base = rulesStatic();
  const first = G.turn === 1;
  const handLeft = ctx.handLeft ?? G.hand.length;
  const hard = ctx.hard ?? (!!G.enemy && G.enemy.type !== 'fight');

  // 只在静态层上叠加「此刻」才成立的三项；其余字段原样透传。
  return {
    ...base,
    apMax: base.apMax + (first && hasPower('hourglass') ? BAL.hourglassAp : 0),
    draw: base.draw
      + (hasPower('index') && handLeft <= BAL.indexHand ? BAL.indexDraw : 0)
      + (first && hasPower('dogear') ? BAL.dogearDraw : 0),
    startBlock: first ? base.startBlock + (hard && hasPower('corner') ? BAL.cornerBlock : 0) : 0,
  };
}

/** 卡面与结算共用；加在结算结果上，避免倍率把 +1 缩放成 0 或 1。 */
export function applyCardBonus(out: EffOut, R: Rules = rulesOf()): EffOut {
  if (!R.atkBonus && !R.blkBonus) return out;
  return {
    ...out,
    hits: R.atkBonus ? out.hits.map((h) => (h > 0 ? h + R.atkBonus : h)) : out.hits,
    blk: R.blkBonus && out.blk > 0 ? out.blk + R.blkBonus : out.blk,
  };
}

/**
 * 每回合第一次打基础牌补格挡，不读题目池。只报预算：真正写进 G.block 由
 * settlement 的执行器在飘字那一刻统一做，否则一手牌会出现两个格挡写入点。
 */
export function syllabusBasicBlock(): number {
  const n = rulesOf().basicBlock;
  if (!n || G.syllabusTurn === G.turn) return 0;
  G.syllabusTurn = G.turn;
  return n;
}

/** fight / stage / run 共用的记账。`table` 是 G 上那三张表里的一张。 */
function spend(
  table: Partial<Record<PowerId, boolean>>, id: PowerId,
): boolean {
  if (!hasPower(id)) return false;
  if (table[id]) return false;
  table[id] = true;
  return true;
}

/** 调用即消耗，不是查询；由 `startBattle` 清账。 */
export function onceThisFight(id: PowerId): boolean {
  return spend(G.onceUsed, id);
}

/** 每幕一次（账本 / 地图册）。由 `nextStage` 清账。 */
export function onceThisStage(id: PowerId): boolean {
  return spend(G.onceStage, id);
}

/**
 * 只问「这次还用不用得上」，**不消费账**。界面预估专用：
 * 面板要显示「这一下真能回多少」，就不能调 `onceThisStage()` —— 渲染一帧
 * 就把名额花掉了。查询和消费是两个动作，别合成一个。
 *
 * 判断条件和 `onceThisStage()` 必须一致：`spend()` 会先看 `hasPower`，这里漏掉
 * 就是「没拿地图册也白给 15 点」—— 探针一跑就会发现。
 */
export function canOnceStage(id: PowerId): boolean {
  return hasPower(id) && !G.onceStage[id];
}

/** 整局一次（许愿条）。由 `startRun` 清账。 */
export function onceThisRun(id: PowerId): boolean {
  return spend(G.onceRun, id);
}

/** 清空本场的"一次"账。由 `startBattle` 调，别处不要碰。 */
export function clearOnceUsed() {
  G.onceUsed = {};
}

/** 清空本幕的"一次"账。由 `nextStage` 调。 */
export function clearStageOnce() {
  G.onceStage = {};
}

/** 清空整局的"一次"账。由 `startRun` 调。 */
export function clearRunOnce() {
  G.onceRun = {};
}

/** 拾取即结算：拿到时把效果落到这一局，之后不挂时机。 */
export function applyInstant(id: PowerId): string {
  if (!hasPower(id)) return '';
  switch (id) {
    case 'spine': {
      // 上限和当前值一起抬，只加上限要等回血才看得见。
      raiseMaxHp(BAL.spineHp);
      const got = healHp(BAL.spineHp);
      return `最大生命 +${BAL.spineHp}，回复 ${got} 点（现在 ${G.hp}/${G.maxHp}）`;
    }
    case 'exlibris': {
      const got = grantKnowledge(BAL.exlibrisCards);
      return got ? `「${got.join('、')}」进了牌组` : '牌组里每种卡都到上限了，没有新的可加';
    }
    case 'slim': {
      const got = removeBasics(BAL.slimRemove);
      return got ? `卸下了 ${got} 张基础牌（牌组 ${G.deck.length} 张）` : '牌组里没有可卸的基础牌';
    }
    case 'resin': {
      const n = upgradeBasics();
      return n ? `${n} 张基础牌全部精炼` : '牌组里的基础牌已经全是精炼版';
    }
    case 'polish': {
      // 抛光布抬高的是**默认**精炼量：只对没写 `up` 的牌生效，
      // 写了 `up` 的牌按自己声明的字段长，不受它影响。
      G.upGrade = BAL.polishUp;
      return `以后每次精炼，攻 / 挡再多 +${BAL.polishUp}`;
    }
    default:
      return '';
  }
}

/** 塞 n 张不重复的随机知识卡，每种受 `rulesOf().maxCopies` 限制。 */
function grantKnowledge(n: number): string[] {
  const cap = rulesOf().maxCopies;
  const copies: Record<string, number> = {};
  G.deck.forEach((id) => { copies[baseIdOf(id)] = (copies[baseIdOf(id)] || 0) + 1; });
  const pool = shuffle(PACK.cards.filter((c) => (copies[c.id] || 0) < cap));
  const got: string[] = [];
  for (const c of pool) {
    if (got.length >= n) break;
    G.deck.push(c.id);
    got.push(c.name);
  }
  return got;
}

/** 卸掉 n 张基础牌（优先卸未精炼的）。牌组不能删到 5 张以下。 */
function removeBasics(n: number): number {
  let left = n;
  while (left > 0 && G.deck.length > 5) {
    // 从前向后找：未精炼的优先（精炼过的那张更值钱，先留着）。
    const i = G.deck.findIndex((id) => isBasicId(baseIdOf(id)) && !isUpgraded(id));
    const j = i >= 0 ? i : G.deck.findIndex((id) => isBasicId(baseIdOf(id)));
    if (j < 0) break;
    G.deck.splice(j, 1);
    left -= 1;
  }
  return n - left;
}

/** 把牌组里所有基础牌变成精炼版。返回真的变了几张。 */
function upgradeBasics(): number {
  let n = 0;
  G.deck = G.deck.map((id: CardId) => {
    if (!isBasicId(baseIdOf(id)) || isUpgraded(id)) return id;
    n += 1;
    return upgradedId(id);
  });
  return n;
}

/** 致死的那一下把它接住，返回 true 表示这一下没死。
 * 由 `checkPending` 通过 `setDeathGuard` 调用；判定点只有一个。 */
function wishGuard(): boolean {
  if (!onceThisRun('wish')) return false;
  G.pending = null;
  // 是固定点数而不是比例：一个"以 30 点活下来"的承诺，玩家一眼能算清够挨几下。
  reviveHp(BAL.wishHp);
  return true;
}

// 注册免死钩子：这张牌的规则属于这个文件，注册即生效。
setDeathGuard(wishGuard);
