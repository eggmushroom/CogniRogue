import { g, roundRect, VH, VW, wrapText } from '../gfx/canvas';
import { C, font, FONT_TITLE, FONT_UI, SCRIM, topicColor, withAlpha } from '../gfx/theme';
import { action, button, choiceCard, drawCard, drawPowerEmblem, squeeze, text } from '../gfx/ui';
import { consumeWheel, hover, onClick } from '../input';
import { easeOut } from '../gfx/geom';
import { BAL, EFFS, MODES, POWER_BY_ID, effSummaryOf } from '../core/model';
import { clamp, G } from '../core/infra';
import { curFloor } from '../core/map';
import { countQuestions, sourceBank } from '../core/library';
import {
  BASICS, cardType, CARD_TYPE_META, costOf, defOf, isUpgraded, upgradedId,
  isXCost, PACK, rulesStatic, UP_MARK,
} from '../core/cards';
import { answer, cancelPanel } from '../core/combat';
import { liveStatOf } from '../core/combat/link';
import { basicsSummary, planStrike } from '../core/combat/strike';
import {
  ackCardGet, ackPower, canPayHp, cancelPreview, chooseEventOption, dismissFeedback, forgetCard,
  openCardPick, previewUpgrade,
  restHeal, restWanted, startRun, skipReward, takeCard, upgradeCard,
} from '../core/journey';
import type { Feedback, PowerDef, Question, QView } from '../core/model';
import { drawReport } from './report';
import { requestPackFile, pastePack } from './packio';

/* ── 通用外壳 ─────────────────────────────────────────────── */

/**
 * 以前每个面板各写一个 0.72~0.84 的 alpha：战斗里开选卡 / 牌组浮层时，
 * 底边下方会透出一排「幽灵手牌」，地图上的浮层还会读出左侧 HUD 标题。
 * 现在统一走 theme 的 SCRIM；dimQuestion() 的渐变是另一套，不动。
 */
function dim() {
  g.fillStyle = `rgba(3,4,8,${SCRIM})`;
  g.fillRect(0, 0, VW, VH);
}

/** onClose 为 null 时不画 ×：强制选择的面板没有"关掉"语义。 */
function box(
  x: number, y: number, w: number, h: number,
  glow: string = C.line, onClose: (() => void) | null = cancelPanel,
) {
  g.save();
  g.shadowColor = 'rgba(0,0,0,.75)';
  g.shadowBlur = 48;
  g.shadowOffsetY = 12;
  roundRect(x, y, w, h, 18);
  g.fillStyle = 'rgba(12,15,22,.97)';
  g.fill();
  g.restore();

  roundRect(x, y, w, h, 18);
  g.strokeStyle = glow;
  g.lineWidth = 1.6;
  g.stroke();

  roundRect(x + 1, y + 1, w - 2, 2.4, 16);
  g.fillStyle = 'rgba(255,255,255,.07)';
  g.fill();

  g.save();
  roundRect(x, y, w, h, 18);
  g.clip();
  g.globalAlpha = 0.8;
  const tg = g.createLinearGradient(x, 0, x + w, 0);
  tg.addColorStop(0, 'rgba(255,255,255,0)');
  tg.addColorStop(0.18, glow);
  tg.addColorStop(0.82, glow);
  tg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = tg;
  g.fillRect(x, y, w, 3.5);
  g.restore();

  if (!onClose) return;
  const cx = x + w - 34;
  const cy = y + 34;
  const chv = hover(cx - 16, cy - 16, 32, 32);
  g.beginPath();
  g.arc(cx, cy, 16, 0, Math.PI * 2);
  g.fillStyle = chv ? 'rgba(255,255,255,.14)' : 'rgba(255,255,255,.05)';
  g.fill();
  text('×', cx, cy + 1, { size: 22, align: 'center', color: chv ? C.ink : C.dim });
  onClick(cx - 16, cy - 16, 32, 32, onClose, '×');
}

function heading(s: string, x: number, y: number, sub?: string) {
  text(s, x, y, { size: 30, weight: 700, family: FONT_TITLE, color: C.ink });
  if (sub) text(sub, x, y + 34, { size: 14, color: C.dim });
}

let scroll = 0;
let scrollKey = '';
function scrollArea(x: number, y: number, w: number, h: number, contentH: number, key = '') {
  // scroll 是模块级的；换列表必须归零，否则会从中间开始。
  if (key !== scrollKey) { scrollKey = key; scroll = 0; }
  const max = Math.max(0, contentH - h);
  scroll = clamp(scroll + consumeWheel() * 0.7, 0, max);
  g.save();
  roundRect(x, y, w, h, 10);
  g.clip();
  return {
    x, y: y - scroll, restore: () => g.restore(), y0: y, h, max, cur: scroll,
  };
}

