import { BAL } from '../model/data';
import type { CardId, Eff, Foe } from '../model/types';
import { G, checkPending, log } from '../infra/state';
import { after } from '../infra/schedule';
import { emit } from '../infra/events';
import type { GameEvent } from '../infra/events';
import { gainAp, grantBlock, healHp, loseHp, spendAp } from '../infra/write';
import { defOf } from '../cards/registry';
import { onceThisFight, rulesOf } from '../cards/powers';
import { isXCost, costNow } from '../cards/cost';
import { commitLink, liveStatOf } from './link';
import { planStrike } from './strike';
import { drawCards } from './deck';

/**
 * 一次出手 = 一份 Settlement（计划）+ 一个执行器（settle）。
 *
 * 以前「一手牌」有三种写法：strikeWith 同步把状态写进 G，publishStrike 再把
 * 飘字错开补播，answer.ts 又手工把结果逐字段拷进 AnswerCtx。状态有两套时相、
 * 结果有两份读数，漏拷 selfHp 这种 bug 就不可避免。
 *
 * 现在业务函数只**构造**计划：hits 是逐段的伤害，budget 是这一手要写的资源，
 * instant 是必须在本帧跑完的账本与答题流水。所有可见写入（敌人 hp/block、
 * 玩家 hp/block/ap、抽牌、事件）只在 settle 里发生，段与它的 dmg 事件落在
 * 同一个调度点 —— 血条因此跟着飘字逐段掉，而日志、反馈面板、免答记账读的
 * 都是同一份计划派生出来的 view。
 *
 * 账本类写入（cardsThisTurn / cardPlays / nextBoost / 记忆 / 统计）在构造期
 * 同步完成：它们只影响**下一手**，不产生可见时序，也不需要第二份读数。
 * 分界线是「玩家能不能在画面上看到它变化」，不是「是不是写了 G」。
 *
 * 执行器走 infra/schedule.ts：浏览器按毫秒排队，无头模拟换同步调度器，
 * 所以「core 同步可跑」和「逐段可见」不冲突，不需要为测试留后门。
 */

/** 多段之间隔多久落地。表现层的光刃时长按 seq 拉长，两者共用这个节奏。 */
export const SEG_MS = 150;

/** 一段伤害的预演结果：raw 是卡面段值，dealt 是真正打进去的血。 */
export interface Hit {
  raw: number;
  dealt: number;
  absorbed: number;
}

/** 这一手要写入的资源总量。`draw` 先记请求数，执行器抽完写回实际数。 */
export interface Budget {
  blk: number;
  /** 必须在**第一段之前**就生效的格挡（羽毛在敌人出招前补甲）；其余格挡跟飘字一起落地。 */
  blkEarly: number;
  heal: number;
  /** 玩家实际要掉的血：卡面自伤 + 反伤。 */
  hurt: number;
  draw: number;
  ap: { spend: number; gain: number };
  /** 卡面自伤，只用于日志与反馈文案；实际扣血走 hurt。 */
  selfHp: number;
}

export interface Settlement {
  /** 敌人回合没有出牌者，用 null 表示；计划的身份由 target 决定。 */
  id: CardId | null;
  eff: Eff;
  /** 段打在谁身上：玩家出牌打敌人，敌人回合打玩家。两者走同一个执行器。 */
  target: 'enemy' | 'hero';
  hits: Hit[];
  pierce: boolean;
  /** hero 段整手最多能吸收多少格挡；敌人「穿透」机制在构造时把它减半。 */
  guardCap?: number;
  budget: Budget;
  /** 本帧必须完成的写入，按加入顺序由执行器同步跑完。 */
  instant: (() => void)[];
  /** 非段级的即时事件（举盾 / 塞牌 / 强化 / 观察），由执行器统一发出。 */
  events: GameEvent[];
  /** 判定面板的说明文字：由各处直接追加，不再在收尾时拼第二份。 */
  notes: string[];
  linkNote: string;
  nextNote: string;
  foeAlive: boolean;
  /** 答错且没有实际伤害时演「焰灭」。 */
  wrong: boolean;
}

