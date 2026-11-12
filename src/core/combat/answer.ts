import { BAL, MISS_RULE } from '../model/data';
import { EFFS } from '../model/effects';
import type { CardDef, CardId, Feedback, QView, Question } from '../model/types';
import { G, checkPending, log, topTopic } from '../infra/state';
import { gainAp, grantBlock, spendAp } from '../infra/write';
import { drawCards } from './deck';
import { onPlayerMiss } from './foe';
import { publishStrike, strikeWith, thornsBack } from './play';
import type { StrikeResult } from './play';
import { defOf } from '../cards/registry';
import { gradeNeed } from '../cards/grade';
import { onceThisFight, rulesOf } from '../cards/powers';
import { costNow, isXCost, refundOf } from '../cards/cost';
import { memOf, saveMem } from '../library/memory';
import { recordAnswer } from '../library/stagemem';

/**
 * 答题结算：答对 / 答错分支只改 `AnswerCtx`，最后由 `finishAnswer` 统一落账。
 * 这里的增益触发按“答对 / 答错 / 结算 AP”分组；加新增益优先改这里，不要再往通用路径里插分支。
 */

/** 一次答题的全部中间结果；右/左分支只改这里，最后由 finishAnswer 统一收尾。 */
interface AnswerCtx {
  idx: number;
  qid: string;
  choice: number;
  id: CardId;
  card: CardDef;
  q: Question;
  view: QView;
  right: boolean;
  spent: number;
  repeat: number;
  xcost: boolean;
  mem: ReturnType<typeof memOf>;
  dmg: number;
  absorbed: number;
  blk: number;
  heal: number;
  drawn: number;
  selfHp: number;
  hits: number[];
  parts: { d: number; a: number }[];
  linkNote: string;
  nextNote: string;
  backToHand: boolean;
  notes: string[];
}

function addNote(ctx: AnswerCtx, msg: string) {
  ctx.notes.push(msg);
}

/** 把一次 strikeWith 的结果装回上下文。 */
function applyStrike(ctx: AnswerCtx, r: StrikeResult) {
  ctx.hits = r.out.hits;
  ctx.dmg = r.dmg;
  ctx.absorbed = r.absorbed;
  ctx.blk = r.blk;
  ctx.heal = r.heal;
  ctx.drawn = r.drawn;
  ctx.selfHp = r.selfHp;
  ctx.parts = r.parts;
  ctx.linkNote = r.linkNote;
  ctx.nextNote = r.nextNote;
}

function resolveRight(ctx: AnswerCtx) {
  // 毛笔：这一场第一次答对，段数 +1（不是翻倍）。记账必须在结算之前。
  const extra = onceThisFight('brush') ? BAL.brushRepeat : 0;
  applyStrike(ctx, strikeWith(ctx.id, 1, ctx.repeat + extra));
  if (extra) addNote(ctx, `毛笔：这一场第一次答对，效果结算 ${ctx.repeat + extra} 次。`);
  if (ctx.selfHp) addNote(ctx, `反噬：失去 ${ctx.selfHp} 点生命。`);
  if (ctx.nextNote) addNote(ctx, `${ctx.nextNote}。`);
  if (ctx.xcost) addNote(ctx, `耗尽 ${ctx.spent} 点行动力，效果结算 ${ctx.repeat} 次。`);
  if (ctx.drawn) addNote(ctx, `专注：抽 ${ctx.drawn} 张。`);
  // 反伤在结算完之后收
  const back = thornsBack(ctx.hits);
  if (back) addNote(ctx, `反伤：你受到 ${back} 点。`);

  // 答对抽牌由双面镜提供，默认关闭；上限读 `rulesOf().answerDraw`。
  const cap = rulesOf().answerDraw;
  if (G.answerDrawsThisTurn < cap && drawCards(BAL.answerDraw)) {
    G.answerDrawsThisTurn += BAL.answerDraw;
    G.answerDraws += BAL.answerDraw;
    ctx.drawn += BAL.answerDraw;
    addNote(ctx, `答对：抽 ${BAL.answerDraw} 张（本回合 ${G.answerDrawsThisTurn}/${cap}）。`);
  }

  // 书签：这一场第一道答对补格挡，和双面镜（给牌）分属两条线。
  if (onceThisFight('bookmark')) {
    grantBlock(BAL.bookmarkBlock);
    ctx.blk += BAL.bookmarkBlock;
    addNote(ctx, `书签：这一场第一道答对，获得 ${BAL.bookmarkBlock} 点格挡。`);
  }

  // 答对攒等级，攒够 `gradeNeed` 这场就免答；按卡 id 记，同名牌副本共用。
  const need = gradeNeed(ctx.card);
  if (need > 0) {
    const before = G.charge[ctx.card.id] ?? 0;
    G.charge[ctx.card.id] = Math.min(need, before + 1);
    if (G.charge[ctx.card.id] >= need && before < need) {
      addNote(ctx, `这一场「${ctx.card.name}」已免答：再打它不用答题。`);
    }
  }

  G.okThisTurn += 1;
  G.runOk += 1;
  G.stageOk += 1;
  // 记的是本回合答对的题主题，`topTopic()` 之后可能被改写，结算时重对一次。
  if (ctx.q.topic === topTopic()) G.topOkTopic = ctx.q.topic;
  ctx.mem.reps += 1;
  ctx.mem.ok += 1;
  // 答对涨稳固度；批注在这一场第一道答对时额外多涨一点。
  let stabGain = MISS_RULE.stabGain;
  if (onceThisFight('margin')) {
    stabGain += BAL.marginStab;
    addNote(ctx, `批注：这一场第一道答对，稳固度额外 +${BAL.marginStab}。`);
  }
  ctx.mem.stab = Math.min(60, Math.max(ctx.mem.stab * (1 + 0.8 * stabGain), ctx.mem.stab + stabGain));
  ctx.mem.due = Math.round(ctx.mem.stab);
  // 荧光笔：这一手多退 1 点，在 settleAnswerAp 统一结算。
  if (onceThisFight('marker')) {
    G.markerRefund += 1;
    addNote(ctx, '荧光笔：这一场第一道答对，这一手多退 1 点行动力。');
  }
}

