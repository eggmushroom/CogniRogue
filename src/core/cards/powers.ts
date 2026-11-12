import { BAL, POWER_BY_ID } from '../model/data';
import type { EffOut } from '../model/effects';
import type { CardId, PowerId, PowerScope } from '../model/types';
import { G, log, setDeathGuard } from '../infra/state';
import { grantBlock, healHp, raiseMaxHp, reviveHp } from '../infra/write';
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
  restPct: number;
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

/** 把 `G.powers` 折成一组数字。纯读，不写 G。 */
export function rulesOf(ctx: RulesCtx = {}): Rules {
  const first = G.turn === 1;
  const handLeft = ctx.handLeft ?? G.hand.length;
  const hard = ctx.hard ?? (!!G.enemy && G.enemy.type !== 'fight');

  return {
    apMax: BAL.baseAp + (first && hasPower('hourglass') ? 1 : 0),
    refund: hasPower('librarycard') ? BAL.refund : 0,
    draw: BAL.drawPerTurn
      + (hasPower('board') ? BAL.boardDraw : 0)
      + (hasPower('index') && handLeft <= 2 ? BAL.indexDraw : 0)
      + (first && hasPower('dogear') ? BAL.dogearDraw : 0),
    turnBlock: hasPower('lamp') ? BAL.lampBlock : 0,
    startBlock: first
      ? BAL.startBlock
        + (hasPower('paperweight') ? BAL.paperweightBlock : 0)
        + (hard && hasPower('corner') ? BAL.cornerBlock : 0)
      : 0,
    answerDraw: hasPower('mirrorcard') ? BAL.answerDrawCap : 0,
    basicBlock: hasPower('syllabus') ? BAL.syllabusBlock : 0,
    rewardPicks: BAL.rewardPicks + (hasPower('sticky') ? BAL.stickyChoice : 0),
    restPct: BAL.restPct + (hasPower('mend') ? BAL.mendRest : 0),
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

/** 卡面与结算共用；加在结算结果上，避免倍率把 +1 缩放成 0 或 1。 */
export function applyCardBonus(out: EffOut, R: Rules = rulesOf()): EffOut {
  if (!R.atkBonus && !R.blkBonus) return out;
  return {
    ...out,
    hits: R.atkBonus ? out.hits.map((h) => (h > 0 ? h + R.atkBonus : h)) : out.hits,
    blk: R.blkBonus && out.blk > 0 ? out.blk + R.blkBonus : out.blk,
  };
}

/** 每回合第一次打基础牌补格挡，不读题目池。 */
export function syllabusBasicBlock(): number {
  const n = rulesOf().basicBlock;
  if (!n || G.syllabusTurn === G.turn) return 0;
  G.syllabusTurn = G.turn;
  grantBlock(n);
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

/** 一张牌的作用域。数据表是唯一来源，这里只是给消费点一个短名字。 */
export const scopeOf = (id: PowerId): PowerScope => POWER_BY_ID[id]?.scope ?? 'always';

/** 拾取即结算：拿到时把效果落到这一局，之后不挂时机。
 * 返回写进日志的一句话；拿不到效果时返回空串。 */
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
      // 精炼加成写在 `G.upGrade` 上，`statOf` 读它。
      G.upGrade = BAL.polishUp;
      return `以后每次精炼额外 +${BAL.polishUp}（攻/挡底数 +${3 + BAL.polishUp}）`;
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
    got.push(c.topic);
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
export function wishGuard(): boolean {
  if (!onceThisRun('wish')) return false;
  G.pending = null;
  // 按上限的一个比例活下来，而不是固定点数：固定点数在第四幕等于没救。
  reviveHp(G.maxHp * BAL.wishPct);
  log(`许愿条燃尽了：你在最后一刻活了下来（${G.hp}/${G.maxHp}）`, 'hi');
  return true;
}

// 注册免死钩子：这张牌的规则属于这个文件，注册即生效。
setDeathGuard(wishGuard);
