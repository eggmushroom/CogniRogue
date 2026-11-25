import { g, roundRect, VH, VW, wrapText } from '../gfx/canvas';
import { C, PRESS, font, FONT_TITLE, FONT_UI, topicColor, withAlpha } from '../gfx/theme';
import { action, choiceCard, cutRule, drawCard, panel, text } from '../gfx/ui';
import { drawArtIcon } from '../gfx/art/icons';
import { drawPowerIcon } from '../gfx/art/powers';
import { consumeWheel, hover, onClick } from '../input';
import { drawMarkdown, layoutMarkdown } from '../gfx/markdown';
import { easeOut } from '../gfx/geom';
import { reduceMotion, type QuestionMotion } from '../gfx/motion';
import { BAL, MODES, POWER_BY_ID, effSummaryOf } from '../core/model';
import { clamp, G, shuffle } from '../core/infra';
import { curFloor } from '../core/map';
import {
  activeBankId, allQuestions, isRetired, listBanks, requestRunPool,
  serviceOnline, sourceBank,
} from '../core/library';
import {
  BASICS, costOf, defOf, isUpgraded, upgradedId,
  isXCost, rulesStatic, UP_MARK,
} from '../core/cards';
import { answer, MAX_PICK_PER_RUN } from '../core/combat';
import { basicsSummary, planStrike } from '../core/combat/strike';
import {
  ackCardGet, ackPower, canPayHp, cancelPreview, chooseEventOption, forgetCard,
  openCardPick, previewUpgrade,
  restHeal, restWanted, startRun, skipReward, takeCard, upgradeCard,
} from '../core/journey';
import type { Feedback, ModeId, PowerDef, Question, QView } from '../core/model';
import { drawPackPanel, drawPlanPanel, drawSettingsPanel } from './overlay/library';
import { box, heading, MENU_BUTTON_H, MENU_RADIUS, MENU_ROW_RADIUS, overflowAffordance, resetScroll, scrollArea } from './overlay/common';
import { drawReport } from './report';
import { closeFeedback, questionCard, type QuizFlipCard } from './battle';

export function drawOverlay(t: number, quiz: QuizState = IDLE_QUIZ, age = 0) {
  const p = G.panel;
  quizFrameInfo = { ...quizFrameInfo, drawn: false, phase: 'idle', entry: 'ready' };
  switch (p.k) {
    case 'question': return drawQuestion(p.idx, p.q, p.view, quiz.entry);
    case 'boon': return drawBoon();
    case 'topic': return drawTopics(p);
    case 'feedback':
      if (p.fb.right) return;
      return drawFeedback(quiz);
    case 'reward': return drawReward(age);
    case 'powerdrop': return drawPowerDrop(age);
    case 'cardget': return drawCardGet();
    case 'rest': return drawRest(t);
    case 'cardpick': return drawCardPick(p.mode);
    case 'event': return drawEvent();
    case 'deck': return drawGallery('牌组', G.deck);
    case 'pile': return drawGallery(p.kind === 'draw' ? '抽牌堆' : '弃牌堆',
      p.kind === 'draw' ? G.draw.slice().reverse() : G.discard);
    case 'help': return drawHelp();
    case 'pack': return drawPackPanel(t);
    case 'settings': return drawSettingsPanel(t);
    case 'plan': return drawPlanPanel(p.data);
    case 'report': return drawReport(p.data);
    default: return;
  }
}
/* ── 答题 ─────────────────────────────────────────────────── */

// 右缘 944：敌人状态牌左端 950、名字从 966 起。留 22px 给名字描边，
// 别再把首字切掉。整块左移而不是缩 QW —— 题干换行、选项条、底部说明都不动。
const QX = 52;
const QW = 892;

/** 调试/冒烟用：答题面板现场，判定有没有换过框。 */
export interface QuizFrameInfo {
  drawn: boolean;
  phase: 'idle' | 'ask' | 'settle' | 'result';
  entry: 'front' | 'question' | 'ready';
  flipAt?: { x: number; y: number };
  optionBottom?: number;
  manual?: boolean;
  review?: { answer: number; choice: number; explained: boolean };
  geom: { x: number; y: number; w: number; h: number };
}
let quizFrameInfo: QuizFrameInfo = {
  drawn: false, phase: 'idle', geom: { x: QX, y: 48, w: QW, h: 700 }, entry: 'ready',
};
export const quizFrame = () => quizFrameInfo;

export interface QuizState {
  entry: QuestionMotion | null;
  exit?: { motion: QuestionMotion; card: QuizFlipCard } | null;
  /** 判定已出、打击演出还在飞；面板不消失，结果区还没展开 */
  settling: boolean;
  reveal: number;
}
const IDLE_QUIZ: QuizState = {
  entry: null, settling: false, reveal: 0,
};

// Leave room for the result before asking so the same question never changes frame or reflows.
const QUIZ_FOOTER = 84;
const QUIZ_PAD = 34;

let quizOptions: readonly string[] | undefined;

function quizPanel(question: string, options: readonly string[]) {
  if (quizOptions !== options) {
    quizOptions = options;
    resetScroll('quiz-body');
    resetScroll('quiz-explain');
  }
  const width = QW - QUIZ_PAD * 2;
  const stem = layoutMarkdown(question, width, 26, 700);
  const choices = options.map((option) => {
    const layout = layoutMarkdown(option, width - 104, 18);
    return { layout, h: Math.max(56, layout.h + 24) };
  });
  const headH = 104;
  const gap = 12;
  const contentH = stem.h + 24 + choices.reduce((sum, choice) => sum + choice.h, 0) + (choices.length - 1) * gap;
  const h = clamp(headH + contentH + QUIZ_FOOTER, 580, VH - 96);
  const y = (VH - h) / 2;
  return { x: QX, y, w: QW, h, stem, choices, gap, contentH,
    bodyY: y + headH, footer: y + h - QUIZ_FOOTER };
}

function dimQuestion(k = 1) {
  const lg = g.createLinearGradient(0, 0, 0, VH);
  lg.addColorStop(0, `rgba(3,4,8,${(0.66 * k).toFixed(3)})`);
  lg.addColorStop(0.55, `rgba(3,4,8,${(0.7 * k).toFixed(3)})`);
  lg.addColorStop(1, `rgba(3,4,8,${(0.8 * k).toFixed(3)})`);
  g.fillStyle = lg;
  g.fillRect(0, 0, VW, VH);
}

/** 面板和牌面共用同一个变换，过侧边时只换内容，不换位置、尺寸或角度。 */
function drawQuizFlip({ x, y, w, h }: QuizFrameInfo['geom'], origin: QuizFlipCard, motion: QuestionMotion) {
  const p = motion.progress;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const landing = origin.landing ?? origin;
  const back = motion.returning ?? 0;
  const lerp = (from: number, to: number, k: number) => from + (to - from) * k;
  const width = lerp(lerp(origin.w, landing.w, back), w, p);
  const height = lerp(lerp(origin.h, landing.h, back), h, p);
  const face = Math.cos(Math.PI * p);
  const at = { x: lerp(lerp(origin.x, landing.x, back), cx, p), y: lerp(lerp(origin.y, landing.y, back), cy, p) };
  quizFrameInfo.flipAt = at;
  g.translate(at.x, at.y);
  g.rotate(lerp(origin.rotation, landing.rotation, back) * (1 - p));
  g.scale(Math.max(0.01, Math.abs(face)), 1);
  if (face > 0) {
    quizFrameInfo.entry = 'front';
    g.scale(width / origin.w, height / origin.h);
    origin.drawFront();
    return false;
  }
  quizFrameInfo.entry = 'question';
  g.scale(width / w, height / h);
  g.translate(-cx, -cy);
  return true;
}

