import { BAL, FOES, MODES } from '../model/data';
import { EFFS, resolveEff } from '../model/effects';
import type { CardInst, MapNode } from '../model/types';
import { G, checkPending, log, topTopic } from '../infra/state';
import { emit } from '../infra/events';
import { clamp, pick, shuffle } from '../infra/util';
import { poolFor } from '../library/bank';
import { memOf, saveMem } from '../library/memory';
import { shuffleOptions } from '../library/question';
import { defOf, hasPower, isBasicCardId, isPowerId, powerOf, statOf } from '../cards/registry';
import { cardKind } from '../cards/kinds';
import { endRun } from '../journey/report';
import { openReward } from '../journey/rewards';
import { drawCards, startTurn } from './deck';
import { makeFoe } from './foe';
import { isUnlocked, unlockStats } from './unlock';

/**
 * combat/play —— 一场战斗的开局，以及玩家出牌的全部路径。
 *
 * 出牌有三条路：答题（answer）、免答（playUnlocked）、快攻（quickPlay），
 * 还有一条不打伤害的增益牌（playPower）。前三条都从 `strikeWith` 走，
 * 数值才不会出现"卡面和结算对不上"。
 */
const join = (a: string, b: string) => (a ? a + ' ' : '') + b;

export function startBattle(nd: MapNode) {
  const pool = FOES.filter((f) => f.type === nd.type);
  const e = makeFoe(pick(pool.length ? pool : FOES), nd.type, nd.r);

  G.screen = 'battle';
  G.enemy = e;
  G.panel = { k: 'none' };
  G.pending = null;
  G.busy = false;
  G.turn = 1;
  G.okThisTurn = 0;
  G.topOkTopic = null;
  G.cardsPlayed = 0;
  G.binderUsed = false;
  G.draw = shuffle(G.deck);
  G.discard = [];
  G.hand = [];

  // 全部上锁，只有精炼过的卡例外 —— 精炼 = 这个知识已经证明过，开局就能用
  G.unlocked = {};
  G.failedTurn = {};
  G.forgotten = {};
  G.qSeen = {};
  G.deck.forEach((ent) => { if (ent.up) G.unlocked[ent.id] = true; });

  // 增益牌每场都要重新打一遍。这一行就是"遗物 → 牌"的整个差别所在。
  G.powers = [];
  // 行动力上限也要清回去：沙漏是"本场"的 +1，不清第二场就会凭空多 1 点
  G.apMax = BAL.baseAp;

  log(`── ${e.name} 出现了 · ${MODES[G.mode].name}模式 ──`, 'turn');
  const pre = unlockStats().n;
  if (pre) log(`${pre} 张精炼过的卡开局即可使用`, 'hi');
  else log('所有卡都是锁着的 —— 答对才能解锁', 'turn');
  // 开局格挡在 startTurn 里给（那里才知道是不是第一回合）—— 写在这里会被 startTurn 清零
  startTurn();
}

/**
 * 从题池里挑一道，优先问本场还没问过的 —— 同一个池被从不同角度问过几次，
 * 和只蒙对一道题，含金量不一样。`key` 是 `G.qSeen` 的分桶键：
 * 主题池用自己的主题名，回退池用 `GLOBAL_QKEY`，两条路互不串号。
 *
 * 题池来自外部的 md 题库，卡面里没有题；直到玩家点开牌，这里才第一次碰题目。
 */
function pickQi(key: string, n: number): number {
  if (n <= 1) return 0;
  const seen = G.qSeen[key] || [];
  const fresh: number[] = [];
  for (let i = 0; i < n; i++) if (seen.indexOf(i) < 0) fresh.push(i);
  const pool = fresh.length ? fresh : Array.from({ length: n }, (_, i) => i);
  return pool[Math.floor(Math.random() * pool.length)];
}

