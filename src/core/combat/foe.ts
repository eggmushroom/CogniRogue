import { BAL } from '../model/data';
import type { Foe, FoeTpl, Move } from '../model/types';
import { G, checkPending, log, topTopic } from '../infra/state';
import { after } from '../infra/schedule';
import { STAGE_ROWS } from '../model/data';
import { JUNK_ID } from '../cards/registry';
import { onceThisFight, rulesOf } from '../cards/powers';
import { requestSettle } from './pending';
import { discardHand, startTurn } from './deck';
import { foeSettlement, planHeroHits, settle } from './settlement';
import type { Settlement } from './settlement';

/**
 * combat/foe：敌人模板、意图公示、敌人回合。招式是循环表，玩家能看见下一步。
 *
 * 敌人回合和玩家出牌共用 `settlement.ts` 的计划与执行器：每一段的扣血和它的
 * 光刃事件落在同一个调度点，不再「一帧扣完、表现层用原生 setTimeout 补播」。
 */
/**
 * 幕内强度台阶：每 5 层上一档，一共四档。查表而不是比例 ——
 * "第 16 层比第 1 层厚 12 点"是能写进卡面的数，"厚 1.42 倍"不是。
 */
const TIER = [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3];

/**
 * 造一只怪：血量 = 模板值 + 台阶 × 每档加点，伤害就是模板值。
 *
 * 两个数都在 `FOES` 里，可以直接和玩家看到的数字对上。原来的实现是
 * 「模板 × 0.55 × 开方曲线 × 精英倍率」—— 四个数乘在一起，想让第一幕的杂兵
 * 多 2 点血，得反算改哪一个。
 */
export function makeFoe(tpl: FoeTpl, floor: number): Foe {
  const row = Math.max(1, Math.min(STAGE_ROWS, floor - (tpl.stage - 1) * STAGE_ROWS));
  const hp = tpl.hp + tpl.hpStep * TIER[row - 1] + BAL.foeHpAdd;
  return {
    ...tpl,
    maxHp: hp,
    hp,
    dmg: tpl.dmg + BAL.foeDmgAdd,
    block: 0,
    mv: 0,
  };
}

const PLAIN_ATK: Move = { k: 'atk' };

export function moveOf(e: Foe) {
  const arr = e.moves && e.moves.length ? e.moves : [PLAIN_ATK];
  return arr[(e.mv || 0) % arr.length];
}

/** 这一步攻击的最终伤害：意图与结算同源，修正都加在 total 上。 */
function attackOf(e: Foe) {
  const m = moveOf(e);
  const per = Math.max(0, e.dmg + (m.add ?? 0));
  const times = m.times ?? 1;
  let reviewer = 0;
  let oblivionAdd = 0;
  let oblivionCut = 0;
  let topic: string | null = null;

  if (e.mech === 'reviewer' && G.okThisTurn === 0) {
    reviewer = e.mechV ?? BAL.mech.reviewer;
  }
  if (e.mech === 'oblivion') {
    topic = topTopic();
    if (topic) {
      oblivionAdd = e.mechV ?? BAL.mech.oblivion;
      // 本回合在该主题答对过，加的部分被削回去；日志要写清先加后减。
      if (G.topOkTopic === topic) oblivionCut = BAL.mech.oblivionReduce;
    }
  }

  const total = Math.max(0, per * times + reviewer + oblivionAdd - oblivionCut);
  return { per, times, total, reviewer, oblivionAdd, oblivionCut, topic };
}

/** 下一步意图，画在敌人头顶；攻击写总伤，无修正时写「每段×段数」，多段格挡按总数吸收。 */
export function intentText(e: Foe): { icon: 'attack' | 'shield' | 'junk' | 'buff'; text: string } {
  const m = moveOf(e);
  if (m.k === 'atk') {
    const f = attackOf(e);
    const plain = f.per * f.times;
    const text = f.times > 1 && f.total === plain ? `${f.per}×${f.times}` : `${f.total}`;
    return { icon: 'attack', text };
  }
  if (m.k === 'def') return { icon: 'shield', text: `+${m.v ?? 0}` };
  if (m.k === 'jam') return { icon: 'junk', text: `${m.n ?? 1} 杂念` };
  return { icon: 'buff', text: `攻击 +${m.v ?? 0}` };
}

