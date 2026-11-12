import { BAL, FOES, MISS_RULE } from '../model/data';
import { EFFS, resolveEff } from '../model/effects';
import type { CardId, Feedback, MapNode } from '../model/types';
import { G, checkPending, log, topTopic } from '../infra/state';
import { emit } from '../infra/events';
import { grantBlock, gainAp, healHp, loseHp, spendAp } from '../infra/write';
import { pick, shuffle } from '../infra/util';
import { stagePool } from '../library/stage';
import { floorOf } from '../map/gen';
import { recordAnswer } from '../library/stagemem';
import { memOf, saveMem } from '../library/memory';
import { shuffleOptions } from '../library/question';
import { defOf } from '../cards/registry';
import { applyCardBonus, clearOnceUsed, onceThisFight, rulesOf, syllabusBasicBlock } from '../cards/powers';
import { canPay, costNow, isXCost, refundOf } from '../cards/cost';
import { cardGrade, gradeNeed, needsAsk } from '../cards/grade';
import { cardKind } from '../cards/kinds';
import { drawCards, startTurn } from './deck';
import { commitLink, liveStatOf } from './link';
import { makeFoe, onPlayerMiss } from './foe';
import { requestSettle } from './pending';
import { drawBattleQuestions, takeQuestion } from './questions';

/**
 * 战斗开局与玩家出牌的全部路径。
 * 出牌只有两条：答题（`answer`）和基础牌（`playBasic`），都经 `strikeWith` 结算，
 * 且都要先 `canPay` 再动牌堆。
 * 答对奖励只有两条：退 1 点行动力、抽一张牌，没有倍率层。
 */
const join = (a: string, b: string) => (a ? a + ' ' : '') + b;