/** 点一张锁着的牌 = 从题库里抽一道题。押注没了，所以点下去没有中间那一步。 */
export function askCard(idx: number) {
  if (G.busy || G.panel.k !== 'none' || G.ap <= 0) return;
  const ent = G.hand[idx];
  if (!ent) return;
  const card = defOf(ent);
  // 题库不限制主题：卡面主题没匹配到题池时，poolFor 会回退到全部题目。
  // 只要题库里还有一道题，任何知识卡都点得开。
  const { key, list } = poolFor(card.topic);
  if (cardKind(card) !== 'knowledge' || !list.length) return;
  // 已解锁的卡不出题，走 playUnlocked；这回合答错过、或整场已作废的卡种也不能再答
  if (G.unlocked[card.id] || G.failedTurn[card.id] || G.forgotten[card.id]) return;
  const qi = pickQi(key, list.length);
  // 题号在"点开"这一下就记下，不等答完。否则玩家可以点开看一眼、Esc 关掉、再点开换一道，
  // 等于免费挑题 —— 和押注时代"读完三档再挑最好答的那道"是同一个漏洞。
  G.qSeen[key] = (G.qSeen[key] || []).concat([qi]);
  const q = list[qi];
  // 题目快照挂在 Panel 上：答题期间就算换了题库，这一手也不会跟着变。
  // 选项每次点开都重新排，判定与反馈面板一律读 view。
  G.panel = { k: 'question', idx, qi, topic: card.topic, q, view: shuffleOptions(q) };
}

export function cancelPanel() {
  if (G.panel.k === 'question' || G.panel.k === 'deck' || G.panel.k === 'pile'
      || G.panel.k === 'help' || G.panel.k === 'pack' || G.panel.k === 'mode') {
    G.panel = { k: 'none' };
  }
}

function damageEnemy(raw: number, pierce = false) {
  const e = G.enemy!;
  let n = raw;
  let absorbed = 0;
  // 洞察绕过格挡：连"被吸收"这件事都不会发生，敌人那层防御直接不参与结算
  if (!pierce && e.block > 0) { absorbed = Math.min(e.block, n); e.block -= absorbed; n -= absorbed; }
  e.hp -= n;
  return { dealt: n, absorbed };
}

/**
 * 一张卡真正打出去的那一下。mult 是倍率（未解锁的答题出牌传 1，
 * 已解锁的免答出牌传 BAL.freeMult）。答题、免答、快攻三条路都从这里走，
 * 数值才不会出现"卡面和结算对不上"。
 */
function strikeWith(ent: CardInst, mult: number) {
  const card = defOf(ent);
  const st = statOf(ent);
  // card.mods 必须一起传：卡面（ui.ts）和答题面板（overlay.ts）都是按 mods 画的，
  // 结算漏掉它，带签名改动的 15 张卡就会「卡面写的」和「实际发生的」两张皮。
  const out = resolveEff(card.eff, st.atk, st.blk, mult, card.mods);
  const parts: { d: number; a: number }[] = [];
  let dmg = 0;
  let absorbed = 0;
  for (const hit of out.hits) {
    const r = damageEnemy(hit, out.pierce);
    dmg += r.dealt;
    absorbed += r.absorbed;
    parts.push({ d: r.dealt, a: r.absorbed });
  }
  if (out.blk) G.block += out.blk;
  let heal = 0;
  let drawn = 0;
  if (out.healRatio > 0) {
    heal = Math.max(1, Math.round(dmg * out.healRatio));
    G.hp = Math.min(G.maxHp, G.hp + heal);
  }
  if (out.draw > 0) drawn = drawCards(out.draw);
  return { out, dmg, absorbed, blk: out.blk, heal, drawn, parts };
}