/**
 * 答错时触发的敌人机制。挂在答错这个动作上，返回给反馈面板的短文案。
 * 状态写入与事件并入这一手的计划，不在敌人模块里另开一条出口。
 */
export function onPlayerMiss(s: Settlement): string {
  const e = G.enemy;
  if (!e) return '';

  if (e.mech === 'leech') {
    const cap = e.mechV ?? BAL.mech.leech;
    const n = Math.min(cap, e.maxHp - e.hp);
    if (n <= 0) return '';
    s.instant.push(() => { e.hp += n; });
    s.events.push({ t: 'foeHeal', n });
    log(`${e.name}啃食你的失误，回复 ${n} 点`, 'bad');
    return `${e.name}啃食这次失误，回复 ${n} 点。`;
  }
  if (e.mech === 'lethe') {
    const n = e.mechV ?? BAL.mech.lethe;
    s.instant.push(() => { e.dmg += n; });
    log(`${e.name}吞下这次遗忘，攻击 +${n}`, 'bad');
    return `${e.name}吞下这次遗忘：它的攻击永久 +${n}。`;
  }
  if (e.mech === 'bulwark') {
    // 答错让它多一层甲：惩罚落在节奏上，不落在血量上。
    const n = e.mechV ?? BAL.mech.bulwark;
    s.instant.push(() => { e.block += n; });
    log(`${e.name} 加固了 ${n} 点格挡`, 'bad');
    return `它趁机加固：获得 ${n} 点格挡。`;
  }
  return '';
}

/** 把最终总伤摊回每一段：无修正时正好等于意图公示的 `per×times`。 */
function splitDamage(total: number, times: number): number[] {
  const n = Math.max(1, times);
  const base = Math.floor(total / n);
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? total - base * (n - 1) : base));
}

