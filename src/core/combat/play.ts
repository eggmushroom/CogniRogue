import { BAL, FOES, MODES } from '../model/data';
import { EFFS, resolveEff } from '../model/effects';
import type { CardId, MapNode } from '../model/types';
import { G, checkPending, log, topTopic } from '../infra/state';
import { emit } from '../infra/events';
import { clamp, pick, shuffle } from '../infra/util';
import { stagePool } from '../library/stage';
import { floorOf } from '../map/gen';
import { recordAnswer } from '../library/stagemem';
import { memOf, saveMem } from '../library/memory';
import { shuffleOptions } from '../library/question';
import { defOf, hasPower, powerOf, statOf } from '../cards/registry';
import { canPay, costNow, isXCost, refundOf } from '../cards/cost';
import { cardGrade, gradeNeed, needsAsk } from '../cards/grade';
import { cardKind } from '../cards/kinds';
import { drawCards, startTurn } from './deck';
import { makeFoe, onPlayerMiss } from './foe';
import { requestSettle } from './pending';
import { drawBattleQuestions, takeQuestion } from './questions';

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
  // 层号从**节点自己的坐标**算，不读 G 里的当前进度：测试和调试会直接把节点塞进来，
  // 那时 G.pos 还停在上一个节点上，读它就会把怪的强度按错层算。
  const e = makeFoe(
    pick(pool.length ? pool : FOES.filter((f) => f.type === nd.type)),
    floorOf(G.stage, nd.r),
  );

  G.screen = 'battle';
  G.enemy = e;
  G.panel = { k: 'none' };
  G.pending = null;
  G.busy = false;
  G.turn = 1;
  G.draw = shuffle(G.deck);
  G.discard = [];
  G.hand = [];

  // 本场要清的是免答计数和题池。答错不扣行动力、也不封牌：
  // 代价落在"本场新题少一道"上，新题用完后进入复用（见 combat/questions.ts）。
  G.charge = {};
  drawBattleQuestions();
  // 蠹蛾这类怪不封牌，它只是让你少看见一张：本场每回合的抽牌数 -1。
  // 记在场上而不是临时减 —— 手牌上限、抽牌动画、日志都得读同一个数。
  G.drawCut = e.mech === 'fog' ? (e.mechV ?? BAL.mech.fog) : 0;
  G.apDown = 0;

  // 增益牌每场都要重新打一遍。这一行就是"遗物 → 牌"的整个差别所在。
  G.powers = [];
  // 行动力上限也要清回去：沙漏是"本场"的 +1，不清第二场就会凭空多 1 点
  G.apMax = BAL.baseAp;

  // 模式已经在顶栏标了一次，这一行不再复读。"卡是锁着的"只在第一次战斗里说：
  // 那是教学，不是战报 —— 打到第八层还在播同一句，就是把日志的位置浪费掉了。
  log(`── ${e.name} 出现了 ──`, 'turn');
  if ((G.node?.r ?? 0) === 0) {
    log(`这一场准备了 ${G.qLeft.length} 道新题；C 牌免答，B/A/S 各要答对 1/2/3 次。新题用完会复用问得最少的题`, 'turn');
  }
  // 开局格挡在 startTurn 里给（那里才知道是不是第一回合）—— 写在这里会被 startTurn 清零
  startTurn();
}

/**
 * 这张知识卡此刻的状态，给卡面和点击路由用（也是"能不能问"的唯一判断）：
 *
 *   'free'   等级已攒满，这一场直接打，不出题
 *   'ask'    还要答题
 *   'empty'  要答题，但这一章一道题都没有（题库载入失败时的兜底）
 *   'other'  不是知识卡
 *
 * **不读 `qLeft`**：本场新题用完不会锁牌，`takeQuestion` 会进入复用路径。
 * 所以"还剩几道新题"（顶栏读数）和"这张牌能不能点"是两个问题。
 */
export function cardAskState(id: CardId | null | undefined): 'free' | 'ask' | 'empty' | 'other' {
  if (!id) return 'other';
  const card = defOf(id);
  if (cardKind(card) !== 'knowledge') return 'other';
  if (!needsAsk(id, G.charge)) return 'free';
  return stagePool().length ? 'ask' : 'empty';
}