function drawQuestion(idx: number, q: Question, view: QView, entry: QuizState['entry']) {
  const ent = G.hand[idx];
  if (!ent) return;
  const card = defOf(ent);
  // 题面是点开那一刻的快照，选项顺序来自本次打乱；反馈面板读同一份。
  const options = view.options;
  const gm = quizPanel(q.q, options);
  const { x, y, w } = gm;
  const col = C.blue;
  const geom = { x, y, w, h: gm.h };
  quizFrameInfo = { drawn: true, phase: 'ask', geom, entry: 'ready', optionBottom: gm.footer };

  const origin = questionCard();
  dimQuestion(entry?.progress ?? 1);
  g.save();
  if (origin && entry && !entry.ready && !drawQuizFlip(geom, origin, entry)) {
    g.restore();
    return;
  }
  box(x, y, w, gm.h, col, undefined, MENU_RADIUS);

  const headX = x + 64;
  text(`${card.name}${isUpgraded(ent) ? '+' : ''}`, headX, y + 38, {
    size: 22, weight: 700, family: FONT_TITLE, maxW: w - 98,
  });
  const xc = isXCost(card);
  text(`${xc ? 'X' : costOf(card)} 行动力`, headX, y + 67, { size: 14, color: C.gold, weight: 700 });
  cutRule(x + 166, y + 67, 14, C.lineHi, 0.8);
  text(effSummaryOf(planStrike(ent), card.eff, xc), x + 192, y + 67, {
    size: 14, color: C.ink2, maxW: w - 226,
  });

  drawQuizBody(gm, undefined, false, quizFrameInfo.entry === 'ready');
  g.restore();
}

/** The answer and its review keep the same wrapped rows, even while the battle settles. */
function drawQuizBody(gm: ReturnType<typeof quizPanel>, fb?: Feedback, settling = false, interactive = !settling, wheel = interactive ? consumeWheel() : 0) {
  const { x, w, bodyY, footer, gap, stem, choices, contentH } = gm;
  const left = x + QUIZ_PAD;
  const width = w - QUIZ_PAD * 2;
  const bodyH = footer - bodyY;
  const view = scrollArea(left, bodyY, width, bodyH, contentH, 'quiz-body', wheel);
  drawMarkdown(stem, left, view.y);
  let nextY = view.y + stem.h + 24;
  g.fillStyle = C.line;
  g.fillRect(left, nextY - 12, width, 1);

  choices.forEach(({ layout, h: rowH }, i) => {
    const by = nextY;
    nextY += rowH + gap;
    const top = Math.max(by, bodyY);
    const hitH = Math.min(by + rowH, footer) - top;
    if (hitH <= 0) return;
    const mid = by + 28;
    const hv = interactive && !fb && hover(left, top, width, hitH);
    const picked = i === fb?.choice;
    const tint = picked ? C.gold : hv ? C.blue : null;
    panel(left, by, width, rowH, {
      radius: MENU_ROW_RADIUS,
      fill: tint ? withAlpha(tint, 0.12) : PRESS.sheet,
      stroke: tint ?? C.line,
    });
    panel(left + 16, mid - 14, 28, 28, { radius: 6, fill: C.panel, stroke: tint ?? C.line });
    text('ABCD'[i] ?? String(i + 1), left + 30, mid, { size: 15, weight: 700, align: 'center', color: tint ?? C.ink2 });

    drawMarkdown(layout, left + 60, by + (rowH - layout.h) / 2, hv || picked ? C.ink : C.ink2);
    if (interactive && !fb) onClick(left, top, width, hitH, () => answer(i), 'opt');
  });
  view.restore();
  overflowAffordance(view, left, width, interactive);
}

function drawFeedback(quiz: QuizState) {
  const p = G.panel;
  if (p.k !== 'feedback') return;
  const fb = p.fb;
  const gm = quizPanel(fb.question, fb.options);
  const { x, y, w, h } = gm;
  const geom = { x, y, w, h };
  quizFrameInfo = { drawn: true, phase: quiz.settling ? 'settle' : 'result', geom, entry: 'ready' };
  const exit = quiz.exit;
  dimQuestion(exit?.motion.progress ?? 1);
  g.save();
  if (!exit || drawQuizFlip(geom, exit.card, exit.motion)) drawFeedbackBody(gm, fb, quiz);
  g.restore();
}

function drawFeedbackBody(gm: ReturnType<typeof quizPanel>, fb: Feedback, quiz: QuizState) {
  const { x, y, w, h, footer } = gm;
  const { settling } = quiz;
  box(x, y, w, h, settling ? C.blue : C.red, settling ? null : { kind: 'close', side: 'left', run: closeFeedback }, MENU_RADIUS);
  if (settling) {
    drawQuizBody(gm, fb, true);
    return;
  }
  text('答错', x + 64, y + 42, { size: 26, weight: 700, family: FONT_TITLE, color: C.red });
  drawQuizReview(gm, fb, quiz.reveal, !quiz.exit);
  g.fillStyle = C.line;
  g.fillRect(x + QUIZ_PAD, footer, w - QUIZ_PAD * 2, 1);
  const bw = 132;
  const bh = MENU_BUTTON_H;
  action(x + w - QUIZ_PAD - bw, footer + (QUIZ_FOOTER - bh) / 2, bw, bh,
    '继续', closeFeedback, 'primary', { size: 16, r: MENU_ROW_RADIUS });
}

