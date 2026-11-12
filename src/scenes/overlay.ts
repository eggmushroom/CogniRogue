import { g, roundRect, VH, VW, wrapText } from '../gfx/canvas';
import { C, font, FONT_TITLE, FONT_UI, topicColor, withAlpha } from '../gfx/theme';
import { action, button, drawCard, drawPowerEmblem, squeeze, text } from '../gfx/ui';
import { consumeWheel, hover, onClick } from '../input';
import { BAL, EFFS, MODES, POWER_BY_ID, effSummary, resolveEff } from '../core/model';
import { clamp, G } from '../core/infra';
import { countQuestions, sourceBank } from '../core/library';
import {
  BASICS, baseIdOf, basicsSummary, cardType, CARD_TYPE_META, costOf, defOf, isUpgraded,
  isXCost, statOf, upGain, UP_MARK,
} from '../core/cards';
import { applyCardBonus } from '../core/cards/powers';
import { answer, cancelPanel } from '../core/combat';
import { liveStatOf } from '../core/combat/link';
import {
  ackPower, chooseEventOption, dismissFeedback, forgetCard, openCardPick, restHeal, startRun,
  skipReward, takeCard, upgradeCard,
} from '../core/journey';
import type { PowerDef, Question, QView } from '../core/model';
import { drawReport } from './report';
import { requestPackFile, pastePack } from './packio';

/* ── 通用外壳 ─────────────────────────────────────────────── */