/** 这张牌现在点下去会不会出题。费用是另一回事（`canPay`）。 */
export const canAsk = (id: CardId | null | undefined): boolean => cardAskState(id) === 'ask';

/**
 * 等级攒满之后直接打出去：和答对走同一条 `strikeWith`，只是不抽题、不判对错。
 *
 * 它**不扣行动力之外的东西**，也不进答题流水 —— 这一手没有"答对/答错"这回事。
 * 反馈用日志，不弹反馈面板：没有题就没有解析可读，弹一个空面板只是打断节奏。
 */
export function playFree(idx: number) {
  if (G.busy || G.panel.k !== 'none') return;
  const id = G.hand[idx];
  if (!id) return;
  const card = defOf(id);
  if (cardKind(card) !== 'knowledge') return;
  // 免答是"已经攒够了"才有的待遇。没攒够的牌不能从这条路绕过去 ——
  // 模拟和界面都可能误调，规则要在这里守一次。
  if (needsAsk(id, G.charge)) return;
  if (!canPay(card)) return;

  const xcost = isXCost(card);
  const spent = xcost ? G.ap : costNow(card);
  const repeat = xcost ? Math.max(1, spent) : 1;
  const r = strikeWith(id, 1, repeat);
  const back = thornsBack(r.out.hits);

  G.ap -= spent;
  G.ap = clamp(G.ap, 0, 10);
  G.discard.push(id);
  G.hand.splice(idx, 1);
  checkPending();

  const shape = r.out.hits.length > 1 ? `${r.out.hits.join('+')} 伤害` : `${r.dmg} 伤害`;
  log(
    `「${card.name}」${r.dmg ? shape : ''}${r.blk ? `${r.dmg ? '，' : ''}${r.blk} 格挡` : ''}` +
      `（${cardGrade(card)} 级，这一场已免答${back ? `；反伤 ${back}` : ''}）`,
    'hi',
  );
  if (r.dmg > 0) {
    r.parts.forEach((p, i) => {
      const fire = () => emit({ t: 'dmg', n: p.d, absorbed: p.a, eff: card.eff, seq: i });
      if (i === 0) fire(); else setTimeout(fire, i * 150);
    });
  }
  if (r.blk) setTimeout(() => emit({ t: 'blk', n: r.blk }), 60);
  if (r.heal) setTimeout(() => emit({ t: 'heal', n: r.heal }), 60);

  G.busy = true;
  setTimeout(() => {
    G.busy = false;
    requestSettle();
  }, 200);
}

/** 点一张知识卡 = 从**本场预抽的题**里取一道。 */
export function askCard(idx: number) {
  if (G.busy || G.panel.k !== 'none') return;
  const id = G.hand[idx];
  if (!id) return;
  const card = defOf(id);
  // 门前先看价：付不起的牌连题都不该弹出来 —— 让人答完一道题才发现打不出去，
  // 是最难受的一种白费力气。
  if (!canPay(card)) return;
  if (cardKind(card) !== 'knowledge') return;
  // 攒满等级：直接打，不抽题
  if (!needsAsk(id, G.charge)) { playFree(idx); return; }

  const q = takeQuestion();
  if (!q) {
    // 只有"整章一道题都没有"才会走到这里（空题库在载入时就被拒绝）；
    // 不能静默吞掉一次点击，给玩家一个能查的失败原因。
    log('这一章的题库是空的 —— 检查题库文件，或者先用基础牌撑过去', 'bad');
    emit({ t: 'fizzle', eff: card.eff });
    return;
  }
  // 题目快照挂在 Panel 上：答题期间就算换了题库/阶段，这一手也不会跟着变。
  // 选项每次点开都重新排，判定与反馈面板一律读 view。
  G.panel = { k: 'question', idx, qid: q.qid, topic: q.topic, q, view: shuffleOptions(q) };
}