export function answer(choice: number) {
  if (G.panel.k !== 'question' || G.busy) return;
  const { idx, qi, q, view } = G.panel;
  const ent = G.hand[idx];
  if (!ent) return;
  const card = defOf(ent);
  // 键盘数字键会直接打进来，越界的选项不算答错 —— 手滑按到 9 不该扣行动力
  if (!Number.isInteger(choice) || choice < 0 || choice >= view.options.length) return;
  // 判定只看本次打乱后的视图。回头读 t.answer 会「点对了却算错」。
  const right = choice === view.answer;
  const m = memOf(card.id);
  const st = statOf(ent);
  /** 这一局的答错价码。开局前选好，整局不变 —— 不再看这张卡自己到了哪个阶段。 */
  const M = MODES[G.mode];

  let dmg = 0;
  let blkGain = 0;
  let absorbed = 0;
  let heal = 0;
  let drawn = 0;
  let hits: number[] = [];
  let parts: { d: number; a: number }[] = [];
  let apNote = '';
  /** 学习模式答错的牌退回抽牌堆而不是进弃牌堆 */
  let backToDraw = false;

  if (right) {
    const r = strikeWith(ent, 1);
    hits = r.out.hits;
    dmg = r.dmg;
    absorbed = r.absorbed;
    blkGain = r.blk;
    heal = r.heal;
    drawn = r.drawn;
    parts = r.parts;
    if (drawn) apNote = join(apNote, `专注：抽 ${drawn} 张。`);

    // 答对就是解锁：之后这个卡种的所有副本都可以免答打出（×BAL.freeMult）
    if (!G.unlocked[card.id]) {
      G.unlocked[card.id] = true;
      G.unlocks += 1;
      apNote = join(apNote, `「${card.topic}」已解锁，本场免答可用。`);
    }

    G.okThisTurn += 1;
    G.runOk += 1;
    // 记的是"本回合答对了哪个主题"，不是计数：遗忘了的 -3 是当回合的，
    // 而且 topTopic() 可能在同一回合里被新的错误改写，结算时要重新对一次。
    if (card.topic === topTopic()) G.topOkTopic = card.topic;
    m.reps += 1;
    m.ok += 1;
    // 答对也涨稳固度，但涨多少看模式：测试模式是"检索练习"，记得更牢；
    // 学习模式是第一次接触，涨得最少。1 = 原来的 ×1.8 / +1。
    m.stab = Math.min(60, Math.max(m.stab * (1 + 0.8 * M.stabGain), m.stab + M.stabGain));
    m.due = Math.round(m.stab);
    // 荧光笔：本回合第一道答对才给牌。答对本来就是目标，所以它不给"额外奖励"，
    // 它奖励的是"这一回合你先答对了什么"这个顺序。
    if (hasPower('marker') && G.okThisTurn === 1 && drawCards(1)) {
      drawn += 1;
      apNote = join(apNote, '荧光笔：本回合第一道答对，抽 1 张。');
    }
  } else {
    // 答错的价码由本局模式决定：学习/复习/测试三档，开局前玩家自己选。
    // 三条都不碰血量：扣血会让人不敢碰不会的知识，正好和目的相反。
    G.failedTurn[card.id] = true;
    blkGain = Math.max(0, Math.round(st.blk * M.missBlock));
    if (blkGain) {
      G.block += blkGain;
      apNote = join(apNote, `答错也挡住了 ${blkGain} 点。`);
    } else {
      apNote = join(apNote, '测试模式：这次答错没有格挡补偿。');
    }

    if (M.missDest === 'draw') {
      // 学习：牌不进弃牌堆，回抽牌堆 —— 下一回合你一定会再抽到它。
      // 惩罚只剩"这一手作废"，不没收工具：还在学的东西，该让你再试一次。
      backToDraw = true;
      apNote = join(apNote, '学习模式：牌回到牌堆，下一回合会再抽到它。');
    } else if (M.forget) {
      // 测试：这个卡种本场作废。还能快攻，但不能再答题 —— 错了就是错了。
      G.forgotten[card.id] = true;
      apNote = join(apNote, '测试模式：这个卡种本场作废，只能快攻。');
    } else {
      // 复习：这张牌进弃牌堆，这一场它不再自动回来 —— 想再见它得等洗牌。
      apNote = join(apNote, '复习模式：它进了弃牌堆，要等洗牌才回来。');
    }

    G.topicWrong[card.topic] = (G.topicWrong[card.topic] || 0) + 1;
    G.runBad += 1;
    m.lapses += 1;
    m.bad += 1;

    // 以失误为食的敌人机制。挂在"答错"这个动作上而不是敌人回合上，
    // 因为它们惩罚的正是"这次答错"本身。
    if (G.enemy) {
      if (G.enemy.mech === 'leech') {
        const n = Math.min(4, G.enemy.maxHp - G.enemy.hp);
        if (n > 0) {
          G.enemy.hp += n;
          apNote = join(apNote, `书蛀啃食这次失误，回复 ${n} 点。`);
          log(`书蛀啃食你的失误，回复 ${n} 点`, 'bad');
        }
      } else if (G.enemy.mech === 'lethe') {
        G.enemy.dmg += 1;
        apNote = join(apNote, '忘川吞下这次遗忘：它的攻击永久 +1。');
        log('忘川吞下这次遗忘，攻击 +1', 'bad');
      }
    }

    // 稳固度按模式掉：学习最轻、测试最狠。到期也提前 —— 惩罚不靠扣血警告，靠日程。
    // 测试模式直接 due=0：下一局它会被排到最前面。
    m.stab = Math.max(1, m.stab * M.stabDrop);
    m.due = G.mode === 'test' ? 0 : 1;
    if (hasPower('log')) {
      const cur = G.topicAtk[card.topic] || 0;
      if (cur < 6) { G.topicAtk[card.topic] = cur + BAL.logAtk; apNote = join(apNote, `错题本：「${card.topic}」攻击 +1。`); }
    }
  }

  // 节奏结算：一张牌 1 点。答对把这一手退回来 —— 行动力买的不是"出牌次数"，
  // 而是"犯错次数"：会的人这一回合能把整把手牌打完，不会的人打三张就没油了。
  G.ap -= 1;
  G.cardsPlayed += 1;
  if (right && BAL.refundRight) {
    G.ap += 1;
    // 这条不进日志，进反馈面板：它是这一版唯一的经济规则，玩家得看得到
    apNote = join(apNote, '答对了，这一手不花行动力。');
  }

  // 装订线：每回合第一次答错把这一手退回来。答错的代价是"这回合少一张牌"，
  // 而不是"这回合什么都没发生" —— 这张牌买的就是一次容错。
  if (!right && hasPower('binder') && !G.binderUsed) {
    G.binderUsed = true;
    G.ap += 1;
    apNote = join(apNote, '装订线：这次答错不花行动力。');
  }
  G.ap = clamp(G.ap, 0, 10);

  G.busy = true;
  // 学习模式答错的牌回抽牌堆（push 到尾部 = 下一张抽到的就是它）；其余都进弃牌堆
  if (backToDraw) G.draw.push(ent);
  else G.discard.push(ent);
  G.hand.splice(idx, 1);
  saveMem();

  const effName = EFFS[card.eff].name;
  const shape = hits.length > 1 ? `${hits.join('+')} 伤害` : `${dmg} 伤害`;
  const missNote = backToDraw ? '，牌回牌堆' : G.forgotten[card.id] ? '，本场作废' : '，进弃牌堆';
  log(
    `「${effName}·${card.topic}」${right ? '答对' : '答错'}` +
      (right
        ? `，${shape}${absorbed ? `（${absorbed} 被挡）` : ''}` +
          (blkGain ? `，${blkGain} 格挡` : '') +
          (heal ? `，回 ${heal}` : '') +
          (drawn ? `，抽 ${drawn}` : '')
        : `，效果作废${blkGain ? `，${blkGain} 格挡` : '，无格挡补偿'}${missNote}`),
    right ? 'hi' : 'bad',
  );

  checkPending();

  // 串联是两下，光刃和飘字都要分两次落地，否则玩家读不出"打了两段"。
  // 第一下同步发出：表现层要靠它在本帧就知道"这一手打出去了"，
  // 反馈面板才会等演出演完再弹出来（见 main.ts 的 panelHold）。
  if (right) {
    parts.forEach((p, i) => {
      const fire = () => emit({ t: 'dmg', n: p.d, absorbed: p.a, eff: card.eff, seq: i });
      if (i === 0) fire(); else setTimeout(fire, i * 150);
    });
  } else {
    // 答错不是"什么都没发生"：抬手、甩出去、半路散掉。
    // 这一步只能由逻辑层发起（只有它知道答错了），怎么演交给表现层。
    emit({ t: 'fizzle', eff: card.eff });
  }
  const base = parts.length * 150;
  // 答错时格挡补偿稍晚一点出场：先让玩家看见"焰灭了"，再看见"但还是挡住了 3 点"。
  // 两个数字同时冒出来，会读成"答错也有收益"，把失败感冲掉。
  if (blkGain) setTimeout(() => emit({ t: 'blk', n: blkGain }), base + (right ? 60 : 220));
  if (heal) setTimeout(() => emit({ t: 'heal', n: heal }), base + 60);

  G.panel = {
    k: 'feedback',
    fb: {
      idx, qi, choice, right, quick: false,
      dmg, absorbed, blk: blkGain, eff: card.eff, hits, heal, draw: drawn, apNote,
      explain: q.explain, question: q.q, options: view.options, answer: view.answer,
      topic: card.topic,
    },
  };
}