function resolveWrong(ctx: AnswerCtx) {
  // 答错：这一手作废，不补格挡、不补抽，牌进弃牌堆。
  if (onceThisFight('gluepot')) {
    // 胶水壶：这一场第一次答错，牌留在手里；回合结束照常进弃牌堆。
    ctx.backToHand = true;
    addNote(ctx, '胶水壶：这张牌没有离开手牌，这一回合还能再打它。');
  } else {
    // 默认：进弃牌堆，要等洗牌才回来。
    addNote(ctx, '它进了弃牌堆，要等洗牌才回来。');
  }

  // 草稿纸：这一场第一次答错补一张。
  if (onceThisFight('scratch')) {
    const got = drawCards(BAL.scratchDraw);
    if (got) {
      ctx.drawn += got;
      addNote(ctx, `草稿纸：这一场第一次答错，补抽 ${got} 张。`);
    }
  }

  // 橡皮：这一场第一次答错补 3 点格挡，不救那一手。
  if (onceThisFight('eraser')) {
    grantBlock(BAL.eraserBlock);
    ctx.blk += BAL.eraserBlock;
    addNote(ctx, `橡皮：这一场第一次答错，补了 ${BAL.eraserBlock} 点格挡。`);
  }

  G.topicWrong[ctx.q.topic] = (G.topicWrong[ctx.q.topic] || 0) + 1;
  G.runBad += 1;
  G.stageBad += 1;
  ctx.mem.lapses += 1;
  ctx.mem.bad += 1;
  addNote(ctx, '这一手不花行动力：代价是这一场少了一道题。');

  const missNote = onPlayerMiss();
  if (missNote) addNote(ctx, missNote);

  // 稳固度下降、到期提前：惩罚靠日程不靠扣血。
  // 书套：这一场第一次答错，两项都不动。
  if (onceThisFight('slipcase')) {
    addNote(ctx, '书套：这一场第一次答错，稳固度和到期都没动。');
  } else {
    ctx.mem.stab = Math.max(1, ctx.mem.stab * MISS_RULE.stabDrop);
    ctx.mem.due = 1;
  }
}

function settleAnswerAp(ctx: AnswerCtx) {
  // 节奏结算：答对先付再退最多 1 点；答错一分不扣。
  if (ctx.right) {
    spendAp(ctx.spent);
    // 退款上限来自借书证；荧光笔是额外一层，不进 `refundOf`。
    let back = refundOf(ctx.spent, rulesOf().refund) + G.markerRefund;
    // 回形针：这一场第一次打出 3 费以上的牌，再多退 2 点。
    if (ctx.spent >= 3 && onceThisFight('clip')) {
      back += BAL.clipRefund;
      addNote(ctx, `回形针：这一场第一次打出 ${ctx.spent} 费牌，多退 ${BAL.clipRefund} 点。`);
    }
    G.markerRefund = 0;
    if (back > 0) {
      gainAp(back);
      addNote(ctx, back > ctx.spent
        ? `答对了，退回 ${back} 点：这一手净赚 ${back - ctx.spent} 点。`
        : back >= ctx.spent
          ? '答对了，这一手不花行动力。'
          : `答对了，退回 ${back} 点：这张牌净花 ${ctx.spent - back} 点。`);
    }
  } else {
    G.markerRefund = 0;
  }
}