export function cancelPanel() {
  // 取消**不再作废这张牌**：题目已经从这里扣掉了（`takeQuestion`），
  // 代价就是"本场少一道新题"，不必再叠一层"这张牌这回合不能用"。
  // 否则玩家会学会"不点"，而目的恰恰是让他多点。
  if (G.panel.k === 'question') {
    G.panel = { k: 'none' };
    return;
  }
  // 选牌面板（精炼 / 遗忘）现在可以取消：事件里"精炼一张、失去 N 点生命"
  // 的代价挂在 `G.pendingCost` 上，取消就要把它一起丢掉 —— 否则玩家取消一次，
  // 之后随便做点什么就凭空掉 10 点血。
  if (G.panel.k === 'cardpick') {
    G.pendingCost = 0;
    G.panel = { k: 'none' };
    return;
  }
  if (G.panel.k === 'deck' || G.panel.k === 'pile'
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
 * 一张卡真正打出去的那一下。`mult` 只给装订线的"半额结算"传 0.5，其余路径
 * 一律 1 —— 没有全局倍率，卡面写的数就是打出来的数。
 * `repeat` 是 X 费牌花掉的点数，走同一条结算路径，所以牌面写的段数和实际打出的段数
 * 永远由同一份 `resolveEff` 决定。
 */
function strikeWith(id: CardId, mult: number, repeat = 1) {
  const card = defOf(id);
  const st = statOf(id);
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
  // 按**实际打进去的伤害**回血。0 伤害不该回 1 点 —— 那是卡面上没有的保底。
  // `heal` 记的是血量真的涨了多少：满血时是 0，反馈和飘字才不会凭空多报一个 +N。
  if (out.healRatio > 0 && dmg > 0) {
    const before = G.hp;
    G.hp = Math.min(G.maxHp, G.hp + Math.max(1, Math.round(dmg * out.healRatio)));
    heal = G.hp - before;
  }
  if (out.draw > 0) drawn = drawCards(out.draw);
  return { out, dmg, absorbed, blk: out.blk, heal, drawn, parts };
}

/**
 * 反伤。你打它一下，它回你一下 —— **你的格挡挡不住**，因为它不是攻击，
 * 是纸割手。这条机制只惩罚"数量"：一回合打三张 1 费牌，就挨三次；
 * 打一张 3 费牌，只挨一次（多段牌也只挨一次，它数的是打出几张，不是打中几段）。
 *
 * 触发条件看的是"这张牌有没有攻击段"，不看实际打进去多少：
 * 完全被敌方格挡吃掉的攻击照样算打了一下 —— 机制条写的是"打它一次"，
 * 不是"打穿它一次"。纯格挡牌没有攻击段，所以不触发。
 *
 * 反伤可以致死。它和敌人的攻击落在同一条血线上，不做隐形保底：
 * "只剩 1 点血还能白打它一下"会是一条玩家读不到的规则。
 *
 * 但**击杀的那一下不反伤**：这一击已经赢了，不能再让玩家在胜利帧掉血。
 * 双方同时倒下时按胜利算（见 checkPending）；这条跳过让"同归于尽"不再发生，
 * 反伤只在敌人还活着的时候收。
 */
function thornsBack(hits: number[]) {
  const e = G.enemy;
  if (!e || e.mech !== 'thorns' || e.hp <= 0 || !hits.some((h) => h > 0)) return 0;
  const n = e.mechV ?? BAL.mech.thorns;
  if (n <= 0) return 0;
  G.hp -= n;
  log(`${e.name} 的反伤：你受到 ${n} 点伤害`, 'bad');
  emit({ t: 'hurt', n });
  return n;
}

export function answer(choice: number) {
  if (G.panel.k !== 'question' || G.busy) return;
  const { idx, qid, q, view } = G.panel;
  const id = G.hand[idx];
  if (!id) return;
  const card = defOf(id);
  // 键盘数字键会直接打进来，越界的选项不算答错 —— 手滑按到 9 不该扣行动力
  if (!Number.isInteger(choice) || choice < 0 || choice >= view.options.length) return;
  // 判定只看本次打乱后的视图。回头读 t.answer 会「点对了却算错」。
  const right = choice === view.answer;
  const m = memOf(card.id);
  const st = statOf(id);
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
  /** 这张牌自己会给出多少格挡（答错时用来区分"模式没给"和"这张牌本来就没有"） */
  let ownBlk = 0;
  let absorbed = 0;
  let heal = 0;
  let drawn = 0;
  let hits: number[] = [];
  let parts: { d: number; a: number }[] = [];
  let apNote = '';
  /** 学习模式答错的牌退回抽牌堆而不是进弃牌堆 */
  let backToDraw = false;

  if (right) {
    const r = strikeWith(id, 1, repeat);
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
    const back = thornsBack(hits);
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

    // 答对的次数用来攒这张牌的等级：攒到 `gradeNeed` 之后，这一场剩下的时间里它免答。
    // 记在卡 id 上而不是实例上 —— 同名牌的两张副本共用"我记住这张牌了"这件事。
    const need = gradeNeed(card);
    if (need > 0) {
      const before = G.charge[card.id] ?? 0;
      G.charge[card.id] = Math.min(need, before + 1);
      if (G.charge[card.id] >= need && before < need) {
        apNote = join(apNote, `这一场「${card.name}」已免答：再打它不用答题。`);
      }
    }

    G.okThisTurn += 1;
    G.runOk += 1;
    // 记的是"本回合答对了哪个主题"，不是计数：遗忘了的 -3 是当回合的，
    // 而且 topTopic() 可能在同一回合里被新的错误改写，结算时要重新对一次。
    // 卡题解耦之后，这里读的是**这道题**的主题，不是卡面主题。
    if (q.topic === topTopic()) G.topOkTopic = q.topic;
    m.reps += 1;
    m.ok += 1;
    // 答对也涨稳固度，但涨多少看模式：测试模式是"检索练习"，记得更牢；
    // 学习模式是第一次接触，涨得最少。1 = 原来的 ×1.8 / +1。
    m.stab = Math.min(60, Math.max(m.stab * (1 + 0.8 * M.stabGain), m.stab + M.stabGain));
    m.due = Math.round(m.stab);
    // 荧光笔：本回合第一道答对，退回的行动力 +1（在下面统一结算退款）。
    // 它曾经是"抽 1 张"——和双面镜逐字相同，于是两张牌是同一张，而 1 费的还比 0 费的弱。
    // 现在它改成加钱：两条线分开（镜给牌，笔给行动力），各自的量级也说得清。
    if (hasPower('marker') && G.okThisTurn === 1) {
      G.markerRefund += 1;
      apNote = join(apNote, '荧光笔：本回合第一道答对，这一手多退 1 点行动力。');
    }
  } else {
    // 答错的价码由本局模式决定：学习/复习/测试三档，开局前玩家自己选。
    // 三条都不碰血量：扣血会让人不敢碰不会的知识，正好和目的相反。
    // 补偿只给"这张牌自己就会给格挡"的那些，而且读的是 `resolveEff` 算出来的格挡，
    // 不是 `statOf` 那个纸面数值：**每张卡都挂着一个 blk 档位**（它是同价位牌的格挡
    // 底数），可 strike / pierce / chain / focus 这些效果里根本没有格挡。
    // 照着 statOf 补，一张纯攻杀牌答错就会凭空长出一层甲 —— 于是"答错"和"挡一下"
    // 被解绑，垫子变成人人有份的白送，卡面上还看不出它是哪来的。
    ownBlk = resolveEff(card.eff, st.atk, st.blk, 1, card.mods, repeat).blk;
    blkGain = Math.max(0, Math.round(ownBlk * M.missBlock));
    if (blkGain) {
      G.block += blkGain;
      apNote = join(apNote, `答错也挡住了 ${blkGain} 点。`);
    } else if (ownBlk > 0) {
      // 这里不能写死"测试模式"：学习模式的 missBlock 也是 0。
      // 用模式名拼，改数值不用回来改文案。
      apNote = join(apNote, `${M.name}模式：这张牌的格挡这次不生效。`);
    }

    if (M.missDest === 'draw') {
      // 学习：牌不进弃牌堆，回抽牌堆 —— 下一回合你一定会再抽到它。
      // 惩罚只剩"这一手作废"，不没收工具：还在学的东西，该让你再试一次。
      backToDraw = true;
      apNote = join(apNote, '这张牌回到牌堆，下一回合会再抽到它。');
    } else {
      // 复习 / 测试：这张牌进弃牌堆，这一场它不再自动回来 —— 想再见它得等洗牌。
      apNote = join(apNote, '它进了弃牌堆，要等洗牌才回来。');
    }

    // 补抽一张：答错的那张牌要离开手牌，不补位的话，一个中等正确率的人两回合就把手牌
    // 打空了 —— 那时他不是"答不对"，是"没牌可答"。补的是位置，不是奖励：
    // 这一手照样作废、行动力照样不退。学习模式不补：练的是牌感，手牌少了就少了。
    if (M.missDraw && BAL.missDraw && G.missDrawsThisTurn < BAL.missDrawCap) {
      const got = drawCards(BAL.missDraw);
      if (got) {
        G.missDrawsThisTurn += got;
        drawn += got;
        apNote = join(apNote, `补抽 ${got} 张 —— 位置不空着。`);
      }
    }

    G.topicWrong[q.topic] = (G.topicWrong[q.topic] || 0) + 1;
    G.runBad += 1;
    m.lapses += 1;
    m.bad += 1;
    apNote = join(apNote, '这一手不花行动力 —— 代价是这一场少了一道题。');

    const missNote = onPlayerMiss();
    if (missNote) apNote = join(apNote, missNote);

    // 稳固度按模式掉：学习最轻、测试最狠。到期也提前 —— 惩罚不靠扣血警告，靠日程。
    // 测试模式直接 due=0：下一局它会被排到最前面。
    m.stab = Math.max(1, m.stab * M.stabDrop);
    m.due = G.mode === 'test' ? 0 : 1;
  }

  // 节奏结算：答对付费用再退回 1 点；**答错一分不扣**。
  //
  // 答错不扣行动力是这一版的明确选择：错的代价已经落在"本场少一道新题"上，
  // 再扣一次行动力等于同一个错误收两次钱，而且会让人不敢碰不会的知识 ——
  // 正好和这个游戏的目的相反。高费牌因此变成"答错也不亏节奏、但要赔一道题"，
  // 赔的是学习机会，不是这一回合的出手次数。
  if (right) {
    G.ap -= spent;
    // 退款上限是"最多退 1 点"（`BAL.refund`），荧光笔是**额外**的一层，
    // 所以它不能塞进 refundOf 里 —— 那会把 1 费牌的全额退款一起改掉。
    // 它也因此允许退得比花掉的多：1 费牌答对 = +1 点净收入，这才是"笔给行动力"。
    const back = refundOf(spent) + G.markerRefund;
    G.markerRefund = 0;
    if (back > 0) {
      G.ap += back;
      apNote = join(apNote, back > spent
        ? `答对了，退回 ${back} 点 —— 这一手净赚 ${back - spent} 点。`
        : back >= spent
          ? '答对了，这一手不花行动力。'
          : `答对了，退回 ${back} 点 —— 这张牌净花 ${spent - back} 点。`);
    }
  } else {
    G.markerRefund = 0;
  }

  // 装订线：每回合第一次答错，这一手**仍然按一半结算**。
  //
  // 旧文案是"答错不花行动力"，而现行规则里答错本来就不扣行动力 —— 那句话恒真，
  // 这张牌于是等于没有效果（这正是"能力牌和机制冲突"最直白的一例）。
  // 改成半额结算之后，它买的东西变成"错了还有一点输出"，和"答错的代价落在题池上"
  // 这条新规则互补而不是打架。
  if (!right && hasPower('binder') && !G.binderUsed) {
    G.binderUsed = true;
    const r = strikeWith(id, 0.5, repeat);
    hits = r.out.hits;
    parts = r.parts;
    dmg = r.dmg;
    absorbed = r.absorbed;
    // 格挡也减半：只补伤害会让一张纯防御的牌在这条路上凭空变强。
    const halfBlk = Math.round(r.blk / 2);
    if (halfBlk > 0) { G.block += halfBlk; blkGain += halfBlk; }
    heal = r.heal;
    drawn += r.drawn;
    apNote = join(apNote, `装订线：这一手仍然按一半结算`
      + `${dmg ? `（${dmg} 伤害` : '（'}${halfBlk ? `${dmg ? '，' : ''}${halfBlk} 格挡` : ''}）。`);
  }
  G.ap = clamp(G.ap, 0, 10);

  G.busy = true;
  // 学习模式答错的牌回抽牌堆（push 到尾部 = 下一张抽到的就是它）；其余都进弃牌堆
  if (backToDraw) G.draw.push(id);
  else G.discard.push(id);
  G.hand.splice(idx, 1);
  saveMem();

  // 章节记忆按题号记账，和卡牌记忆（memOf）分开：同一张卡在不同阶段抽到
  // 不同章节的题，卡上的统计会把它们混成一个数。
  recordAnswer({ stageTopic: G.stageTopic, qid, right });
  G.answers.push({
    qid, topic: q.topic, stageTopic: G.stageTopic, stage: G.stage, right, choice,
    answer: view.answer, stem: q.q.slice(0, 80),
  });
  // 环形缓冲：只留最近若干条，够结算/导出读，不把整局题面塞进内存。
  if (G.answers.length > 120) G.answers.shift();

  const effName = EFFS[card.eff].name;
  const shape = hits.length > 1 ? `${hits.join('+')} 伤害` : `${dmg} 伤害`;
  const missNote = backToDraw ? '，牌回牌堆' : '，进弃牌堆';
  const leftNote = G.qLeft.length
    ? `本场还剩 ${G.qLeft.length} 道新题`
    : '本场新题已用完，开始复用';
  log(
    `「${effName}·${q.topic}」${right ? '答对' : '答错'}` +
      (right
        ? `，${shape}${absorbed ? `（${absorbed} 被挡）` : ''}` +
          (blkGain ? `，${blkGain} 格挡` : '') +
          (heal ? `，回 ${heal}` : '') +
          (drawn ? `，抽 ${drawn}` : '')
        : `，效果作废${blkGain ? `，${blkGain} 格挡`
          : ownBlk > 0 ? '，这一手没补格挡' : '，这张牌本身没有格挡'}${missNote}`) +
      `　·　${leftNote}`,
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
      idx, qid, choice, right,
      dmg, absorbed, blk: blkGain, eff: card.eff, hits, parts, heal, draw: drawn, apNote,
      explain: q.explain, question: q.q, options: view.options, answer: view.answer,
      topic: q.topic,
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
  const id = G.hand[idx];
  if (!id) return;
  const card = defOf(id);
  const p = powerOf(card);
  if (!p) return;
  if (hasPower(p.id)) return;
  if (!canPay(card)) return;

  const spent = costNow(card);
  G.ap -= spent;
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
    // 它不改数值，只把"答对抽牌"的上限从 0 抬到 BAL.answerDrawCap —— 效果在 answer() 里读 hasPower。
    // 之所以做成"改规则"而不是"当场发一次收益"：增益牌本来就是本场持续的东西。
    note = '本场答对后抽 1 张（每回合一次）。';
  } else if (p.id === 'marker') {
    note = '本场每回合第一道答对时，退回的行动力 +1。';
  } else if (p.id === 'binder') {
    note = '本场每回合第一次答错，那一手按一半结算。';
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
  const id = G.hand[idx];
  if (!id) return;
  const card = defOf(id);
  if (cardKind(card) !== 'basic') return;
  if (!canPay(card)) return;

  const spent = costNow(card);
  const r = strikeWith(id, 1);
  thornsBack(r.out.hits);
  G.ap -= spent;
  G.ap = clamp(G.ap, 0, 10);

  G.discard.push(id);
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
    requestSettle();
  }, 200);
}

