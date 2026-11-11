import { g, roundRect, VH, VW, wrapText } from '../gfx/canvas';
import { C, font, FONT_TITLE, FONT_UI, topicColor, withAlpha } from '../gfx/theme';
import { action, button, drawCard, drawPowerEmblem, squeeze, text } from '../gfx/ui';
import { consumeWheel, hover, onClick } from '../input';
import { BAL, EFFS, MODES, POWER_BY_ID, effSummary, resolveEff } from '../core/model';
import { clamp, G } from '../core/infra';
import { countQuestions, sourceBank } from '../core/library';
import {
  BASICS, baseIdOf, basicsSummary, cardType, CARD_TYPE_META, costOf, defOf, isUpgraded,
  isXCost, statOf, upGain,
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

/**
 * 面板外壳。
 *
 * `onClose` 为 `null` 时不画右上角的 × —— 强制选择的面板（复习、事件、选卡）
 * 没有"关掉"这个语义，画一个点了没反应的 × 比不画更糟。
 */
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

  // 顶部一道主题色条：弹层和背景之间给一条明确的边界，也顺手给这个面板定调。
  // 渐隐两端，不会在圆角外露出方角。
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

  // 关闭
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

/** 长列表容器：裁剪 + 滚轮。 */
let scroll = 0;
let scrollKey = '';
function scrollArea(x: number, y: number, w: number, h: number, contentH: number, key = '') {
  // scroll 是模块级的：换了一张列表就要归零。否则在牌组里滚到底、再打开弃牌堆，
  // 会从中间开始 —— 那不是"记住进度"，是漏了一份状态。
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

/**
 * 列表溢出的三个收尾：底部渐隐、右侧滚动条、脚注提示。
 *
 * 以前列表被容器干净地切断 —— 第三排卡只剩一窄条，读起来像渲染坏了，而不是
 * "下面还有"。渐隐把"切"变成"渐出"，滚动条回答"还有多少"，脚注写明怎么滚。
 */
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
    case 'feedback': return drawFeedback(t, quiz);
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

/** main.ts / 冒烟测试读的答题面板现场：判定有没有换过框，是可验的。 */
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
  /** 判定已出、打击演出还在飞：面板在原地不消失，但结果区还没展开 */
  settling: boolean;
  /** 结果区展开后的秒数，驱动选项折叠与结果逐层淡入 */
  reveal: number;
  /** 自动推进进度 0..1 */
  autoProgress: number;
  autoPaused: boolean;
  autoCancelled: boolean;
}
const IDLE_QUIZ: QuizState = {
  settling: false, reveal: 0, autoProgress: 0, autoPaused: true, autoCancelled: false,
};

/**
 * 答题与判定**共用一份几何**。
 *
 * 以前两个面板各算各的高度：点下选项的那一帧旧框消失、光刃飞 0.66s、
 * 再弹一个更高更暗的新框 —— 一局几十次的"换页感"就是这么来的。现在盒子、
 * 题干和选项从头到尾钉在同一处；判定只改颜色，选项在原位收拢成小片，
 * 腾出来的空间里展开结果。玩家读到的是"这一张卡翻面了"，不是"换了一屏"。
 *
 * 选项带按四行固定：题库允许 2–4 个选项，若按实际个数算高度，少选项的题
 * 会在判定时突然长高一截。少选项时把行高撑大并在带内居中，几何就不会跳。
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

/**
 * 只有答题 / 判定这两屏用这层渐变遮罩。
 *
 * 判定刚出来的那一小段压到 0.72 倍：光刃和飘字要透得过来，玩家才读得到
 * "判定"和"打出去"是同一件事；结果展开后回到完整浓度，视线收回面板。
 */
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
  // 题面是点开那一刻从题库抽出的快照，选项顺序来自本次打乱的视图 ——
  // 反馈面板读的是同一份。卡面本身（card）里没有题。
  const options = view.options;
  const gm = quizGeom(q.q, options.length);
  const { x, y, w } = gm;
  const col = C.blue;
  quizFrameInfo = { drawn: true, phase: 'ask', geom: { x, y, w, h: gm.h } };

  dimQuestion();
  box(x, y, w, gm.h, withAlpha(col, 0.5));

  // 标题 = 牌名。牌名不是知识点，摆出来不泄题，还能把「这手牌」和「这道题」对上号。
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
  // 出牌之前就把因果讲明白：这个数不是牌面自带的，是前几张牌堆出来的。
  // 题干基线在 y + headH(=132)，所以这一行只能落在 y+100：再往下就会
  // 和 26px 的题干顶部叠在一起（第一版放 y+106 就撞上了）。
  if (st.reasons.length) {
    text(`联动 · ${st.reasons.join(' · ')}`, x + 34, y + 100, {
      size: 12, color: C.gold, weight: 600, maxW: w - 68,
    });
  }

  // 题面：卡面知识点名已经撤掉，这里就是整个面板的主标题
  roundRect(x + 24, gm.qy - 8, 3, gm.lines.length * gm.lineH - 10, 2);
  g.fillStyle = withAlpha(col, 0.9);
  g.fill();
  g.font = font(26, 700, FONT_UI);
  g.fillStyle = C.ink;
  gm.lines.forEach((ln, i) => g.fillText(ln, x + 34, gm.qy + i * gm.lineH));

  // "问"和"选"之间断开：一条细线就够
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

  // 底部一行：这一局的答错价码。模式整局不变，所以这里只说一次。
  text('答对退回 1 点行动力；答错这一手作废 —— 不扣行动力、不补格挡、不补抽，牌进弃牌堆。',
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

  // 判定当帧就出现（settling 阶段也一样），结果区才按 reveal 逐层淡入。
  const u = clamp(quiz.reveal / 0.26, 0, 1);
  const ease = 1 - Math.pow(1 - u, 3);
  dimQuestion(clamp(0.72 + quiz.reveal * 1.4, 0.72, 1));

  // 整块面板都是"继续"，不用瞄准一个小按钮；× 由 box 注册在它之后，
  // 所以右上角仍然是独立可点的关闭。演出未完时不注册，避免抢在判定前推进。
  if (!quiz.settling) onClick(x, y, w, h, () => dismissFeedback(), '继续');
  box(x, y, w, h, withAlpha(col, 0.5), quiz.settling ? null : dismissFeedback);

  // 标题原地换字 + 轻微弹出：这一下点对了，立刻就知道
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

  // 右侧摘要：判定一出就把结论钉在这里，结果区再逐层展开。
  const sx = x + w - 84 - 300;
  text(fb.right ? '这一手已经生效' : '这一手作废', sx, y + 50, { size: 12, color: C.dim });
  text(fb.right ? '效果已经结算' : '不扣行动力', sx, y + 74, {
    size: 14, color: col, weight: 700,
  });

  // 题干：和答题时同一个字号、同一处坐标，一行都不挪
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

  // 判定演出那一小段：选项**留在答题时的整行位置**，只把"我选了哪个"点亮。
  // 结果展开时换成 2×2 小片，腾出的空间给结算内容。刻意不做逐帧位置插值 ——
  // 四行在半路上会互相叠、结果文字又会压到还在飞的行上，读起来像渲染坏了。
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

    // 演出中只亮"已选"，对错留到结果展开那一拍才揭晓
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

  // ── 结果区：只占选项收拢腾出来的空间，盒子高度始终没变 ──
  const ry0 = gm.oy + chipRowsH + 12;
  const ryEnd = y + h - 84;
  if (!quiz.settling) {
    g.save();
    g.globalAlpha = ease;
    g.beginPath();
    g.rect(x + 24, ry0 - 4, w - 48, Math.max(0, ryEnd - ry0 + 8));
    g.clip();
    let ry = ry0;
    // 先给阶梯留位，再按剩下的高度分配释义行数 —— 长解析不能把阶梯和按钮顶掉。
    // 结果区到「继续」之间的空档全部给释义，不再留阶梯占位。
    const contentEnd = y + h - 132;

    if (fb.right) {
      const eff = EFFS[fb.eff] ?? EFFS.strike;
      // 多段要显示**实际**每段伤害，不能用 fb.hits：那是扣格挡前的原始值。
      const segs = fb.parts.length ? fb.parts : [{ d: fb.dmg, a: fb.absorbed }];
      const shape = segs.length > 1 ? segs.map((s) => s.d).join(' + ') : `${fb.dmg}`;
      text(`${eff.name} · 造成 ${shape} 点伤害${fb.absorbed ? ` · ${fb.absorbed} 被吸收` : ''}`,
        x + 34, ry + 16, { size: 17, color: C.gold, weight: 700, maxW: w - 68 });
      ry += 25;
      // 判定里把"这 14 点是哪来的"写清楚：不写就只是一个忽大忽小的数字。
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

    // 继续：按钮只是视觉，整块面板已经接过点击。sub 里把自动推进讲明白。
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
    // 演出这一小段：一行短提示，让"已经在判定了"这件事不落空
    text('判定已出 · 结算中…', x + w / 2, y + h - 42, {
      size: 13, align: 'center', color: C.dim, alpha: 0.6 + 0.4 * Math.sin(t * 8),
    });
  }
}

/* ── 奖励 ─────────────────────────────────────────────────── */

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
  // × = 跳过：奖励面板本来就有"跳过"，关掉和跳过同义。
  box(x, y, w, h, withAlpha(C.gold, 0.4), skipReward);

  // 一道扫光把"打完了"和"挑卡了"接上：否则击杀的最后一帧直接跳成一张静态列表。
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
    isElite ? '精英倒下了。挑一张卡 —— 它还会掉一个增益。' : '挑一张放进牌组。');

  // 张数是活的：「便签」把三选一变成四选一。原来卡宽写死 280，
  // 四张正好 1222px > 面板 1220px，卡片左右各压出边框 1px —— 看着就是"贴边了"。
  // 现在先按可用宽度等比缩卡：三张保持原尺寸，四张及以上整体缩小，
  // 左右始终留出至少 72px，卡面发光也不会蹭到框。
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
  // 缩卡后仍把整排压在原来 356px 高的中心上，底部按钮那一行才不会突然空一截
  const cy = y + 142 + (baseCh - ch) / 2;

  p.cards.forEach((c, i) => {
    const px = cx0 + i * (cw + gap);
    const hv = hover(px, cy, cw, ch);
    const lift = hv ? -10 : 0;
    // 奖励预览也用同一套卡面数值；直接画 c.atk 会和入牌组后的卡面不一致。
    const st = statOf(c.id);
    drawCard(px, cy + lift, cw, ch, c, st.atk, st.blk, { glow: hv, note: c.link?.note });
    onClick(px, cy, cw, ch, () => takeCard(i), 'rewardcard');
  });

  action(x + w / 2 - 340, y + h - 74, 300, 54, '跳过，不要卡', () => skipReward());
  text('牌组越厚，关键卡越难抽到。', x + w / 2 + 40, y + h - 46, { size: 13, color: C.faint });
}

