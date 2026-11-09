import { BAL, FOES, MODES } from '../model/data';
import { EFFS, resolveEff } from '../model/effects';
import type { CardInst, MapNode } from '../model/types';
import { G, checkPending, log, topTopic } from '../infra/state';
import { emit } from '../infra/events';
import { clamp, pick, shuffle } from '../infra/util';
import { poolFor } from '../library/bank';
import { memOf, saveMem } from '../library/memory';
import { shuffleOptions } from '../library/question';
import { defOf, hasPower, powerOf, statOf } from '../cards/registry';
import { canPay, costNow, isXCost, refundOf } from '../cards/cost';
import { cardKind } from '../cards/kinds';
import { settlePending } from '../journey/run';
import { drawCards, startTurn } from './deck';
import { makeFoe } from './foe';

/**
 * combat/play —— 一场战斗的开局，以及玩家出牌的全部路径。
 *
 * 出牌有三条路：答题（answer）、基础牌（playBasic）和增益牌（playPower）。
 * 前两条都把卡面数字经 `strikeWith` 结算，数值才不会出现"卡面和结算对不上"；
 * 增益牌不打伤害，只改本场规则。
 *
 * 三条路**都要先付得起**（`canPay`），也都要在付完之后才动牌堆 —— 一条先扣牌、
 * 再发现行动力不够的路径，会凭空吃掉玩家一张牌。
 *
 * 答题是**唯一**能吃到"答对"奖励的路径，而奖励只有两条：退回 1 点行动力、
 * 抽一张牌。都在机制内，没有第三层倍率 —— 卡面写的 8 点就是 8 点。
 * 原来的"答对解锁本场免答 ×1.5"整条删掉了，理由见 DESIGN.md。
 */
const join = (a: string, b: string) => (a ? a + ' ' : '') + b;