/** 列表溢出：底部渐隐 + 滚动条 + 脚注，说明下面还有内容。 */
function overflowAffordance(a: ReturnType<typeof scrollArea>, x: number, w: number) {
  if (a.max <= 0) return;
  if (a.cur < a.max - 1) {
    const fadeH = 68;
    const fd = g.createLinearGradient(0, a.y0 + a.h - fadeH, 0, a.y0 + a.h);
    fd.addColorStop(0, 'rgba(10,13,20,0)');
    fd.addColorStop(1, 'rgba(10,13,20,.95)');
    g.fillStyle = fd;
    g.fillRect(x, a.y0 + a.h - fadeH, w, fadeH);
  }

  const tx = x + w + 6;
  roundRect(tx, a.y0 + 6, 3, a.h - 12, 1.5);
  g.fillStyle = 'rgba(255,255,255,.06)';
  g.fill();
  const thumbH = Math.max(40, (a.h - 12) * (a.h / (a.h + a.max)));
  const ty = a.y0 + 6 + (a.h - 12 - thumbH) * (a.cur / a.max);
  roundRect(tx, ty, 3, thumbH, 1.5);
  g.fillStyle = withAlpha(C.lineHi, 0.9);
  g.fill();
}

/* ── 入口 ─────────────────────────────────────────────────── */

