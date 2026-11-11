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
 * cards/powers —— 能力牌的**唯一读取入口**。
 *
 * ## 为什么需要这一层
 *
 * 加一张能力牌的旧流程是：改 `data.ts`（定义）→ 改 `types.ts`（`PowerId` 联合）
 * → 在 6 个结算文件里找一个合适的分支 → 手写 `hasPower('xxx') ? 数字 : 0`。
 * 十八张牌的时候，`hasPower` 散成了 25 处，横跨 deck / play / questions /
 * events / rewards 五个文件。想知道"这张牌到底在哪生效"，只能全文搜。
 *
 * ## 四十张牌，四种作用域
 *
 * 牌一多，真正的问题不再是"有没有唯一通道"，而是**"这张牌多久兑现一次"**。
 * 十八张的时候一半的牌都挂在"每场第一次答对/答错"上，一局捡到八九张，
 * 同一个瞬间会有两三张抢着响。所以 40 张按 `PowerScope` 分四条通道：
 *
 *   · `always`  常驻数值 —— `rulesOf()` 把它折成一组数字（`Rules`）。
 *     结算层读数字，不读牌名。加一张同类牌只改 `rulesOf` 的一行。
 *   · `fight`   每场一次 —— `onceThisFight(id)`，调用即消耗，`startBattle` 清账。
 *   · `stage`   每幕一次 —— `onceThisStage(id)`，过幕清账。
 *   · `run`     整局一次 —— `onceThisRun(id)`，开局清账。
 *   · `instant` 拾取即结算 —— `applyInstant(id)`，不挂时机，直接改这一局的底盘。
 *
 * 四种作用域共用一张 `G.onceUsed` / `G.onceStage` / `G.onceRun` 记账表，
 * 都是一张 `Partial<Record<PowerId, boolean>>` —— 加第 41 张牌不用碰状态定义。
 *
 * ## 为什么不直接上状态空间 / ECS
 *
 * 那套东西解决的是"实体数量上万、组件自由组合"的问题。这里只有 40 张
 * 单例增益，玩家就一个，怪物是"模板 + 实例"。为它铺一层组件表，代价是
 * core 里六十来个文件全部改读写方式，换来的是把 15 个字段变成一张表 ——
 * 而这一层用一百来行就做到了。**先要唯一通道，再要抽象。**
 */

/**
 * 这一局当前生效的所有常驻数值。
 *
 * 名字都是**结算层要问的问题**，不是牌名：`turnBlock` 而不是 `lamp`。
 * 这样以后再来一张"每回合给格挡"的牌，只是往同一个字段里加数，
 * 消费它的那一行不用知道牌叫什么。
 */
export interface Rules {
  /** 每回合行动力上限（沙漏：第一回合 +1） */
  apMax: number;
  /** 这一回合能看几张牌（索引卡 / 折角 / 板书）。**不含**敌人砍掉的 `G.drawCut` */
  draw: number;
  /** 回合开始的保底格挡（长明灯）—— 不是"额外"，它就是这一回合的起点 */
  turnBlock: number;
  /** 第一回合的开局格挡（镇纸 / 护角）。非第一回合恒为 0 */
  startBlock: number;
  /** 答对之后最多补抽几张（双面镜），也用作每回合的补抽上限 */
  answerDraw: number;
  /** 这一场的新题数加成（课表） */
  questions: number;
  /** 奖励屏给几个选项（便签）。`BAL.rewardPicks` 是底数 */
  rewardPicks: number;
  /** 复习点的回复比例（修书胶）。`BAL.restPct` 是底数 */
  restPct: number;
  /** 每张牌的伤害加成（压书石）—— 加在 `resolveEff` 算出的每一段上 */
  atkBonus: number;
  /** 每张牌的格挡加成（校规）—— 只加在本来就有格挡的牌上 */
  blkBonus: number;
  /** 每次挨打少受几点（夜灯） */
  dmgCut: number;
  /** 回合结束保留几点格挡到下一回合（索引贴） */
  carryBlock: number;
  /** 击杀时回复几点（藏书印） */
  healOnKill: number;
  /** 过幕时最大生命额外加几点（茶），叠在 `BAL.stageMaxHp` 上 */
  stageMaxHp: number;
  /** 同种卡的张数上限加成（书挡），叠在 `BAL.maxCopies` 上 */
  maxCopies: number;
}

