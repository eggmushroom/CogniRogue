import { BAL } from '../model/data';
import type { Foe, FoeTpl } from '../model/types';
import { G, checkPending, log, topTopic } from '../infra/state';
import { emit } from '../infra/events';
import { grantBlock, loseHp } from '../infra/write';
import { JUNK_ID } from '../cards/registry';
import { onceThisFight, rulesOf } from '../cards/powers';
import { FLOOR_MAX } from '../map/gen';
import { requestSettle } from './pending';
import { discardHand, startTurn } from './deck';

/**
 * combat/foe：敌人模板、意图公示、敌人回合。招式是循环表，玩家能看见下一步。
 */
/** 造一只怪：强度按全局层号 floorOf 算，血量与伤害同源，曲线开方（前陡后缓）。 */
export function makeFoe(tpl: FoeTpl, floor: number): Foe {
  const t = Math.max(0, Math.min(1, (floor - 1) / (FLOOR_MAX - 1)));
  const hpK = 1 + BAL.growth.floor * Math.sqrt(t);
  const dmgK = 1 + BAL.growth.all * t;
  // 精英/Boss 另加厚度倍率（普通怪 1.0），让打大怪的场次拖到 3 回合以上。
  const typeK = tpl.type === 'fight' ? 1 : BAL.hpType;
  const hp = Math.round(tpl.hp * hpK * BAL.hp * typeK);
  return {
    ...tpl,
    maxHp: hp,
    hp,
    dmg: Math.round(tpl.dmg * dmgK * BAL.dmg),
    block: 0,
    mv: 0,
  };
}

export function moveOf(e: Foe) {
  const arr = e.moves && e.moves.length ? e.moves : [{ k: 'atk' as const, m: 1 }];
  return arr[(e.mv || 0) % arr.length];
}