export function startBattle(nd: MapNode) {
  // 一幕一套物种；找不到时回退到全表，别让一场战斗开不起来。
  const pool = FOES.filter((f) => f.stage === G.stage && f.type === nd.type);
  // 层号读节点自己的坐标，不读 G.pos（调试会直接塞节点进来）。
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

  // 本场清免答计数和题池；答错不扣行动力、不封牌，代价落在本场新题数上。
  G.charge = {};
  // `syllabusTurn` 记回合号，跨场不清会误判已给过。
  G.syllabusTurn = 0;
  // 联动的账按场清
  G.cardPlays = {};
  G.nextBoost = null;
  G.drawnThisTurn = 0;
  G.cardsThisTurn = 0;
  drawBattleQuestions();
  // fog：本场每回合少抽一张。记在场上，手牌上限 / 动画 / 日志读同一个数。
  G.drawCut = e.mech === 'fog' ? (e.mechV ?? BAL.mech.fog) : 0;
  G.apDown = 0;

  // 增益跨战斗保留，但「一场一次」的账必须清，否则那张牌从第二场起不再响。
  // 行动力上限由 `startTurn` 按 `rulesOf()` 重算。
  clearOnceUsed();

  // 模式已经在顶栏标了一次，这一行不再复读。考场提示只在第一次战斗里说：
  // 那是教学，不是战报：打到第八层还在播同一句，就是把日志的位置浪费掉了。
  log(`── ${e.name} 出现了 ──`, 'turn');
  if ((G.node?.r ?? 0) === 0) {
    log(`这一场准备了 ${G.qLeft.length} 道新题；C 牌直接打，B/A/S 各要答对 1/2/3 次。新题用完会复用问得最少的题`, 'turn');
  }
  // 开局格挡在 startTurn 里给（那里才知道是不是第一回合）：写在这里会被 startTurn 清零
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
 * 等级攒满后直接打：走同一条 `strikeWith`，不抽题、不判对错、不进答题流水。
 * 不弹反馈面板，结果只留一条内部文字记录。
 */
export function playFree(idx: number) {
  if (G.busy || G.panel.k !== 'none') return;
  const id = G.hand[idx];
  if (!id) return;
  const card = defOf(id);
  if (cardKind(card) !== 'knowledge') return;
  // 没攒够的牌不能从这条路绕过去，规则在这里守一次。
  if (needsAsk(id, G.charge)) return;
  if (!canPay(card)) return;

  const xcost = isXCost(card);
  const spent = xcost ? G.ap : costNow(card);
  const repeat = xcost ? Math.max(1, spent) : 1;
  const r = strikeWith(id, 1, repeat);
  const back = thornsBack(r.out.hits);

  spendAp(spent);
  G.discard.push(id);
  G.hand.splice(idx, 1);
  checkPending();

  const shape = r.out.hits.length > 1 ? `${r.out.hits.join('+')} 伤害` : `${r.dmg} 伤害`;
  log(
    `「${card.name}」${r.dmg ? shape : ''}${r.blk ? `${r.dmg ? '，' : ''}${r.blk} 格挡` : ''}` +
      `${r.selfHp ? `，失去 ${r.selfHp} 生命` : ''}` +
      `（${cardGrade(card)} 级，这一场已免答${back ? `；反伤 ${back}` : ''}）` +
      `${r.nextNote ? `　·　${r.nextNote}` : ''}`,
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
  // 付不起就不弹题：让人答完才发现打不出去是最难受的白费。
  if (!canPay(card)) return;
  if (cardKind(card) !== 'knowledge') return;
  // 攒满等级：直接打，不抽题
  if (!needsAsk(id, G.charge)) { playFree(idx); return; }

  const q = takeQuestion();
  if (!q) {
    // 空题库：给一个能查的失败原因，不静默吞掉点击。
    log('这一章的题库是空的：检查题库文件，或者先用基础牌撑过去', 'bad');
    emit({ t: 'fizzle', eff: card.eff });
    return;
  }
  // 题目快照挂在 Panel 上，答题期间不随题库变。
  let view = shuffleOptions(q);
  // 放大镜：这一场第一道题删一个错误选项；只剩两项的题不动。
  // 记账在抬手就打，不等 `answer()`，否则取消再点能一直删。
  if (view.options.length >= 3 && onceThisFight('loupe')) {
    const wrongs = view.options.map((_, i) => i).filter((i) => i !== view.answer);
    if (wrongs.length) {
      const drop = wrongs[Math.floor(Math.random() * wrongs.length)];
      view = {
        options: view.options.filter((_, i) => i !== drop),
        answer: drop < view.answer ? view.answer - 1 : view.answer,
      };
      log('放大镜：这一场的第一道题，一个干扰项被划掉了。', 'hi');
    }
  }
  G.panel = { k: 'question', idx, qid: q.qid, topic: q.topic, q, view };
}

export function cancelPanel() {
  // 取消不作废这张牌：题已经被 `takeQuestion` 扣掉了，代价已经付过。
  if (G.panel.k === 'question') {
    G.panel = { k: 'none' };
    return;
  }
  // 选牌面板（精炼 / 遗忘）现在可以取消：事件里"精炼一张、失去 N 点生命"
  // 的代价挂在 `G.pendingCost` 上，取消就要把它一起丢掉：否则玩家取消一次，
  // 之后随便做点什么就凭空掉 10 点血。
  if (G.panel.k === 'cardpick') {
    G.pendingCost = 0;
    G.panel = { k: 'none' };
    return;
  }
  if (G.panel.k === 'deck' || G.panel.k === 'pile'
      || G.panel.k === 'help' || G.panel.k === 'pack' || G.panel.k === 'boon') {
    G.panel = { k: 'none' };
  }
}

function damageEnemy(raw: number, pierce = false) {
  const e = G.enemy!;
  let n = raw;
  let absorbed = 0;
  // 洞察绕过格挡：连"被吸收"这件事都不会发生，敌人那层防御直接不参与结算
  if (!pierce && e.block > 0) { absorbed = Math.min(e.block, n); e.block -= absorbed; n -= absorbed; }
  const alive = e.hp > 0;
  e.hp -= n;
  // 藏书印：**这一下打死的**才算击杀。多段牌的第二段会让 `e.hp` 已经是负数，
  // 不加 `alive` 这个前置判断的话，一张两段牌会回两次血。
  if (alive && e.hp <= 0) {
    const got = healHp(rulesOf().healOnKill);
    if (got) {
      log(`藏书印：击杀回复 ${got} 点生命`, 'hi');
      emit({ t: 'heal', n: got });
    }
  }
  return { dealt: n, absorbed };
}

/**
 * 一张卡真正打出去的那一下。`mult` 只给装订线的"半额结算"传 0.5，其余路径
 * 一律 1：没有全局倍率，卡面写的数就是打出来的数。
 * `repeat` 是 X 费牌花掉的点数，走同一条结算路径，所以牌面写的段数和实际打出的段数
 * 永远由同一份 `resolveEff` 决定。
 */
function strikeWith(id: CardId, mult: number, repeat = 1) {
  const card = defOf(id);
  // 这一回合第几张真正生效的牌。答错不增加，所以墨水瓶/节拍器只数打出去的牌。
  G.cardsThisTurn += 1;
  // 读的是**此刻**的联动底数，不是卡面印死的那个数。手牌、答题面板、
  // 结算三处都调 liveStatOf，所以「卡面写 10」和「实际打 10」是同一个数。
  const st = liveStatOf(id);
  // card.mods 必须一起传：卡面（ui.ts）和答题面板（overlay.ts）都是按 mods 画的，
  // 结算漏掉它，带签名改动的 15 张卡就会「卡面写的」和「实际发生的」两张皮。
  // `applyCardBonus` 同理：压书石 / 校规加在**结果**上，卡面走的是同一个函数。
  const out = applyCardBonus(resolveEff(card.eff, st.atk, st.blk, mult, card.mods, repeat));
  const parts: { d: number; a: number }[] = [];
  let dmg = 0;
  let absorbed = 0;
  for (const hit of out.hits) {
    const r = damageEnemy(hit, out.pierce);
    dmg += r.dealt;
    absorbed += r.absorbed;
    parts.push({ d: r.dealt, a: r.absorbed });
  }
  grantBlock(out.blk);
  let heal = 0;
  let drawn = 0;
  let selfHp = 0;
  // 按实际打进去的伤害回血；0 伤害不回 1 点。
  if (out.healRatio > 0 && dmg > 0) {
    heal = healHp(Math.max(1, Math.round(dmg * out.healRatio)));
  }
  if (out.draw > 0) drawn = drawCards(out.draw);
  // 自伤：卡面写多少扣多少。
  if (out.selfHp > 0) {
    selfHp = out.selfHp;
    loseHp(selfHp);
    log(`「${card.name}」反噬：你失去 ${selfHp} 点生命`, 'bad');
    emit({ t: 'hurt', n: selfHp });
  }
  // 节奏型增益：按"真正生效的牌"计数，答错不触发
  const R = rulesOf();
  if (R.inkDraw > 0 && G.cardsThisTurn % 3 === 0) {
    const got = drawCards(R.inkDraw);
    if (got) log(`墨水瓶：本回合第 ${G.cardsThisTurn} 张牌，抽 ${got} 张`, 'hi');
  }
  if (G.cardsThisTurn === 3 && onceThisFight('pulse')) {
    gainAp(BAL.pulseRefund);
    log(`节拍器：这一场第一次三连，退回 ${BAL.pulseRefund} 点行动力`, 'hi');
  }
  if (!isXCost(card) && costNow(card) === 0 && onceThisFight('varnish')) {
    const got = drawCards(BAL.varnishDraw);
    if (got) log(`亮油：这一场第一张 0 费牌，抽 ${got} 张`, 'hi');
  }
  if (out.hits.some((h) => h > 0) && onceThisFight('seed')) {
    grantBlock(BAL.seedBlock);
    log(`种纸：这一场第一张攻击牌，补 ${BAL.seedBlock} 点格挡`, 'hi');
  }
  // 走完才记账：答错这一手作废，上一张留的倍率继续留着。
  const nextNote = commitLink(id);
  return {
    out, dmg, absorbed, blk: out.blk, heal, drawn, selfHp, parts,
    linkNote: st.reasons.join(' · '), boosted: st.boosted, nextNote,
  };
}

/**
 * 反伤：打出有攻击段的牌就挨一下，格挡挡不住。
 * 数的是打出几张，不是打中几段；击杀的那一下不反伤。
 */
function thornsBack(hits: number[]) {
  const e = G.enemy;
  if (!e || e.mech !== 'thorns' || e.hp <= 0 || !hits.some((h) => h > 0)) return 0;
  const n = e.mechV ?? BAL.mech.thorns;
  if (n <= 0) return 0;
  loseHp(n);
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
  // 键盘数字键直接打进来，越界不算答错
  if (!Number.isInteger(choice) || choice < 0 || choice >= view.options.length) return;
  // 判定只看打乱后的视图
  const right = choice === view.answer;
  const m = memOf(card.id);
  // 这一手的价格：X 费按此刻剩余的全部行动力，先定价再结算。
  const xcost = isXCost(card);
  const spent = xcost ? G.ap : costNow(card);
  const repeat = xcost ? Math.max(1, spent) : 1;

  let dmg = 0;
  let blkGain = 0;
  let absorbed = 0;
  let heal = 0;
  let drawn = 0;
  let selfHp = 0;
  let hits: number[] = [];
  let parts: { d: number; a: number }[] = [];
  let apNote = '';
  /** 这一手伤害里来自前序出牌的部分 */
  let linkNote = '';
  /** 胶水壶：这张牌留在手里 */
  let backToHand = false;

  if (right) {
    // 毛笔：这一场第一次答对，段数 +1（不是翻倍）。记账必须在结算之前。
    const extra = onceThisFight('brush') ? BAL.brushRepeat : 0;
    const r = strikeWith(id, 1, repeat + extra);
    if (extra) apNote = join(apNote, `毛笔：这一场第一次答对，效果结算 ${repeat + extra} 次。`);
    hits = r.out.hits;
    dmg = r.dmg;
    absorbed = r.absorbed;
    blkGain = r.blk;
    heal = r.heal;
    drawn = r.drawn;
    selfHp = r.selfHp;
    parts = r.parts;
    linkNote = r.linkNote;
    if (r.selfHp) apNote = join(apNote, `反噬：失去 ${r.selfHp} 点生命。`);
    if (r.nextNote) apNote = join(apNote, `${r.nextNote}。`);
    if (xcost) apNote = join(apNote, `耗尽 ${spent} 点行动力，效果结算 ${repeat} 次。`);
    if (drawn) apNote = join(apNote, `专注：抽 ${drawn} 张。`);
    // 反伤在结算完之后收
    const back = thornsBack(hits);
    if (back) apNote = join(apNote, `反伤：你受到 ${back} 点。`);

    // 答对抽牌由双面镜提供，默认关闭；上限读 `rulesOf().answerDraw`。
    const cap = rulesOf().answerDraw;
    if (G.answerDrawsThisTurn < cap && drawCards(BAL.answerDraw)) {
      G.answerDrawsThisTurn += BAL.answerDraw;
      G.answerDraws += BAL.answerDraw;
      drawn += BAL.answerDraw;
      apNote = join(apNote, `答对：抽 ${BAL.answerDraw} 张（本回合 ${G.answerDrawsThisTurn}/${cap}）。`);
    }

    // 书签：这一场第一道答对补格挡，和双面镜（给牌）分属两条线。
    if (onceThisFight('bookmark')) {
      grantBlock(BAL.bookmarkBlock);
      blkGain += BAL.bookmarkBlock;
      apNote = join(apNote, `书签：这一场第一道答对，获得 ${BAL.bookmarkBlock} 点格挡。`);
    }

    // 答对攒等级，攒够 `gradeNeed` 这场就免答；按卡 id 记，同名牌副本共用。
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
    // 记的是本回合答对的题主题，`topTopic()` 之后可能被改写，结算时重对一次。
    if (q.topic === topTopic()) G.topOkTopic = q.topic;
    m.reps += 1;
    m.ok += 1;
    // 答对涨稳固度；批注在这一场第一道答对时额外多涨一点。
    let stabGain = MISS_RULE.stabGain;
    if (onceThisFight('margin')) {
      stabGain += BAL.marginStab;
      apNote = join(apNote, `批注：这一场第一道答对，稳固度额外 +${BAL.marginStab}。`);
    }
    m.stab = Math.min(60, Math.max(m.stab * (1 + 0.8 * stabGain), m.stab + stabGain));
    m.due = Math.round(m.stab);
    // 荧光笔：本回合第一道答对多退 1 点，在下面统一结算退款。
    if (onceThisFight('marker')) {
      G.markerRefund += 1;
      apNote = join(apNote, '荧光笔：这一场第一道答对，这一手多退 1 点行动力。');
    }
  } else {
    // 答错：这一手作废，不补格挡、不补抽，牌进弃牌堆。
    if (onceThisFight('gluepot')) {
      // 胶水壶：这一场第一次答错，牌留在手里；回合结束照常进弃牌堆。
      backToHand = true;
      apNote = join(apNote, '胶水壶：这张牌没有离开手牌，这一回合还能再打它。');
    } else {
      // 默认：进弃牌堆，要等洗牌才回来。
      apNote = join(apNote, '它进了弃牌堆，要等洗牌才回来。');
    }

    // 草稿纸：这一场第一次答错补一张。
    if (onceThisFight('scratch')) {
      const got = drawCards(BAL.scratchDraw);
      if (got) {
        drawn += got;
        apNote = join(apNote, `草稿纸：这一场第一次答错，补抽 ${got} 张。`);
      }
    }

    // 橡皮：这一场第一次答错补 3 点格挡，不救那一手。
    if (onceThisFight('eraser')) {
      grantBlock(BAL.eraserBlock);
      blkGain += BAL.eraserBlock;
      apNote = join(apNote, `橡皮：这一场第一次答错，补了 ${BAL.eraserBlock} 点格挡。`);
    }

    G.topicWrong[q.topic] = (G.topicWrong[q.topic] || 0) + 1;
    G.runBad += 1;
    m.lapses += 1;
    m.bad += 1;
    apNote = join(apNote, '这一手不花行动力：代价是这一场少了一道题。');

    const missNote = onPlayerMiss();
    if (missNote) apNote = join(apNote, missNote);

    // 稳固度下降、到期提前：惩罚靠日程不靠扣血。
    // 书套：这一场第一次答错，两项都不动。
    if (onceThisFight('slipcase')) {
      apNote = join(apNote, '书套：这一场第一次答错，稳固度和到期都没动。');
    } else {
      m.stab = Math.max(1, m.stab * MISS_RULE.stabDrop);
      m.due = 1;
    }
  }

  // 节奏结算：答对先付再退最多 1 点；答错一分不扣。
  if (right) {
    spendAp(spent);
    // 退款上限来自借书证；荧光笔是额外一层，不进 `refundOf`。
    let back = refundOf(spent, rulesOf().refund) + G.markerRefund;
    // 回形针：这一场第一次打出 3 费以上的牌，再多退 2 点。
    if (spent >= 3 && onceThisFight('clip')) {
      back += BAL.clipRefund;
      apNote = join(apNote, `回形针：这一场第一次打出 ${spent} 费牌，多退 ${BAL.clipRefund} 点。`);
    }
    G.markerRefund = 0;
    if (back > 0) {
      gainAp(back);
      apNote = join(apNote, back > spent
        ? `答对了，退回 ${back} 点：这一手净赚 ${back - spent} 点。`
        : back >= spent
          ? '答对了，这一手不花行动力。'
          : `答对了，退回 ${back} 点：这张牌净花 ${spent - back} 点。`);
    }
  } else {
    G.markerRefund = 0;
  }

  // 装订线：这一场第一次答错，仍然按一半结算。
  if (!right && onceThisFight('binder')) {
    const r = strikeWith(id, 0.5, repeat);
    hits = r.out.hits;
    parts = r.parts;
    dmg = r.dmg;
    absorbed = r.absorbed;
    // `resolveEff` 已经把 mult 乘进格挡，这里不能再补一次。
    blkGain = r.blk;
    heal = r.heal;
    drawn += r.drawn;
    linkNote = r.linkNote;
    if (r.nextNote) apNote = join(apNote, `${r.nextNote}。`);
    apNote = join(apNote, `装订线：这一手仍然按一半结算`
      + `（${dmg} 伤害${r.blk ? `，${r.blk} 格挡` : ''}${r.drawn ? `，抽 ${r.drawn} 张` : ''}）。`);
  }

  G.busy = true;
  // 两条去向互斥：胶水壶留在手里，其余进弃牌堆。
  if (!backToHand) {
    G.discard.push(id);
    G.hand.splice(idx, 1);
  }
  saveMem();

  // 章节记忆按题号记，和卡牌记忆分开。
  recordAnswer({ stageTopic: G.stageTopic, qid, right });
  G.answers.push({
    qid, topic: q.topic, stageTopic: G.stageTopic, stage: G.stage, right, choice,
    answer: view.answer, stem: q.q.slice(0, 80),
  });
  // 环形缓冲，只留最近若干条
  if (G.answers.length > 120) G.answers.shift();

  const effName = EFFS[card.eff].name;
  const shape = hits.length > 1 ? `${hits.join('+')} 伤害` : `${dmg} 伤害`;
  const missNote = backToHand ? '，牌留在手里' : '，进弃牌堆';
  const leftNote = G.qLeft.length
    ? `本场还剩 ${G.qLeft.length} 道新题`
    : '本场新题已用完，开始复用';
  log(
    `「${effName}·${q.topic}」${right ? '答对' : '答错'}` +
      (right
        ? `，${shape}${absorbed ? `（${absorbed} 被挡）` : ''}` +
          (blkGain ? `，${blkGain} 格挡` : '') +
          (selfHp ? `，失去 ${selfHp} 生命` : '') +
          (heal ? `，回 ${heal}` : '') +
          (drawn ? `，抽 ${drawn}` : '')
        : `，效果作废${blkGain ? `，${blkGain} 格挡` : '，这张牌本身没有格挡'}${missNote}`) +
      `　·　${leftNote}`,
    right ? 'hi' : 'bad',
  );

  checkPending();

  // 多段伤害按段错开发出；第一下同步发，表现层靠它在本帧知道这一手打出去了。
  if (right) {
    parts.forEach((p, i) => {
      const fire = () => emit({ t: 'dmg', n: p.d, absorbed: p.a, eff: card.eff, seq: i });
      if (i === 0) fire(); else setTimeout(fire, i * 150);
    });
  } else {
    // 答错：抬手、甩出去、半路散掉。
    emit({ t: 'fizzle', eff: card.eff });
  }
  const base = parts.length * 150;
  // 答错时的格挡补偿晚一点出场，先让"焰灭了"被看见。
  if (blkGain) setTimeout(() => emit({ t: 'blk', n: blkGain }), base + (right ? 60 : 220));
  if (heal) setTimeout(() => emit({ t: 'heal', n: heal }), base + 60);

  const fb: Feedback = {
    idx, qid, choice, right,
    dmg, absorbed, blk: blkGain, eff: card.eff, hits, parts, heal, draw: drawn, apNote, linkNote,
    explain: q.explain, question: q.q, options: view.options, answer: view.answer,
    topic: q.topic,
  };
  lastFb = fb;
  /**
   * 答对**不画**判定面板（见 scenes/overlay.ts）：效果已经当场结算，
   * 那块面板除了盖住战场没有别的作用，光刃和伤害数字全被它压在底下。
   * 状态仍然停在 feedback 一小会，只是给打击演出当输入锁 —— 表现层演完就收掉，
   * 不需要玩家再点一次「继续」。
   */
  G.panel = { k: 'feedback', fb };
}

/**
 * 最近一次判定的完整结果。
 * 答对不再有面板可读，测试和调试仍要拿到"这一手打了几段、退了几点"。
 */
let lastFb: Feedback | null = null;
export function lastFeedback() {
  return lastFb;
}

/**
 * 打出一张基础牌：不答题、不退款、不进记忆调度。
 * 它是这一局的地板，数值刻意低于知识卡，同样花 1 点。
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
  // 课表只认基础牌，和题目池无关。
  const syllabusBlk = syllabusBasicBlock();
  thornsBack(r.out.hits);
  spendAp(spent);

  G.discard.push(id);
  G.hand.splice(idx, 1);
  checkPending();

  const shape = r.out.hits.length > 1 ? `${r.out.hits.join('+')} 伤害` : `${r.dmg} 伤害`;
  log(
    `「${card.name}」${r.dmg ? shape : ''}${r.blk ? `${r.dmg ? '，' : ''}${r.blk} 格挡` : ''}` +
      `${syllabusBlk ? `${r.dmg || r.blk ? '，' : ''}课表 +${syllabusBlk} 格挡` : ''}` +
      `（基础牌，不答题）${r.nextNote ? `　·　${r.nextNote}` : ''}`,
    '',
  );

  // 纯防御的基础牌没有伤害段：不发光刃，只飘格挡
  if (r.dmg > 0) {
    r.parts.forEach((p, i) => {
      const fire = () => emit({ t: 'dmg', n: p.d, absorbed: p.a, eff: card.eff, seq: i });
      if (i === 0) fire(); else setTimeout(fire, i * 150);
    });
  }
  if (r.blk + syllabusBlk) setTimeout(() => emit({ t: 'blk', n: r.blk + syllabusBlk }), 60);

  G.busy = true;
  setTimeout(() => {
    G.busy = false;
    requestSettle();
  }, 200);
}

