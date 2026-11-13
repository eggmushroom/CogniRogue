import { BAL, MISS_RULE } from '../model/data';
import { EFFS } from '../model/effects';
import type { CardDef, CardId, Feedback, QView, Question } from '../model/types';
import { G, checkPending, log, topTopic } from '../infra/state';
import { onPlayerMiss } from './foe';
import { defOf } from '../cards/registry';
import { gradeNeed } from '../cards/grade';
import { onceThisFight, rulesOf } from '../cards/powers';
import { costNow, isXCost, refundOf } from '../cards/cost';
import { memOf, saveMem } from '../library/memory';
import { recordAnswer } from '../library/stagemem';
import {
  addNote, buildSettlement, emptySettlement, mergeSettlement, planThorns, settle, viewOf,
} from './settlement';
import type { Settlement, StrikeView } from './settlement';

/**
 * 答题结算：答对 / 答错分支只改同一份 `Settlement`，最后由 `finishAnswer`
 * 交给唯一执行器。判定面板、日志、免答记账都从这份计划的 `viewOf()` 派生，
 * 不存在「预演值」和「真实值」两套读数，也不需要逐字段拷贝。
 *
 * 加新增益优先改这里，不要再往通用路径里插分支。
 */

/** 一次答题的全部中间结果；唯一的结算真值是 `s`，其余是答题自己的身份信息。 */
class AnswerCtx {
  s: Settlement;
  backToHand = false;

  constructor(
    readonly idx: number,
    readonly qid: string,
    readonly choice: number,
    readonly id: CardId,
    readonly card: CardDef,
    readonly q: Question,
    readonly view: QView,
    readonly right: boolean,
    readonly spent: number,
    readonly repeat: number,
    readonly xcost: boolean,
    readonly mem: ReturnType<typeof memOf>,
  ) {
    this.s = emptySettlement(id);
  }

  /** 反馈与日志只读这一份派生视图；预算再怎么改，都不会出现漏拷的字段。 */
  get v(): StrikeView {
    return viewOf(this.s);
  }
}