/** 反馈面板 / 日志 / 界面共用的只读视图；只有这一处把计划翻译成数字。 */
export interface StrikeView {
  hits: number[];
  parts: { d: number; a: number }[];
  dmg: number;
  absorbed: number;
  blk: number;
  heal: number;
  drawn: number;
  selfHp: number;
  foeAlive: boolean;
  linkNote: string;
  nextNote: string;
}

export function viewOf(s: Settlement): StrikeView {
  return {
    hits: s.hits.map((h) => h.raw),
    parts: s.hits.map((h) => ({ d: h.dealt, a: h.absorbed })),
    dmg: s.hits.reduce((n, h) => n + h.dealt, 0),
    absorbed: s.hits.reduce((n, h) => n + h.absorbed, 0),
    blk: s.budget.blk + s.budget.blkEarly,
    heal: s.budget.heal,
    drawn: s.budget.draw,
    selfHp: s.budget.selfHp,
    foeAlive: s.foeAlive,
    linkNote: s.linkNote,
    nextNote: s.nextNote,
  };
}

/**
 * 一段伤害对敌人状态的唯一规则。计划阶段在敌人副本上预演，执行阶段传真实的
 * G.enemy 落地，两边走同一个函数，不会出现「预演一套、实战一套」。
 */
function applyHit(e: Foe, raw: number, pierce: boolean) {
  let n = raw;
  let absorbed = 0;
  if (!pierce && e.block > 0) { absorbed = Math.min(e.block, n); e.block -= absorbed; n -= absorbed; }
  const alive = e.hp > 0;
  e.hp -= n;
  // 藏书印只认「这一下打死的」：多段牌的第二段会让 e.hp 已经是负数。
  return { dealt: n, absorbed, killed: alive && e.hp <= 0 };
}

function emptyBudget(): Budget {
  return { blk: 0, blkEarly: 0, heal: 0, hurt: 0, draw: 0, ap: { spend: 0, gain: 0 }, selfHp: 0 };
}

/** 答错（或纯粹记账）时的空计划：没有段、没有资源，只保留这张牌的身份。 */
export function emptySettlement(id: CardId): Settlement {
  return {
    id, eff: defOf(id).eff, target: 'enemy', hits: [], pierce: false, budget: emptyBudget(),
    instant: [], events: [], notes: [], linkNote: '', nextNote: '',
    foeAlive: G.enemy ? G.enemy.hp > 0 : true, wrong: true,
  };
}

/** 敌人回合的计划：段打在玩家身上，没有卡面、没有反馈面板。 */
export function foeSettlement(): Settlement {
  return {
    id: null, eff: 'strike', target: 'hero', hits: [], pierce: false, budget: emptyBudget(),
    instant: [], events: [], notes: [], linkNote: '', nextNote: '',
    foeAlive: true, wrong: false,
  };
}

/**
 * 把两份计划合成一手：装订线在答错后仍按半额结算，而橡皮 / 草稿纸已经
 * 往空计划里记过预算。合并是**预算相加、段取后者**，不是逐字段搬运，
 * 所以不会再出现「装订线覆盖掉橡皮的格挡」或「漏拷 selfHp」。
 */
export function mergeSettlement(base: Settlement, extra: Settlement): Settlement {
  const a = base.budget;
  const b = extra.budget;
  return {
    ...extra,
    notes: base.notes,
    instant: [...base.instant, ...extra.instant],
    events: [...base.events, ...extra.events],
    budget: {
      blk: a.blk + b.blk,
      blkEarly: a.blkEarly + b.blkEarly,
      heal: a.heal + b.heal,
      hurt: a.hurt + b.hurt,
      draw: a.draw + b.draw,
      selfHp: a.selfHp + b.selfHp,
      ap: { spend: a.ap.spend + b.ap.spend, gain: a.ap.gain + b.ap.gain },
    },
  };
}