export function drawOverlay(t: number, quiz: QuizState = IDLE_QUIZ) {
  const p = G.panel;
  quizFrameInfo = { ...quizFrameInfo, drawn: false, phase: 'idle' };
  if (p.k !== 'reward') rewardWasOpen = false;
  switch (p.k) {
    case 'question': return drawQuestion(p.idx, p.q, p.view);
    case 'boon': return drawBoon();
    case 'feedback':
      // 答对不画判定面板：效果已经当场结算，这块整屏面板只会盖住战场，
      // 把光刃、伤害数字和敌人的反应全压在底下，打击感立刻没了。
      // 状态保留到演出结束只是当输入锁（见 main.ts），演完自己收掉。
      // 答错仍然整屏反馈 —— 解析和正确选项是这一局真正的教学时刻。
      if (p.fb.right) return;
      return drawFeedback(t, quiz);
    case 'reward': return drawReward(t);
    case 'powerdrop': return drawPowerDrop();
    case 'cardget': return drawCardGet();
    case 'rest': return drawRest(t);
    case 'cardpick': return drawCardPick(p.mode);
    case 'event': return drawEvent();
    case 'deck': return drawGallery('牌组', G.deck);
    case 'pile': return drawGallery(p.kind === 'draw' ? '抽牌堆' : '弃牌堆',
      p.kind === 'draw' ? G.draw.slice().reverse() : G.discard);
    case 'help': return drawHelp();
    case 'pack': return drawPack();
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
  geom: { x: number; y: number; w: number; h: number };
}
let quizFrameInfo: QuizFrameInfo = {
  drawn: false, phase: 'idle', geom: { x: QX, y: 48, w: QW, h: 700 },
};
export const quizFrame = () => quizFrameInfo;

export interface QuizState {
  /** 判定已出、打击演出还在飞；面板不消失，结果区还没展开 */
  settling: boolean;
  reveal: number;
  autoProgress: number;
  autoPaused: boolean;
  autoCancelled: boolean;
}
const IDLE_QUIZ: QuizState = {
  settling: false, reveal: 0, autoProgress: 0, autoPaused: true, autoCancelled: false,
};

/**
 * 一个 Panel 的三个 state：ask / settle / result 共用锚点 (x, y) 与宽度。
 *
 * 以前三者共用**整个盒子**：高度由四行选项带撑着，结果态把选项压成 2×2 后
 * 下半就空出一百多像素。现在 settle 仍是答题那一块（判定当场不换框，
 * 这条是 CHANGELOG 里消掉"选项消失 → 等演出 → 反馈弹出"割裂感的初衷），
 * result 则按自己的内容量高度：题干 + 两行小片 + 结果文字 + 释义 + 按钮。
 *
 * y 只由答题态的高度决定，所以两个 state 的上边缘严丝合缝地对齐；
 * 盒子收起来时变的是底边，不是位置。冒烟断言因此从"几何全等"
 * 改成"锚点不变、结果态不高于答题态"。
 */
function quizPanel(
  question: string, n: number,
  state: 'ask' | 'settle' | 'result', fb?: Feedback,
) {
  g.font = font(26, 700, FONT_UI);
  const lines = wrapText(question, QW - 68);
  const lineH = 36;
  const headH = 132;
  const gap = 12;
  const fixedH = headH + lines.length * lineH + 24 + 76;
  const oh = clamp(Math.floor((VH - 96 - fixedH) / 4) - gap, 54, 70);
  const band = 4 * (oh + gap) - gap;
  const askH = headH + lines.length * lineH + 24 + band + 76;
  const y = Math.max(48, (VH - askH) / 2);
  const qy = y + headH;
  const oy = qy + lines.length * lineH + 24;
  const rowH = Math.min(96, (band - (n - 1) * gap) / n);
  const rowsH = n * rowH + (n - 1) * gap;

  // result 的内容量：小片行数 + 每条结果文字 + 释义预算 + 按钮区。
  // 先量内容再定高度，而不是拿一个固定盒子去裁内容。
  const chipRows = Math.ceil(n / 2);
  const chipRowsH = chipRows * CHIP_H + (chipRows - 1) * CHIP_GAP;
  const noteCount = fb?.apNote ? Math.min(2, wrapText(fb.apNote, QW - 68).length) : 0;
  const expCount = fb?.explain ? Math.min(2, wrapText(fb.explain, QW - 116).length) : 0;
  // 按钮顶固定在 y+h-76。resultH 就是 ry0 到按钮顶的距离，精确等于内容高度
  // + 8px 呼吸；不多留一寸，否则结果文字与「继续」之间又会长出空白。
  const resultH = 26
    + (fb?.linkNote ? 22 : 0)
    + (fb && (fb.blk > 0 || fb.heal > 0 || fb.draw > 0 || fb.eff === 'pierce') ? 20 : 0)
    + noteCount * 19 + (noteCount ? 6 : 0)
    + (expCount ? expCount * 20 + 18 : 0)
    + 8;
  const fbH = headH + lines.length * lineH + 24 + chipRowsH + 12 + resultH + 76;

  return {
    x: QX, y, w: QW, h: state === 'result' ? fbH : askH,
    askH, lines, lineH, headH, gap, oh, band,
    qy, oy, rowH, oy0: oy + (band - rowsH) / 2,
  };
}

function dimQuestion(k = 1) {
  const lg = g.createLinearGradient(0, 0, 0, VH);
  lg.addColorStop(0, `rgba(3,4,8,${(0.66 * k).toFixed(3)})`);
  lg.addColorStop(0.55, `rgba(3,4,8,${(0.7 * k).toFixed(3)})`);
  lg.addColorStop(1, `rgba(3,4,8,${(0.8 * k).toFixed(3)})`);
  g.fillStyle = lg;
  g.fillRect(0, 0, VW, VH);
}

function drawQuestion(idx: number, q: Question, view: QView) {
  const ent = G.hand[idx];
  if (!ent) return;
  const card = defOf(ent);
  // 题面是点开那一刻的快照，选项顺序来自本次打乱；反馈面板读同一份。
  const options = view.options;
  const gm = quizPanel(q.q, options.length, 'ask');
  const { x, y, w } = gm;
  const col = C.blue;
  quizFrameInfo = { drawn: true, phase: 'ask', geom: { x, y, w, h: gm.h } };

  dimQuestion();
  box(x, y, w, gm.h, withAlpha(col, 0.5));

  text(card.name, x + 34, y + 48, { size: 22, weight: 700, family: FONT_TITLE, color: C.ink });
  const ct = CARD_TYPE_META[cardType(card)];
  const xc = isXCost(card);
  const costNote = xc ? `X = ${Math.max(1, G.ap)} 点，吃光行动力` : `${costOf(card)} 点行动力`;
  text(`${ct.name}牌 · ${costNote} · 从题库随机抽一题`, x + 34, y + 74, {
    size: 13, color: ct.color, weight: 600,
  });

  const st = liveStatOf(ent);
  const eff = EFFS[card.eff] ?? EFFS.strike;
  // 与卡面、真实结算同一份 EffOut；加成已经算进每段，不再另折算一次。
  const out = planStrike(ent);
  const sumW = 300;
  const sx = x + w - 84 - sumW;
  text('答对就拿到的效果', sx, y + 50, { size: 12, color: C.dim, align: 'left' });
  text(effSummaryOf(out, card.eff, xc), sx, y + 74, {
    size: 13, color: eff.color, weight: 700, align: 'left',
  });
  // 题干基线在 y+132，联动行只能落在 y+100，再往下会撞上题干。
  if (st.reasons.length) {
    text(`联动 · ${st.reasons.join(' · ')}`, x + 34, y + 100, {
      size: 12, color: C.gold, weight: 600, maxW: w - 68,
    });
  }

  roundRect(x + 24, gm.qy - 8, 3, gm.lines.length * gm.lineH - 10, 2);
  g.fillStyle = withAlpha(col, 0.9);
  g.fill();
  g.font = font(26, 700, FONT_UI);
  g.fillStyle = C.ink;
  gm.lines.forEach((ln, i) => g.fillText(ln, x + 34, gm.qy + i * gm.lineH));

  g.beginPath();
  g.moveTo(x + 34, gm.oy - 12);
  g.lineTo(x + w - 34, gm.oy - 12);
  g.strokeStyle = withAlpha(col, 0.2);
  g.lineWidth = 1;
  g.stroke();

  options.forEach((o, i) => {
    const by = gm.oy0 + i * (gm.rowH + gm.gap);
    const hv = hover(x + 34, by, w - 68, gm.rowH);
    roundRect(x + 34, by, w - 68, gm.rowH, 10);
    g.fillStyle = hv ? withAlpha(col, 0.16) : 'rgba(255,255,255,.035)';
    g.fill();
    g.strokeStyle = hv ? withAlpha(col, 0.8) : C.line;
    g.lineWidth = hv ? 1.8 : 1.2;
    g.stroke();
    if (hv) {
      roundRect(x + 34, by + 8, 3, gm.rowH - 16, 2);
      g.fillStyle = col;
      g.fill();
    }

    g.beginPath();
    g.arc(x + 68, by + gm.rowH / 2, 17, 0, Math.PI * 2);
    g.fillStyle = hv ? withAlpha(col, 0.35) : 'rgba(255,255,255,.06)';
    g.fill();
    text('ABCD'[i] ?? String(i + 1), x + 68, by + gm.rowH / 2 + 1, {
      size: 16, weight: 800, align: 'center', color: hv ? col : C.ink2,
    });

    g.font = font(18, 400, FONT_UI);
    g.fillStyle = hv ? C.ink : C.ink2;
    const ol = wrapText(o, w - 190);
    ol.slice(0, 2).forEach((ln, k) => {
      g.fillText(ln, x + 100, by + gm.rowH / 2 + (ol.length > 1 ? (k === 0 ? -12 : 14) : 0));
    });

    onClick(x + 34, by, w - 68, gm.rowH, () => answer(i), 'opt');
  });

  text(`答对：按卡面结算，带借书证再退 ${rulesStatic().refund} 点 · 答错：这一手作废，不扣行动力，牌进弃牌堆`,
    x + 34, y + gm.h - 37, { size: 13, color: C.dim, maxW: w - 68 });
}

/* ── 判定：同一块面板原地翻面 ──────────────────────────────── */

const CHIP_H = 50;
const CHIP_GAP = 12;

function drawFeedback(t: number, quiz: QuizState) {
  const p = G.panel;
  if (p.k !== 'feedback') return;
  const fb = p.fb;
  const col = fb.right ? C.green : C.red;
  const gm = quizPanel(fb.question, fb.options.length, quiz.settling ? 'settle' : 'result', fb);
  const { x, y, w, h } = gm;
  const n = fb.options.length;
  quizFrameInfo = {
    drawn: true, phase: quiz.settling ? 'settle' : 'result', geom: { x, y, w, h },
  };

  const u = clamp(quiz.reveal / 0.26, 0, 1);
  const ease = easeOut(u);
  dimQuestion(clamp(0.72 + quiz.reveal * 1.4, 0.72, 1));

  // 整块面板都是"继续"；× 在 box 里后注册，演出未完时先不注册。
  if (!quiz.settling) onClick(x, y, w, h, () => dismissFeedback(), '继续');
  box(x, y, w, h, withAlpha(col, 0.5), quiz.settling ? null : dismissFeedback);

  const pop = 1 + (1 - ease) * 0.16;
  g.save();
  g.translate(x + 34, y + 48);
  g.scale(pop, pop);
  if (!quiz.settling) { g.shadowColor = withAlpha(col, 0.6); g.shadowBlur = 14; }
  text(fb.right ? '正确' : '答错', 0, 0, {
    size: 30, weight: 800, family: FONT_TITLE, color: col,
  });
  g.restore();
  text(fb.topic, x + w - 90, y + 52, {
    size: 14, color: topicColor(fb.topic), weight: 700, align: 'right',
  });

  const sx = x + w - 84 - 300;
  text(fb.right ? '这一手已经生效' : '这一手作废', sx, y + 50, { size: 12, color: C.dim });
  text(fb.right ? '效果已经结算' : '不扣行动力', sx, y + 74, {
    size: 14, color: col, weight: 700,
  });

  roundRect(x + 24, gm.qy - 8, 3, gm.lines.length * gm.lineH - 10, 2);
  g.fillStyle = withAlpha(col, 0.9);
  g.fill();
  g.font = font(26, 700, FONT_UI);
  g.fillStyle = C.ink;
  gm.lines.forEach((ln, i) => g.fillText(ln, x + 34, gm.qy + i * gm.lineH));

  g.beginPath();
  g.moveTo(x + 34, gm.oy - 12);
  g.lineTo(x + w - 34, gm.oy - 12);
  g.strokeStyle = withAlpha(col, 0.2);
  g.lineWidth = 1;
  g.stroke();

  // 演出中选项留在原位，结果展开时换成 2×2 小片；不做逐帧插值，半路会叠。
  const chipW = (w - 68 - CHIP_GAP) / 2;
  const chipRows = Math.ceil(n / 2);
  const chipRowsH = chipRows * CHIP_H + (chipRows - 1) * CHIP_GAP;
  const compact = !quiz.settling;
  fb.options.forEach((o, i) => {
    const isAns = i === fb.answer;
    const isPick = i === fb.choice;
    const r = Math.floor(i / 2);
    const c = i % 2;
    const bx = compact ? x + 34 + c * (chipW + CHIP_GAP) : x + 34;
    const by = compact ? gm.oy + r * (CHIP_H + CHIP_GAP) : gm.oy0 + i * (gm.rowH + gm.gap);
    const bw = compact ? chipW : w - 68;
    const bh = compact ? CHIP_H : gm.rowH;

    const border = quiz.settling
      ? (isPick ? withAlpha(C.gold, 0.85) : C.line)
      : isAns ? withAlpha(C.green, 0.75) : isPick ? withAlpha(C.red, 0.75) : C.line;
    const fill = quiz.settling
      ? (isPick ? withAlpha(C.gold, 0.13) : 'rgba(255,255,255,.035)')
      : isAns ? withAlpha(C.green, 0.13) : isPick ? withAlpha(C.red, 0.13) : 'rgba(255,255,255,.03)';
    roundRect(bx, by, bw, bh, 9);
    g.fillStyle = fill;
    g.fill();
    g.strokeStyle = border;
    g.lineWidth = 1.3;
    g.stroke();

    const lx = bx + (compact ? 22 : 34);
    const tx0 = bx + (compact ? 42 : 66);
    const mid = by + bh / 2;
    g.beginPath();
    g.arc(lx, mid, compact ? 13 : 17, 0, Math.PI * 2);
    g.fillStyle = isAns && compact ? withAlpha(C.green, 0.35)
      : isPick ? withAlpha(quiz.settling ? C.gold : C.red, 0.35) : 'rgba(255,255,255,.06)';
    g.fill();
    text('ABCD'[i] ?? String(i + 1), lx, mid + 1, {
      size: 15, weight: 800, align: 'center',
      color: quiz.settling ? (isPick ? C.gold : C.dim)
        : isAns ? C.green : isPick ? C.red : C.dim,
    });
    g.font = font(compact ? 15 : 17, 400, FONT_UI);
    g.fillStyle = quiz.settling ? C.ink2
      : isAns ? C.ink : isPick ? C.ink2 : C.dim;
    g.fillText(squeeze(o, bw - (tx0 - bx) - 76), tx0, mid + 1);

    if (compact && (isAns || isPick)) {
      text(isAns ? '正确' : '你选的', bx + bw - 14, mid + 1, {
        size: 12, align: 'right', weight: 700,
        color: isAns ? C.green : C.red, alpha: ease,
      });
    } else if (quiz.settling && isPick) {
      text('已选', bx + bw - 14, mid + 1, { size: 12, align: 'right', color: C.gold });
    }
  });

  const ry0 = gm.oy + chipRowsH + 12;
  const ryEnd = y + h - 84;
  if (!quiz.settling) {
    g.save();
    g.globalAlpha = ease;
    g.beginPath();
    g.rect(x + 24, ry0 - 4, w - 48, Math.max(0, ryEnd - ry0 + 8));
    g.clip();
    let ry = ry0;
    // 释义行数按剩余高度分配，长解析不能把按钮顶掉。按钮顶就是 y+h-76，
    // 留 8px 呼吸；几何里的 resultH 与这里用同一个锚点，不再各留一次余量。
    const contentEnd = y + h - 84;

    if (fb.right) {
      const eff = EFFS[fb.eff] ?? EFFS.strike;
      // 每段伤害用实际值，不能用 fb.hits，那是扣格挡前的原始值。
      const segs = fb.parts.length ? fb.parts : [{ d: fb.dmg, a: fb.absorbed }];
      const shape = segs.length > 1 ? segs.map((s) => s.d).join(' + ') : `${fb.dmg}`;
      text(`${eff.name} · 造成 ${shape} 点伤害${fb.absorbed ? ` · ${fb.absorbed} 被吸收` : ''}`,
        x + 34, ry + 16, { size: 17, color: C.gold, weight: 700, maxW: w - 68 });
      ry += 25;
      if (fb.linkNote) {
        text(`联动 · ${fb.linkNote}`, x + 34, ry + 14, {
          size: 13, color: C.gold, weight: 600, maxW: w - 68,
        });
        ry += 22;
      }
      const extras: string[] = [];
      if (fb.blk > 0) extras.push(`${fb.blk} 点格挡`);
      if (fb.eff === 'pierce') extras.push('无视格挡');
      if (fb.heal > 0) extras.push(`回复 ${fb.heal} 点生命`);
      if (fb.draw > 0) extras.push(`抽 ${fb.draw} 张牌`);
      if (extras.length) {
        text(extras.join(' · '), x + 34, ry + 13, { size: 13, color: eff.color });
        ry += 20;
      }
    } else {
      text('这一手作废 · 不扣行动力', x + 34, ry + 16, {
        size: 17, color: col, weight: 700,
      });
      ry += 26;
    }

    g.font = font(13, 500, FONT_UI);
    const noteLines = fb.apNote ? wrapText(fb.apNote, w - 68).slice(0, 2) : [];
    noteLines.forEach((ln, i) => {
      text(ln, x + 34, ry + 13 + i * 19, { size: 13, color: C.gold, weight: 500 });
    });
    if (noteLines.length) ry += noteLines.length * 19 + 6;

    g.font = font(13, 400, FONT_UI);
    const expBudget = Math.max(0, Math.min(2, Math.floor((contentEnd - ry - 18) / 20)));
    const expLines = expBudget && fb.explain
      ? wrapText(fb.explain, w - 116).slice(0, expBudget) : [];
    if (expLines.length) {
      const eh = expLines.length * 20 + 18;
      roundRect(x + 34, ry, w - 68, eh, 9);
      g.fillStyle = 'rgba(255,255,255,.035)';
      g.fill();
      expLines.forEach((ln, i) => {
        text(ln, x + 50, ry + 20 + i * 20, { size: 13, color: C.ink2 });
      });
    }

    g.restore();

    const bw = 280;
    const bx = x + w / 2 - bw / 2;
    const by = y + h - 76;
    const bh = 58;
    const secs = Math.max(1, Math.ceil(quiz.autoProgress < 1 ? (1 - quiz.autoProgress) * 4.2 : 0));
    button(bx, by, bw, bh, '继续', 'primary', {
      size: 18,
      sub: quiz.autoPaused || quiz.autoCancelled
        ? '点击面板任意处 · 空格'
        : `${secs}s 后自动继续 · 点击立即`,
    });
    if (quiz.autoProgress > 0) {
      roundRect(bx + 8, by + bh - 5, Math.max(2, (bw - 16) * quiz.autoProgress), 2.5, 1.25);
      g.fillStyle = withAlpha(col, quiz.autoPaused ? 0.32 : 0.9);
      g.fill();
    }
  } else {
    text('判定已出 · 结算中…', x + w / 2, y + h - 42, {
      size: 13, align: 'center', color: C.dim, alpha: 0.6 + 0.4 * Math.sin(t * 8),
    });
  }
}

/* ── 奖励 ─────────────────────────────────────────────────── */

/** 战后结算的入场时刻：只用来演一次扫光，不落到任何存档或规则里。 */
let rewardWasOpen = false;
let rewardEnter = -1;

function drawReward(t: number) {
  const p = G.panel;
  if (p.k !== 'reward') return;
  const isElite = G.node?.type === 'elite';
  if (!rewardWasOpen) { rewardEnter = t; rewardWasOpen = true; }
  const age = t - rewardEnter;

  dim();
  const w = 1220;
  const h = 640;
  const x = (VW - w) / 2;
  const y = 130;
  box(x, y, w, h, withAlpha(C.gold, 0.4), skipReward);

  if (age < 0.7) {
    const u = clamp(age / 0.7, 0, 1);
    const sx = x - 220 + (w + 440) * u;
    g.save();
    roundRect(x, y, w, h, 18);
    g.clip();
    const lg = g.createLinearGradient(sx - 200, 0, sx + 200, 0);
    lg.addColorStop(0, 'rgba(232,182,76,0)');
    lg.addColorStop(0.5, withAlpha(C.gold, 0.2 * (1 - u)));
    lg.addColorStop(1, 'rgba(232,182,76,0)');
    g.fillStyle = lg;
    g.fillRect(x, y, w, h);
    g.restore();
  }

  heading('战斗结束', x + 44, y + 66,
    isElite ? '精英倒下了。挑一张卡，之后还会掉一个增益。'
      : p.ledger ? '账本翻开了：这一屏多一个选项，选中的牌直接精炼。'
        : '挑一张放进牌组。');

  // 张数是活的；卡宽按可用宽度等比缩放，四张时左右仍留 72px，卡面发光不会蹭到框。
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
    const lift = hv ? -10 : 0;
    // 预览用牌本身的数值；直接画 c.atk 会和入牌组后的卡面不一致。
    const id = p.ledger ? c.id + UP_MARK : c.id;
    drawCard(px, cy + lift, cw, ch, c, planStrike(id, { noBoost: true }), {
      glow: hv, up: p.ledger, rule: c.link?.note,
    });
    onClick(px, cy, cw, ch, () => takeCard(i), 'rewardcard');
  });

  action(x + w / 2 - 340, y + h - 74, 300, 54, '跳过，不要卡', () => skipReward());
  text('牌组会变厚。', x + w / 2 + 40, y + h - 46, { size: 13, color: C.faint });
}

