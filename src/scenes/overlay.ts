import { g, roundRect, VH, VW, wrapText } from '../gfx/canvas';
import { C, font, FONT_TITLE, FONT_UI, topicColor, withAlpha } from '../gfx/theme';
import { action, drawCard, squeeze, text } from '../gfx/ui';
import { consumeWheel, hover, onClick } from '../input';
import { BAL, EFFS, MODE_KEYS, MODES, effSummary, resolveEff } from '../core/model';
import { clamp, G } from '../core/infra';
import { countQuestions, sourceBank } from '../core/library';
import {
  BASICS, baseIdOf, basicsSummary, cardKind, cardType, CARD_TYPE_META, costOf, defOf, isUpgraded,
  isXCost, statOf, UP_GAIN,
} from '../core/cards';
import { answer, cancelPanel } from '../core/combat';
import {
  chooseEventOption, dismissFeedback, forgetCard, openCardPick, restHeal, startRun,
  skipPower, skipReward, takeCard, takePower, upgradeCard,
} from '../core/journey';
import type { Question, QView } from '../core/model';
import { drawReport } from './report';
import { requestPackFile, pastePack } from './packio';

/* ── 通用外壳 ─────────────────────────────────────────────── */

function dim(a: number) {
  g.fillStyle = `rgba(3,4,8,${a})`;
  g.fillRect(0, 0, VW, VH);
}

/**
 * 只有答题面板用这层薄遮罩。
 *
 * 结算、牌组、事件这些是要玩家专注读一屏内容的，背景透出来只会显乱；
 * 但答题的时候敌人还在对面，把它抹成纯黑等于"换了个页面做题"，
 * 玩家会忘记自己正在跟谁打。所以这一屏留一条能看见战场的缝。
 */