/**
 * 一手牌的**决定**：算出每段伤害、整手资源预算和这一手的记账结果。
 * 不写任何可见状态 —— 敌人 hp/block、玩家 hp/block/ap、抽牌、事件都留给 settle。
 *
 * `mult` 只给装订线的半额结算传 0.5，其余一律 1；`repeat` 是 X 费花掉的点数，
 * 乘在**段数**上。卡面、答题面板、结算都由 planStrike 给出同一份 EffOut。
 */
export function buildSettlement(
  id: CardId, opts: { mult?: number; repeat?: number } = {},
): Settlement {
  const card = defOf(id);
  // 这一回合第几张真正生效的牌。答错不增加，所以墨水瓶/节拍器只数打出去的牌。
  G.cardsThisTurn += 1;
  const st = liveStatOf(id);
  const out = planStrike(id, opts);

  const ghost: Foe | null = G.enemy ? { ...G.enemy } : null;
  const hits: Hit[] = out.hits.map((raw) => {
    const r = ghost
      ? applyHit(ghost, raw, out.pierce)
      : { dealt: 0, absorbed: 0, killed: false };
    return { raw, dealt: r.dealt, absorbed: r.absorbed };
  });
  const dmg = hits.reduce((n, h) => n + h.dealt, 0);

  const s: Settlement = {
    id, eff: card.eff, target: 'enemy', hits, pierce: out.pierce,
    budget: emptyBudget(), instant: [], events: [], notes: [],
    linkNote: st.reasons.join(' · '),
    nextNote: '', foeAlive: ghost ? ghost.hp > 0 : true, wrong: false,
  };
  const b = s.budget;
  b.blk = out.blk;
  b.draw = out.draw;
  b.selfHp = out.selfHp;
  b.hurt = out.selfHp;
  // 按实际打进去的伤害回血；0 伤害不回 1 点，满血时预算就是 0。
  if (out.healRatio > 0 && dmg > 0) {
    b.heal = Math.max(0, Math.min(G.maxHp - G.hp, Math.max(1, Math.round(dmg * out.healRatio))));
  }

  if (out.selfHp > 0) {
    log(`「${card.name}」反噬：你失去 ${out.selfHp} 点生命`, 'bad');
  }

  // 节奏型增益按「真正生效的牌」计数。抽牌与行动力都只记进预算，
  // 由执行器一次写完，日志排在抽牌之后才能报实际张数。
  const R = rulesOf();
  const ink = R.inkDraw > 0 && G.cardsThisTurn % 3 === 0 ? R.inkDraw : 0;
  const pulse = G.cardsThisTurn === 3 && onceThisFight('pulse') ? BAL.pulseRefund : 0;
  const varnish = !isXCost(card) && costNow(card) === 0 && onceThisFight('varnish')
    ? BAL.varnishDraw : 0;
  if (out.hits.some((h) => h > 0) && onceThisFight('seed')) {
    b.blk += BAL.seedBlock;
    s.instant.push(() => log(`种纸：这一场第一张攻击牌，补 ${BAL.seedBlock} 点格挡`, 'hi'));
  }
  if (pulse) {
    b.ap.gain += pulse;
    s.instant.push(() => log(`节拍器：这一场第一次三连，退回 ${pulse} 点行动力`, 'hi'));
  }
  b.draw += ink + varnish;

  // 走完才记账：答错这一手作废，上一张留的倍率继续留着。
  s.nextNote = commitLink(id);

  s.instant.unshift(() => {
    b.draw = drawCards(b.draw);
    if (ink) log(`墨水瓶：本回合第 ${G.cardsThisTurn} 张牌，抽 ${ink} 张`, 'hi');
    if (varnish) log(`亮油：这一场第一张 0 费牌，抽 ${varnish} 张`, 'hi');
    if (b.ap.spend) spendAp(b.ap.spend);
    if (b.ap.gain) gainAp(b.ap.gain);
  });
  return s;
}

/**
 * 敌人多段攻击的预演：格挡按整手一个上限逐段吃，和意图公示的总吸收同源。
 * 段值只是数据，真正扣血由执行器在每段落地时写。
 */