function drawQuizReview(gm: ReturnType<typeof quizPanel>, fb: Feedback, age: number, interactive: boolean) {
  const left = gm.x + QUIZ_PAD;
  const w = gm.w - QUIZ_PAD * 2;
  const top = gm.y + 82;
  const correct = layoutMarkdown(fb.options[fb.answer] ?? '', w - 40, 25, 700);
  const explain = layoutMarkdown(fb.explain, w - 24, 19);
  const picked = layoutMarkdown(fb.options[fb.choice] ?? '', w - 28, 17);
  const question = layoutMarkdown(fb.question, w - 24, 16);
  const notes = layoutMarkdown(fb.apNote, w - 24, 14);
  const answerH = 68 + correct.h;
  const explanationH = explain.h ? 52 + explain.h : 0;
  const pickedH = 50 + picked.h;
  const questionH = 44 + question.h;
  const contentH = answerH + explanationH + pickedH + questionH + (notes.h ? notes.h + 22 : 0);
  const review = scrollArea(left, top, w, gm.footer - top - 12, contentH, 'quiz-explain', interactive ? consumeWheel() : 0);
  quizFrameInfo.manual = review.max > 0;
  quizFrameInfo.review = { answer: fb.answer, choice: fb.choice, explained: explain.h > 0 };
  const { y } = review;
  const mark = reduceMotion() ? 1 : easeOut(clamp(age / 0.45, 0, 1));
  g.fillStyle = withAlpha(C.green, 0.13);
  g.fillRect(left, y, w, answerH - 16);
  g.fillStyle = C.green;
  g.fillRect(left, y, 3, answerH - 16);
  drawArtIcon('check', left + 22, y + 20, 18, C.green);
  text('正确答案', left + 40, y + 20, { size: 15, weight: 700, color: C.green });
  drawMarkdown(correct, left + 20, y + 36);
  let underline = 32;
  for (const row of correct.rows) for (const run of row.runs) underline = Math.max(underline, run.x + run.w);
  cutRule(left + 20, y + 40 + correct.h, Math.max(6, underline * mark), C.green, 0.85);

  let rowY = y + answerH;
  if (explain.h) {
    text('解析', left + 12, rowY + 12, { size: 16, weight: 700, color: C.gold });
    g.fillStyle = withAlpha(C.gold, 0.46);
    g.fillRect(left + 1, rowY + 28, 2, explain.h);
    drawMarkdown(explain, left + 12, rowY + 27);
    rowY += explanationH;
  }
  cutRule(left, rowY, w, C.lineHi, 0.54);
  drawArtIcon('close', left + 12, rowY + 21, 15, C.red);
  text('你的选择', left + 28, rowY + 21, { size: 14, weight: 700, color: C.red });
  drawMarkdown(picked, left + 12, rowY + 33, C.ink2);
  rowY += pickedH;
  text('原题', left + 12, rowY + 14, { size: 14, weight: 700, color: C.dim });
  drawMarkdown(question, left + 12, rowY + 26, C.ink2);
  if (notes.h) drawMarkdown(notes, left + 12, rowY + questionH, C.dim);
  review.restore();
  overflowAffordance(review, left, w, interactive);
}

/* ── 奖励 ─────────────────────────────────────────────────── */

function drawReward(age: number) {
  const p = G.panel;
  if (p.k !== 'reward') return;
  const isElite = G.node?.type === 'elite';

  const w = 1220;
  const h = 640;
  const x = (VW - w) / 2;
  const y = 130;
  box(x, y, w, h, C.gold, { kind: 'close', run: skipReward });
  revealRule(x + 44, y + 122, w - 88, C.gold, age);

  heading('战斗结束', x + 44, y + 66,
    isElite ? '精英倒下了。挑一张卡，之后还会掉一个增益。'
      : p.ledger ? '账本翻开了：这一屏多一个选项，选中的牌直接精炼。'
        : '挑一张放进牌组。');

  // 张数是活的；四张时按可用宽度等比缩放，保留面板左右两侧的留白。
  const n = p.cards.length;
  const baseCw = 280;
  const baseCh = 356;
  const baseGap = 34;
  const pad = 72;
  const natural = n * baseCw + (n - 1) * baseGap;
  const k = Math.min(1, (w - pad * 2) / Math.max(1, natural));
  const cw = Math.floor(baseCw * k);
  const ch = Math.floor(baseCh * k);
  const gap = Math.floor(baseGap * k);
  const totalW = n * cw + (n - 1) * gap;
  const cx0 = x + (w - totalW) / 2;
  const cy = y + 142 + (baseCh - ch) / 2;

  p.cards.forEach((c, i) => {
    const px = cx0 + i * (cw + gap);
    const hv = hover(px, cy, cw, ch);
    const settle = reduceMotion() ? 1 : easeOut(clamp((age - i * 0.05) / 0.28, 0, 1));
    const lift = hv && !reduceMotion() ? -10 : 0;
    // 预览用牌本身的数值；直接画 c.atk 会和入牌组后的卡面不一致。
    const id = p.ledger ? c.id + UP_MARK : c.id;
    g.save();
    g.globalAlpha = 0.66 + 0.34 * settle;
    drawCard(px, cy + lift - 10 * (1 - settle), cw, ch, c, planStrike(id, { noBoost: true }), {
      glow: hv, up: p.ledger, rule: c.link?.note,
    });
    g.restore();
    onClick(px, cy, cw, ch, () => takeCard(i), 'rewardcard');
  });

  action(x + w / 2 - 340, y + h - 74, 300, 54, '跳过，不要卡', () => skipReward());
  text('牌组会变厚。', x + w / 2 + 40, y + h - 46, { size: 13, color: C.faint });
}

/* ── 增益掉落 ─────────────────────────────────────────────── */

/** 增益多久兑现一次，用玩家读得懂的话；作用域内部名不对玩家露出。 */
function scopeLine(scope: PowerDef['scope']): string {
  switch (scope) {
    case 'always': return '整局常驻，每次结算都算。';
    case 'fight': return '整局常驻，但每场战斗只兑现一次。';
    case 'stage': return '整局常驻，但每一幕只兑现一次。';
    case 'run': return '整局常驻，整局只兑现一次，用完就没了。';
    default: return '拾取即结算，之后不再触发。';
  }
}

function revealRule(x: number, y: number, w: number, color: string, age: number) {
  const k = reduceMotion() ? 1 : easeOut(clamp(age / 0.36, 0, 1));
  cutRule(x, y, Math.max(6, w * k), color, 0.44);
}

function drawPowerDrop(age: number) {
  const p = G.panel;
  if (p.k !== 'powerdrop') return;
  const pw = POWER_BY_ID[p.id];
  if (!pw) return;
  const w = 640;
  const pad = 36;
  const size = 72;
  const gap = 24;
  const width = w - pad * 2 - size - gap;
  g.font = font(17);
  const effect = wrapText(pw.card, width);
  g.font = font(14);
  const details = pw.desc ? wrapText(pw.desc, width) : [];
  const rowTop = 99;
  const effectTop = 42;
  const detailTop = effectTop + effect.length * 24 + 4;
  const rowH = Math.max(size, details.length ? detailTop + (details.length - 1) * 21 + 10 : detailTop - 18);
  const h = rowTop + rowH + 78;
  const x = (VW - w) / 2;
  const y = (VH - h) / 2;
  box(x, y, w, h, pw.color, null);
  heading('获得增益', x + pad, y + 42, scopeLine(pw.scope));
  revealRule(x + pad, y + rowTop - 10, w - pad * 2, pw.color, age);

  const tx = x + pad + size + gap;
  const ty = y + rowTop;
  drawPowerIcon(x + pad, ty, size, pw.id);
  text(pw.name, tx, ty + 12, { size: 24, weight: 700, family: FONT_TITLE, color: pw.color });
  effect.forEach((ln, i) => text(ln, tx, ty + effectTop + i * 24, { size: 17 }));
  details.forEach((ln, i) => text(ln, tx, ty + detailTop + i * 21, { size: 14, color: C.dim }));
  action(x + w / 2 - 92, y + h - 62, 184, 44, '知道了', () => ackPower());
}