/* ── 增益掉落 ─────────────────────────────────────────────── */

/** 精英 / 幕 Boss 的掉落：一张，拾取即生效；这一屏是收据，不是选择。 */
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

function drawPowerDrop() {
  const p = G.panel;
  if (p.k !== 'powerdrop') return;
  const pw = POWER_BY_ID[p.id];
  if (!pw) return;
  dim();

  const cw = 252;
  const ch = 322;
  const w = 800;
  // 面板高度跟着说明行数走：`desc` 是可选的（只说 card 装不下的边界），
  // 写死 590 会让没有说明的增益留出半屏空白，而三行的又会被按钮压住最后一行。
  const lines = pw.desc ? wrapText(pw.desc, w - 130).slice(0, 3) : [];
  const h = lines.length ? 580 + (lines.length - 1) * 22 : 546;
  const x = (VW - w) / 2;
  const y = (VH - h) / 2;
  // 没有"不要"：增益不占牌位、不稀释牌组，拒绝没有好处。
  box(x, y, w, h, withAlpha(pw.color, 0.5), null);

  heading('掉了一个增益', x + 44, y + 66, scopeLine(pw.scope));

  const cx = x + (w - cw) / 2;
  const cy = y + 118;
  drawPowerEmblem(cx, cy, cw, ch, pw, { glow: hover(cx, cy, cw, ch) });
  onClick(cx, cy, cw, ch, () => ackPower(), 'powerdrop');

  g.font = font(14, 400, FONT_UI);
  lines.forEach((ln, i) => {
    text(ln, x + 50, cy + ch + 34 + i * 22, { size: 14, color: C.ink2 });
  });

  action(x + w / 2 - 110, y + h - 80, 220, 50, '知道了', () => ackPower());
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
  dim();

  const n = p.ids.length;
  const cw = 300;
  const chh = 372;
  const gap = 44;
  const rowW = n * cw + (n - 1) * gap;
  const w = Math.max(700, rowW + 160);
  const lines = p.note ? wrapText(p.note, w - 120).slice(0, 3) : [];
  // 高度按内容推：注脚是可选的，写死会让只有一张卡的屏留出半屏空白。
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
  dim();
  const w = 1000;
  const h = 412;
  const x = (VW - w) / 2;
  const y = (VH - h) / 2;
  box(x, y, w, h, withAlpha(C.cyan, 0.4), null);

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
  dim();
  const w = 1280;
  const h = 740;
  const x = (VW - w) / 2;
  const y = 90;
  box(x, y, w, h, withAlpha(mode === 'up' ? C.gold : C.purple, 0.45));

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

  dim();
  const w = 900;
  const h = 640;
  const x = (VW - w) / 2;
  const y = (VH - h) / 2;
  box(x, y, w, h, withAlpha(C.gold, 0.45));
  heading('精炼这张？', x + 40, y + 62, '左边是现在，右边是精炼后；确认了才会改牌组。');

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

  // 确认 / 返回。返回不动牌组，代价也还没收。
  const bw = 200;
  const bh = 52;
  const by = y + h - 68;
  action(x + w / 2 - bw - 16, by, bw, bh, '确认精炼', () => upgradeCard(i), 'primary');
  action(x + w / 2 + 16, by, bw, bh, '返回', () => cancelPreview(), 'ghost');
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

  dim();
  box(x, y, w, h, withAlpha(C.purple, 0.45), null);

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
  dim();
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
  dim();
  const w = 1060;
  const h = 490;
  const x = (VW - w) / 2;
  const y = (VH - h) / 2;
  box(x, y, w, h, withAlpha(C.gold, 0.35));
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
    onClick(cx, cy, cw, ch, () => startRun(m.id), `mode:${m.id}`);
  });

  text('选定后整局不变，想换就重开一局。Esc 返回。',
    x + 44, y + h - 26, { size: 12, color: C.faint });
}