export interface RulesCtx {
  /**
   * 上一回合剩了几张手牌（索引卡看这个）。
   *
   * 必须由调用方传：`startTurn` 会先清空手牌，等它进 `rulesOf` 时
   * 那个数已经没了。默认读当前手牌数，只在"回合开始时"这个时机不准。
   */
  handLeft?: number;
  /** 是不是精英 / 幕首领那几场（护角只看这个）。默认读当前敌人 */
  hard?: boolean;
}

/**
 * 把 `G.powers` 翻译成一组数字。**纯读，不写 G**。
 *
 * 只在这里读 `G.turn` / `G.enemy`，是因为这两个是"什么时候"与"打谁"，
 * 属于同一层上下文；卡牌本身不关心它们。
 */
export function rulesOf(ctx: RulesCtx = {}): Rules {
  const first = G.turn === 1;
  const handLeft = ctx.handLeft ?? G.hand.length;
  const hard = ctx.hard ?? (!!G.enemy && G.enemy.type !== 'fight');

  return {
    apMax: BAL.baseAp + (first && hasPower('hourglass') ? 1 : 0),
    draw: BAL.drawPerTurn
      + (hasPower('board') ? BAL.boardDraw : 0)
      + (hasPower('index') && handLeft <= 2 ? 1 : 0)
      + (first && hasPower('dogear') ? BAL.dogearDraw : 0),
    turnBlock: hasPower('lamp') ? BAL.lampBlock : 0,
    startBlock: first
      ? BAL.startBlock
        + (hasPower('paperweight') ? BAL.paperweightBlock : 0)
        + (hard && hasPower('corner') ? BAL.cornerBlock : 0)
      : 0,
    answerDraw: hasPower('mirrorcard') ? BAL.answerDrawCap : 0,
    questions: hasPower('syllabus') ? BAL.syllabusQuestions : 0,
    rewardPicks: BAL.rewardPicks + (hasPower('sticky') ? BAL.stickyChoice : 0),
    restPct: BAL.restPct + (hasPower('mend') ? BAL.mendRest : 0),
    atkBonus: hasPower('press') ? BAL.pressAtk : 0,
    blkBonus: hasPower('code') ? BAL.codeBlk : 0,
    dmgCut: hasPower('nightlight') ? BAL.nightCut : 0,
    carryBlock: hasPower('tab') ? BAL.tabCarry : 0,
    healOnKill: hasPower('stamp') ? BAL.stampHeal : 0,
    stageMaxHp: BAL.stageMaxHp + (hasPower('tea') ? BAL.teaMaxHp : 0),
    maxCopies: BAL.maxCopies + (hasPower('shelf') ? BAL.shelfCopies : 0),
  };
}

/**
 * 把规则表里的"每张牌加成"贴到一次结算结果上。
 *
 * **卡面与结算必须共用它**（`gfx/ui.ts`、`scenes/overlay.ts`、`combat/play.ts`
 * 三处都调），否则「压书石」会让卡面写 5 而实际打 6 —— 那正是这一版最想
 * 避免的"两张皮"。
 *
 * 加在 `resolveEff` 的**结果**上而不是它的入参上，是因为效果表的倍率会缩放
 * 底数：把 +1 加进 `atk` 再乘 0.52（串联）会变成 +0.52，四舍五入之后有时是
 * 0、有时是 1。压在结果上是"每段 +1"，和卡面写的话一致。
 */
export function applyCardBonus(out: EffOut, R: Rules = rulesOf()): EffOut {
  if (!R.atkBonus && !R.blkBonus) return out;
  return {
    ...out,
    hits: R.atkBonus ? out.hits.map((h) => (h > 0 ? h + R.atkBonus : h)) : out.hits,
    blk: R.blkBonus && out.blk > 0 ? out.blk + R.blkBonus : out.blk,
  };
}