/**
 * 已解锁的卡种直接打出去：不出题、不写记忆、伤害按 BAL.freeMult 放大。
 *
 * 这是"答对了之后这场战斗里它就归你"的那一半。没有反馈面板 —— 收割阶段
 * 要快，一下接一下，中间不能再插一个要按的框。
 */
export function playUnlocked(idx: number) {
  if (G.busy || G.panel.k !== 'none' || G.ap <= 0) return;
  const ent = G.hand[idx];
  if (!ent) return;
  const card = defOf(ent);
  if (cardKind(card) !== 'knowledge' || !isUnlocked(card.id)) return;

  const r = strikeWith(ent, BAL.freeMult);
  G.ap -= 1;
  G.cardsPlayed += 1;
  G.frees += 1;
  G.ap = clamp(G.ap, 0, 10);

  G.discard.push(ent);
  G.hand.splice(idx, 1);
  checkPending();

  const shape = r.out.hits.length > 1 ? `${r.out.hits.join('+')} 伤害` : `${r.dmg} 伤害`;
  log(
    `「${EFFS[card.eff].name}·${card.topic}」免答 ×${BAL.freeMult} —— ${shape}` +
      (r.blk ? `，${r.blk} 格挡` : '') +
      (r.heal ? `，回 ${r.heal}` : '') +
      (r.drawn ? `，抽 ${r.drawn}` : ''),
    'hi',
  );

  r.parts.forEach((p, i) => {
    const fire = () => emit({ t: 'dmg', n: p.d, absorbed: p.a, eff: card.eff, seq: i });
    if (i === 0) fire(); else setTimeout(fire, i * 150);
  });
  if (r.blk) setTimeout(() => emit({ t: 'blk', n: r.blk }), 60);
  if (r.heal) setTimeout(() => emit({ t: 'heal', n: r.heal }), 60);

  // 没有反馈面板兜底，得自己锁一小会儿输入：不然连点会误花第二点行动力，
  // 而且这一下还没演完就接了下一手。顺带把击杀后的推进接上。
  G.busy = true;
  setTimeout(() => {
    G.busy = false;
    if (G.pending === 'clear') openReward();
    else if (G.pending === 'win') endRun(true);
    else if (G.pending === 'dead') endRun(false);
  }, 240);
}