/* ── 白送的卡 ─────────────────────────────────────────────── */

/**
 * 把刚进牌组的那几张牌摆出来。
 *
 * 事件给的是随机卡，选项上只能写「获得一张随机知识卡」—— 卡名要到选完才知道；
 * 增益「藏书」更是一次塞三张。只报名字，玩家仍然不知道那张牌打出来是几点。
 * 这一屏让他看见牌面本身。
 *
 * 没有"要不要"：卡在发的时候就进牌组了，按哪里都是同一个结果。
 */
function drawCardGet() {
  const p = G.panel;
  if (p.k !== 'cardget') return;
  const n = p.ids.length;
  const cw = 300;
  const chh = 372;
  const gap = 44;
  const rowW = n * cw + (n - 1) * gap;
  const w = Math.max(700, rowW + 160);
  const lines = p.note ? wrapText(p.note, w - 120).slice(0, 3) : [];
  const top = 118;
  const h = top + chh + (lines.length ? 34 + lines.length * 24 : 0) + 134;
  const x = (VW - w) / 2;
  const y = (VH - h) / 2;
  box(x, y, w, h, C.gold, null);

  heading(n === 1 ? '拿到一张卡' : `拿到 ${n} 张卡`, x + 44, y + 66);

  const x0 = x + (w - rowW) / 2;
  p.ids.forEach((id, i) => {
    const cx = x0 + i * (cw + gap);
    const cy = y + top;
    const hv = hover(cx, cy, cw, chh);
    drawCard(cx, cy, cw, chh, defOf(id), planStrike(id, { noBoost: true }), {
      up: isUpgraded(id), glow: hv,
    });
    onClick(cx, cy, cw, chh, () => ackCardGet(), `cardget:${i}`);
  });

  g.font = font(14, 400, FONT_UI);
  lines.forEach((ln, i) => {
    text(ln, x + 60, y + top + chh + 34 + i * 24, { size: 14, color: C.ink2 });
  });

  action(x + w / 2 - 110, y + h - 84, 220, 50, '知道了', () => ackCardGet(), 'primary');
}

/* ── 复习点 ───────────────────────────────────────────────── */

function drawRest(t: number) {
  const w = 1000;
  const h = 412;
  const x = (VW - w) / 2;
  const y = (VH - h) / 2;
  box(x, y, w, h, C.cyan, null);

  heading('复习', x + 44, y + 66, '这一层没有敌人。休息，或者动一动牌组。');

  const opts: Array<{ t: string; s: string; fn: () => void; col: string }> = [
    // 回复量走 restWanted()：它和 restHeal() 是同一个算法，修书胶、地图册都算进去了。
    // 近似满血时会被当前生命截断，但那是结算时的事，这里报的是「这一下给多少」。
    { t: '休息', s: `回复 ${restWanted()} 点生命`, col: C.green, fn: restHeal },
    // 下面两条说明都压在两行内：wrapText 按 240px 折，长句会把最后一个
    // 括号挤成孤零零一行（以前「遗忘」末尾只剩「删）」两个字）。
    // 精炼的方向由每张牌自己的 `up` 决定，界面不承诺具体加多少。
    { t: '精炼一张卡', s: '按这张牌自己的方向变强，同名的其余几张不变', col: C.gold, fn: () => openCardPick('up', { k: 'rest' }) },
    { t: '遗忘', s: '永久移除一张卡；只剩 4 张时不可删', col: C.purple, fn: () => openCardPick('rm', { k: 'rest' }) },
  ];

  const bw = 288;
  const bh = 200;
  const gap = 32;
  const totalW = opts.length * bw + (opts.length - 1) * gap;
  const bx0 = x + (w - totalW) / 2;

  opts.forEach((o, i) => {
    const bx = bx0 + i * (bw + gap);
    const by = y + 170;
    const hv = hover(bx, by, bw, bh);
    const bob = hv ? Math.sin(t * 6) * 2 : 0;
    roundRect(bx, by + bob, bw, bh, 14);
    g.fillStyle = hv ? withAlpha(o.col, 0.16) : 'rgba(255,255,255,.035)';
    g.fill();
    g.strokeStyle = hv ? o.col : withAlpha(o.col, 0.35);
    g.lineWidth = hv ? 2 : 1.3;
    g.stroke();

    text(o.t, bx + bw / 2, by + 80 + bob, { size: 25, weight: 700, align: 'center', color: hv ? o.col : C.ink, family: FONT_TITLE });
    g.font = font(13, 400, FONT_UI);
    g.fillStyle = C.ink2;
    wrapText(o.s, bw - 48).slice(0, 3).forEach((ln, k) => {
      g.textAlign = 'center';
      g.fillText(ln, bx + bw / 2, by + 122 + k * 20 + bob);
    });
    g.textAlign = 'left';
    onClick(bx, by, bw, bh, o.fn, o.t);
  });
}

/* ── 选一张牌 ─────────────────────────────────────────────── */

/**
 * 精炼 / 遗忘面板。
 *
 * 精炼分两态：先在**未精炼的牌**里挑一张（列表里画的都是原样），
 * 点中之后切到预览态 —— 这时才画「精炼后会变成什么样」，再由玩家确认或返回。
 * 取消了从不精炼的牌里挑，所以列表本身不需要 `+` 号、也不需要任何"第几张"的标注。
 *
 * 遗忘只有一态：点哪张删哪张，本来就没有"之后"。
 * 取消不付 `G.pendingCost`，选了才付。
 */