function dimQuestion() {
  const lg = g.createLinearGradient(0, 0, 0, VH);
  lg.addColorStop(0, 'rgba(3,4,8,.5)');
  lg.addColorStop(0.55, 'rgba(3,4,8,.54)');
  lg.addColorStop(1, 'rgba(3,4,8,.66)');
  g.fillStyle = lg;
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

export function drawOverlay(t: number) {
  const p = G.panel;
  switch (p.k) {
    case 'question': return drawQuestion(p.idx, p.q, p.view);
    case 'mode': return drawMode();
    case 'feedback': return drawFeedback();
    case 'reward': return drawReward();
    case 'power': return drawPowerPick();
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

function drawQuestion(idx: number, q: Question, view: QView) {
  const ent = G.hand[idx];
  if (!ent) return;
  const card = defOf(ent);
  // 题面是点开那一刻从题库抽出的快照，选项顺序来自本次打乱的视图 ——
  // 反馈面板读的是同一份。卡面本身（card）里没有题。
  const options = view.options;

  const x = QX;
  const w = QW;
  const col = C.blue;

  // 先量后画：面板高度跟着题目走，不留空白也不会顶出屏幕。
  // 题干是这一屏的主视觉，字号比标题更大，所以量行也得用同一个字号。
  g.font = font(26, 700, FONT_UI);
  const lines = wrapText(q.q, w - 68);
  const lineH = 36;
  const headH = 132;
  const gap = 12;
  const n = options.length;
  const fixedH = headH + lines.length * lineH + 24 + 76;
  const oh = clamp(Math.floor((VH - 96 - fixedH) / n) - gap, 54, 70);
  const h = headH + lines.length * lineH + 24 + n * (oh + gap) + 76;
  const y = Math.max(48, (VH - h) / 2);

  dimQuestion();
  box(x, y, w, h, withAlpha(col, 0.5));

  // 标题 = 牌名（杀戮尖塔式游戏名，如「折半之刃」）。牌名不是知识点，摆出来不泄题，
  // 还能让玩家把「这手牌」和「这道题」对上号。
  // 副标题只写类别与"随机抽题"这条规则 —— 主题名从牌面和这一屏都撤掉了：
  // 它会在看清题之前先告诉你"这题考的是哪一块"，等于提前漏一半答案。
  text(card.name, x + 34, y + 48, { size: 22, weight: 700, family: FONT_TITLE, color: C.ink });
  const ct = CARD_TYPE_META[cardType(card)];
  // 费用写在这一行里：这一手要花多少，是玩家按下选项之前最该知道的一个数。
  // X 费牌不能只写一个 X —— 得当场告诉他"X 现在等于几"。
  const xc = isXCost(card);
  const costNote = xc ? `X = ${Math.max(1, G.ap)} 点，吃光行动力` : `${costOf(card)} 点行动力`;
  text(`${ct.name}牌 · ${costNote} · 从题库随机抽一题`, x + 34, y + 74, {
    size: 13, color: ct.color, weight: 600,
  });

  const st = statOf(ent);
  const eff = EFFS[card.eff] ?? EFFS.strike;
  const sumW = 300;
  text('答对就拿到的效果', x + w - 84 - sumW, y + 50, { size: 12, color: C.dim, align: 'left' });
  text(effSummary(card.eff, st.atk, st.blk, card.mods, xc), x + w - 84 - sumW, y + 74, {
    size: 13, color: eff.color, weight: 700, align: 'left',
  });

  // 题面：卡面知识点名已经撤掉，这里就是整个面板的主标题 —— 左沿一根亮条把它托住
  const qy = y + headH;
  roundRect(x + 24, qy - 8, 3, lines.length * lineH - 10, 2);
  g.fillStyle = withAlpha(col, 0.9);
  g.fill();
  g.font = font(26, 700, FONT_UI);
  g.fillStyle = C.ink;
  lines.forEach((ln, i) => g.fillText(ln, x + 34, qy + i * lineH));

  // 选项
  const oy = qy + lines.length * lineH + 24;
  // "问"和"选"之间断开：一条细线就够，别让题干和四个选项糊成一整块文字
  g.beginPath();
  g.moveTo(x + 34, oy - 12);
  g.lineTo(x + w - 34, oy - 12);
  g.strokeStyle = withAlpha(col, 0.2);
  g.lineWidth = 1;
  g.stroke();
  options.forEach((o, i) => {
    const by = oy + i * (oh + gap);
    const hv = hover(x + 34, by, w - 68, oh);
    roundRect(x + 34, by, w - 68, oh, 10);
    g.fillStyle = hv ? withAlpha(col, 0.16) : 'rgba(255,255,255,.035)';
    g.fill();
    g.strokeStyle = hv ? withAlpha(col, 0.8) : C.line;
    g.lineWidth = hv ? 1.8 : 1.2;
    g.stroke();
    // 悬停时左沿一根亮条：四个选项长得一样，手指落到哪一个要一眼看得出来
    if (hv) {
      roundRect(x + 34, by + 8, 3, oh - 16, 2);
      g.fillStyle = col;
      g.fill();
    }

    g.beginPath();
    g.arc(x + 68, by + oh / 2, 17, 0, Math.PI * 2);
    g.fillStyle = hv ? withAlpha(col, 0.35) : 'rgba(255,255,255,.06)';
    g.fill();
    text('ABCD'[i] ?? String(i + 1), x + 68, by + oh / 2 + 1, {
      size: 16, weight: 800, align: 'center', color: hv ? col : C.ink2,
    });

    g.font = font(18, 400, FONT_UI);
    g.fillStyle = hv ? C.ink : C.ink2;
    const ol = wrapText(o, w - 190);
    ol.slice(0, 2).forEach((ln, k) => {
      g.fillText(ln, x + 100, by + oh / 2 + (ol.length > 1 ? (k === 0 ? -12 : 14) : 0));
    });

    onClick(x + 34, by, w - 68, oh, () => answer(i), 'opt');
  });

  // 底部一行：这一局的答错价码。模式是开局选定的、整局不变，
  // 所以这里只说一次，不再按卡自己的阶段分两句。
  const by = y + h - 58;
  text(MODES[G.mode].hint, x + 34, by + 21, { size: 13, color: C.dim, maxW: w - 68 });
}

/* ── 答题结果 ─────────────────────────────────────────────── */

function drawFeedback() {
  const p = G.panel;
  if (p.k !== 'feedback') return;
  const fb = p.fb;
  const col = fb.right ? C.green : C.red;
  const x = QX;
  const w = QW;

  // 先量后画：面板高度跟着内容走，不会溢出也不会空一大块
  g.font = font(20, 600, FONT_UI);
  const qLines = wrapText(fb.question, w - 68).slice(0, 3);
  g.font = font(13, 500, FONT_UI);
  const noteLines = fb.apNote ? wrapText(fb.apNote, w - 68) : [];
  g.font = font(14, 400, FONT_UI);
  const expLines = fb.explain ? wrapText(fb.explain, w - 148) : [];

  const n = fb.options.length;
  const optH = n ? n * 58 + (n - 1) * 8 + 20 : 0;
  const sumH = (fb.right ? 54 : 0) + (noteLines.length ? noteLines.length * 21 + 12 : 0);
  const expH = expLines.length ? expLines.length * 22 + 30 : 0;
  const h = Math.min(806, 96 + 44 + qLines.length * 30 + 18 + optH + sumH + expH + 92);
  const y = Math.max(56, (VH - h) / 2);

  dim(0.55);
  // × = 继续：反馈页没有别的动作，关掉它和按"继续"是同一件事。
  box(x, y, w, h, withAlpha(col, 0.6), dismissFeedback);

  text(fb.right ? '正确' : '答错', x + 34, y + 52, {
    size: 30, weight: 800, family: FONT_TITLE, color: col,
  });
  text(fb.topic, x + w - 90, y + 52, {
    size: 14, color: topicColor(fb.topic), weight: 700, align: 'right',
  });

  let cy = y + 100;
  g.font = font(20, 600, FONT_UI);
  g.fillStyle = C.ink;
  qLines.forEach((ln, i) => g.fillText(ln, x + 34, cy + i * 30));
  cy += qLines.length * 30 + 18;

  if (n) {
    fb.options.forEach((o, i) => {
      const isAns = i === fb.answer;
      const isPick = i === fb.choice;
      roundRect(x + 34, cy, w - 68, 58, 9);
      g.fillStyle = isAns ? withAlpha(C.green, 0.14) : isPick ? withAlpha(C.red, 0.14) : 'rgba(255,255,255,.03)';
      g.fill();
      g.strokeStyle = isAns ? withAlpha(C.green, 0.7) : isPick ? withAlpha(C.red, 0.7) : C.line;
      g.lineWidth = 1.2;
      g.stroke();

      text('ABCD'[i] ?? String(i + 1), x + 62, cy + 29, {
        size: 15, weight: 800, align: 'center',
        color: isAns ? C.green : isPick ? C.red : C.dim,
      });
      g.font = font(17, 400, FONT_UI);
      g.fillStyle = isAns ? C.ink : isPick ? C.ink2 : C.dim;
      g.fillText(squeeze(o, w - 200), x + 84, cy + 29);

      if (isAns) text('正确', x + w - 60, cy + 29, { size: 13, color: C.green, align: 'right', weight: 700 });
      else if (isPick) text('你选的', x + w - 60, cy + 29, { size: 13, color: C.red, align: 'right' });

      cy += 66;
    });
    cy += 12;
  }

  if (fb.right) {
    const eff = EFFS[fb.eff] ?? EFFS.strike;
    // 多段要显示**实际**每段伤害，不能用 fb.hits：那是扣格挡前的原始值，
    // 敌人有甲时 hits 相加会大于 fb.dmg（屏幕会凭空多报伤害）。
    const segs = fb.parts.length ? fb.parts : [{ d: fb.dmg, a: fb.absorbed }];
    const shape = segs.length > 1 ? segs.map((p) => p.d).join(' + ') : `${fb.dmg}`;
    text(`${eff.name} · 造成 ${shape} 点伤害${fb.absorbed ? `（${fb.absorbed} 被格挡吸收）` : ''}`,
      x + 34, cy, { size: 18, color: C.gold, weight: 700 });

    // 第二行说清楚这一手的额外收益：挡、回血、抽牌，还是单纯穿了防
    const extras: string[] = [];
    if (fb.blk > 0) extras.push(`${fb.blk} 点格挡`);
    if (fb.eff === 'pierce') extras.push('无视格挡');
    if (fb.heal > 0) extras.push(`回复 ${fb.heal} 点生命`);
    if (fb.draw > 0) extras.push(`抽 ${fb.draw} 张牌`);
    if (extras.length) {
      text(extras.join(' · '), x + 34, cy + 26, { size: 15, color: eff.color });
    }
    cy += 54;
  }
  if (noteLines.length) {
    g.font = font(14, 500, FONT_UI);
    g.fillStyle = C.gold;
    noteLines.forEach((ln, i) => g.fillText(ln, x + 34, cy + i * 21));
    cy += noteLines.length * 21 + 12;
  }
  if (expLines.length) {
    roundRect(x + 34, cy, w - 68, expLines.length * 22 + 20, 10);
    g.fillStyle = 'rgba(255,255,255,.035)';
    g.fill();
    g.font = font(14, 400, FONT_UI);
    g.fillStyle = C.ink2;
    expLines.forEach((ln, i) => g.fillText(ln, x + 52, cy + 24 + i * 22));
  }

  action(x + w / 2 - 110, y + h - 76, 220, 54, '继续', () => dismissFeedback(), 'primary', { size: 20 });
}

/* ── 奖励 ─────────────────────────────────────────────────── */

function drawReward() {
  const p = G.panel;
  if (p.k !== 'reward') return;
  const isElite = G.node?.type === 'elite';

  dim(0.78);
  const w = 1220;
  const h = 640;
  const x = (VW - w) / 2;
  const y = 130;
  // × = 跳过：奖励面板本来就有"跳过"，关掉和跳过同义。
  box(x, y, w, h, withAlpha(C.gold, 0.4), skipReward);

  heading('战斗结束', x + 44, y + 66,
    G.powerFallback
      ? '增益牌已经拿齐了；这次从知识卡里挑一张。'
      : isElite ? '精英倒下了。挑一张卡，它还会留下一样东西。' : '挑一张放进牌组。');

  const cw = 280;
  const ch = 356;
  const gap = 34;
  const totalW = p.cards.length * cw + (p.cards.length - 1) * gap;
  const cx0 = x + (w - totalW) / 2;
  const cy = y + 142;

  p.cards.forEach((c, i) => {
    const px = cx0 + i * (cw + gap);
    const hv = hover(px, cy, cw, ch);
    const lift = hv ? -10 : 0;
    // 奖励预览也用同一套卡面数值；直接画 c.atk 会和入牌组后的卡面不一致。
    const st = statOf(c.id);
    drawCard(px, cy + lift, cw, ch, c, st.atk, st.blk, { glow: hv });
    onClick(px, cy, cw, ch, () => takeCard(i), 'rewardcard');
  });

  action(x + w / 2 - 340, y + h - 74, 300, 54, '跳过，不要卡', () => skipReward());
  text('牌组越厚，关键卡越难抽到。', x + w / 2 + 40, y + h - 46, { size: 13, color: C.faint });
}

/* ── 增益牌 ───────────────────────────────────────────────── */

/**
 * 精英战后的选择。和战利品面板长得一样（都是三张卡），因为它们是同一件事：
 * 往牌组里加一张牌。区别只在标题和底部那句提醒 —— 增益牌不会直接生效。
 */
function drawPowerPick() {
  const p = G.panel;
  if (p.k !== 'power') return;
  dim(0.82);

  const cw = 216;
  const ch = 276;
  const gap = 38;
  const n = p.pool.length || 1;
  const totalW = n * cw + (n - 1) * gap;
  const w = Math.max(totalW + 120, 700);
  const h = ch + 214;
  const x = (VW - w) / 2;
  const y = (VH - h) / 2;
  // × = 不要这张增益牌，和底部"跳过"同义。
  box(x, y, w, h, withAlpha(C.gold, 0.45), skipPower);

  heading('战斗留下了东西', x + 44, y + 66,
    '它现在是一张牌：进牌组，抽到手，付它的费用打出去，本场剩下的时间里一直生效。');

  p.pool.forEach((c, i) => {
    const cx = x + (w - totalW) / 2 + i * (cw + gap);
    const cy = y + 128;
    const hv = hover(cx, cy, cw, ch);
    if (hv) {
      roundRect(cx - 6, cy - 6, cw + 12, ch + 12, 16);
      g.fillStyle = withAlpha(C.gold, 0.08);
      g.fill();
    }
    drawCard(cx, cy, cw, ch, c, 0, 0, { glow: hv });
    onClick(cx, cy, cw, ch, () => takePower(c.id), 'power');
  });

  text('牌组越厚，关键卡越难抽到 —— 拿之前先想清楚它值不值一个位置。',
    x + 44, y + h - 26, { size: 13, color: C.faint });
  action(x + w - 264, y + h - 62, 220, 46, '不要，跳过', () => skipPower());
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
    // 增益牌没有数值可精炼（要么在要么不在），只在"遗忘"列表里保留。
    .filter((o) => mode === 'rm' || cardKind(o.d) !== 'power')
    // 已精炼的那一张不再出现：一张牌只能精炼一次，列出来点了也没反应。
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
    const after = { atk: st.atk + (up ? UP_GAIN : 0), blk: st.blk + (up ? UP_GAIN : 0) };
    const faceOf = (atk: number, blk: number) => {
      const out = resolveEff(o.d.eff, atk, blk, 1, o.d.mods);
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
    onClick(px, py, cw, ch, () => (up ? upgradeCard(o.i) : forgetCard(o.i)), 'pick', o.i);
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
    drawCard(px, py, cw, ch, d, st.atk, st.blk, { up: isUpgraded(id) });
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
 * 模式选择。它挡在每一局前面（首页的"开始"、结算页的"再来一局"都先到这里），
 * 因为"这一局是来学、来复习，还是来测"只有玩家自己知道 —— 不该由卡片进度替他决定。
 */
function drawMode() {
  dim(0.84);
  const w = 1100;
  const h = 464;
  const x = (VW - w) / 2;
  const y = (VH - h) / 2;
  box(x, y, w, h, withAlpha(C.gold, 0.42));
  heading('这一局怎么打', x + 48, y + 66,
    '答对退回 1 点行动力。三种模式只改答错的价码；另外固定带 8 张不答题的基础牌做保底。');

  const gap = 24;
  const cw = (w - 96 - gap * 2) / 3;
  const ch = 264;
  const cy = y + 132;
  MODE_KEYS.forEach((k, i) => {
    const m = MODES[k];
    const cx = x + 48 + i * (cw + gap);
    const hv = hover(cx, cy, cw, ch);
    roundRect(cx, cy, cw, ch, 14);
    g.fillStyle = hv ? withAlpha(m.color, 0.13) : 'rgba(255,255,255,.035)';
    g.fill();
    g.strokeStyle = withAlpha(m.color, hv ? 0.9 : 0.42);
    g.lineWidth = hv ? 2 : 1.3;
    g.stroke();

    // 顶部一道模式色：三张卡片并排，颜色比标题更先被看见
    roundRect(cx + 1, cy + 1, cw - 2, 4, 3);
    g.fillStyle = m.color;
    g.fill();

    text(m.name, cx + 24, cy + 52, { size: 30, weight: 800, family: FONT_TITLE, color: m.color });
    text(m.tag, cx + 24, cy + 80, { size: 13, color: C.ink2, weight: 600 });

    // 这里原来还有一段 desc，但下面三条要点就是它逐句展开的版本
    // （"答错只作废这一手，牌还会回来" ≈ "牌回牌堆，下回合一定再回来"）。
    // 一段总述加三条重复的细节，读起来像同一句话说两遍 —— 去掉总述。

    // 按 missBlock 与 missDraw 算，不再手写三档：学习模式是"不给格挡 + 不补抽"，
    // 复习/测试是"有格挡的按比例补 + 补抽"。改数据不用再回来改文案。
    const pct = Math.round(m.missBlock * 100);
    const draw = m.missDraw ? `、补抽 ${BAL.missDraw} 张` : '、不补抽';
    const guard = pct === 0 ? `答错：不给格挡${draw}`
      : `有格挡的牌补 ${pct}% 格挡${draw}`;
    const dest = m.missDest === 'draw' ? '牌回牌堆，下回合一定再回来'
      : '牌进弃牌堆，等洗牌才回来';
    const rows = [
      guard,
      dest,
      `稳固度：答错 ×${m.stabDrop} · 答对 ×${m.stabGain}`,
    ];
    rows.forEach((ln, j) => {
      const ry = cy + 128 + j * 34;
      g.beginPath();
      g.arc(cx + 29, ry - 4, 2.4, 0, Math.PI * 2);
      g.fillStyle = m.color;
      g.fill();
      text(ln, cx + 42, ry, { size: 12.5, color: C.ink2, maxW: cw - 66 });
    });

    // 卡片底部：点击区域就是整张卡，别再多一个小按钮抢注意力
    text(hv ? '开始这一局 →' : '点击开始', cx + cw / 2, cy + ch - 24, {
      size: 13, align: 'center', color: hv ? m.color : C.faint, weight: 700,
    });
    onClick(cx, cy, cw, ch, () => startRun(k), `mode:${k}`);
  });

  text('模式在开局前选定，整局不变；想换模式就重开一局。Esc 返回。',
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

