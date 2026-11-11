import { BAL } from '../model/data';
import type { Foe, FoeTpl } from '../model/types';
import { G, checkPending, log, topTopic } from '../infra/state';
import { emit } from '../infra/events';
import { JUNK_ID } from '../cards/registry';
import { FLOOR_MAX } from '../map/gen';
import { requestSettle } from './pending';
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
 * ## 强度必须跟着**全局层号**走，而不是"幕内行号"
 *
 * 以前这里是 `1 + r * 0.018`：`r` 是幕内第几行（0–19）。也就是说第 1 幕第 1 层
 * 和第 1 幕第 20 层的怪差 34% 血，而第 1 幕第 20 层和第 2 幕第 1 层的差异完全由
 * 模板自己承担 —— 于是"塔越高、怪越厚"这件事只有 5 个台阶（换幕），台阶之间是平的。
 *
 * 现在用全局层号 `floorOf(stage, r)`（1..100），并让曲线**前陡后缓**（开方）：
 * 塔底每层涨得多，塔顶涨得少。详见 `BAL.growth` 的注释 —— 那一句开方
 * 就是"开局那张大牌为什么不能再一路平推"的答案。
 *
 * 血量和伤害用的是**同一个层号函数**：血量决定"打不打得完"，伤害决定
 * "挡不挡得住"，只抬血会让后几幕变成"很厚但没威胁"。
 */
export function makeFoe(tpl: FoeTpl, floor: number): Foe {
  const t = Math.max(0, Math.min(1, (floor - 1) / (FLOOR_MAX - 1)));
  // 开方：前 20 层就吃掉一半的增幅。Boss 也走同一条曲线 ——
  // 它本来就在这一幕的末尾，"按层号算"这个口径对它同样成立。
  const hpK = 1 + BAL.growth.floor * Math.sqrt(t);
  const dmgK = 1 + BAL.growth.all * t;
  // 精英 / Boss 另有一条厚度倍率（普通怪 1.0）。见 `BAL.hpType` 的注释：
  // 想让"A/S 免答"有机会攒，得让**打大怪**的那几场拖到 3 回合以上；
  // 把所有怪一起加厚只会把整局变成消耗战，技巧曲线反而被磨平。
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

/**
 * 这一步攻击的**最终**伤害。意图和结算都读这一个函数。
 *
 * 以前意图显示底数，审稿人的 +N / 遗忘的 ±N 只在结算时加上去 ——
 * 玩家照着意图叠甲，却永远多挨一截，而"为什么多挨"只能去日志里找。
 * 修正都落在总伤害上，所以 `total` 才是该公示的数。
 */
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
      // 这一回合在错题主题上答对过 —— 加的部分被削回去。两条都要留数，
      // 日志要说清是"先 +4 再 -3"，意图只写最后的总数。
      if (G.topOkTopic === topic) oblivionCut = BAL.mech.oblivionReduce;
    }
  }

  // 减到负数不能变成"打你一下反而回血"。
  const total = Math.max(0, per * times + reviewer + oblivionAdd - oblivionCut);
  return { per, times, total, reviewer, oblivionAdd, oblivionCut, topic };
}

/** 敌人下一步的意图，画在它头顶 —— 有了这个，"该攻该守"才是可推理的决定。 */
export function intentText(e: Foe): { icon: 'attack' | 'shield' | 'junk' | 'buff'; text: string } {
  const m = moveOf(e);
  if (m.k === 'atk') {
    const f = attackOf(e);
    // 没有修正时保留「每段 × 段数」的写法：玩家能读出这是几段攻击。
    // 有修正时写总数 —— 修正是加在总数上的，`per × times` 会把 +N 藏掉。
    // 多段的格挡也按总数吸收（见 endTurn），所以总数就是玩家该拿来叠甲的数。
    const plain = f.per * f.times;
    const text = f.times > 1 && f.total === plain ? `${f.per}×${f.times}` : `${f.total}`;
    return { icon: 'attack', text };
  }
  if (m.k === 'def') return { icon: 'shield', text: `+${m.v ?? 0}` };
  if (m.k === 'jam') return { icon: 'junk', text: `${m.n ?? 1} 杂念` };
  return { icon: 'buff', text: `攻击 +${m.v ?? 0}` };
}

/**
 * 答错时触发的敌人机制。挂在"答错"这个动作上，而不是敌人回合上 ——
 * 它们惩罚的正是"这次答错"本身。返回给反馈面板的一句短文案；没有机制时返回空串。
 */
export function onPlayerMiss(): string {
  const e = G.enemy;
  if (!e) return '';

  if (e.mech === 'leech') {
    // 名字必须读 e.name：这条机制挂在三种怪身上（书蛀 / 书蛀母 / 饕餮书虫），
    // 写死"书蛀"的话，第二幕 Boss 回血时日志会告诉玩家是另一只怪干的。
    const cap = e.mechV ?? BAL.mech.leech;
    const n = Math.min(cap, e.maxHp - e.hp);
    if (n <= 0) return '';
    e.hp += n;
    log(`${e.name}啃食你的失误，回复 ${n} 点`, 'bad');
    // 血条往上跳却没有数字，读起来像"我看错了"。回血也要有一声。
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
    // 答错 = 它多一层甲。这条机制把"不会"变成"打不动"，
    // 而不是变成扣血 —— 惩罚落在节奏上，不落在血量上。
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
  e.block = 0;
  const m = moveOf(e);

  if (m.k === 'atk' && G.turn === 1 && BAL.calmFirstTurn) {
    // 第一回合手里全是没答过的卡，玩家几乎叠不出格挡。给它留一个观察期，
    // 不然"答错"从第一回合起就是在拿血换。
    log(`${e.name} 还在观察你，这一回合没有出手`, 'hi');
    emit({ t: 'enemyAct', k: 'calm', n: 0 });
  } else if (m.k === 'atk') {
    const f = attackOf(e);
    let dmg = f.total;
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
    for (let i = 0; i < (m.n ?? 1); i++) G.discard.push(JUNK_ID);
    log(`${e.name} 往你的弃牌堆塞了 ${m.n} 张杂念`, 'bad');
    emit({ t: 'enemyAct', k: 'jam', n: m.n ?? 1 });
  } else if (m.k === 'buff') {
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

  if (G.pending === 'dead') setTimeout(() => { if (G.pending === 'dead') requestSettle(); }, 700);
}