function drawCardPick(mode: 'up' | 'rm') {
  const p = G.panel;
  const pick = p.k === 'cardpick' ? p.pick : undefined;
  if (mode === 'up' && pick !== undefined) { drawUpPreview(pick); return; }
  const w = 1280;
  const h = 740;
  const x = (VW - w) / 2;
  const y = 90;
  box(x, y, w, h, mode === 'up' ? C.gold : C.purple);

  const pending = G.pendingCost;
  heading(mode === 'up' ? '精炼哪一张' : '遗忘哪一张', x + 44, y + 66,
    mode === 'up'
      ? '挑一张，下一页会显示它精炼后的样子。基础牌也能精炼。'
      : '移除后这张卡本局不会再出现。牌组会更薄，也更好抽；基础牌也能丢。');
  if (pending > 0) {
    // heading 的副标题基线在 y+100，代价提示要和它同一行、靠右对齐。
    // 早先放在 (x+44, y+106)，两行只差 6px，带代价的事件里会直接叠成一团。
    text(`选完要付 ${pending} 点生命；取消则不付。`, x + w - 44, y + 100, {
      size: 13, color: C.red, weight: 700, align: 'right',
    });
  }

  // 每一份副本单独一格；精炼按张，`i`（牌组下标）才是身份。
  const items = G.deck
    .map((id, i) => ({ id, i, d: defOf(id) }))
    .filter((o) => mode === 'rm' || !isUpgraded(o.id))
    .sort((a, b) => {
      const ca = costOf(a.d);
      const cb = costOf(b.d);
      const na = ca === 'x' ? 4 : ca;
      const nb = cb === 'x' ? 4 : cb;
      return na - nb || a.d.name.localeCompare(b.d.name) || a.i - b.i;
    });

  // 尺寸按"开局 10 张刚好两排、不用滚"反推。
  const cols = 5;
  const cw = 196;
  const ch = 248;
  const gapx = 26;
  const gapy = 32;
  const totalW = cols * cw + (cols - 1) * gapx;
  const gx0 = x + (w - totalW) / 2;
  const rows = Math.ceil(items.length / cols);
  const gridH = rows * (ch + gapy) - gapy;
  const areaH = h - 180;
  const area = scrollArea(x + 30, y + 130, w - 60, areaH, gridH, `pick:${mode}`);

  items.forEach((o, k) => {
    const col = k % cols;
    const row = Math.floor(k / cols);
    const px = gx0 - x - 30 + area.x + col * (cw + gapx);
    const py = area.y + row * (ch + gapy);
    const hv = hover(px, py, cw, ch);
    // 列表里一律画原样：这里是"还没精炼的牌"，画强化后的样子会先把答案说掉。
    drawCard(px, py, cw, ch, o.d, planStrike(o.id, { noBoost: true }), {
      glow: hv, rule: o.d.link?.note,
    });
    // 热区只登记当前露在列表里的那一段；按整卡登记会点到被裁掉的牌。
    const top = Math.max(py, area.y0);
    const bot = Math.min(py + ch, area.y0 + area.h);
    if (bot > top) {
      onClick(px, top, cw, bot - top,
        () => (mode === 'up' ? previewUpgrade(o.i) : forgetCard(o.i)), 'pick', o.i);
    }
  });
  area.restore();
  overflowAffordance(area, x + 30, w - 60);

  if (!items.length) {
    text(mode === 'up' ? '所有能精炼的牌都精炼过了。' : '没有可以移除的牌。',
      x + w / 2, y + h / 2, { size: 17, align: 'center', color: C.faint });
  } else if (area.max > 0) {
    text('滚轮查看更多', x + w / 2, y + h - 26, { size: 12, align: 'center', color: C.faint });
  }
}

/**
 * 精炼预览：左边原样、右边精炼后，两张卡并排比。
 *
 * **不再单独列一行「伤害 4 → 10」**：卡面本身已经写着两边的数，
 * 再排一行等于把同一件事说两遍。玩家读两张卡就知道变了什么。
 */
function drawUpPreview(i: number) {
  const id = G.deck[i];
  if (!id) { cancelPreview(); return; }
  const before = defOf(id);
  const after = defOf(upgradedId(id));

  const w = 900;
  const h = 640;
  const x = (VW - w) / 2;
  const y = (VH - h) / 2;
  box(x, y, w, h, C.gold);
  heading('精炼这张？', x + 40, y + 66, '左边是现在，右边是精炼后；确认了才会改牌组。');

  const cw = 300;
  const chh = 372;
  const cy = y + 132;
  const lx = x + w / 2 - cw - 44;
  const rx = x + w / 2 + 44;

  drawCard(lx, cy, cw, chh, before, planStrike(id, { noBoost: true }), { rule: before.link?.note });
  drawCard(rx, cy, cw, chh, after, planStrike(upgradedId(id), { noBoost: true }),
    { up: true, glow: true, rule: after.link?.note });

  // 中间的箭头：两列之间的空隙就是它。
  text('→', x + w / 2, cy + chh / 2, { size: 40, align: 'center', color: C.gold, weight: 700 });

  // 代价只在确认时结算。
  const bw = 200;
  const bh = 52;
  const by = y + h - 68;
  action(x + (w - bw) / 2, by, bw, bh, '确认精炼', () => upgradeCard(i), 'primary');
}

/* ── 事件 ─────────────────────────────────────────────────── */

function drawEvent() {
  const p = G.panel;
  if (p.k !== 'event') return;
  const w = 980;
  const x = (VW - w) / 2;

  g.font = font(16, 400, FONT_UI);
  const body = wrapText(p.ev.text, w - 130);
  const bodyH = body.length * 26 + 40;
  const optH = p.ev.opts.length * 88;
  const h = 130 + bodyH + 26 + optH + 24;
  const y = Math.max(80, (VH - h) / 2);
  box(x, y, w, h, C.purple, null);

  // 层号只从 curFloor() 出：这里原来读 G.node.r + 1，在第三幕事件面板上会
  // 显示「第 3 层」，而同一屏地图抬头写着「第 43 / 100 层」。
  heading(p.ev.title, x + 44, y + 66, `事件 · 第 ${curFloor()} 层`);

  const textY = y + 130;
  roundRect(x + 44, textY, w - 88, bodyH, 12);
  g.fillStyle = 'rgba(255,255,255,.035)';
  g.fill();
  g.font = font(16, 400, FONT_UI);
  g.fillStyle = C.ink2;
  body.forEach((ln, i) => g.fillText(ln, x + 66, textY + 30 + i * 26));

  const oy = textY + bodyH + 26;
  p.ev.opts.forEach((o, i) => {
    const by = oy + i * 88;
    // 付不起的选项压暗且不注册热区：`chooseEventOption()` 里也会拦，
    // 但那一下不解释原因，玩家会以为点了没反应。这里把原因写在副标题。
    const affordable = canPayHp(o.payHp ?? 0);
    const hv = affordable && hover(x + 44, by, w - 88, 74);
    roundRect(x + 44, by, w - 88, 74, 10);
    g.fillStyle = hv ? withAlpha(C.purple, 0.16) : 'rgba(255,255,255,.03)';
    g.fill();
    g.strokeStyle = hv ? C.purple : C.line;
    g.lineWidth = hv ? 1.8 : 1.2;
    g.stroke();
    text(o.t, x + 70, by + 26, {
      size: 19, weight: 600, color: affordable ? (hv ? C.ink : C.ink2) : C.faint,
    });
    text(affordable ? o.sub() : `付不起：还差 ${(o.payHp ?? 0) - (G.hp - 1)} 点生命`,
      x + 70, by + 52, { size: 13, color: affordable ? C.dim : C.red });
    if (affordable) onClick(x + 44, by, w - 88, 74, () => chooseEventOption(i), 'eventopt');
  });
}

/* ── 牌组 / 牌堆 ──────────────────────────────────────────── */