function finishAnswer(ctx: AnswerCtx) {
  // 装订线：这一场第一次答错，仍然按一半结算。
  if (!ctx.right && onceThisFight('binder')) {
    const r = strikeWith(ctx.id, 0.5, ctx.repeat);
    ctx.hits = r.out.hits;
    ctx.parts = r.parts;
    ctx.dmg = r.dmg;
    ctx.absorbed = r.absorbed;
    // `resolveEff` 已经把 mult 乘进格挡，这里不能再补一次。
    ctx.blk = r.blk;
    ctx.heal = r.heal;
    ctx.drawn += r.drawn;
    ctx.linkNote = r.linkNote;
    if (r.nextNote) addNote(ctx, `${r.nextNote}。`);
    addNote(ctx, `装订线：这一手仍然按一半结算`
      + `（${ctx.dmg} 伤害${r.blk ? `，${r.blk} 格挡` : ''}${r.drawn ? `，抽 ${r.drawn} 张` : ''}）。`);
  }

  G.busy = true;
  // 两条去向互斥：胶水壶留在手里，其余进弃牌堆。
  if (!ctx.backToHand) {
    G.discard.push(ctx.id);
    G.hand.splice(ctx.idx, 1);
  }
  saveMem();

  // 章节记忆按题号记，和卡牌记忆分开。
  recordAnswer({ stageTopic: G.stageTopic, qid: ctx.qid, right: ctx.right });
  G.answers.push({
    qid: ctx.qid, topic: ctx.q.topic, stageTopic: G.stageTopic, stage: G.stage, right: ctx.right, choice: ctx.choice,
    answer: ctx.view.answer, stem: ctx.q.q.slice(0, 80),
  });
  // 环形缓冲，只留最近若干条
  if (G.answers.length > 120) G.answers.shift();

  const effName = EFFS[ctx.card.eff].name;
  const shape = ctx.hits.length > 1 ? `${ctx.hits.join('+')} 伤害` : `${ctx.dmg} 伤害`;
  const missNote = ctx.backToHand ? '，牌留在手里' : '，进弃牌堆';
  const leftNote = G.qLeft.length
    ? `本场还剩 ${G.qLeft.length} 道新题`
    : '本场新题已用完，开始复用';
  log(
    `「${effName}·${ctx.q.topic}」${ctx.right ? '答对' : '答错'}` +
      (ctx.right
        ? `，${shape}${ctx.absorbed ? `（${ctx.absorbed} 被挡）` : ''}` +
          (ctx.blk ? `，${ctx.blk} 格挡` : '') +
          (ctx.selfHp ? `，失去 ${ctx.selfHp} 生命` : '') +
          (ctx.heal ? `，回 ${ctx.heal}` : '') +
          (ctx.drawn ? `，抽 ${ctx.drawn}` : '')
        : `，效果作废${ctx.blk ? `，${ctx.blk} 格挡` : '，这张牌本身没有格挡'}${missNote}`) +
      `　·　${leftNote}`,
    ctx.right ? 'hi' : 'bad',
  );

  checkPending();

  // 多段伤害按段错开发出；第一下同步发，表现层靠它在本帧知道这一手打出去了。
  // 0 伤害 / 装订线半结算 / 答错焰灭的判定统一在 publishStrike 里。
  publishStrike(
    { parts: ctx.parts, blk: ctx.blk, heal: ctx.heal },
    ctx.card.eff,
    { wrong: !ctx.right, base: ctx.parts.length * 150 },
  );

  const fb: Feedback = {
    idx: ctx.idx, qid: ctx.qid, choice: ctx.choice, right: ctx.right,
    dmg: ctx.dmg, absorbed: ctx.absorbed, blk: ctx.blk, eff: ctx.card.eff,
    hits: ctx.hits, parts: ctx.parts, heal: ctx.heal, draw: ctx.drawn,
    apNote: ctx.notes.join(' '), linkNote: ctx.linkNote,
    explain: ctx.q.explain, question: ctx.q.q, options: ctx.view.options, answer: ctx.view.answer,
    topic: ctx.q.topic,
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
  // 这一手的价格：X 费按此刻剩余的全部行动力，先定价再结算。
  const xcost = isXCost(card);
  const spent = xcost ? G.ap : costNow(card);
  const repeat = xcost ? Math.max(1, spent) : 1;

  const ctx: AnswerCtx = {
    idx, qid, choice, id, card, q, view, right,
    spent, repeat, xcost,
    mem: memOf(card.id),
    dmg: 0, absorbed: 0, blk: 0, heal: 0, drawn: 0, selfHp: 0,
    hits: [], parts: [], linkNote: '', nextNote: '', backToHand: false, notes: [],
  };
  if (right) resolveRight(ctx);
  else resolveWrong(ctx);
  settleAnswerAp(ctx);
  finishAnswer(ctx);
}

/**
 * 最近一次判定的完整结果。
 * 答对不再有面板可读，测试和调试仍要拿到"这一手打了几段、退了几点"。
 */
let lastFb: Feedback | null = null;
export function lastFeedback() {
  return lastFb;
}