/**
 * 课表：答对一道**本场新题**，补 1 点格挡，每场至多 `BAL.syllabusBlockCap` 点。
 *
 * 为什么读 `fresh` 而不是卡面：复用问过的题不给格挡 —— 否则这张牌会退化成
 * "只要答对就有格挡"，跟"课表 = 这一场多学两道新东西"这件事没有关系。
 * 返回实际补了多少，调用方据此写日志和飘字。
 *
 * 它不并进 `blkGain`：那个数是**这张牌自己的**格挡，反馈面板和卡面读的是
 * 同一个值。把增益塞进去，卡面写 6 实际 7，就破了"卡面写的数 = 打出来的数"。
 */
export function syllabusBlock(fresh: boolean): number {
  if (!fresh || !hasPower('syllabus')) return 0;
  const cap = BAL.syllabusBlockCap;
  if (G.syllabusBlocks >= cap) return 0;
  const n = Math.min(BAL.syllabusBlock, cap - G.syllabusBlocks);
  grantBlock(n);
  G.syllabusBlocks += n;
  return n;
}

/** 四条作用域共用的记账。`table` 是 G 上那三张表里的一张。 */
function spend(
  table: Partial<Record<PowerId, boolean>>, id: PowerId,
): boolean {
  if (!hasPower(id)) return false;
  if (table[id]) return false;
  table[id] = true;
  return true;
}

/**
 * 这张「一场一次」的能力牌**现在**还能不能用。能用返回 true 并当场记账，
 * 不能用返回 false。**调用即消耗** —— 不要拿它当查询。
 */
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

/**
 * 「拾取即结算」的牌：拿到的那一刻就把效果落到这一局上，之后不再挂任何时机。
 *
 * 返回一句要写进日志的话（拿不到效果时返回空串，比如牌组里已经没有基础牌）。
 * 由 `rewards.ts` 的 `grantPower` 在入池之后调用 —— 那里是**所有**增益的
 * 唯一发放入口，所以开局带进来的那张走的也是这里。
 */
export function applyInstant(id: PowerId): string {
  if (!hasPower(id)) return '';
  switch (id) {
    case 'spine': {
      // 上限和当前值一起抬：只加上限会留下一个"要回血才看得见"的空洞，
      // 而这张牌说的是"立刻变厚"。
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
      // 精炼的加成写在 `G.upGrade` 上，`statOf` 读它 —— 见 `GameState.upGrade`。
      G.upGrade = BAL.polishUp;
      return `以后每次精炼额外 +${BAL.polishUp}（攻/挡底数 +${3 + BAL.polishUp}）`;
    }
    default:
      return '';
  }
}

/**
 * 往牌组里塞 n 张**不重复**的随机知识卡，每种卡受 `rulesOf().maxCopies` 限制。
 *
 * 和 `journey/events.ts` 的 `grantCard` 是同一条规则，但那一份在 journey 层、
 * 这份在 cards 层 —— 复制 20 行比让 cards 反向依赖 journey 便宜。两处都读
 * `rulesOf().maxCopies`，所以「书挡」同时作用于事件和藏书票，不会漏一边。
 */
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

/**
 * 许愿条：致死的那一下把它接住。返回 true 表示"这一下没死"。
 *
 * 由 `infra/state.ts` 的 `checkPending` 通过 `setDeathGuard` 调用 ——
 * 判定点只能有一个（出牌、敌人回合、事件扣血都改血量），而 infra 不能
 * 反向 import cards。注册在这里，是因为**这条规则属于这张牌**。
 */
export function wishGuard(): boolean {
  if (!onceThisRun('wish')) return false;
  G.pending = null;
  // 按上限的一个比例活下来，而不是固定点数：固定点数在第四幕等于没救。
  reviveHp(G.maxHp * BAL.wishPct);
  log(`许愿条燃尽了：你在最后一刻活了下来（${G.hp}/${G.maxHp}）`, 'hi');
  return true;
}

// 注册免死钩子。放在模块底部而不是某个 init 函数里：这张牌的规则属于这个文件，
// 而 `setDeathGuard` 的语义就是"注册即生效"（和 `setSettleHandler` 同一手法）。
setDeathGuard(wishGuard);
