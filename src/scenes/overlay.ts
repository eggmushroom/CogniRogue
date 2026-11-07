import { g, roundRect, VH, VW, wrapText } from '../gfx/canvas';
import { C, font, FONT_TITLE, FONT_UI, topicColor, withAlpha } from '../gfx/theme';
import { action, drawCard, squeeze, text } from '../gfx/ui';
import { consumeWheel, hover, onClick } from '../input';
import { BAL, EFFS, EFF_KEYS, effSummary } from '../core/model';
import { clamp, G } from '../core/infra';
import { BANK, bankQuestionCount, bankTopics, isReview, memOf, memRatio } from '../core/library';
import { cardKind, defOf, statOf } from '../core/cards';
import { answer, cancelPanel, quickPlay } from '../core/combat';
import {
  chooseEventOption, dismissFeedback, forgetCard, openCardPick, restHeal,
  skipPower, skipReward, takeCard, takePower, upgradeCard,
} from '../core/journey';
import type { CardInst, Question, QView } from '../core/model';
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

function box(x: number, y: number, w: number, h: number, glow: string = C.line) {
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
  const cx = x + w - 34;
  const cy = y + 34;
  const chv = hover(cx - 16, cy - 16, 32, 32);
  g.beginPath();
  g.arc(cx, cy, 16, 0, Math.PI * 2);
  g.fillStyle = chv ? 'rgba(255,255,255,.14)' : 'rgba(255,255,255,.05)';
  g.fill();
  text('×', cx, cy + 1, { size: 22, align: 'center', color: chv ? C.ink : C.dim });
  onClick(cx - 16, cy - 16, 32, 32, cancelPanel);
}

function heading(s: string, x: number, y: number, sub?: string) {
  text(s, x, y, { size: 30, weight: 700, family: FONT_TITLE, color: C.ink });
  if (sub) text(sub, x, y + 34, { size: 14, color: C.dim });
}

/** 长列表容器：裁剪 + 滚轮。 */
let scroll = 0;
function scrollArea(x: number, y: number, w: number, h: number, contentH: number) {
  scroll = clamp(scroll + consumeWheel() * 0.7, 0, Math.max(0, contentH - h));
  g.save();
  roundRect(x, y, w, h, 10);
  g.clip();
  return { x, y: y - scroll, restore: () => g.restore(), y0: y };
}

/* ── 入口 ─────────────────────────────────────────────────── */

