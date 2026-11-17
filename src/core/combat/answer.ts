import { BAL } from '../model/data';
import type { CardDef, CardId, Feedback, QView, Question } from '../model/types';
import { G, checkPending, topTopic } from '../infra/state';
import { onPlayerMiss } from './foe';
import { defOf } from '../cards/registry';
import { askOf } from '../cards/ask';
import { onceThisFight, rulesOf } from '../cards/powers';
import { costNow, isXCost, refundOf } from '../cards/cost';
import { recordAnswer } from '../library/stagemem';
import {
  addNote, buildSettlement, emptySettlement, mergeSettlement, planThorns, settle, viewOf,
} from './settlement';
import type { Settlement, StrikeView } from './settlement';

/**
 * 答题结算：答对 / 答错分支只改同一份 `Settlement`，最后由 `finishAnswer`
 * 交给唯一执行器。判定面板与免答记账都从这份计划的 `viewOf()` 派生，
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
  ) {
    this.s = emptySettlement(id);
  }

  /** 反馈只读这一份派生视图；预算再怎么改，都不会出现漏拷的字段。 */
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

  // 答对攒答题次数，攒够 `askOf` 这场就免答；按卡 id 记，同名牌副本共用。
  // 批注在这一场第一次答对时多攒一次，和这次答对本来攒的那次一起加。
  const need = askOf(ctx.card);
  const bonus = need > 0 && onceThisFight('margin') ? BAL.marginCharge : 0;
  if (need > 0) {
    const before = G.charge[ctx.card.id] ?? 0;
    G.charge[ctx.card.id] = Math.min(need, before + 1 + bonus);
    if (bonus) {
      // 不写（已攒/要求）：答题要求是隐藏属性，前端不显示这个分数。
      addNote(ctx.s, `批注：这一场第一道答对，这张牌多攒 ${bonus} 次免答。`);
    }
    if (G.charge[ctx.card.id] >= need && before < need) {
      addNote(ctx.s, `这一场「${ctx.card.name}」已免答：再打它不用答题。`);
    }
  }

  G.okThisTurn += 1;
  G.runOk += 1;
  G.stageOk += 1;
  // 记的是本回合答对的题主题，`topTopic()` 之后可能被改写，结算时重对一次。
  if (ctx.q.topic === topTopic()) G.topOkTopic = ctx.q.topic;
  // 荧光笔：这一手多退 1 点，在 settleAnswerAp 统一结算。
  if (onceThisFight('marker')) {
    G.markerRefund += BAL.markerPlus;
    addNote(ctx.s, `荧光笔：这一场第一道答对，这一手多退 ${BAL.markerPlus} 点行动力。`);
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

  // 错题簿决定「遗忘」盯哪个主题（`topTopic()`）：书套让这一场第一次答错不上账。
  // 记的是主题不是卡，所以它保护的是"这一题所属的主题"。
  G.runBad += 1;
  G.stageBad += 1;
  if (onceThisFight('slipcase')) {
    addNote(ctx.s, '书套：这一道答错不记进错题簿，「遗忘」不会因此盯上这个主题。');
  } else {
    G.topicWrong[ctx.q.topic] = (G.topicWrong[ctx.q.topic] || 0) + 1;
  }

  const missNote = onPlayerMiss(ctx.s);
  if (missNote) addNote(ctx.s, missNote);
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
  // 装订线：这一场第一次答错，这一手照样打出去，只是按费用削减。
  // 两份计划合并，而不是把 11 个字段手工拷一遍：橡皮刚记的格挡、
  // 装订线的自伤与联动说明，全都由 mergeSettlement 保住。
  if (!ctx.right && onceThisFight('binder')) {
    const n = Math.max(1, ctx.spent);
    const cut = buildSettlement(ctx.id, {
      cut: { atk: BAL.binderAtkCut * n, blk: BAL.binderBlkCut * n },
      repeat: ctx.repeat,
    });
    const added = viewOf(cut);
    ctx.s = mergeSettlement(ctx.s, cut);
    if (ctx.v.nextNote) addNote(ctx.s, `${ctx.v.nextNote}。`);
    addNote(ctx.s, `装订线：这一手照样打出去`
      + `（${added.dmg} 伤害${added.blk ? `，${added.blk} 格挡` : ''}${added.drawn ? `，抽 ${added.drawn} 张` : ''}）。`);
  }

  G.busy = true;
  // 两条去向互斥：胶水壶留在手里，其余进弃牌堆。
  if (!ctx.backToHand) {
    G.discard.push(ctx.id);
    G.hand.splice(ctx.idx, 1);
  }

  // 章节记忆按题号记；跨局的卡牌熟练度表已经删掉，这里只留会影响出题的那一份。
  // 主题取题目自己的 `topic`，不取 `G.stageTopic`：题池回退到全部题目时两者不同，
  // 按幕的主题记账会把别的主题的题记到这一章上。
  recordAnswer({ stageTopic: ctx.q.topic, qid: ctx.qid, right: ctx.right });
  // 答对即出局：这一局不再抽它，把位置让给还没学会的题。
  // 只有"对"才出局 —— 答错的题必须回来，否则错题就再也见不到了。
  if (ctx.right) G.qSolved[ctx.qid] = true;

  const v = ctx.v;
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
    idx, qid, choice, id, card, q, view, right, spent, repeat, xcost,
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