/**
 * 打出一张增益牌：花 1 点行动力，本场战斗剩下的时间里一直亮着。
 *
 * 它**不进弃牌堆**。洗回去的话，同一张牌每洗一次就能再打一次，
 * 一个"本场持续"的增益会变成无限叠加。所以它从手牌里直接消失，本场不再回到循环。
 * 这也是"每场都要重新打一遍"这条规则的物理实现 —— 跨场时 G.powers 被清空。
 */
export function playPower(idx: number) {
  if (G.busy || G.panel.k !== 'none' || G.ap <= 0) return;
  const ent = G.hand[idx];
  if (!ent) return;
  const card = defOf(ent);
  const p = powerOf(card);
  if (!p) return;
  if (hasPower(p.id)) return;

  G.ap -= 1;
  G.cardsPlayed += 1;
  G.powers.push(p.id);
  G.hand.splice(idx, 1);

  // 打出那一下要有一点即时回报，否则"花 1 点上一个以后才生效的东西"永远是最差的一手
  let note = '';
  let blk = 0;
  if (p.id === 'hourglass') {
    // 上限和当前值一起涨：这一手等于免费，之后每回合都多一次出手
    G.apMax += 1;
    G.ap += 1;
    note = '行动力上限 +1，这一手不花行动力。';
  } else if (p.id === 'index') {
    if (drawCards(1)) note = '抽 1 张。';
  } else if (p.id === 'lamp') {
    blk = BAL.lampBlock;
    G.block += blk;
    note = `获得 ${blk} 点格挡。`;
  } else if (p.id === 'mirrorcard') {
    // 只照"知识卡"：基础牌不是靠答对解锁的，照到它等于给一个空奖励
    const ids = [...new Set(G.deck.map((e) => e.id))]
      .filter((id) => !G.unlocked[id] && !isPowerId(id) && !isBasicCardId(id));
    if (ids.length) {
      const id = pick(ids);
      G.unlocked[id] = true;
      G.unlocks += 1;
      note = `「${defOf({ id, up: 0 }).topic}」已解锁。`;
    }
  }
  G.ap = clamp(G.ap, 0, 10);

  log(`打出增益「${p.name}」—— ${p.card}${note ? ` ${note}` : ''}`, 'hi');
  if (blk) setTimeout(() => emit({ t: 'blk', n: blk }), 60);
  emit({ t: 'power', id: p.id });

  // 短锁一下输入：否则连点会把同一张牌所在的位置误判成下一张
  G.busy = true;
  setTimeout(() => { G.busy = false; }, 180);
}