function drawGallery(title: string, list: string[]) {
  const w = 1280;
  const h = 740;
  const x = (VW - w) / 2;
  const y = 80;
  box(x, y, w, h, C.line);

  const nCards = list.filter((id) => defOf(id).kind !== 'junk').length;
  const nJunk = list.length - nCards;
  heading(title, x + 44, y + 66,
    `${list.length} 张${nJunk ? `（含 ${nJunk} 张杂念）` : ''} · 抽到关键卡的概率随牌组变厚而下降`);

  const cols = 5;
  const cw = 196;
  const ch = 252;
  const gapx = 26;
  const gapy = 26;
  const totalW = cols * cw + (cols - 1) * gapx;
  const gx0 = x + (w - totalW) / 2;
  const rows = Math.max(1, Math.ceil(list.length / cols));
  const gridH = rows * (ch + gapy);
  const areaH = h - 180;
  const area = scrollArea(x + 30, y + 130, w - 60, areaH, gridH, `gallery:${title}`);

  list.forEach((id, k) => {
    const col = k % cols;
    const row = Math.floor(k / cols);
    const px = gx0 - x - 30 + area.x + col * (cw + gapx);
    const py = area.y + row * (ch + gapy);
    const d = defOf(id);
    drawCard(px, py, cw, ch, d, planStrike(id, { noBoost: true }), { up: isUpgraded(id), rule: d.link?.note });
  });
  area.restore();
  overflowAffordance(area, x + 30, w - 60);

  if (!list.length) {
    text('空的。', x + w / 2, y + h / 2, { size: 18, align: 'center', color: C.faint });
  } else if (area.max > 0) {
    text('滚轮查看更多', x + w / 2, y + h - 24, { size: 12, align: 'center', color: C.faint });
  }
}

/* ── 开局前：选模式 ───────────────────────────────────────── */

/**
 * 开局三选一；模式只决定初始增益数量，不改价码和卡面。
 *
 * 三张卡读的是 MODES 自带的身色与徽记：模式是"身份"，不是"难度条"。
 * 之前刻意把三张都压成同色金边，结果它们既不像卡、也不像徽记，只像
 * 三个并排的网页按钮 —— 和战后选卡、增益掉落那一套语言断开。
 * 视觉细节全部交给 choiceCard()，这里只负责布局与命中。
 */
function drawBoon() {
  const w = 1060;
  const h = 490;
  const x = (VW - w) / 2;
  const y = (VH - h) / 2;
  box(x, y, w, h, C.gold);
  heading('这次从哪个模式开始', x + 44, y + 62,
    '差别只在开局带哪几个增益。');

  const pad = 44;
  const gap = 26;
  const cw = (w - pad * 2 - gap * 2) / 3;
  const ch = 270;
  const cy = y + 144;
  MODES.forEach((m, i) => {
    const cx = x + pad + i * (cw + gap);
    choiceCard(cx, cy, cw, ch, {
      color: m.color,
      tag: `0${i + 1}`,
      mark: m.icon,
      title: m.name,
      desc: m.desc,
      hovered: hover(cx, cy, cw, ch),
      factLabel: `初始增益 · ${m.powers.length}`,
      fact: m.powers.length
        ? m.powers.map((id) => POWER_BY_ID[id]?.name ?? id).join(' · ')
        : '无 · 全靠路上捡',
      factMuted: !m.powers.length,
      descLines: 2,
      cta: ['点击选择', '从这里开始 →'],
    });
    // 这个 label 是冒烟测试点开局的入口：坐标可以改，名字不能改。
    // 点击后进选主题，开局在那边发生。
    onClick(cx, cy, cw, ch, () => { G.panel = { k: 'topic', mode: m.id, picks: [] }; }, `mode:${m.id}`);
  });

  text('选定后整局不变。',
    x + 44, y + h - 26, { size: 12, color: C.faint });
}

/* ── 开局前：选主题 ───────────────────────────────────────── */

/**
 * 一局 2–5 个主题。勾选顺序就是出题顺序：先勾的主题先走完，才轮到下一个。
 *
 * 每张牌子报两个数：「题」是这个主题一共有多少道，「可抽」是还没答对满
 * `BAL.retireAt` 次的。抽题逻辑对玩家是隐藏的，但"还剩多少"必须让他看见 ——
 * 题变少而不说明，玩家只会以为题库丢了。
 */
async function beginSelectedRun(p: { mode: ModeId | null; picks: string[]; msg?: string; loading?: boolean }) {
  if (p.loading || p.picks.length < BAL.topicsMin) return;
  p.loading = true;
  p.msg = '';
  const bankId = activeBankId();
  const selectedBank = listBanks().find((bank) => bank.id === bankId);
  if (selectedBank && !selectedBank.remote && !serviceOnline()) {
    startRun(p.mode, [], p.picks);
    return;
  }
  const topics = [...p.picks];
  const retired = allQuestions()
    .filter(isRetired)
    .map((q) => q.qid);
  const result = await requestRunPool({
    bankId, topics, retired, quota: BAL.runTopicQuota,
  });
  // 用户等待期间可能按 Esc 离开；迟到的响应不能启动新局并清掉原存档。
  if (G.panel !== p) return;
  if (result.ok && result.questions?.length) {
    startRun(p.mode, [], topics, result.questions, bankId);
    return;
  }
  if (selectedBank && !selectedBank.remote) {
    startRun(p.mode, [], topics);
    return;
  }
  p.loading = false;
  p.msg = result.error || '没有取到本局题目，请重试。';
}