/** 这一步攻击的最终伤害：意图与结算同源，修正都加在 total 上。 */
function attackOf(e: Foe) {
  const m = moveOf(e);
  const per = Math.round(e.dmg * (m.m ?? 1));
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

/** 答错时触发的敌人机制。挂在答错这个动作上，返回给反馈面板的短文案。 */
export function onPlayerMiss(): string {
  const e = G.enemy;
  if (!e) return '';

  if (e.mech === 'leech') {
    const cap = e.mechV ?? BAL.mech.leech;
    const n = Math.min(cap, e.maxHp - e.hp);
    if (n <= 0) return '';
    e.hp += n;
    log(`${e.name}啃食你的失误，回复 ${n} 点`, 'bad');
    emit({ t: 'foeHeal', n });
    return `${e.name}啃食这次失误，回复 ${n} 点。`;
  }
  if (e.mech === 'lethe') {
    const n = e.mechV ?? BAL.mech.lethe;
    e.dmg += n;
    log(`${e.name}吞下这次遗忘，攻击 +${n}`, 'bad');
    return `${e.name}吞下这次遗忘：它的攻击永久 +${n}。`;
  }
  if (e.mech === 'bulwark') {
    // 答错让它多一层甲：惩罚落在节奏上，不落在血量上。
    const n = e.mechV ?? BAL.mech.bulwark;
    e.block += n;
    log(`${e.name} 加固了 ${n} 点格挡`, 'bad');
    return `它趁机加固：获得 ${n} 点格挡。`;
  }
  return '';
}

export function endTurn() {
  if (G.panel.k !== 'none' || G.pending || !G.enemy || G.busy) return;
  const e = G.enemy;
  // 回合结束：不管这几张牌用没用过、能不能用，一律回弃牌堆。
  // 先记下张数再清 —— 索引卡在 startTurn 里按「上回合剩几张」决定多抽几张。
  const handLeft = discardHand();
  e.block = 0;
  // 羽毛：回合结束是最后一次看格挡的时机，先算它再让敌人出招。
  const R = rulesOf({ handLeft });
  if (R.endBlock > 0 && G.block === 0) {
    grantBlock(R.endBlock);
    log(`羽毛：空手结束回合，补 ${R.endBlock} 点格挡`, 'hi');
    emit({ t: 'blk', n: R.endBlock });
  }
  const m = moveOf(e);

  if (m.k === 'atk' && G.turn === 1 && (BAL.calmFirstTurn || onceThisFight('whistle'))) {
    // 第一回合留观察期，否则答错从开局起就是拿血换。
    // 口哨买的就是这一回合，一场一次。
    log(`${e.name} 还在观察你，这一回合没有出手`, 'hi');
    emit({ t: 'enemyAct', k: 'calm', n: 0 });
  } else if (m.k === 'atk') {
    const f = attackOf(e);
    let dmg = f.total;
    // 封蜡：这一场第一次挨打减半，落在格挡之前，否则半份伤害会被格挡吃掉。
    if (onceThisFight('seal')) {
      dmg = Math.round(dmg * BAL.sealCut);
      log(`封蜡：这一击被削去一半（${f.total} → ${dmg}）`, 'hi');
    }
    // 夜灯：每次挨打减固定值，同样在格挡之前，可以削到 0。
    const cut = rulesOf({ handLeft }).dmgCut;
    if (cut > 0 && dmg > 0) dmg = Math.max(0, dmg - cut);
    if (f.reviewer) {
      log(`${e.name}：你这回合没有认真答对任何一张卡，+${f.reviewer}`, 'bad');
    }
    if (f.oblivionCut) {
      log(`遗忘：你在「${f.topic}」上答对了，它被削弱 -${f.oblivionCut}`, 'hi');
    } else if (f.oblivionAdd) {
      log(`遗忘：你错得最多的主题是「${f.topic}」，它抓住这点 +${f.oblivionAdd}`, 'bad');
    }
    let guard = G.block;
    if (e.mech === 'pierce') { guard = Math.ceil(guard / 2); log(`${e.name}：穿透了一半格挡`, 'bad'); }
    const absorbed = Math.min(guard, dmg);
    const taken = dmg - absorbed;
    loseHp(taken);
    // 吸水：挡住不算命中，没挡住才抽走下回合的行动力。
    if (e.mech === 'siphon' && taken > 0) {
      const n = e.mechV ?? BAL.mech.siphon;
      G.apDown += n;
      log(`${e.name} 抽走了你 ${n} 点行动力（下回合）`, 'bad');
    }
    log(
      `${e.name} 攻击 ${dmg}${m.times ? `（${m.times} 段）` : ''} 点` +
        (absorbed ? `，格挡吸收 ${absorbed}` : '') +
        (taken ? `，你受到 ${taken} 点伤害` : '，全部挡下'),
      taken ? 'bad' : 'hi',
    );
    emit({ t: 'enemyAct', k: 'atk', n: dmg, times: m.times ?? 1, taken, absorbed });
  } else if (m.k === 'def') {
    e.block += m.v ?? 0;
    log(`${e.name} 举起格挡，获得 ${m.v} 点护甲`, 'bad');
    emit({ t: 'enemyAct', k: 'def', n: m.v ?? 0 });
  } else if (m.k === 'jam') {
    for (let i = 0; i < (m.n ?? 1); i++) G.discard.push(JUNK_ID);
    log(`${e.name} 往你的弃牌堆塞了 ${m.n} 张杂念`, 'bad');
    emit({ t: 'enemyAct', k: 'jam', n: m.n ?? 1 });
  } else if (m.k === 'buff') {
    e.dmg += m.v ?? 0;
    log(`${e.name} 变得更清晰了，攻击 +${m.v}`, 'bad');
    emit({ t: 'enemyAct', k: 'buff', n: m.v ?? 0 });
  }

  e.mv = (e.mv || 0) + 1;
  // 索引贴：没花完的格挡带一点进下一回合；重设而非累加，startTurn 会先清格挡。
  const carry = rulesOf({ handLeft }).carryBlock;
  G.carryBlock = carry > 0 ? Math.min(G.block, carry) : 0;
  // 加速：每回合自己变强，拖一回合更贵。
  if (e.mech === 'haste') {
    const n = e.mechV ?? BAL.mech.haste;
    e.dmg += n;
    log(`${e.name} 又紧了一分，攻击 +${n}`, 'bad');
  }
  checkPending();
  // 战斗在这一回合结束（打完 / 倒下）时不再开新回合，但手牌已经在上面清干净了。
  if (!G.pending) { G.turn += 1; startTurn(handLeft); }
  G.busy = false;

  if (G.pending === 'dead') setTimeout(() => { if (G.pending === 'dead') requestSettle(); }, 700);
}