/**
 * 打出一张**基础牌**：初始牌组里的那三张，不答题、不退款、不进记忆调度。
 *
 * 它是这一局的地板：答错、卡种作废、抽到的全是够不着的知识卡时，
 * 玩家至少还能把行动力换成一点伤害或格挡，不至于整回合空转。
 * 数值刻意低于知识卡 —— 保底 ≠ 变强。
 */
export function playBasic(idx: number) {
  if (G.busy || G.panel.k !== 'none' || G.ap <= 0) return;
  const ent = G.hand[idx];
  if (!ent) return;
  const card = defOf(ent);
  if (cardKind(card) !== 'basic') return;

  const r = strikeWith(ent, 1);
  G.ap -= 1;
  G.cardsPlayed += 1;
  G.ap = clamp(G.ap, 0, 10);

  G.discard.push(ent);
  G.hand.splice(idx, 1);
  checkPending();

  const shape = r.out.hits.length > 1 ? `${r.out.hits.join('+')} 伤害` : `${r.dmg} 伤害`;
  log(
    `「${card.name}」${r.dmg ? shape : ''}${r.blk ? `${r.dmg ? '，' : ''}${r.blk} 格挡` : ''}` +
      '（基础牌，不答题）',
    '',
  );

  // 纯防御的基础牌没有伤害段：不发光刃，只飘格挡
  if (r.dmg > 0) {
    r.parts.forEach((p, i) => {
      const fire = () => emit({ t: 'dmg', n: p.d, absorbed: p.a, eff: card.eff, seq: i });
      if (i === 0) fire(); else setTimeout(fire, i * 150);
    });
  }
  if (r.blk) setTimeout(() => emit({ t: 'blk', n: r.blk }), 60);

  G.busy = true;
  setTimeout(() => {
    G.busy = false;
    if (G.pending === 'clear') openReward();
    else if (G.pending === 'win') endRun(true);
    else if (G.pending === 'dead') endRun(false);
  }, 200);
}

export function quickPlay(idx: number) {
  if (G.busy || G.panel.k !== 'none' || G.ap <= 0) return;
  const ent = G.hand[idx];
  if (!ent) return;
  const card = defOf(ent);
  if (cardKind(card) !== 'knowledge') return;

  const dmg = Math.floor(statOf(ent).atk / 2);
  damageEnemy(dmg);
  // 快攻没有"答对"，所以拿不到那一手退款 —— 绕过去也要付钱，只是付得少
  G.ap -= 1;
  G.cardsPlayed += 1;
  G.ap = clamp(G.ap, 0, 10);
  G.busy = true;
  G.discard.push(ent);
  G.hand.splice(idx, 1);
  log(`快攻「${card.topic}」，${dmg} 点伤害（未计入复习）`, '');
  checkPending();
  emit({ t: 'dmg', n: dmg, absorbed: 0, eff: card.eff, seq: 0 });

  G.panel = {
    k: 'feedback',
    fb: {
      idx, qi: 0, choice: -1, right: false, quick: true,
      dmg, absorbed: 0, blk: 0, eff: 'strike', hits: [dmg], heal: 0, draw: 0, apNote: '',
      explain: '它明年还是这个强度——你只是绕过去了，没有变强。',
      question: '快攻', options: [], answer: -1, topic: card.topic,
    },
  };
}