function dim(a: number) {
  g.fillStyle = `rgba(3,4,8,${a})`;
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
  onClick(cx - 16, cy - 16, 32, 32, onClose);
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

const QX = 76;
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
 * 答题与判定共用一份几何，判定只改颜色，盒子高度不变。
 * 选项带按四行固定：按实际个数算高度，少选项的题在判定时会突然长高。
 */
function quizGeom(question: string, n: number) {
  g.font = font(26, 700, FONT_UI);
  const lines = wrapText(question, QW - 68);
  const lineH = 36;
  const headH = 132;
  const gap = 12;
  const fixedH = headH + lines.length * lineH + 24 + 76;
  const oh = clamp(Math.floor((VH - 96 - fixedH) / 4) - gap, 54, 70);
  const band = 4 * (oh + gap) - gap;
  const h = headH + lines.length * lineH + 24 + band + 76;
  const y = Math.max(48, (VH - h) / 2);
  const qy = y + headH;
  const oy = qy + lines.length * lineH + 24;
  const rowH = Math.min(96, (band - (n - 1) * gap) / n);
  const rowsH = n * rowH + (n - 1) * gap;
  return {
    x: QX, y, w: QW, h, lines, lineH, headH, gap, oh, band,
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
  const gm = quizGeom(q.q, options.length);
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
  const sumW = 300;
  const sx = x + w - 84 - sumW;
  text('答对就拿到的效果', sx, y + 50, { size: 12, color: C.dim, align: 'left' });
  text(effSummary(card.eff, st.atk, st.blk, card.mods, xc), sx, y + 74, {
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

  text('答对：效果按卡面结算，带借书证时退回 1 点行动力。答错：这一手作废，不扣行动力、牌进弃牌堆。',
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
  const gm = quizGeom(fb.question, fb.options.length);
  const { x, y, w, h } = gm;
  const n = fb.options.length;
  quizFrameInfo = {
    drawn: true, phase: quiz.settling ? 'settle' : 'result', geom: { x, y, w, h },
  };

  const u = clamp(quiz.reveal / 0.26, 0, 1);
  const ease = 1 - Math.pow(1 - u, 3);
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
    // 释义行数按剩余高度分配，长解析不能把按钮顶掉。
    const contentEnd = y + h - 132;

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

  dim(0.78);
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
    // 预览用 statOf 的数值；直接画 c.atk 会和入牌组后的卡面不一致。
    const id = p.ledger ? c.id + UP_MARK : c.id;
    const st = statOf(id);
    drawCard(px, cy + lift, cw, ch, c, st.atk, st.blk, {
      glow: hv, up: p.ledger, rule: c.link?.note,
    });
    onClick(px, cy, cw, ch, () => takeCard(i), 'rewardcard');
  });

  action(x + w / 2 - 340, y + h - 74, 300, 54, '跳过，不要卡', () => skipReward());
  text('牌组越厚，关键卡越难抽到。', x + w / 2 + 40, y + h - 46, { size: 13, color: C.faint });
}

/* ── 增益掉落 ─────────────────────────────────────────────── */

/** 精英 / 幕 Boss 的掉落：一张，拾取即生效；这一屏是收据，不是选择。 */
/** 增益多久兑现一次，用玩家读得懂的话；作用域内部名不对玩家露出。 */
function scopeLine(scope: PowerDef['scope']): string {
  switch (scope) {
    case 'always': return '整局常驻：它不进牌组，每一次结算都算上它。';
    case 'fight': return '整局常驻，但每场战斗只兑现一次。';
    case 'stage': return '整局常驻，但每一幕只兑现一次。';
    case 'run': return '整局常驻，整局只兑现一次，用完就没了。';
    default: return '拾取即结算：效果已经落下了，之后不再挂任何时机。';
  }
}

function drawPowerDrop() {
  const p = G.panel;
  if (p.k !== 'powerdrop') return;
  const pw = POWER_BY_ID[p.id];
  if (!pw) return;
  dim(0.82);

  const cw = 252;
  const ch = 322;
  const w = 800;
  const h = ch + 268;
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
  const lines = wrapText(pw.desc, w - 100).slice(0, 3);
  lines.forEach((ln, i) => {
    text(ln, x + 50, cy + ch + 46 + i * 22, { size: 14, color: C.ink2 });
  });

  action(x + w / 2 - 110, y + h - 76, 220, 50, '知道了', () => ackPower());
}

/* ── 复习点 ───────────────────────────────────────────────── */

function drawRest(t: number) {
  dim(0.72);
  const w = 1000;
  const h = 412;
  const x = (VW - w) / 2;
  const y = (VH - h) / 2;
  box(x, y, w, h, withAlpha(C.cyan, 0.4), null);

  heading('复习', x + 44, y + 66, '这一层没有敌人。休息，或者动一动牌组。');

  const opts: Array<{ t: string; s: string; fn: () => void; col: string }> = [
    { t: '休息', s: `回复 ${Math.round(G.maxHp * BAL.restPct)} 点生命`, col: C.green, fn: restHeal },
    { t: '精炼一张卡', s: '挑中的那一张：攻/挡底数 +3（同名的其余几张不变）', col: C.gold, fn: () => openCardPick('up') },
    { t: '遗忘', s: '永久移除一张卡（牌组只剩 4 张时不能再删）', col: C.purple, fn: () => openCardPick('rm') },
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
 * 精炼 / 遗忘面板：每份副本各占一格，只改挑中的那张；卡面直接画选后的数值。
 * 取消不付 `G.pendingCost`，选了才付。
 */
function drawCardPick(mode: 'up' | 'rm') {
  dim(0.8);
  const w = 1280;
  const h = 740;
  const x = (VW - w) / 2;
  const y = 90;
  box(x, y, w, h, withAlpha(mode === 'up' ? C.gold : C.purple, 0.45));

  const pending = G.pendingCost;
  heading(mode === 'up' ? '精炼哪一张' : '遗忘哪一张', x + 44, y + 66,
    mode === 'up'
      ? '卡面数值会永久改变，只强化挑中的那一张。基础牌也能精炼，但只强化你挑中的那一张。'
      : '移除后这张卡本局不会再出现。牌组会更薄，也更好抽；基础牌也能丢。');
  if (pending > 0) {
    text(`选完要付 ${pending} 点生命；取消则不付。`, x + 44, y + 106, {
      size: 13, color: C.red, weight: 700,
    });
  }

  // 每一份副本单独一格；精炼按张，`i`（牌组下标）才是身份。
  const items = G.deck
    .map((id, i) => ({ id, i, d: defOf(id) }))
    .filter((o) => mode === 'rm' || !isUpgraded(o.id))
    .sort((a, b) => a.d.topic.localeCompare(b.d.topic) || a.i - b.i);

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

  const seen: Record<string, number> = {};
  items.forEach((o, k) => {
    const col = k % cols;
    const row = Math.floor(k / cols);
    const px = gx0 - x - 30 + area.x + col * (cw + gapx);
    const py = area.y + row * (ch + gapy);
    const hv = hover(px, py, cw, ch);
    const st = statOf(o.id);
    const up = mode === 'up';
    // 卡面画选后的数值，必须和 statOf 同一套折算，否则选完才发现涨得比卡面多。
    const gain = upGain();
    const after = { atk: st.atk + (up ? gain : 0), blk: st.blk + (up ? gain : 0) };
    const faceOf = (atk: number, blk: number) => {
      const out = applyCardBonus(resolveEff(o.d.eff, atk, blk, 1, o.d.mods));
      return { dmg: out.hits.reduce((n, v) => n + v, 0), blk: out.blk };
    };
    const b = faceOf(st.atk, st.blk);
    const a = faceOf(after.atk, after.blk);
    // note 只写变了哪一格，判据是前后不相等；基础斩击 +3 底数会折算成格挡。
    const note = up
      ? [
        b.dmg !== a.dmg ? `伤 ${b.dmg}→${a.dmg}` : '',
        b.blk !== a.blk ? `挡 ${b.blk}→${a.blk}` : '',
      ].filter(Boolean).join('  ')
      : undefined;
    drawCard(px, py, cw, ch, o.d, after.atk, after.blk, {
      // 只给真的已精炼的牌画金边和 + 号；全部画上会读成四张都强化过。
      up: isUpgraded(o.id), glow: hv, note, rule: o.d.link?.note,
    });
    const base = baseIdOf(o.id);
    seen[base] = (seen[base] ?? 0) + 1;
    const total = G.deck.filter((v) => baseIdOf(v) === base).length;
    if (total > 1) {
      text(`第 ${seen[base]}/${total} 张`, px + cw - 12, py + ch - 10, {
        size: 12, align: 'right', color: C.faint, weight: 600,
      });
    }
    // 热区只登记当前露在列表里的那一段；按整卡登记会点到被裁掉的牌。
    const top = Math.max(py, area.y0);
    const bot = Math.min(py + ch, area.y0 + area.h);
    if (bot > top) {
      onClick(px, top, cw, bot - top, () => (up ? upgradeCard(o.i) : forgetCard(o.i)), 'pick', o.i);
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

  dim(0.76);
  box(x, y, w, h, withAlpha(C.purple, 0.45), null);

  heading(p.ev.title, x + 44, y + 66, `事件 · 第 ${(G.node?.r ?? 0) + 1} 层`);

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
    const hv = hover(x + 44, by, w - 88, 74);
    roundRect(x + 44, by, w - 88, 74, 10);
    g.fillStyle = hv ? withAlpha(C.purple, 0.16) : 'rgba(255,255,255,.03)';
    g.fill();
    g.strokeStyle = hv ? C.purple : C.line;
    g.lineWidth = hv ? 1.8 : 1.2;
    g.stroke();
    text(o.t, x + 70, by + 26, { size: 19, weight: 600, color: hv ? C.ink : C.ink2 });
    text(o.sub, x + 70, by + 52, { size: 13, color: C.dim });
    onClick(x + 44, by, w - 88, 74, () => chooseEventOption(i), 'eventopt');
  });
}

/* ── 牌组 / 牌堆 ──────────────────────────────────────────── */

function drawGallery(title: string, list: string[]) {
  dim(0.8);
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
    const st = statOf(id);
    drawCard(px, py, cw, ch, d, st.atk, st.blk, { up: isUpgraded(id), rule: d.link?.note });
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
 * 刻意不读 MODES 的 color / icon：首页、复习点、事件、战后选卡都是暗底 +
 * 单一金边的目录卡片，三块各染绿/金/红会读成另一套 UI。难度差别交给
 * 增益个数和它的名字，彩色只留给 hover 与面板边线。
 */
function drawBoon() {
  dim(0.84);
  const w = 1040;
  const h = 486;
  const x = (VW - w) / 2;
  const y = (VH - h) / 2;
  box(x, y, w, h, withAlpha(C.gold, 0.35));
  heading('这次从哪个模式开始', x + 44, y + 64,
    '只决定开局带几个增益；答错价码、卡面、题库三档完全一样。');

  const pad = 44;
  const gap = 24;
  const cw = (w - pad * 2 - gap * 2) / 3;
  const ch = 272;
  const cy = y + 140;
  MODES.forEach((m, i) => {
    const cx = x + pad + i * (cw + gap);
    const mid = cx + cw / 2;
    const hv = hover(cx, cy, cw, ch);

    roundRect(cx, cy, cw, ch, 14);
    g.fillStyle = hv ? withAlpha(C.gold, 0.1) : 'rgba(255,255,255,.035)';
    g.fill();
    g.strokeStyle = withAlpha(C.gold, hv ? 0.85 : 0.28);
    g.lineWidth = hv ? 2 : 1.3;
    g.stroke();

    // 编号 + 渐隐金线是首页标题下那条分割线的缩小版，三张卡读成同一套目录卡片。
    text(`0${i + 1}`, mid, cy + 30, {
      size: 12, align: 'center', color: C.faint, weight: 700,
    });
    const lg = g.createLinearGradient(cx + 36, 0, cx + cw - 36, 0);
    lg.addColorStop(0, withAlpha(C.gold, 0));
    lg.addColorStop(0.5, withAlpha(C.gold, hv ? 0.8 : 0.45));
    lg.addColorStop(1, withAlpha(C.gold, 0));
    g.fillStyle = lg;
    g.fillRect(cx + 36, cy + 46, cw - 72, 1.4);

    text(m.name, mid, cy + 84, {
      size: 26, weight: 700, align: 'center', family: FONT_TITLE,
      color: hv ? C.gold : C.ink,
    });

    g.font = font(13, 400, FONT_UI);
    g.fillStyle = C.ink2;
    g.textAlign = 'center';
    wrapText(m.desc, cw - 48).slice(0, 3)
      .forEach((ln, j) => g.fillText(ln, mid, cy + 118 + j * 20));
    g.textAlign = 'left';

    text(`初始增益 · ${m.powers.length}`, mid, cy + 196, {
      size: 12, align: 'center', color: C.faint, weight: 700,
    });
    text(
      m.powers.length
        ? m.powers.map((id) => POWER_BY_ID[id]?.name ?? id).join(' · ')
        : '无 · 全靠路上捡',
      mid, cy + 218, {
        size: 13, align: 'center', weight: 600,
        color: m.powers.length ? C.ink2 : C.faint,
      },
    );

    text(hv ? '从这里开始 →' : '点击选择', mid, cy + ch - 24, {
      size: 13, align: 'center', color: hv ? C.gold : C.faint, weight: 700,
    });
    // 这个 label 是冒烟测试点开局的入口：坐标可以改，名字不能改。
    onClick(cx, cy, cw, ch, () => startRun(m.id), `mode:${m.id}`);
  });

  text('开局选一次，整局不变；想换就重开一局。Esc 返回。',
    x + 44, y + h - 30, { size: 12, color: C.faint });
}

/* ── 说明 ─────────────────────────────────────────────────── */

function drawHelp() {
  dim(0.8);
  const w = 1120;
  const x = (VW - w) / 2;
  const colW = (w - 96 - 36) / 2;
  const cols = [x + 48, x + 48 + colW + 36];

  const blocks: Array<[string, string[]]> = [
    [`初始牌组：10 张（8 基础 + 2 随机知识）`, [
      `开局 ${BASICS.length} 张基础牌（${basicsSummary()}），不答题、随时可打，各要 1 点行动力；再加 2 张随机知识卡。`,
      '基础牌无法从游戏中获得，但可以精炼或遗忘。它们的数值低于知识卡，只保证手牌不会完全卡死。',
    ]],
    ['三类牌：攻击 / 防御 / 技能', [
      '攻击（猛击 / 洞察 / 串联 / 内化）：把行动力换成伤害，内化按实际伤害回血。',
      '防御（巩固）：伤害减半、格挡翻倍。',
      '技能（专注）：伤害偏低，抽一张牌。',
      '增益不是牌：精英和 Boss 掉落，拾取即生效，不进牌组、不花行动力。',
    ]],
    ['牌面只讲机械，不讲知识', [
      '卡面上只有费用、类别、牌名、效果和数值。左上角是费用：0–3 点，或 X（花光行动力，花几点结算几次）；付不起时变红。',
      '费用右边的字母是等级：C 不用答题、B 答对 1 次、A 两次、S 三次，攒够这一场就免答。',
      '右下角纹章是效果原型，顶部色条是攻击 / 防御 / 技能三类。',
      '卡面没有题目：点开才从当前这一章抽题，和这张牌的主题无关；C 级不问。',
    ]],
    ['答对算数，答错这一手作废', [
      '答对：卡面效果按原值结算，这张牌攒一次免答；带借书证时退回 1 点行动力。',
      '答错：这一手不结算，也不扣行动力；本场少一道新题，牌进弃牌堆。',
      '攒满等级（C 0 / B 1 / A 2 / S 3）之后，这一场剩下的时间它直接打、不再出题。计数每场清零。',
      '默认不补格挡、不补抽；橡皮、草稿纸、装订线各改其中一条。',
    ]],
    ['每一场都有自己的题池', [
      '开战时按牌组算题量：牌组里贵的牌越多，这一场新题越多。顶栏「题 N」是本场还没问过的新题。',
      '点开一张要答题的知识卡消耗一道，答错也消耗。新题用完不锁牌，改问本章被问得最少的题，顶栏显示「题 复用」。',
      '同一道题一局最多进 3 次新题池。',
    ]],
    ['三种模式，开局前选', [
      '学习：借书证 + 课表，2 个初始增益。',
      '复习：只带借书证，1 个初始增益。',
      '测试：没有初始增益；答对不退行动力，也没有额外防御。',
      '模式只影响开局带哪几个增益，不改答错价码、卡面、题库和已攒下的记忆。',
    ]],
    ['行动力是唯一的节奏', [
      `每回合 ${BAL.baseAp} 点行动力、抽 ${BAL.drawPerTurn} 张牌；每张牌标 0–3 点，X 费吃光剩下的全部。`,
      '带借书证时答对退 1 点：1 费牌等于免费，2 费净花 1 点、3 费净花 2 点。',
      '答错不扣行动力；基础牌不答题，所以一分不退。',
      '双面镜让每回合第一次答对抽 1 张，荧光笔让每场第一次答对多退 1 点。',
      '键盘：1–4 选选项，空格 / 回车推进面板，空场时空格结束回合。',
    ]],
    ['增益是掉落，不是牌', [
      '精英和幕 Boss 战后各掉一个增益，拾取即生效、整局常驻；不进牌组、不占手牌、不花行动力。',
      '常驻类改规则（沙漏、索引卡、长明灯……）；每场一次类挂在第一次答对 / 答错或第一次出牌上。',
      '池子里每种只有一个，拿过就不再掉，也不叠层。',
    ]],
    ['一百层，五幕', [
      '整座塔 100 层，每 20 层是一幕，幕末一只 Boss。打赢会换一张新地图、血回满、生命上限 +14。',
      '一幕一套物种：目录厅教你出牌、虫蛀区搅你的牌堆、报刊区靠反伤、修复室叠甲、禁书区挑你错得最多的主题。',
      '层号越高，怪越厚、打得越疼。',
      '地图一屏显示 8 层；滚轮或按住拖动可以看到整张 20 层，先看清上面是不是精英。',
      '节点类型全部可见：战斗、精英、复习、事件、Boss。',
      '复习点三选一：回复 62% 生命（修书胶再加）、精炼一张卡（攻 / 挡底数 +3）、或永久移除一张。',
      '精炼按张算：牌组里每份副本各占一格，只强化挑中的那一张，同名的另一张不动；精炼过的那张带一个 + 号。',
      '牌组越厚，关键卡越难抽到，所以战后拿不拿那张奖励卡是真正的构筑决定。',
    ]],
    ['它会记住你', [
      '复习状态存在本地；起手固定 10 张（4 斩击 + 4 格挡 + 2 张随机低费知识卡，A / S 级要自己挣），模式只改开局增益数量。',
      '结算页给出本局答题数、正确率和答错次数。',
    ]],
  ];

  // 先量后画，否则加一段说明会把最后一行挤出盒子。
  g.font = font(14, 400, FONT_UI);
  const measured = blocks.map(([t, lines]) => ({
    t, lines: lines.flatMap((ln) => wrapText(ln, colW - 8)),
  }));
  const halves = [measured.slice(0, 4), measured.slice(4)];
  const colH = halves.map((half) => half.reduce(
    (n, b) => n + 26 + b.lines.length * 20 + 10, 0,
  ));
  const contentH = Math.max(...colH);
  const h = Math.min(VH - 48, 128 + contentH + 44);
  const y = Math.max(24, (VH - h) / 2);
  box(x, y, w, h, withAlpha(C.gold, 0.35));
  heading('怎么玩', x + 48, y + 70, '一句话：出牌要答题（C 级除外），答对了卡才生效。');
  // 正文进滚动区；直接照画会把最后一块切掉半行，比看不到更糟。
  const bodyTop = y + 128;
  const bodyH = h - 128 - 46;
  // fillText 的 y 是基线，标题要往下让 20px，否则被裁剪切掉上半截。
  const area = scrollArea(x + 24, bodyTop, w - 48, bodyH, contentH + 26, 'help');

  halves.forEach((half, ci) => {
    let by = area.y + 20;
    for (const b of half) {
      text(b.t, cols[ci], by, { size: 18, weight: 700, color: C.gold });
      by += 26;
      g.font = font(14, 400, FONT_UI);
      g.fillStyle = C.ink2;
      g.textAlign = 'left';
      for (const seg of b.lines) {
        g.fillText(seg, cols[ci] + 4, by);
        by += 20;
      }
      by += 10;
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
  dim(0.8);
  const w = 900;
  const h = 520;
  const x = (VW - w) / 2;
  const y = 190;
  box(x, y, w, h, withAlpha(C.cyan, 0.4));

  heading('载入自己的题库', x + 44, y + 66,
    '主题不限，只校验格式。只换题目，卡池恒定；md / JSON 都行，样例见 packs/algorithms.md。');

  const lines = [
    '## 主题                → 可选，名字随便写，不写就进「未分类」',
    '### 题干  /  ? 题干    → 一道题',
    'A) 选项 / B) 选项 …    → 2–4 个',
    '= B                   → 正确答案字母（不能越过选项数）',
    '+ 解析（可选，答完会显示）',
    '点开一张牌 → 从当前这一章的 BANK 抽题；章节没题就抽全部题目',
    '卡面（101 张 / 攻挡 / 效果）内置，md 改不了',
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
    text('只校验格式：题干、2–4 个选项、= 答案字母；写错会列出第几行。复习进度按内置卡片 id 保存，不会丢。',
      x + 44, y + 454, { size: 13, color: C.faint });
  }
}