/* ── 增益掉落 ─────────────────────────────────────────────── */

/**
 * 精英 / 幕 Boss 的掉落。
 *
 * 只有一张，而且**已经生效了** —— 这一屏是收据，不是选择：它告诉玩家掉的是什么、
 * 这一局它一直做什么。唯一的操作是"知道了"。
 *
 * 上一版这一屏是三选一、拿进牌组，然后要靠自己抽到它、付得起它的费用、打出它才生效，
 * 而本场结束又会清空 —— 于是玩家经常整局都没见过自己拿到的增益做过什么。
 */
/**
 * 一张能力牌"多久兑现一次"，用玩家读得懂的一句话。
 *
 * 四十张牌按五档作用域分布（`PowerScope`），但玩家不该看到 `always` /
 * `fight` 这种词 —— 他要回答的是"这东西什么时候能用"。这一行就是那个答案，
 * 而它同时也是**设计约束的公示**：一张 `fight` 的牌写成"每场一次"，
 * 就不会有人以为它每回合都在响。
 */
function scopeLine(scope: PowerDef['scope']): string {
  switch (scope) {
    case 'always': return '整局常驻：它不进牌组，每一次结算都算上它。';
    case 'fight': return '整局常驻，但每场战斗只兑现一次。';
    case 'stage': return '整局常驻，但每一幕只兑现一次。';
    case 'run': return '整局常驻，整局只兑现一次 —— 用完就没了。';
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
  // 没有"不要"：增益不占牌位、不稀释牌组，拒绝它没有任何好处。
  box(x, y, w, h, withAlpha(pw.color, 0.5), null);

  heading('精英掉了东西', x + 44, y + 66, scopeLine(pw.scope));

  const cx = x + (w - cw) / 2;
  const cy = y + 118;
  // 徽记本身也能点：玩家的手已经在鼠标上了，"知道了"不该只挂在按钮上。
  drawPowerEmblem(cx, cy, cw, ch, pw, { glow: hover(cx, cy, cw, ch) });
  onClick(cx, cy, cw, ch, () => ackPower(), 'powerdrop');

  // 描述是这一屏唯一要读的东西，所以按面板宽度折行，不挤在卡面底下
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
  // 复习点必须选一项才能继续：没有"关掉"这个语义，不画 ×。
  box(x, y, w, h, withAlpha(C.cyan, 0.4), null);

  heading('复习', x + 44, y + 66, '这一层没有敌人。你可以休息，也可以把一张卡磨得更利。');

  const opts: Array<{ t: string; s: string; fn: () => void; col: string }> = [
    { t: '休息', s: `回复 ${Math.round(G.maxHp * BAL.restPct)} 点生命`, col: C.green, fn: restHeal },
    { t: '精炼一张卡', s: '挑中的那一张：攻/挡底数 +3（同名的其余几张不变）', col: C.gold, fn: () => openCardPick('up') },
    { t: '遗忘', s: '永久移除一张卡（牌组至少留 5 张）', col: C.purple, fn: () => openCardPick('rm') },
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
 * 精炼 / 遗忘的选牌面板。
 *
 * 两处曾经让玩家读不到自己买了什么：
 *
 *   1. **精炼看不出效果**。面板上画的还是当前数值，选完才变 —— 于是"这次精炼
 *      到底加了什么"只能靠猜。现在卡面右下角直接写「4 伤 → 7 伤」，
 *      并且把加粗的那一档数值画在卡面上（预览即结果）。
 *   2. **精炼只作用于挑中的那一张**。所以列表里**每份副本各占一格**：
 *      牌组里四张基础斩击就是四个格子，挑哪个格子就只改哪一张。
 *      已经精炼过的那一张会标上 `+`，并且不再列进精炼列表。
 *
 * 面板可以取消了（右上角 ×）。这是"直接扣血、没有回头路"那件事的修法：
 * 事件里的代价记在 `G.pendingCost` 上，取消就丢掉，选了才付。
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
      ? '卡面数值会永久改变——这是构筑，不是赌博。基础牌也能精炼，但只强化你挑中的那一张。'
      : '移除后这张卡本局不会再出现。牌组会更薄，也更好抽；基础牌也能丢。');
  if (pending > 0) {
    text(`选完要付 ${pending} 点生命 —— 取消则不付。`, x + 44, y + 106, {
      size: 13, color: C.red, weight: 700,
    });
  }

  // 每一份副本单独一格：精炼是**按张**的，所以 `i`（牌组下标）才是身份。
  // 去重会把"四张基础斩击"压成一个格子，玩家点了也不知道改的是哪一张。
  const items = G.deck
    .map((id, i) => ({ id, i, d: defOf(id) }))
    // 基础牌也在列表里：精炼它、或者丢掉它换一张知识卡，都是合法的构筑决定。
    .filter((o) => mode === 'rm' || !isUpgraded(o.id))
    // 同名牌排在一起，但顺序保持牌组内的相对次序 —— 下标 i 才是这一格指向的牌。
    .sort((a, b) => a.d.topic.localeCompare(b.d.topic) || a.i - b.i);

  // 尺寸是按"开局 10 张刚好两排、不用滚"反推的。
  // gapy 里要留出卡面底下那行「伤 4→7」—— 它画在 y+h+18，行距不够就会压到下一排的卡上。
  const cols = 5;
  const cw = 196;
  const ch = 248;
  const gapx = 26;
  const gapy = 32;
  const noteH = 22;
  const totalW = cols * cw + (cols - 1) * gapx;
  const gx0 = x + (w - totalW) / 2;
  const rows = Math.ceil(items.length / cols);
  // 最后一排底下也要留出 note，否则最后一行会紧贴裁剪边
  const gridH = rows * (ch + gapy) - gapy + noteH;
  const areaH = h - 180;
  const area = scrollArea(x + 30, y + 130, w - 60, areaH, gridH, `pick:${mode}`);

  // 同名副本在视觉上要能分开：同一张牌的第二份起，右下角标一个份数序号。
  const seen: Record<string, number> = {};
  items.forEach((o, k) => {
    const col = k % cols;
    const row = Math.floor(k / cols);
    const px = gx0 - x - 30 + area.x + col * (cw + gapx);
    const py = area.y + row * (ch + gapy);
    const hv = hover(px, py, cw, ch);
    const st = statOf(o.id);
    const up = mode === 'up';
    // 卡面画的是**选完之后的数值**，note 写"原来 → 之后"。
    // 数值必须走 resolveEff 折算，不能直接拿 atk/blk —— 牌面上那两行就是折算后的数
    //（基础斩击 4 攻会同时折算成 2 挡），用原值当说明会和牌面对不上。
    // 精炼加成读 `upGain()`：基础 3 点，抛光布在场时是 5 点 ——
    // 预览必须和 `statOf` 用同一个数，否则选完才发现涨得比卡面多。
    const gain = upGain();
    const after = { atk: st.atk + (up ? gain : 0), blk: st.blk + (up ? gain : 0) };
    const faceOf = (atk: number, blk: number) => {
      const out = applyCardBonus(resolveEff(o.d.eff, atk, blk, 1, o.d.mods));
      return { dmg: out.hits.reduce((n, v) => n + v, 0), blk: out.blk };
    };
    const b = faceOf(st.atk, st.blk);
    const a = faceOf(after.atk, after.blk);
    // note 只写"变了哪一格"。判据是**前后不想等**，不是"原值大于 0"：
    // 基础斩击本身没有格挡，但 +3 底数经猛击的 0.7 折算会变成 2 点格挡 ——
    // 按"原值大于 0"筛就会把这一格藏掉，玩家选完才发现多出 2 挡。
    // 用的字和牌面同一套（伤 / 挡），否则一行说明里要重复"造成 X 点伤害"。
    const note = up
      ? [
        b.dmg !== a.dmg ? `伤 ${b.dmg}→${a.dmg}` : '',
        b.blk !== a.blk ? `挡 ${b.blk}→${a.blk}` : '',
      ].filter(Boolean).join('  ')
      : undefined;
    drawCard(px, py, cw, ch, o.d, after.atk, after.blk, {
      // `up` 只画**真的已经精炼过**的牌。精炼列表里的牌还没精炼，
      // 给它们全画上金边和 + 号会让"四张基础斩击"看起来都强化过了 ——
      // 那恰好和"只改一张"相反。
      up: isUpgraded(o.id), glow: hv, note,
    });
    // 第几份：只在同名牌有第二份时才标，避免每张牌都挂一个没意义的 ×1。
    // 放右下角是因为卡面上半部被费用/类别/牌名/效果四行占满了。
    const base = baseIdOf(o.id);
    seen[base] = (seen[base] ?? 0) + 1;
    const total = G.deck.filter((v) => baseIdOf(v) === base).length;
    if (total > 1) {
      text(`第 ${seen[base]}/${total} 张`, px + cw - 12, py + ch - 10, {
        size: 12, align: 'right', color: C.faint, weight: 600,
      });
    }
    // 命中矩形不跟着裁剪走：滚出可视区的那几排仍然会接住点击 —— 上半排被裁在标题栏
    // 底下，点在标题栏上，牌却被精炼了。所以只登记**当前露在列表里**的那一段。
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
  // 事件必须选一个选项：没有"关掉"这个语义，不画 ×。
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

  // 尺寸是按"开局 10 张刚好两排、不用滚"反推的
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
    drawCard(px, py, cw, ch, d, st.atk, st.blk, { up: isUpgraded(id), note: d.link?.note });
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
 * 开局三选一：这次带什么上路。
 *
 * 它替代了原来的"选模式"。同样是每局前的一次选择，但选的东西不一样 ——
 * 模式只是把四行数字换一换，选完就忘；能力卡会进 `powers`，在战斗里一直响。
 */
function drawBoon() {
  dim(0.84);
  const w = 1100;
  const h = 464;
  const x = (VW - w) / 2;
  const y = (VH - h) / 2;
  box(x, y, w, h, withAlpha(C.gold, 0.42));
  heading('这次从哪个模式开始', x + 48, y + 66,
    '学习 2 张初始能力 · 复习 1 张 · 测试 0 张；难度逐级递加。');

  const gap = 24;
  const cw = (w - 96 - gap * 2) / 3;
  const ch = 264;
  const cy = y + 132;
  MODES.forEach((m, i) => {
    const cx = x + 48 + i * (cw + gap);
    const hv = hover(cx, cy, cw, ch);
    roundRect(cx, cy, cw, ch, 14);
    g.fillStyle = hv ? withAlpha(m.color, 0.13) : 'rgba(255,255,255,.035)';
    g.fill();
    g.strokeStyle = withAlpha(m.color, hv ? 0.9 : 0.42);
    g.lineWidth = hv ? 2 : 1.3;
    g.stroke();

    // 顶部一道模式色：三张并排时，颜色比标题更先被看见
    roundRect(cx + 1, cy + 1, cw - 2, 4, 3);
    g.fillStyle = m.color;
    g.fill();

    text(m.icon, cx + 44, cy + 58, {
      size: 30, weight: 800, family: FONT_TITLE, color: m.color, align: 'center',
    });
    text(m.name, cx + 78, cy + 58, { size: 26, weight: 800, family: FONT_TITLE, color: m.color });

    g.font = font(13, 400, FONT_UI);
    g.fillStyle = C.ink2;
    wrapText(m.desc, cw - 48).slice(0, 2)
      .forEach((ln, j) => g.fillText(ln, cx + 24, cy + 98 + j * 19));

    text('初始能力', cx + 24, cy + 150, { size: 12, color: C.faint, weight: 700 });
    if (m.powers.length) {
      m.powers.forEach((id, j) => {
        const p = POWER_BY_ID[id];
        text(`· ${p?.name ?? id}`, cx + 24, cy + 176 + j * 22, {
          size: 14, color: p?.color ?? C.ink, weight: 600,
        });
      });
    } else {
      text('无 —— 全靠路上捡', cx + 24, cy + 176, { size: 14, color: C.faint });
    }

    text(hv ? '从这里开始 →' : '点击选择', cx + cw / 2, cy + ch - 24, {
      size: 13, align: 'center', color: hv ? m.color : C.faint, weight: 700,
    });
    onClick(cx, cy, cw, ch, () => startRun(m.id), `mode:${m.id}`);
  });

  text('开局选一次，整局不变；想换就重开一局。Esc 返回。',
    x + 48, y + h - 30, { size: 12, color: C.faint });
}

/* ── 说明 ─────────────────────────────────────────────────── */

function drawHelp() {
  dim(0.8);
  const w = 1120;
  const x = (VW - w) / 2;
  // 两栏：八块说明按单栏排会超出屏幕，最后两块会被画到盒子外面。
  // 每栏单独量高，取更高的一栏决定盒子高度。
  const colW = (w - 96 - 36) / 2;
  const cols = [x + 48, x + 48 + colW + 36];

  // 效果/类别表不再写死在帮助页：卡面徽章上就印着「类别·效果」，帮助页只讲分工
  const blocks: Array<[string, string[]]> = [
    [`初始牌组：10 张（8 基础 + 2 随机知识）`, [
      `一局开始有 ${BASICS.length} 张基础牌（${basicsSummary()}），它们不答题、随时可打、各要 1 点行动力；再加 2 张随机知识卡。`,
      '基础牌**无法从游戏中获取**，但可以精炼、也可以遗忘 —— 它们是地板，不是圣物；只是把一次精炼花在基础牌上，就没花在知识卡上。',
      '数值刻意压得比知识卡低：保底不等于变强，想赢还是得答对题、把知识卡打出去。',
    ]],
    ['四类牌：攻击 / 防御 / 技能 / 能力', [
      '攻击：猛击、洞察、串联、内化 —— 把行动力换成伤害（内化再按伤害回血）。',
      '防御：巩固 —— 把行动力换成格挡，伤害减半、格挡翻倍。',
      '技能：专注 —— 伤害偏低但抽一张牌，处理的是"手上没牌了"这个节奏问题。',
      '能力：六种增益牌 —— 本场持续改规则（沙漏多 1 点行动力、索引卡多抽一张……）。',    ]],
    ['牌面只讲机械，不讲知识', [
      '卡面上只有费用、类别、牌名、效果和数值。左上角那个数是费用：0–3 点，或 X（花光行动力，花几点结算几次）。付不起时它会变红。',
      '费用右边那个字母是等级：C 不用答题、B 答对 1 次、A 两次、S 三次，攒够这一场就免答。',
      '右下角是纹章：六种效果各有原型（攻 / 防 / 技 / 能四类靠顶部色条区分）。',
      '没有主题名、没有知识点名、没有记忆度、更没有题干。所以「折半之刃」这一手会问哪道题，只能靠点开它知道 —— 题来自当前这一章，不和这张牌绑定。',
    ]],
    ['答对算数，答错这一手作废', [
      '答对：卡面效果按原值结算，退回 1 点行动力，并给这张牌攒一次免答。会的人一回合能把牌打完，不会的人两张就没油。',
      '答错：这一手什么都不发生，**但一分行动力都不扣** —— 代价是本场的新题少一道。',
      '一张牌攒满等级（C 0 / B 1 / A 2 / S 3）之后，这一场剩下的时间里它直接打、不再出题。计数每场清零。',
      `复习 / 测试答错会补抽 1 张（每回合至多 ${BAL.missDrawCap} 次）；学习模式不补 —— 它是练习场，手牌会真的少一张。`,
      '挡不挡、牌去哪里、补不补抽，由本局模式决定（见下一条）。复习模式补的格挡只看这张牌自己：卡面上有格挡那一行（巩固、猛击）才补，洞察 / 内化 / 串联 / 专注 没有，答错也就没有。',
    ]],
    ['每一场都有自己的题池', [
      '开战时按你的牌组算题量：越贵的牌越多，这一场的新题越多。顶栏「题 N」数的是本场还没问过的新题。',
      '点开一张知识卡就消耗一道新题；答错也消耗。新题用完不会锁牌 —— 顶栏改成「题 复用」，之后问的是本章被问得最少的题。',
      '同一道题在一局里最多进 3 次新题池 —— 问过的题不会在下一场立刻再来一遍。',
    ]],
    ['三种模式，开局前选', [
      '学习：答错只作废这一手，牌回抽牌堆，下一回合一定再抽到；但**不补格挡、不补抽** —— 练习场不负责让你通关。适合第一次见这些题。',
      '复习：答错作废，牌进弃牌堆，要等洗牌才回来；本身有格挡的牌按一半挡一下，答错补抽 1 张。适合学过一遍、要求稳。',
      '测试：答错作废，牌进弃牌堆，一格挡都不补（学习也不补，但学习回牌堆且不补抽），答错仍补抽 1 张。答对稳固度涨得更多。',
      '模式只影响这一局的答错价码，不改卡面数值、不改题库，也不动你已经攒下的记忆。',
    ]],
    ['行动力是唯一的节奏', [
      `每回合 ${BAL.baseAp} 点行动力、抽 ${BAL.drawPerTurn} 张牌。每张牌标 0–3 点，X 费牌吃光剩下的全部。`,
      '答对只退回 1 点：1 费牌等于免费，2 费净花 1 点、3 费净花 2 点。贵牌不是"更强的一手"，是"更大的一张票"。',
      '答错不扣行动力 —— 错的代价落在"本场新题少一道"上，不落在这一回合的出手次数上。',
      '基础牌和增益牌不答题，所以一分不退 —— 拿行动力打基础牌，就是拿这回合的答题机会换保底输出。',
      '双面镜在场时，每回合第一次答对还会抽 1 张；荧光笔让那次答对多退 1 点。两条都是牌给的规则，不是人人白吃。',
      '键盘：1–4 选选项，空格/回车推进面板，空场时空格结束回合。',
    ]],
    ['增益牌：也要打出去才算', [
      '精英战后和部分事件会给你一张增益牌（能力牌）。它没有题，也没有伤害 —— 它改的是这一场的规则：',
      '沙漏每回合多 1 点行动力 · 索引卡每回合多抽一张 · 长明灯每回合开局 3 点格挡 ·',
      '双面镜让每回合第一次答对抽 1 张 · 荧光笔让那次答对多退 1 点 · 装订线让每回合第一次答错仍按一半结算。',
      '它们都对着现行的规则说话：答错不扣行动力，所以没有一张牌还在"免掉行动力"。',
      '它和知识卡一样占手牌、一样要付费用（只是不答题，所以这笔钱不退）。打出后从牌组循环里出去，本场一直生效；下一场要重新打。',
    ]],
    ['一百层，五幕', [
      '整座塔 100 层，每 20 层是一幕，幕末一只 Boss。打赢 Boss 会换一张新地图、血回满、生命上限 +14。',
      '一幕一套物种：目录厅教你出牌、虫蛀区搅你的牌堆、报刊区靠反伤治薄刀、修复室叠甲、禁书区专挑你错得最多的主题。',
      // 怪的血量现在是一条连续上坡：同一种小怪在第 15 层和第 90 层不是同一个厚度。
      '越往上爬，怪越厚、打得越疼 —— 同一只小怪在第 90 层会明显比第 15 层难缠。开局想靠一张高费牌横推前几层，是做不到了。',
      '地图一屏显示 8 层；滚轮或按住拖动能看到整张 20 层的地图 —— 先看清上面是不是精英，再决定走哪条。',
      '节点类型全部可见：战斗、精英、复习、事件、Boss。',
      '复习点三选一：回复 62% 生命、精炼一张卡（攻/挡底数 +3）、或永久移除一张让牌组更薄。',
      '精炼是**按张**算的：牌组里每份副本各占一格，只强化你挑中的那一张；同名的另一张不动。精炼过的那张会带一个 + 号。',
      '牌组越厚，关键卡越难抽到 —— 拿不拿那张增益牌，是这个游戏里最像构筑的决定。',
    ]],
    ['它会记住你', [
      '复习状态存在本地；起手固定 10 张（4 斩击 + 4 格挡 + 2 张随机**低费**知识卡 —— A/S 级要自己挣），模式只改答错的价码。',
      '结算页会告诉你：这一局答了多少题、对了几成、答错了多少次 —— 蒙对和记住的差别在那里。',
    ]],
  ];

  // 先量后画：加一段说明不该把最后一行挤出盒子（之前高度是写死的 676，加两块就溢出）
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
  heading('怎么玩', x + 48, y + 70, '一句话：出牌要答题，答对了卡才生效。');

  // 盒子最高只能到屏幕（VH - 48）。100 层之后右栏多了两块，量出来的高度超过了这个上限 ——
  // 原来的做法是照画，于是最后一块被底边**切掉半行**，切在句子中间，比"看不到"更糟：
  // 它看起来像写完了。现在正文进滚动区：滚轮往下就是剩下的说明，底部渐隐 + 滚动条
  // 用的是列表那套 overflowAffordance，看到的东西和能不能滚到底是一致的。
  const bodyTop = y + 128;
  const bodyH = h - 128 - 46;
  // 首行往下让 20px：`fillText` 的 y 是**基线**，标题直接画在裁剪边上会被切掉上半截。
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
    '卡面（83 张 / 攻挡 / 效果）内置，md 改不了',
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
    // 底部只留 4 行，超出截断：格式诊断可能很长，别让它顶出面板
    wrapText(p.msg, w - 88).slice(0, 4).forEach((ln, i) => g.fillText(ln, x + 44, y + 428 + i * 21));
  } else {
    const src = sourceBank();
    text(`当前题库：${src.name} · ${countQuestions(src)} 道题 / ${Object.keys(src.byTopic).length} 个题池`,
      x + 44, y + 430, { size: 13, color: C.dim });
    text('只校验格式：题干、2–4 个选项、= 答案字母；写错会列出第几行。复习进度按内置卡片 id 保存，不会丢。',
      x + 44, y + 454, { size: 13, color: C.faint });
  }
}