export function startBattle(nd: MapNode) {
  // 按「这一幕 + 这个节点类型」取怪：一幕一套物种，换幕就换一整套。
  // 找不到时回退到全表（自定义题库 / 调试场景），不让一场战斗因为数据缺失开不起来。
  const pool = FOES.filter((f) => f.stage === G.stage && f.type === nd.type);
  const e = makeFoe(pick(pool.length ? pool : FOES.filter((f) => f.type === nd.type)), nd.type, nd.r);

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

  // 战斗里只剩一种锁：这一回合答错过的卡种不能再答（每回合清空）。
  // "本场解锁"和"本场作废"两档都删了 —— 一场只有 3.3 回合，前者来不及兑现，
  // 后者等于没收工具。理由见 DESIGN.md 的「已经删掉的东西」。
  G.failedTurn = {};
  G.qSeen = {};
  G.answerDrawsThisTurn = 0;
  G.missDrawsThisTurn = 0;
  // 蠹蛾这类怪不封牌，它只是让你少看见一张：本场每回合的抽牌数 -1。
  // 记在场上而不是临时减 —— 手牌上限、抽牌动画、日志都得读同一个数。
  G.drawCut = e.mech === 'fog' ? (e.mechV ?? 1) : 0;
  G.apDown = 0;

  // 增益牌每场都要重新打一遍。这一行就是"遗物 → 牌"的整个差别所在。
  G.powers = [];
  // 行动力上限也要清回去：沙漏是"本场"的 +1，不清第二场就会凭空多 1 点
  G.apMax = BAL.baseAp;

  // 模式已经在顶栏标了一次，这一行不再复读。"卡是锁着的"只在第一次战斗里说：
  // 那是教学，不是战报 —— 打到第八层还在播同一句，就是把日志的位置浪费掉了。
  log(`── ${e.name} 出现了 ──`, 'turn');
  if ((G.node?.r ?? 0) === 0) log('点一张知识卡 = 答一道题；答对才打得出去', 'turn');
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

/**
 * 这张牌现在点下去会不会出题。
 *
 * 只有一条限制：这一回合这个卡种已经答错过。费用够不够是另一回事（`canPay`），
 * 两者都要过，点牌才算数 —— 所以战斗画面判定"能不能点"时两个都要问。
 */
export function canAsk(ent: CardInst | null | undefined): boolean {
  if (!ent) return false;
  const card = defOf(ent);
  // 与 askCard 用同一条取池规则：主题没题会回退到全部题目，别在这里把入口关掉
  if (cardKind(card) !== 'knowledge' || !poolFor(card.topic).list.length) return false;
  return !G.failedTurn[card.id];
}

/** 点一张知识卡 = 从题库里抽一道题。押注没了，所以点下去没有中间那一步。 */
export function askCard(idx: number) {
  if (G.busy || G.panel.k !== 'none') return;
  const ent = G.hand[idx];
  if (!ent) return;
  const card = defOf(ent);
  // 门前先看价：付不起的牌连题都不该弹出来 —— 让人答完一道题才发现打不出去，
  // 是最难受的一种白费力气。
  if (!canPay(card)) return;
  // 题库不限制主题：卡面主题没匹配到题池时，poolFor 会回退到全部题目。
  // 只要题库里还有一道题，任何知识卡都点得开。
  const { key, list } = poolFor(card.topic);
  if (cardKind(card) !== 'knowledge' || !list.length) return;
  // 这回合这个卡种已经答错过就不能再答 —— 不拦的话，看完答案用同种副本重答，
  // "每回合每种卡一次机会"这条规则就白设了
  if (G.failedTurn[card.id]) return;
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
 * 一张卡真正打出去的那一下。`mult` 现在是常数 1（答对就是全额，不再有
 * "免答 ×1.5"那种卡面之外的倍率），保留这个参数是因为 X 费的 `repeat` 走同一条路；
 * `repeat` 是 X 费牌花掉的点数 —— 一张牌结算几遍只看这一个参数，所以
 * "卡面写 8 点伤害 ×X"和实际打出的段数永远由同一份 `resolveEff` 决定。
 */
function strikeWith(ent: CardInst, mult: number, repeat = 1) {
  const card = defOf(ent);
  const st = statOf(ent);
  // card.mods 必须一起传：卡面（ui.ts）和答题面板（overlay.ts）都是按 mods 画的，
  // 结算漏掉它，带签名改动的 15 张卡就会「卡面写的」和「实际发生的」两张皮。
  const out = resolveEff(card.eff, st.atk, st.blk, mult, card.mods, repeat);
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

/**
 * 反伤。你打它一下，它回你一下 —— **格挡挡不住**，因为它不是攻击，
 * 是纸割手。这条机制只惩罚"数量"：一回合打三张 1 费牌，就挨三次；
 * 打一张 3 费牌，只挨一次。所以它逼的是"把伤害集中"。
 */
function thornsBack(dealt: number) {
  const e = G.enemy;
  if (!e || e.mech !== 'thorns' || dealt <= 0) return 0;
  const n = Math.min(G.hp - 1, e.mechV ?? BAL.mech.thorns);
  if (n <= 0) return 0;
  G.hp -= n;
  log(`${e.name} 的反伤：你受到 ${n} 点伤害`, 'bad');
  emit({ t: 'hurt', n });
  return n;
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
  /**
   * 这一手的价格。X 费牌按"此刻剩下的全部行动力"算，所以必须在一开局就定下来：
   * 后面的结算只会动血、动格挡、动牌堆，不会动行动力，但先定价再结算读起来才顺。
   */
  const xcost = isXCost(card);
  const spent = xcost ? G.ap : costNow(card);
  const repeat = xcost ? Math.max(1, spent) : 1;

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
    const r = strikeWith(ent, 1, repeat);
    hits = r.out.hits;
    dmg = r.dmg;
    absorbed = r.absorbed;
    blkGain = r.blk;
    heal = r.heal;
    drawn = r.drawn;
    parts = r.parts;
    if (xcost) apNote = join(apNote, `耗尽 ${spent} 点行动力，效果结算 ${repeat} 次。`);
    if (drawn) apNote = join(apNote, `专注：抽 ${drawn} 张。`);
    // 反伤在这张牌结算完之后收：先看见自己打了多少，再看见手上被割了一道。
    const back = thornsBack(dmg);
    if (back) apNote = join(apNote, `反伤：你受到 ${back} 点。`);

    // 答对抽一张：想起来的越多，这一回合看到的牌越多。走的是信息，不是倍率 ——
    // 所以卡面数值才能保持 1:1，不用再靠全局血量去补偿。
    //
    // 这条**默认关闭**，只有双面镜在场才开：实测把它做成常驻规则时，
    // 每回合白抽一张会把熟练档从 55% 抬到 66%、精通档抬到 95%（800 局），
    // 顶格没有余量。做成一张增益牌提供的规则之后，它便成了"这一场我选择多看见一点"
    // 的构筑决定，而不是人人都吃的隐形补强。
    const cap = hasPower('mirrorcard') ? BAL.answerDrawCap : 0;
    if (G.answerDrawsThisTurn < cap && drawCards(BAL.answerDraw)) {
      G.answerDrawsThisTurn += BAL.answerDraw;
      G.answerDraws += BAL.answerDraw;
      drawn += BAL.answerDraw;
      apNote = join(apNote, `答对：抽 ${BAL.answerDraw} 张（本回合 ${G.answerDrawsThisTurn}/${cap}）。`);
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
    } else {
      // 复习 / 测试：这张牌进弃牌堆，这一场它不再自动回来 —— 想再见它得等洗牌。
      apNote = join(apNote, '它进了弃牌堆，要等洗牌才回来。');
    }

    // 补抽一张：答错的那张牌要离开手牌，不补位的话，一个中等正确率的人两回合就把手牌
    // 打空了 —— 那时他不是"答不对"，是"没牌可答"。补的是位置，不是奖励：
    // 这一手照样作废、行动力照样不退。
    if (BAL.missDraw && G.missDrawsThisTurn < BAL.missDrawCap) {
      const got = drawCards(BAL.missDraw);
      if (got) {
        G.missDrawsThisTurn += got;
        drawn += got;
        apNote = join(apNote, `补抽 ${got} 张 —— 位置不空着。`);
      }
    }

    G.topicWrong[card.topic] = (G.topicWrong[card.topic] || 0) + 1;
    G.runBad += 1;
    m.lapses += 1;
    m.bad += 1;
    if (spent > 1) apNote = join(apNote, `这一手花掉的 ${spent} 点行动力不退。`);

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
      } else if (G.enemy.mech === 'bulwark') {
        // 答错 = 它多一层甲。这条机制把"不会"变成"打不动"，
        // 而不是变成扣血 —— 惩罚落在节奏上，不落在血量上。
        const n = G.enemy.mechV ?? BAL.mech.bulwark;
        G.enemy.block += n;
        apNote = join(apNote, `它趁机加固：获得 ${n} 点格挡。`);
        log(`${G.enemy.name} 加固了 ${n} 点格挡`, 'bad');
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

  // 节奏结算：先付整份费用，答对再退回 1 点 —— 不是全退。
  //
  // 1 费牌答对等于免费，和引入费用之前的规则完全一样；2 费净花 1 点、3 费净花 2 点。
  // 所以行动力同时买两样东西：犯错的机会，和一次打得更重的机会。
  // （改成全退，高费牌会变成"同样免费、输出三倍"的纯优化，牌组会一路收敛到最贵的那几张。）
  G.ap -= spent;
  G.cardsPlayed += 1;
  const back = right ? refundOf(spent) : 0;
  if (back > 0) {
    G.ap += back;
    // 这条不进日志，进反馈面板：它是这一版唯一的经济规则，玩家得看得到
    apNote = join(apNote, back >= spent
      ? '答对了，这一手不花行动力。'
      : `答对了，退回 ${back} 点 —— 这张牌净花 ${spent - back} 点。`);
  }

  // 装订线：每回合第一次答错把这一整手退回来。答错的代价是"这回合少一张牌"，
  // 而不是"这回合什么都没发生" —— 这张牌买的就是一次容错。
  // 退的是整份费用：正因为如此，它在一副高费牌里比在一副 1 费牌里值钱得多。
  if (!right && hasPower('binder') && !G.binderUsed) {
    G.binderUsed = true;
    G.ap += spent;
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
  const missNote = backToDraw ? '，牌回牌堆' : '，进弃牌堆';
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
      idx, qi, choice, right,
      dmg, absorbed, blk: blkGain, eff: card.eff, hits, heal, draw: drawn, apNote,
      explain: q.explain, question: q.q, options: view.options, answer: view.answer,
      topic: card.topic,
    },
  };
}

/**
 * 打出一张增益牌：付它标的费用，本场战斗剩下的时间里一直亮着。
 *
 * 它**不进弃牌堆**。洗回去的话，同一张牌每洗一次就能再打一次，
 * 一个"本场持续"的增益会变成无限叠加。所以它从手牌里直接消失，本场不再回到循环。
 * 这也是"每场都要重新打一遍"这条规则的物理实现 —— 跨场时 G.powers 被清空。
 *
 * 这笔钱不退：增益牌不出题，没有"答对"这回事。所以一张 2 费的索引卡是一次
 * 实打实的节奏投资，值不值取决于这一场还要打几个回合。
 */
export function playPower(idx: number) {
  if (G.busy || G.panel.k !== 'none') return;
  const ent = G.hand[idx];
  if (!ent) return;
  const card = defOf(ent);
  const p = powerOf(card);
  if (!p) return;
  if (hasPower(p.id)) return;
  if (!canPay(card)) return;

  const spent = costNow(card);
  G.ap -= spent;
  G.cardsPlayed += 1;
  G.powers.push(p.id);
  G.hand.splice(idx, 1);

  // 打出那一下要有一点即时回报，否则"花行动力上一个以后才生效的东西"永远是最差的一手
  let note = '';
  let blk = 0;
  if (p.id === 'hourglass') {
    // 上限和当前值一起涨：1 费的沙漏等于免费，之后每回合都多一次出手
    G.apMax += 1;
    G.ap += 1;
    note = '行动力上限 +1，这一手等于不花行动力。';
  } else if (p.id === 'index') {
    if (drawCards(1)) note = '抽 1 张。';
  } else if (p.id === 'lamp') {
    blk = BAL.lampBlock;
    G.block += blk;
    note = `获得 ${blk} 点格挡。`;
  } else if (p.id === 'mirrorcard') {
    // 它不改数值，只把"答对抽牌"的上限从 2 抬到 3 —— 效果在 answer() 里读 hasPower。
    // 之所以做成"改规则"而不是"当场发一次收益"：增益牌本来就是本场持续的东西。
    note = '本场答对后抽 1 张（每回合一次）。';
  }
  G.ap = clamp(G.ap, 0, 10);

  log(`打出增益「${p.name}」${spent ? `（${spent} 点）` : ''}—— ${p.card}${note ? ` ${note}` : ''}`, 'hi');
  if (blk) setTimeout(() => emit({ t: 'blk', n: blk }), 60);
  emit({ t: 'power', id: p.id });

  // 短锁一下输入：否则连点会把同一张牌所在的位置误判成下一张
  G.busy = true;
  setTimeout(() => { G.busy = false; }, 180);
}

/**
 * 打出一张**基础牌**：初始牌组里的那三张，不答题、不退款、不进记忆调度。
 *
 * 它是这一局的地板：答错、抽到的全是够不着的知识卡时，
 * 玩家至少还能把行动力换成一点伤害或格挡，不至于整回合空转。
 * 数值刻意低于知识卡 —— 保底 ≠ 变强。**而且它和知识卡一样花 1 点**：
 * 拿这一回合的答题机会换一点保底输出，这才是"地板"该有的价钱。
 */
export function playBasic(idx: number) {
  if (G.busy || G.panel.k !== 'none') return;
  const ent = G.hand[idx];
  if (!ent) return;
  const card = defOf(ent);
  if (cardKind(card) !== 'basic') return;
  if (!canPay(card)) return;

  const spent = costNow(card);
  const r = strikeWith(ent, 1);
  thornsBack(r.dmg);
  G.ap -= spent;
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
    settlePending();
  }, 200);
}