export function endTurn() {
  if (G.panel.k !== 'none' || G.pending || !G.enemy || G.busy) return;
  const e = G.enemy;
  // 回合结束：不管这几张牌用没用过、能不能用，一律回弃牌堆。
  // 先记下张数再清 —— 索引卡在 startTurn 里按「上回合剩几张」决定多抽几张。
  const handLeft = discardHand();
  e.block = 0;
  const s = foeSettlement();

  // 羽毛：回合结束是最后一次看格挡的时机，先算它再让敌人出招。
  const R = rulesOf({ handLeft });
  const feather = R.endBlock > 0 && G.block === 0 ? R.endBlock : 0;
  if (feather) {
    s.budget.blkEarly += feather;
    log(`羽毛：空手结束回合，补 ${feather} 点格挡`, 'hi');
  }
  const m = moveOf(e);

  /**
   * 口哨：第一回合的第一击落空。
   *
   * 它和 `calmFirstTurn`（平衡实验用的全局开关）曾经共用一个 `||`：开关一打开，
   * 短路让 `onceThisFight('whistle')` 根本不执行，玩家拿着这张牌打一整局都不会
   * 触发，而且不会有任何报错。两者要分开求值 —— 口哨按自己的条件结账，
   * 实验开关只决定结果。条件里的 `m.k === 'atk'` 不能拆：首动不是攻击时不该消费。
   */
  const whistled = m.k === 'atk' && G.turn === 1 && onceThisFight('whistle');
  if (m.k === 'atk' && G.turn === 1 && (whistled || BAL.calmFirstTurn)) {
    log(whistled
      ? `${e.name} 的这一击被你闪开了`
      : `${e.name} 还在观察你，这一回合没有出手`, 'hi');
    s.events.push({ t: 'enemyAct', k: 'calm', n: 0 });
  } else if (m.k === 'atk') {
    const f = attackOf(e);
    let dmg = f.total;
    // 封蜡：这一场第一次挨打少受几点，落在格挡之前，否则减免会被格挡吃掉。
    if (onceThisFight('seal') && dmg > 0) {
      const before = dmg;
      dmg = Math.max(0, dmg - BAL.sealCut);
      log(`封蜡：这一击被削去 ${before - dmg} 点（${before} → ${dmg}）`, 'hi');
    }
    // 夜灯：每次挨打减固定值，同样在格挡之前，可以削到 0。
    const cut = rulesOf({ handLeft }).dmgCut;
    if (cut > 0 && dmg > 0) dmg = Math.max(0, dmg - cut);
    if (f.reviewer) log(`${e.name}：你这回合没有认真答对任何一张卡，+${f.reviewer}`, 'bad');
    if (f.oblivionCut) {
      log(`遗忘：你在「${f.topic}」上答对了，它被削弱 -${f.oblivionCut}`, 'hi');
    } else if (f.oblivionAdd) {
      log(`遗忘：你错得最多的主题是「${f.topic}」，它抓住这点 +${f.oblivionAdd}`, 'bad');
    }

    // guardCap 是「段真正落地时」的有效格挡：羽毛的补甲由执行器在第一段之前写入，
    // 所以预演就要把它算进去，否则玩家会平白多吃一段伤害。
    let guard = G.block + feather;
    if (e.mech === 'pierce') {
      const cut = e.mechV ?? BAL.mech.pierceBlock;
      guard = Math.max(0, guard - cut);
      log(`${e.name}：无视 ${cut} 点格挡`, 'bad');
    }
    planHeroHits(s, splitDamage(dmg, f.times), guard);
    const absorbed = s.hits.reduce((n, h) => n + h.absorbed, 0);
    const taken = s.hits.reduce((n, h) => n + h.dealt, 0);

    // 吸水：挡住不算命中，没挡住才抽走下回合的行动力。
    if (e.mech === 'siphon' && taken > 0) {
      const n = e.mechV ?? BAL.mech.siphon;
      s.instant.push(() => { G.apDown += n; });
      log(`${e.name} 抽走了你 ${n} 点行动力（下回合）`, 'bad');
    }
    log(
      `${e.name} 攻击 ${dmg}${f.times > 1 ? `（${f.times} 段）` : ''} 点` +
        (absorbed ? `，格挡吸收 ${absorbed}` : '') +
        (taken ? `，你受到 ${taken} 点伤害` : '，全部挡下'),
      taken ? 'bad' : 'hi',
    );
  } else if (m.k === 'def') {
    const n = m.v ?? 0;
    s.instant.push(() => { e.block += n; });
    s.events.push({ t: 'enemyAct', k: 'def', n });
    log(`${e.name} 举起格挡，获得 ${n} 点护甲`, 'bad');
  } else if (m.k === 'jam') {
    const n = m.n ?? 1;
    s.instant.push(() => { for (let i = 0; i < n; i++) G.discard.push(JUNK_ID); });
    s.events.push({ t: 'enemyAct', k: 'jam', n });
    log(`${e.name} 往你的弃牌堆塞了 ${n} 张杂念`, 'bad');
  } else if (m.k === 'buff') {
    const n = m.v ?? 0;
    s.instant.push(() => { e.dmg += n; });
    s.events.push({ t: 'enemyAct', k: 'buff', n });
    log(`${e.name} 变得更清晰了，攻击 +${n}`, 'bad');
  }

  e.mv = (e.mv || 0) + 1;
  // 加速：每回合自己变强，拖一回合更贵。
  if (e.mech === 'haste') {
    const n = e.mechV ?? BAL.mech.haste;
    e.dmg += n;
    log(`${e.name} 又紧了一分，攻击 +${n}`, 'bad');
  }

  G.busy = true;
  settle(s, {
    onDone: () => {
      // 索引贴：没花完的格挡带一点进下一回合；重设而非累加，startTurn 会先清格挡。
      const carry = R.carryBlock;
      G.carryBlock = carry > 0 ? Math.min(G.block, carry) : 0;
      checkPending();
      // 战斗在这一回合结束（打完 / 倒下）时不再开新回合，但手牌已经在上面清干净了。
      if (!G.pending) { G.turn += 1; startTurn(handLeft); }
      G.busy = false;
      if (G.pending === 'dead') after(700, () => { if (G.pending === 'dead') requestSettle(); });
    },
  });
}