export function planHeroHits(s: Settlement, raws: number[], guardCap: number): void {
  let left = guardCap;
  s.guardCap = guardCap;
  s.hits = raws.map((raw) => {
    const absorbed = Math.max(0, Math.min(left, raw));
    left -= absorbed;
    return { raw, dealt: raw - absorbed, absorbed };
  });
}

/**
 * 反伤：打出有攻击段的牌就挨一下，格挡挡不住。数的是打出几张，不是打中几段。
 * 只把伤害记进计划，击杀的那一下不反伤（读预演结果，不必等血真的扣完）。
 */
export function planThorns(s: Settlement): number {
  const e = G.enemy;
  if (!s.foeAlive || !e || e.mech !== 'thorns' || e.hp <= 0 || !s.hits.some((h) => h.raw > 0)) return 0;
  const n = e.mechV ?? BAL.mech.thorns;
  if (n <= 0) return 0;
  s.budget.hurt += n;
  s.instant.push(() => log(`${e.name} 的反伤：你受到 ${n} 点伤害`, 'bad'));
  return n;
}

export function addNote(s: Settlement, msg: string) {
  s.notes.push(msg);
}

export interface SettleOpts {
  /** 全部段与尾部资源都落地之后才调用（解锁输入、推进胜负）。 */
  onDone?: () => void;
}

/**
 * 唯一执行器：三段出牌路径（免答直打 / 基础牌 / 答题）以及敌人攻击共用。
 * 每段的 hp / block 写入和它的 dmg 事件在**同一个调度点**发生；
 * instant 在本帧同步跑完，尾部资源在最后一段的飘字之后落地。
 */
export function settle(s: Settlement, opts: SettleOpts = {}) {
  for (const run of s.instant) run();
  if (s.budget.blkEarly > 0) {
    grantBlock(s.budget.blkEarly);
    emit({ t: 'blk', n: s.budget.blkEarly });
  }
  for (const ev of s.events) emit(ev);

  const last = s.hits.length - 1;
  if (s.hits.some((h) => h.raw > 0)) {
    let guardLeft = s.guardCap ?? G.block;
    const totalAbsorbed = s.hits.reduce((n, h) => n + h.absorbed, 0);
    s.hits.forEach((h, i) => {
      const land = () => {
        if (s.target === 'enemy') {
          const e = G.enemy;
          if (!e) return;
          const r = applyHit(e, h.raw, s.pierce);
          emit({ t: 'dmg', n: r.dealt, absorbed: r.absorbed, eff: s.eff, seq: i });
          if (r.killed) {
            const got = healHp(rulesOf().healOnKill);
            if (got) {
              log(`藏书印：击杀回复 ${got} 点生命`, 'hi');
              emit({ t: 'heal', n: got });
            }
          }
        } else {
          const absorbed = Math.max(0, Math.min(guardLeft, h.raw));
          guardLeft -= absorbed;
          loseHp(h.raw - absorbed);
          emit({
            t: 'enemyHit', n: h.raw - absorbed, absorbed,
            seq: i, times: s.hits.length, totalAbsorbed,
          });
        }
        if (i === last) checkPending();
      };
      if (i === 0) land(); else after(i * SEG_MS, land);
    });
  } else if (s.wrong) {
    emit({ t: 'fizzle', eff: s.eff });
  }

  const tail = Math.max(last * SEG_MS, 0) + (s.wrong ? 220 : 60);
  after(tail, () => {
    if (s.budget.blk > 0) {
      grantBlock(s.budget.blk);
      emit({ t: 'blk', n: s.budget.blk });
    }
    if (s.budget.heal > 0) {
      const got = healHp(s.budget.heal);
      if (got) emit({ t: 'heal', n: got });
    }
    if (s.budget.hurt > 0) {
      loseHp(s.budget.hurt);
      emit({ t: 'hurt', n: s.budget.hurt });
    }
    // 所有写入都落地后才判胜负；无头模拟的同步调度器下这就是最后一次。
    checkPending();
    opts.onDone?.();
  });
}