export function drawOverlay(t: number) {
  const p = G.panel;
  switch (p.k) {
    case 'question': return drawQuestion(p.idx, p.q, p.view);
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
  // 还能让玩家把「这手牌」和「这道题」对上号。副标题交代主题与随机抽题的规则。
  text(card.name, x + 34, y + 48, { size: 22, weight: 700, family: FONT_TITLE, color: C.ink });
  text(`${card.topic} · 从题库随机抽一题`, x + 34, y + 74, {
    size: 13, color: topicColor(card.topic), weight: 600,
  });

  const st = statOf(ent);
  const eff = EFFS[card.eff] ?? EFFS.strike;
  const sumW = 300;
  text('答对就拿到的效果', x + w - 84 - sumW, y + 50, { size: 12, color: C.dim, align: 'left' });
  text(effSummary(card.eff, st.atk, st.blk, card.mods), x + w - 84 - sumW, y + 74, {
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

  // 底部：逃生口 + 代价提醒
  const by = y + h - 58;
  const qx = x + 34;
  const qhv = hover(qx, by, 190, 42);
  roundRect(qx, by, 190, 42, 8);
  g.fillStyle = qhv ? 'rgba(255,255,255,.1)' : 'rgba(255,255,255,.03)';
  g.fill();
  g.strokeStyle = qhv ? C.lineHi : C.line;
  g.lineWidth = 1.2;
  g.stroke();
  text('不打这道 · 快攻', qx + 95, by + 21, { size: 14, align: 'center', color: qhv ? C.ink : C.dim });
  onClick(qx, by, 190, 42, () => quickPlay(idx), 'quick');

  // 这一行只在"手指已经按下去"的那一刻有用，所以它必须先说清答错的代价 ——
  // 而代价取决于是学习期还是复习期，两张卡在同一把手里就可能不一样。
  text(isReview(card.id)
    ? '答对不花行动力并解锁；这张卡你复习过 —— 答错它进弃牌堆，这一场不会再自动回来。'
    : '答对不花行动力并解锁；这张卡还在学习期 —— 答错这一手作废，牌会回到牌堆。',
    x + 250, by + 21, { size: 13, color: C.dim });
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
  box(x, y, w, h, withAlpha(col, 0.6));

  text(fb.right ? '正确' : fb.quick ? '快攻' : '答错', x + 34, y + 52, {
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
    const hits = fb.hits && fb.hits.length ? fb.hits : [fb.dmg];
    const shape = hits.length > 1 ? `${hits.join(' + ')}` : `${fb.dmg}`;
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
  box(x, y, w, h, withAlpha(C.gold, 0.4));

  heading('战斗结束', x + 44, y + 66,
    isElite ? '精英倒下了。先挑一张卡，它还会留下一样东西。' : '从这三张里挑一张放进牌组，或者一张都不要。');

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
    drawCard(px, cy + lift, cw, ch, c, c.atk, c.blk, { glow: hv, mem: memRatio(c.id), sub: c.kp });
    const m = memOf(c.id);
    const mast = m.reps ? `掌握 ${Math.round(memRatio(c.id) * 100)}%` : '还没答过';
    text(mast, px + cw / 2, cy + ch + 22, { size: 13, align: 'center', color: hv ? C.gold : C.dim });
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
  box(x, y, w, h, withAlpha(C.gold, 0.45));

  heading('精英留下了东西', x + 44, y + 66,
    '它现在是一张牌：进牌组，抽到手，花 1 点行动力打出去，本场剩下的时间里一直生效。');

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
  box(x, y, w, h, withAlpha(C.cyan, 0.4));

  heading('复习', x + 44, y + 66, '这一层没有敌人。你可以休息，也可以把一张卡磨得更利。');

  const opts: Array<{ t: string; s: string; fn: () => void; col: string }> = [
    { t: '休息', s: `回复 ${Math.round(G.maxHp * 0.32)} 点生命`, col: C.green, fn: restHeal },
    { t: '精炼一张卡', s: '永久改写卡面：攻 +3、挡 +3', col: C.gold, fn: () => openCardPick('up') },
    { t: '遗忘', s: '永久移除一张卡（至少留 5 张）', col: C.purple, fn: () => openCardPick('rm') },
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

function drawCardPick(mode: 'up' | 'rm') {
  dim(0.8);
  const w = 1280;
  const h = 700;
  const x = (VW - w) / 2;
  const y = 110;
  box(x, y, w, h, withAlpha(mode === 'up' ? C.gold : C.purple, 0.45));

  heading(mode === 'up' ? '精炼哪一张' : '遗忘哪一张', x + 44, y + 66,
    mode === 'up' ? '卡面数值会永久改变——这是构筑，不是赌博。' : '移除后这张卡本局不会再出现。牌组会更薄，也更好抽。');

  const items = G.deck
    .map((e, i) => ({ e, i, d: defOf(e) }))
    // 增益牌没有数值可精炼 —— 它要么在，要么不在。所以精炼列表里不出现它（移除列表里保留）
    .filter((o) => mode === 'rm' || cardKind(o.d) !== 'power')
    .sort((a, b) => a.d.topic.localeCompare(b.d.topic) || statOf(a.e).atk - statOf(b.e).atk);

  // 尺寸是按"开局 10 张刚好两排、不用滚"反推的
  const cols = 5;
  const cw = 196;
  const ch = 252;
  const gapx = 26;
  const gapy = 26;
  const totalW = cols * cw + (cols - 1) * gapx;
  const gx0 = x + (w - totalW) / 2;
  const rows = Math.ceil(items.length / cols);
  const gridH = rows * (ch + gapy);
  const area = scrollArea(x + 30, y + 130, w - 60, h - 180, gridH);

  items.forEach((o, k) => {
    const col = k % cols;
    const row = Math.floor(k / cols);
    const px = gx0 - x - 30 + area.x + col * (cw + gapx);
    const py = area.y + row * (ch + gapy);
    const hv = hover(px, py, cw, ch);
    const st = statOf(o.e);
    drawCard(px, py, cw, ch, o.d, st.atk, st.blk, {
      up: !!o.e.up, glow: hv, mem: cardKind(o.d) === 'power' ? undefined : memRatio(o.e.id),
      sub: o.d.kp,
    });
    onClick(px, py, cw, ch, () => (mode === 'up' ? upgradeCard(o.i) : forgetCard(o.i)));
  });
  area.restore();

  if (gridH > h - 180) {
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
  box(x, y, w, h, withAlpha(C.purple, 0.45));

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

function drawGallery(title: string, list: CardInst[]) {
  dim(0.8);
  const w = 1280;
  const h = 740;
  const x = (VW - w) / 2;
  const y = 80;
  box(x, y, w, h, C.line);

  const nCards = list.filter((e) => !e.junk).length;
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
  const area = scrollArea(x + 30, y + 130, w - 60, h - 180, gridH);

  list.forEach((e, k) => {
    const col = k % cols;
    const row = Math.floor(k / cols);
    const px = gx0 - x - 30 + area.x + col * (cw + gapx);
    const py = area.y + row * (ch + gapy);
    const d = defOf(e);
    const st = statOf(e);
    drawCard(px, py, cw, ch, d, st.atk, st.blk, {
      up: !!e.up, mem: cardKind(d) === 'power' ? undefined : memRatio(e.id), sub: d.kp,
    });
  });
  area.restore();

  if (!list.length) {
    text('空的。', x + w / 2, y + h / 2, { size: 18, align: 'center', color: C.faint });
  }
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

  // 效果表直接从 EFFS 生成：改了倍率这里不会跟着写错
  const effTable = EFF_KEYS.map((k) => `${EFFS[k].name}·${EFFS[k].tagline}`).join('　');
  const blocks: Array<[string, string[]]> = [
    ['卡面不说题，点开才出题', [
      '每张牌有自己的牌名和效果（杀戮尖塔那套牌面读法），但题不印在卡面上 —— 点一下牌，题和选项才出现。',
      '牌名背后才是知识点，它只在牌组/奖励列表里作小字副标题；题库主题随便写，卡面是内置的。',
    ]],
    ['六种效果，不是六种数值', [
      effTable,
      '同样的攻挡基数，换个效果就是另一种打法：破防、堆挡、回血、分段、接牌。',
      '效果写在内置卡牌库里，一张卡固定一种；导入题库改不了卡面，精炼只会加数字。',
    ]],
    ['答对生效，答错作废', [
      '答对：卡面效果立刻结算，并且这个卡种本场解锁 —— 之后它的每一张副本都能免答直接打出。',
      `免答出牌的伤害是 ×${BAL.freeMult}：记住的东西比当场想起来的更值钱。精炼过的卡开局就是解锁的。`,
      '答错：效果作废、这个卡种这回合不再问（免得看完答案用副本重答），但会按卡面格挡替你挡一点。',
    ]],
    ['答错的代价看学习阶段', [
      '每张卡自己在两个阶段之间：记忆条还没过 1/3 是「学习期」，过了是「复习期」。',
      '学习期答错：这一手作废、花掉 1 点行动力，但牌不进弃牌堆 —— 它退回牌堆，下一回合就抽回来。',
      '复习期答错：这张牌进弃牌堆，这一场不会再自动回来 —— 想再见到它得等牌堆洗过一轮。',
      '稳固度会掉：答错一次就退回学习期，所以同一张牌顶多坑你一回。卡面最下面那行写着它现在在哪一档。',
    ]],
    ['行动力是唯一的节奏', [
      `每回合 ${BAL.baseAp} 点行动力、${BAL.handSize} 张手牌，出牌 1 点。`,
      '答对了这一手不花行动力 —— 行动力买的不是"出牌次数"，而是"犯错次数"。',
      '所以会的人一回合能把整把牌打完，不会的人打两张就没油了。这也是唯一的经济：先答对，再用解锁的牌换伤害。',
      '键盘：1–4 选选项，空格/回车推进面板，没有面板时空格就是结束回合。',
    ]],
    ['增益牌：也要打出去才算', [
      '精英战后和部分事件会给你一张增益牌。它没有题，也没有伤害 —— 它改的是这一场的规则：',
      '沙漏多 1 点行动力、索引卡多抽一张、长明灯每回合给格挡、错题本把答错变成攻击。',
      '它和知识卡一样占手牌、一样要 1 点行动力。打出后从牌组循环里出去，本场一直生效；下一场要重新打。',
    ]],
    ['地图与构筑', [
      '八层分支地图，节点类型全部可见：战斗、精英、复习、事件、Boss。',
      '复习点可休息、精炼一张卡（攻/挡 +3，之后每一场开局即解锁）、或永久移除一张让牌组更薄。',
      '牌组越厚，关键卡越难抽到 —— 拿不拿那张增益牌，是这个游戏里最像构筑的决定。',
    ]],
    ['它会记住你', [
      '复习状态存在本地。下一局的起始牌组，先收逾期的卡，再收没碰过的。',
      '结算页会告诉你：这一局的伤害里有多少是免答打出去的 —— 那就是"记住了"和"当时蒙对"的差别。',
      '记住得越多，你的牌组就越"重"：复习期的牌答错代价更高，但答对了它本来也更强。',
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

  halves.forEach((half, ci) => {
    let by = y + 128;
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
    '点开一张牌 → 优先抽同名题池，没题就抽全部题目',
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
    text(`当前题库：${BANK.name} · ${bankQuestionCount()} 道题 / ${bankTopics().length} 个题池`,
      x + 44, y + 430, { size: 13, color: C.dim });
    text('只校验格式：题干、2–4 个选项、= 答案字母；写错会列出第几行。复习进度按内置卡片 id 保存，不会丢。',
      x + 44, y + 454, { size: 13, color: C.faint });
  }
}