/* ── 说明 ─────────────────────────────────────────────────── */

function drawHelp() {
  dim();
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
    ['每一场都有自己的题池', [
      '开战时按牌组算题量：牌组里贵的牌越多，这一场新题越多。顶栏「题 N」是本场还没问过的新题。',
      '点开一张要答题的知识卡消耗一道，答错也消耗。新题用完不锁牌，改问本局被问得最少的题，顶栏显示「题 复用」。',
      '同一道题一局最多进 3 次新题池。',
    ]],
    ['三种模式，开局前选', [
      '学习：借书证 + 课表，2 个初始增益。',
      '复习：只带借书证，1 个初始增益。',
      '测试：没有初始增益；答对不退行动力，也没有额外防御。',
      '模式只决定开局带哪几个增益。',
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
  box(x, y, w, h, withAlpha(C.gold, 0.35));
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

/* ── 题库 ─────────────────────────────────────────────────── */

function drawPack() {
  const p = G.panel;
  if (p.k !== 'pack') return;
  dim();
  const w = 900;
  const h = 520;
  const x = (VW - w) / 2;
  const y = 190;
  box(x, y, w, h, withAlpha(C.cyan, 0.4));

  heading('载入自己的题库', x + 44, y + 66,
    '主题不限。只换题目，卡池不变；md / JSON 都行，样例见 packs/algorithms.md。');

  const lines = [
    '## 主题                → 可选，名字随便写，不写就进「未分类」',
    '### 题干  /  ? 题干    → 一道题',
    'A) 选项 / B) 选项 …    → 2–4 个',
    '= B                   → 正确答案字母（不能越过选项数）',
    '+ 解析（可选，答完会显示）',
    '! 固定顺序            → 有「以上都对」这类选项时必写',
    '点开一张牌 → 从当前这一章的题目里抽；这一章没题就抽全部',
    `卡面（${PACK.cards.length} 张 / 攻挡 / 效果）内置，md 换不掉`,
  ];
  roundRect(x + 44, y + 120, w - 88, 216, 10);
  g.fillStyle = 'rgba(255,255,255,.035)';
  g.fill();
  g.font = font(15, 400, '"SF Mono",ui-monospace,Consolas,monospace');
  g.fillStyle = C.cyan;
  lines.forEach((ln, i) => g.fillText(ln, x + 64, y + 148 + i * 24));

  action(x + 44, y + 358, 260, 56, '选一个 .md 文件', () => requestPackFile());
  action(x + 328, y + 358, 260, 56, '从剪贴板粘贴', () => pastePack());

  if (p.msg) {
    g.font = font(14, 500, FONT_UI);
    g.fillStyle = p.ok ? C.green : C.red;
    wrapText(p.msg, w - 88).slice(0, 4).forEach((ln, i) => g.fillText(ln, x + 44, y + 428 + i * 21));
  } else {
    const src = sourceBank();
    text(`当前题库：${src.name} · ${countQuestions(src)} 道题 / ${Object.keys(src.byTopic).length} 个题池`,
      x + 44, y + 430, { size: 13, color: C.dim });
    text('校验题干、2–4 个选项、= 答案字母，以及「以上都对」这类选项有没有写「! 固定顺序」；写错会指出位置。复习进度按内置卡片 id 保存。',
      x + 44, y + 454, { size: 13, color: C.faint });
  }
}