function resolveRight(ctx: AnswerCtx) {
  // 毛笔：这一场第一次答对，段数 +1（不是翻倍）。记账必须在结算之前。
  const extra = onceThisFight('brush') ? BAL.brushRepeat : 0;
  ctx.s = buildSettlement(ctx.id, { repeat: ctx.repeat + extra });
  if (extra) addNote(ctx.s, `毛笔：这一场第一次答对，效果结算 ${ctx.repeat + extra} 次。`);
  if (ctx.v.selfHp) addNote(ctx.s, `反噬：失去 ${ctx.v.selfHp} 点生命。`);
  if (ctx.v.nextNote) addNote(ctx.s, `${ctx.v.nextNote}。`);
  if (ctx.xcost) addNote(ctx.s, `耗尽 ${ctx.spent} 点行动力，效果结算 ${ctx.repeat} 次。`);
  if (ctx.v.drawn) addNote(ctx.s, `专注：抽 ${ctx.v.drawn} 张。`);
  // 反伤只把伤害记进计划；敌人是否还活着读预演结果，段伤害还没逐段落地。
  const back = planThorns(ctx.s);
  if (back) addNote(ctx.s, `反伤：你受到 ${back} 点。`);

  // 答对抽牌由双面镜提供，默认关闭；上限读 `rulesOf().answerDraw`。
  const cap = rulesOf().answerDraw;
  if (G.answerDrawsThisTurn < cap) {
    ctx.s.budget.draw += BAL.answerDraw;
    G.answerDrawsThisTurn += BAL.answerDraw;
    G.answerDraws += BAL.answerDraw;
    addNote(ctx.s, `答对：抽 ${BAL.answerDraw} 张（本回合 ${G.answerDrawsThisTurn}/${cap}）。`);
  }

  // 书签：这一场第一道答对补格挡，和双面镜（给牌）分属两条线。
  if (onceThisFight('bookmark')) {
    ctx.s.budget.blk += BAL.bookmarkBlock;
    addNote(ctx.s, `书签：这一场第一道答对，获得 ${BAL.bookmarkBlock} 点格挡。`);
  }

  // 答对攒等级，攒够 `gradeNeed` 这场就免答；按卡 id 记，同名牌副本共用。
  const need = gradeNeed(ctx.card);
  if (need > 0) {
    const before = G.charge[ctx.card.id] ?? 0;
    G.charge[ctx.card.id] = Math.min(need, before + 1);
    if (G.charge[ctx.card.id] >= need && before < need) {
      addNote(ctx.s, `这一场「${ctx.card.name}」已免答：再打它不用答题。`);
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
    addNote(ctx.s, `批注：这一场第一道答对，稳固度额外 +${BAL.marginStab}。`);
  }
  ctx.mem.stab = Math.min(60, Math.max(ctx.mem.stab * (1 + 0.8 * stabGain), ctx.mem.stab + stabGain));
  ctx.mem.due = Math.round(ctx.mem.stab);
  // 荧光笔：这一手多退 1 点，在 settleAnswerAp 统一结算。
  if (onceThisFight('marker')) {
    G.markerRefund += 1;
    addNote(ctx.s, '荧光笔：这一场第一道答对，这一手多退 1 点行动力。');
  }
}

function resolveWrong(ctx: AnswerCtx) {
  // 答错：这一手作废，不补格挡、不补抽，牌进弃牌堆。
  if (onceThisFight('gluepot')) {
    // 胶水壶：这一场第一次答错，牌留在手里；回合结束照常进弃牌堆。
    ctx.backToHand = true;
    addNote(ctx.s, '胶水壶：这张牌没有离开手牌，这一回合还能再打它。');
  } else {
    // 默认：进弃牌堆，要等洗牌才回来。
    addNote(ctx.s, '它进了弃牌堆，要等洗牌才回来。');
  }

  // 草稿纸：这一场第一次答错补一张。
  if (onceThisFight('scratch')) {
    ctx.s.budget.draw += BAL.scratchDraw;
    addNote(ctx.s, `草稿纸：这一场第一次答错，补抽 ${BAL.scratchDraw} 张。`);
  }

  // 橡皮：这一场第一次答错补 3 点格挡，不救那一手。
  if (onceThisFight('eraser')) {
    ctx.s.budget.blk += BAL.eraserBlock;
    addNote(ctx.s, `橡皮：这一场第一次答错，补了 ${BAL.eraserBlock} 点格挡。`);
  }

  G.topicWrong[ctx.q.topic] = (G.topicWrong[ctx.q.topic] || 0) + 1;
  G.runBad += 1;
  G.stageBad += 1;
  ctx.mem.lapses += 1;
  ctx.mem.bad += 1;

  const missNote = onPlayerMiss(ctx.s);
  if (missNote) addNote(ctx.s, missNote);

  // 稳固度下降、到期提前：惩罚靠日程不靠扣血。
  // 书套：这一场第一次答错，两项都不动。
  if (onceThisFight('slipcase')) {
    addNote(ctx.s, '书套：这一场第一次答错，稳固度和到期都没动。');
  } else {
    ctx.mem.stab = Math.max(1, ctx.mem.stab * MISS_RULE.stabDrop);
    ctx.mem.due = 1;
  }
}

function settleAnswerAp(ctx: AnswerCtx) {
  // 节奏结算：答对先付再退最多 1 点；答错一分不扣。
  // 付与退都只记进计划，由执行器在本帧写完，不在两处各写一次 G.ap。
  if (ctx.right) {
    ctx.s.budget.ap.spend = ctx.spent;
    // 退款上限来自借书证；荧光笔是额外一层，不进 `refundOf`。
    let back = refundOf(ctx.spent, rulesOf().refund) + G.markerRefund;
    // 回形针：这一场第一次打出 3 费以上的牌，再多退 2 点。
    if (ctx.spent >= 3 && onceThisFight('clip')) {
      back += BAL.clipRefund;
      addNote(ctx.s, `回形针：这一场第一次打出 ${ctx.spent} 费牌，多退 ${BAL.clipRefund} 点。`);
    }
    G.markerRefund = 0;
    ctx.s.budget.ap.gain = back;
    if (back > 0) {
      addNote(ctx.s, back > ctx.spent
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
  // 两份计划合并，而不是把 11 个字段手工拷一遍：橡皮刚记的格挡、
  // 装订线的自伤与联动说明，全都由 mergeSettlement 保住。
  if (!ctx.right && onceThisFight('binder')) {
    const half = buildSettlement(ctx.id, { mult: 0.5, repeat: ctx.repeat });
    const added = viewOf(half);
    ctx.s = mergeSettlement(ctx.s, half);
    if (ctx.v.nextNote) addNote(ctx.s, `${ctx.v.nextNote}。`);
    addNote(ctx.s, `装订线：这一手按一半结算`
      + `（${added.dmg} 伤害${added.blk ? `，${added.blk} 格挡` : ''}${added.drawn ? `，抽 ${added.drawn} 张` : ''}）。`);
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
  const v = ctx.v;
  const shape = v.hits.length > 1 ? `${v.hits.join('+')} 伤害` : `${v.dmg} 伤害`;
  const missNote = ctx.backToHand ? '，牌留在手里' : '，进弃牌堆';
  const leftNote = G.qLeft.length
    ? `本场还剩 ${G.qLeft.length} 道新题`
    : '本场新题已用完，开始复用';
  log(
    `「${effName}·${ctx.q.topic}」${ctx.right ? '答对' : '答错'}` +
      (ctx.right
        ? `，${shape}${v.absorbed ? `（${v.absorbed} 被挡）` : ''}` +
          (v.blk ? `，${v.blk} 格挡` : '') +
          (v.selfHp ? `，失去 ${v.selfHp} 生命` : '') +
          (v.heal ? `，回 ${v.heal}` : '') +
          (v.drawn ? `，抽 ${v.drawn}` : '')
        : `，效果作废${v.blk ? `，${v.blk} 格挡` : '，这张牌不带格挡'}${missNote}`) +
      `　·　${leftNote}`,
    ctx.right ? 'hi' : 'bad',
  );

  // 同步这一刻只判玩家侧的即时死亡；敌人是否被打死要等最后一段落地，
  // 由执行器再判一次。
  checkPending();

  settle(ctx.s);

  const fb: Feedback = {
    idx: ctx.idx, qid: ctx.qid, choice: ctx.choice, right: ctx.right,
    dmg: v.dmg, absorbed: v.absorbed, blk: v.blk, eff: ctx.card.eff,
    hits: v.hits, parts: v.parts, heal: v.heal, draw: v.drawn,
    apNote: ctx.s.notes.join(' '), linkNote: v.linkNote,
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

  const ctx = new AnswerCtx(
    idx, qid, choice, id, card, q, view, right, spent, repeat, xcost, memOf(card.id),
  );
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