function drawTopics(p: { mode: ModeId | null; picks: string[]; msg?: string; loading?: boolean }) {
  const src = sourceBank();
  const names = Object.keys(src.byTopic);
  const pad = 44;
  const gap = 16;
  const cardH = 96;
  const w = 1040;
  // 列数按主题数取：题库里的 `## 主题` 数量不设限，三列在 5 个主题时最像一排卡，
  // 再多就该加列而不是把面板拉出屏幕。
  const cols = names.length <= 3 ? Math.max(1, names.length)
    : names.length <= 8 ? 3
      : names.length <= 15 ? 4 : 5;
  const rows = Math.max(1, Math.ceil(names.length / cols));
  const contentH = rows * (cardH + gap) - gap;
  // 面板最高 780：再高就压到屏幕上沿，宁可让网格自己滚
  const gridH = Math.min(contentH, 780 - 188 - 76);
  const h = 188 + gridH + 76;
  const x = (VW - w) / 2;
  const y = (VH - h) / 2;
  const gridW = w - pad * 2;
  const cw = (gridW - gap * (cols - 1)) / cols;

  box(x, y, w, h, C.gold);
  heading('这一局练哪几个主题', x + pad, y + 66,
    `选 ${BAL.topicsMin}–${BAL.topicsMax} 个。勾选顺序就是出题顺序，开局后整局不变。`);

  const view = scrollArea(x + pad, y + 144, gridW, gridH, contentH, 'topic');
  names.forEach((name, i) => {
    const cx = view.x + (i % cols) * (cw + gap);
    const cy = view.y + Math.floor(i / cols) * (cardH + gap);
    // 滚出去的牌子必须一起失去热区，否则它会盖住下面那张的点击
    const shown = cy >= view.y0 - 1 && cy + cardH <= view.y0 + view.h + 1;
    const pool = src.byTopic[name] ?? [];
    const left = pool.filter((q) => !isRetired(q)).length;
    const at = p.picks.indexOf(name);
    const on = at >= 0;
    const hv = shown && hover(cx, cy, cw, cardH);
    const tint = topicColor(name);

    panel(cx, cy, cw, cardH, {
      fill: on ? withAlpha(tint, 0.13) : hv ? C.panelHi : PRESS.sheet,
      stroke: on ? tint : hv ? C.lineHi : C.line,
    });

    // 左侧色条：和卡面、地图节点用的是同一套主题色
    roundRect(cx + 12, cy + 14, 4, cardH - 28, 2);
    g.fillStyle = withAlpha(tint, on ? 1 : 0.5);
    g.fill();

    // 主题名是题库作者写的，长度不受控 —— 真语料里有
    // 「使用包、Crate 和模块管理不断增长的项目」这种，单行不截断会直接压到隔壁牌上。
    // 两行封顶，再放不下就把第二行收成省略号：截断必须留痕，静默截断会被读成"本来就叫这个"。
    const nameW = cw - 26 - 14;
    g.save();
    g.font = font(17, 700, FONT_UI);
    const wrapped = wrapText(name, nameW);
    g.restore();
    const titleLines = wrapped.length > 2 ? [wrapped[0], `${wrapped[1]}…`] : wrapped;
    titleLines.forEach((ln, k) => {
      text(ln, cx + 26, cy + 34 + k * 19,
        { size: 17, weight: 700, color: on ? C.ink : C.ink2, maxW: nameW });
    });
    text(`${pool.length} 道 · 可抽 ${left}`, cx + 26, cy + cardH - 26,
      { size: 12, color: left ? C.dim : withAlpha(C.red, 0.85) });

    // 右下角写的是**出题顺序**，不是序号：这张牌是第几个被勾上的
    if (on) {
      text(`${at + 1}`, cx + cw - 22, cy + cardH - 18,
        { size: 22, weight: 700, color: tint, align: 'right', family: FONT_TITLE });
    }

    if (shown && !p.loading) {
      onClick(cx, cy, cw, cardH, () => {
        const idx = p.picks.indexOf(name);
        if (idx >= 0) p.picks.splice(idx, 1);
        else if (p.picks.length < BAL.topicsMax) p.picks.push(name);
      }, `topic:${i}`);
    }
  });
  view.restore();
  overflowAffordance(view, x + pad, gridW);

  const fy = y + h - 64;
  const bw = 190;

  if (!p.loading) {
    action(x + w - pad - bw * 2 - 14, fy, bw, 50, '随机挑几个', () => {
      const want = BAL.topicsMin
        + Math.floor(Math.random() * (BAL.topicsMax - BAL.topicsMin + 1));
      p.picks = shuffle(names).slice(0, Math.min(want, names.length));
    }, 'ghost', { size: 15 });
  }

  if (p.picks.length >= BAL.topicsMin) {
    action(x + w - pad - bw, fy, bw, 50, p.loading ? '准备题目…' : '开始这一局', () => { void beginSelectedRun(p); },
      p.loading ? 'ghost' : 'primary', { size: 17, sub: `${p.picks.length} 个主题` });
  } else {
    text(`至少选 ${BAL.topicsMin} 个主题`, x + w - pad, fy + 30,
      { size: 15, color: withAlpha(C.red, 0.9), align: 'right' });
  }

  text(`已选 ${p.picks.length} / ${BAL.topicsMax}`, x + pad, fy + 18, { size: 14, color: C.ink2 });
  text(`同一道题答对 ${BAL.retireAt} 次之后不再抽到，但仍能在题库里看到。`,
    x + pad, fy + 42, { size: 12, color: C.faint });
  if (p.msg) text(p.msg, x + pad, fy - 12, { size: 13, color: C.red });
}

/* ── 说明 ─────────────────────────────────────────────────── */

