import { BAL } from '../model/data';
import type { Foe, FoeTpl, NodeType } from '../model/types';
import { G, checkPending, log, topTopic } from '../infra/state';
import { emit } from '../infra/events';
import { settlePending } from '../journey/run';
import { startTurn } from './deck';

/**
 * combat/foe —— 敌人模板、意图公示与敌人回合。
 *
 * 招式是循环表，玩家能看见下一步要干什么 —— 这样"这回合该攻还是该守"
 * 才是一个能推理的决定，而不是掷骰子。
 */
/**
 * 造一只怪。
 *
 * **跨幕的强度由模板承担，不在这里乘层号。** 100 层如果按层号线性放大，
 * 第五幕的小怪会变成一堵墙 —— 而玩家那一侧的成长（牌组、增益牌、生命上限）
 * 是有限且缓慢的。所以每一幕换一套血线写在 `FOES` 里，这里只保留一幕之内
 * 从入口爬到 Boss 的那一点点斜率。
 */
export function makeFoe(tpl: FoeTpl, type: NodeType, r: number): Foe {
  const k = type === 'boss' ? 1 : 1 + r * 0.018;
  const hp = Math.round(tpl.hp * k * BAL.hp);
  return {
    ...tpl,
    maxHp: hp,
    hp,
    dmg: Math.round(tpl.dmg * k * BAL.dmg),
    block: 0,
    mv: 0,
    buff: 0,
  };
}

export function moveOf(e: Foe) {
  const arr = e.moves && e.moves.length ? e.moves : [{ k: 'atk' as const, m: 1 }];
  return arr[(e.mv || 0) % arr.length];
}

/** 敌人下一步的意图，画在它头顶 —— 有了这个，"该攻该守"才是可推理的决定。 */
export function intentText(e: Foe): { icon: 'attack' | 'shield' | 'junk' | 'buff'; text: string } {
  const m = moveOf(e);
  if (m.k === 'atk') {
    // 显示「每段 × 段数」，和结算的 round(dmg×m)×times 同源。
    // 以前这里先乘了 times 再拼 "×times"，12 点攻击的 0.45×3 会显示成 15×3（读起来像 45）。
    const per = Math.round(e.dmg * (m.m ?? 1));
    const times = m.times ?? 1;
    return { icon: 'attack', text: times > 1 ? `${per}×${times}` : `${per}` };
  }
  if (m.k === 'def') return { icon: 'shield', text: `+${m.v ?? 0}` };
  if (m.k === 'jam') return { icon: 'junk', text: `${m.n ?? 1} 杂念` };
  return { icon: 'buff', text: `攻击 +${m.v ?? 0}` };
}

export function endTurn() {
  if (G.panel.k !== 'none' || G.pending || !G.enemy || G.busy) return;
  const e = G.enemy;
  e.block = 0;
  const m = moveOf(e);

  if (m.k === 'atk' && G.turn === 1 && BAL.calmFirstTurn) {
    // 第一回合手里全是没答过的卡，玩家几乎叠不出格挡。给它留一个观察期，
    // 不然"答错"从第一回合起就是在拿血换。
    log(`${e.name} 还在观察你，这一回合没有出手`, 'hi');
    emit({ t: 'enemyAct', k: 'calm', n: 0 });
  } else if (m.k === 'atk') {
    let dmg = Math.round(e.dmg * (m.m ?? 1)) * (m.times ?? 1);
    if (e.mech === 'reviewer' && G.okThisTurn === 0) {
      dmg += 3;
      log('复习官：你这回合没有认真答对任何一张卡，+3', 'bad');
    }
    if (e.mech === 'oblivion') {
      const t = topTopic();
      if (t) {
        dmg += 4;
        if (G.topOkTopic === t) { dmg -= 3; log(`遗忘：你在「${t}」上答对了，它被削弱 -3`, 'hi'); }
        else log(`遗忘：你错得最多的主题是「${t}」，它抓住这点 +4`, 'bad');
      }
    }
    let guard = G.block;
    if (e.mech === 'pierce') { guard = Math.ceil(guard / 2); log(`${e.name}：穿透了一半格挡`, 'bad'); }
    const absorbed = Math.min(guard, dmg);
    const taken = dmg - absorbed;
    G.hp -= taken;
    // 吸水：挡住了就不算命中，没挡住才抽走你下回合的行动力。
    // 「挡得住」因此变成一件有复利的事 —— 一次没挡住，下一回合更挡不住。
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
    for (let i = 0; i < (m.n ?? 1); i++) G.discard.push({ id: '__junk', up: 0, junk: true });
    log(`${e.name} 往你的弃牌堆塞了 ${m.n} 张杂念`, 'bad');
    emit({ t: 'enemyAct', k: 'jam', n: m.n ?? 1 });
  } else if (m.k === 'buff') {
    e.buff += m.v ?? 0;
    e.dmg += m.v ?? 0;
    log(`${e.name} 变得更清晰了，攻击 +${m.v}`, 'bad');
    emit({ t: 'enemyAct', k: 'buff', n: m.v ?? 0 });
  }

  e.mv = (e.mv || 0) + 1;
  // 加速：每回合自己变强一点。它不逼你这一回合做什么，它只让"再拖一回合"变贵。
  if (e.mech === 'haste') {
    const n = e.mechV ?? BAL.mech.haste;
    e.dmg += n;
    log(`${e.name} 又紧了一分，攻击 +${n}`, 'bad');
  }
  checkPending();
  if (!G.pending) { G.turn += 1; startTurn(); }
  G.busy = false;

  if (G.pending === 'dead') setTimeout(() => { if (G.pending === 'dead') settlePending(); }, 700);
}