function drawHelp() {
  const w = 1120;
  const x = (VW - w) / 2;
  const colW = (w - 96 - 36) / 2;
  const cols = [x + 48, x + 48 + colW + 36];

  const blocks: Array<[string, string[]]> = [
    [`初始牌组：10 张（8 基础 + 2 随机知识）`, [
      `开局 ${BASICS.length} 张基础牌（${basicsSummary()}），不答题、随时可打，各要 1 点行动力；再加 2 张随机知识卡。`,
      '基础牌无法从游戏中获得，只能精炼或遗忘。',
    ]],
    ['三类牌：攻击 / 防御 / 技能', [
      '攻击（猛击 / 洞察 / 串联 / 内化）：把行动力换成伤害，内化按实际伤害回血。',
      '防御（巩固）：以格挡为主，可以带伤害。',
      '技能（专注）：伤害偏低，抽一张牌。',
      '另有一类增益：精英和 Boss 掉落，拾取即生效，不进牌组、不花行动力。',
    ]],
    ['卡面怎么读', [
      '卡面上只有费用、类别、牌名、效果和数值。左上角是费用：0–3 点，或 X（花光行动力，花几点结算几次）；付不起时变红。',
      '答题要求是隐藏的：卡面不标它出不出题、要答几次；点开一张知识卡时才知道。',
      '右下角纹章是效果原型，顶部色条是攻击 / 防御 / 技能三类。',
      '卡面没有题目：点开才从当前这一章抽题，和这张牌无关。',
    ]],
    ['答对算数，答错这一手作废', [
      `答对：卡面效果按原值结算，这张牌攒一次免答；带借书证时退回 ${rulesStatic().refund} 点行动力。`,      '答错：这一手不结算，也不扣行动力；牌进弃牌堆。题目在点开牌那一刻就消耗了，答对答错都一样。',
      '答对足够次数之后，这一场剩下的时间它直接打、不再出题。计数每场清零。',
      '答错不补格挡、不补抽。橡皮、草稿纸、装订线各改其中一条。',
    ]],
    ['开局先选 2–5 个主题', [
      `勾选顺序就是出题顺序：前一个主题的题走完，才轮到下一个。每个主题最多带 ${BAL.runTopicQuota} 道，整局共用这一份。`,
      '开局之后不能换主题，想换只能重开一局。',
      `同一道题答对 ${BAL.retireAt} 次之后不再抽到，但仍能在题库里看到；答错不算次数。`,
    ]],
    ['每一场都有自己的题量', [
      '开战时按牌组算题量：牌组里贵的牌越多，这一场新题越多。顶栏「题 N」是本场还没问过的新题。',
      '点开一张要答题的知识卡消耗一道，答错也消耗。本局答对过的题不再发给玩家；新题用完不锁牌，改问本局被问得最少的题，顶栏显示「题 复用」。',
      `同一道题一局最多被抽 ${MAX_PICK_PER_RUN} 次，免得一道一直答不对的题把位置占光。`,
    ]],
    ['三种模式，开局前选', [
      '学习：借书证 + 课表，2 个初始增益。',
      '复习：只带借书证，1 个初始增益。',
      '测试：没有初始增益；答对不退行动力，也没有额外防御。',
      '模式只决定开局带哪几个增益；模式和主题都在开局前定死。',
    ]],
    ['行动力是唯一的节奏', [
      // 读 rulesStatic()：BAL 是不带增益的声明值，写死在帮助页会和实际抽牌数差开。
      // 首回合的沙漏 / 折角是「此刻」才成立的修正，由下面两条增益说明负责，不在这里算。
      `每回合 ${rulesStatic().apMax} 点行动力、抽 ${rulesStatic().draw} 张牌；每张牌标 0–3 点，X 费吃光剩下的全部。`,
      `带借书证时答对退 ${rulesStatic().refund} 点：1 费牌等于免费，2 费净花 1 点、3 费净花 2 点。`,
      '答错不扣行动力。基础牌不答题，也不退行动力。',
      `双面镜让每回合第一次答对抽 ${rulesStatic().answerDraw} 张，荧光笔让每场第一次答对多退 ${BAL.markerPlus} 点。`,
      '键盘：1–4 选选项，空格 / 回车推进面板，空场时空格结束回合。',
    ]],
    ['增益不进牌组', [
      '精英和幕 Boss 战后各掉一个增益，拾取即生效、整局常驻；不进牌组、不占手牌、不花行动力。',
      '常驻类一直改着规则（沙漏、索引卡、长明灯……）；每场一次类只在第一次答对、第一次答错或第一次出牌时响。',
      '池子里每种只有一个，拿过就不再掉，也不叠层。',
    ]],
    ['一百层，五幕', [
      `整座塔 100 层，每 20 层是一幕，幕末一只 Boss。打赢会换一张新地图、血回满、生命上限 +${rulesStatic().stageMaxHp}。`,
      '一幕一套物种：目录厅教你出牌、虫蛀区搅你的牌堆、报刊区靠反伤、修复室叠甲、禁书区挑你错得最多的主题。',
      '层号越高，怪越厚、打得越疼。',
      '地图一屏显示 8 层；滚轮或按住拖动可以看到整张 20 层，先看清上面是不是精英。',
      '节点类型全部可见：战斗、精英、复习、事件、Boss。',
      `复习点三选一：回复 ${Math.max(1, rulesStatic().restHp)} 点生命、精炼一张卡、或永久移除一张。`,
      '精炼按张算：牌组里每份副本各占一格，只强化挑中的那一张，同名的另一张不动；精炼过的那张带一个 + 号。',
      '牌组会变厚。',
    ]],
    ['它会记住你', [
      '复习状态存在本地；起手固定 10 张（4 斩击 + 4 格挡 + 2 张随机低费知识卡，2 费以上的知识卡要自己挣）。',
      '结算页给出本局答题数、正确率和答错次数。',
    ]],
  ];

  // 先量后画，否则加一段说明会把最后一行挤出盒子。
  g.font = font(14, 400, FONT_UI);
  const measured = blocks.map(([t, lines]) => ({
    t, lines: lines.flatMap((ln) => wrapText(ln, colW - 8)),
  }));

  /**
   * 布局按内容量算，不写死块数 / 行距。
   *
   * 原来两件事都是魔数：切点写 `slice(0, 4)`，行距写 20。结果加一段说明就可能
   * 把右栏顶出面板，而加内容的人看不出来。这里改成：
   *   1. 切点取「两栏高度差最小」的保序位置（块的顺序有意义，不能重排）；
   *   2. 仍放不下时逐步收紧行距，直到真正放下；到下限还放不下才交给滚动。
   * 收紧只动行距和标题间距，不动字号 —— 折行结果不变，测量的行数一直有效。
   *
   * 下限是分开的：正文 14px 配 16px 行距仍清楚，但标题 18px 需要 22px，
   * 再低就会压到下一行。所以不能用一个统一比例直接乘。
   */
  const PAD_TOP = 20;
  const GAP_HEAD = 10;          // 块之间
  const NAT_LH = 20;            // 常规行距
  const NAT_TH = 26;            // 常规标题行高
  const MIN_LH = 16;
  const MIN_TH = 22;
  const CHROME_H = 128 + 46;    // 标题区 + 底部快捷键
  const AVAIL_H = VH - 48 - CHROME_H;

  const heightsOf = (lh: number, th: number) =>
    measured.map((b) => th + b.lines.length * lh + GAP_HEAD);

  /** 保序最优切点：找使两栏高度差最小的位置。 */
  const splitAt = (hs: number[]) => {
    const total = hs.reduce((a, b) => a + b, 0);
    let at = 1;
    let best = Infinity;
    let acc = 0;
    for (let i = 1; i < hs.length; i++) {
      acc += hs[i - 1];
      const diff = Math.abs(acc - (total - acc));
      if (diff < best) { best = diff; at = i; }
    }
    return at;
  };
  const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);
  const maxColOf = (hs: number[], at: number) => Math.max(sum(hs.slice(0, at)), sum(hs.slice(at)));

  let LH = NAT_LH;
  let TH = NAT_TH;
  let heights = heightsOf(LH, TH);
  let cut = splitAt(heights);
  let maxCol = maxColOf(heights, cut);
  // 逐步收紧而不是一次算出比例：行距要取整、切点还会随高度改变（实测一次估算
  // 会差 12px，结果「压紧了但没放下」—— 最后一行仍被渐隐压暗，比直接滚动更糟）。
  for (let k = 0.99; PAD_TOP + maxCol > AVAIL_H && k > 0; k -= 0.01) {
    LH = Math.max(MIN_LH, Math.round(NAT_LH * k));
    TH = Math.max(MIN_TH, Math.round(NAT_TH * k));
    heights = heightsOf(LH, TH);
    cut = splitAt(heights);
    maxCol = maxColOf(heights, cut);
    if (LH === MIN_LH && TH === MIN_TH) break;   // 到底了，剩下交给滚动
  }

  const halves = [measured.slice(0, cut), measured.slice(cut)];
  // 正文从 bodyTop + PAD_TOP 开始（fillText 的 y 是基线，标题要往下让），这段留白
  // 也是内容的一部分。不把它算进 contentH，面板就永远比内容矮一行 —— 底部那行被
  // 干净地切掉，看不出是「画不下」还是「就这么多」。
  const contentH = PAD_TOP + maxCol;
  const h = Math.min(VH - 48, CHROME_H + contentH);
  const y = Math.max(24, (VH - h) / 2);
  box(x, y, w, h, C.gold);
  heading('怎么玩', x + 48, y + 70, '出牌可能要答题，答对了卡才生效。');
  // 正文进滚动区；直接照画会把最后一块切掉半行，比看不到更糟。
  const bodyTop = y + 128;
  const bodyH = h - 128 - 46;
  // 这里传 contentH 而不是 contentH + 常数：多给的那一点会让 max > 0，从而点亮
  // 底部 68px 渐隐 —— 内容其实刚好放得下，却被自己的「还有更多」提示盖住了最后
  // 一块。只有真的超出（h 撞到 VH 上限）时 max 才为正，渐隐才该出现。
  const area = scrollArea(x + 24, bodyTop, w - 48, bodyH, contentH, 'help');

  halves.forEach((half, ci) => {
    let by = area.y + PAD_TOP;
    for (const b of half) {
      text(b.t, cols[ci], by, { size: 18, weight: 700, color: C.gold });
      by += TH;
      g.font = font(14, 400, FONT_UI);
      g.fillStyle = C.ink2;
      g.textAlign = 'left';
      for (const seg of b.lines) {
        g.fillText(seg, cols[ci] + 4, by);
        by += LH;
      }
      by += GAP_HEAD;
    }
  });

  area.restore();
  overflowAffordance(area, x + 24, w - 48);

  text('快捷键：Esc 取消 · 空格继续 · 数字键选选项', x + 48, y + h - 30, { size: 12, color: C.faint });
}
