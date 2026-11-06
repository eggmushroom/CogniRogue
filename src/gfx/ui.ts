import { g, roundRect, wrapText } from './canvas';
import { onClick, hover } from '../input';
import { C, font, FONT_UI, FONT_TITLE, topicColor, withAlpha } from './theme';
import { EFFS, resolveEff } from '../core/effects';
import { BAL, POWER_BY_ID } from '../core/data';
import type { CardDef, PowerDef } from '../core/types';


export function text(
  s: string, x: number, y: number,
  opts: { size?: number; color?: string; weight?: number; align?: CanvasTextAlign; family?: string; alpha?: number; maxW?: number } = {},
) {
  g.save();
  g.font = font(opts.size ?? 20, opts.weight ?? 400, opts.family ?? FONT_UI);
  g.fillStyle = opts.color ?? C.ink;
  g.textAlign = opts.align ?? 'left';
  if (opts.alpha !== undefined) g.globalAlpha = opts.alpha;
  g.fillText(opts.maxW ? squeeze(s, opts.maxW) : s, x, y);
  g.restore();
}

/** 单行截断：画卡面时用，避免文字溢出卡片。 */
export function squeeze(s: string, maxW: number): string {
  if (g.measureText(s).width <= maxW) return s;
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (g.measureText(s.slice(0, mid) + '…').width <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return s.slice(0, lo) + '…';
}

export function wrap(s: string, maxW: number, lineH: number, x: number, y: number, maxLines = 99) {
  const lines = wrapText(s, maxW);
  const shown = lines.slice(0, maxLines);
  shown.forEach((ln, i) => {
    const isLast = i === maxLines - 1 && lines.length > maxLines;
    g.fillText(isLast ? ln.slice(0, Math.max(0, ln.length - 1)) + '…' : ln, x, y + i * lineH);
  });
  return shown.length;
}

export function panel(
  x: number, y: number, w: number, h: number,
  opts: { r?: number; fill?: string; stroke?: string; glow?: string; alpha?: number } = {},
) {
  g.save();
  if (opts.alpha !== undefined) g.globalAlpha = opts.alpha;
  if (opts.glow) {
    g.shadowColor = opts.glow;
    g.shadowBlur = 30;
  }
  roundRect(x, y, w, h, opts.r ?? 14);
  g.fillStyle = opts.fill ?? 'rgba(17,20,29,.94)';
  g.fill();
  g.shadowBlur = 0;
  if (opts.stroke !== 'none') {
    g.strokeStyle = opts.stroke ?? C.line;
    g.lineWidth = 1.5;
    g.stroke();
  }
  g.restore();
}

export type BtnKind = 'primary' | 'ghost' | 'danger';

export function button(
  x: number, y: number, w: number, h: number, label: string,
  kind: BtnKind = 'ghost', opts: { size?: number; disabled?: boolean; sub?: string } = {},
) {
  const dis = !!opts.disabled;
  const hv = !dis && hover(x, y, w, h);

  const base =
    kind === 'primary' ? withAlpha(C.gold, hv ? 0.22 : 0.1)
      : kind === 'danger' ? withAlpha(C.red, hv ? 0.24 : 0.1)
        : withAlpha('#ffffff', hv ? 0.1 : 0.04);
  const edge =
    kind === 'primary' ? (hv ? C.gold : withAlpha(C.gold, 0.55))
      : kind === 'danger' ? (hv ? C.red : withAlpha(C.red, 0.5))
        : hv ? C.lineHi : C.line;

  g.save();
  if (hv) { g.shadowColor = kind === 'primary' ? withAlpha(C.gold, 0.5) : withAlpha('#9ab', 0.28); g.shadowBlur = 18; }
  roundRect(x, y, w, h, 10);
  g.fillStyle = dis ? 'rgba(255,255,255,.03)' : base;
  g.fill();
  g.shadowBlur = 0;
  g.strokeStyle = dis ? C.faint : edge;
  g.lineWidth = 1.5;
  g.stroke();
  g.restore();

  const cy = opts.sub ? y + h / 2 - 9 : y + h / 2;
  text(label, x + w / 2, cy, {
    size: opts.size ?? 20,
    weight: 600,
    align: 'center',
    color: dis ? C.faint : kind === 'primary' ? C.ink : C.ink2,
  });
  if (opts.sub) {
    text(opts.sub, x + w / 2, y + h / 2 + 14, { size: 14, align: 'center', color: C.dim });
  }
  return hv;
}

/** 可点击按钮：内部注册 onClick 到真正的回调。 */
export function action(
  x: number, y: number, w: number, h: number, label: string, fn: () => void,
  kind: BtnKind = 'ghost', opts: { size?: number; disabled?: boolean; sub?: string } = {},
) {
  button(x, y, w, h, label, kind, opts);
  if (!opts.disabled) onClick(x, y, w, h, fn, label);
}

export function bar(
  x: number, y: number, w: number, h: number, pct: number,
  color: string, opts: { bg?: string; ghost?: number; r?: number; label?: string } = {},
) {
  const r = opts.r ?? h / 2;
  roundRect(x, y, w, h, r);
  g.fillStyle = opts.bg ?? 'rgba(255,255,255,.07)';
  g.fill();

  const p = Math.max(0, Math.min(1, pct));
  if (opts.ghost !== undefined && opts.ghost > p) {
    roundRect(x, y, w * Math.min(1, opts.ghost), h, r);
    g.fillStyle = withAlpha('#ffffff', 0.5);
    g.fill();
  }
  if (p > 0.001) {
    g.save();
    roundRect(x, y, Math.max(2, w * p), h, r);
    g.clip();
    const grd = g.createLinearGradient(0, y, 0, y + h);
    grd.addColorStop(0, withAlpha(color, 0.95));
    grd.addColorStop(1, withAlpha(color, 0.55));
    g.fillStyle = grd;
    g.fillRect(x, y, w * p, h);
    g.fillStyle = 'rgba(255,255,255,.18)';
    g.fillRect(x, y, w * p, h * 0.4);
    g.restore();
  }
  roundRect(x, y, w, h, r);
  g.strokeStyle = withAlpha(color, 0.45);
  g.lineWidth = 1.2;
  g.stroke();

  if (opts.label) {
    text(opts.label, x + w / 2, y + h / 2 + 1, { size: Math.min(h * 0.66, 18), align: 'center', weight: 700, color: C.ink });
  }
}

/* ── 卡牌 ─────────────────────────────────────────────────── */

export interface CardOpts {
  up?: boolean;
  glow?: boolean;
  dim?: boolean;
  hovered?: boolean;
  /** 底部额外说明（奖励/牌组列表用） */
  note?: string;
  /** 隐藏底部的攻/挡 */
  bare?: boolean;
  /** 这张卡在长期记忆里的稳固度 0..1；不传就不画记忆条 */
  mem?: number;
  /**
   * 战斗中的解锁状态。只有手牌会传 —— 牌组/奖励列表传了没意义，
   * 那两个界面关心的是"这张卡是什么"，不是"这一场能不能用"。
   *
   * `forgotten` 是复习期答错的结果：这一场这个卡种作废了（还能快攻，但不能答题）。
   */
  state?: 'locked' | 'open' | 'spent' | 'forgotten';
  /**
   * 学习期 / 复习期。它决定"答错这件事有多贵"，所以必须画在卡面上 ——
   * 玩家在点开这张牌之前就该知道自己是"还能重来"还是"错了就废"。
   */
  phase?: 'learn' | 'review';
}

/**
 * 手牌、奖励、牌组列表共用同一种卡面。
 * 视觉效果：主题色定调 —— 同一主题在任何界面里颜色一致，玩家靠颜色认构筑方向。
 */
export function drawCard(
  x: number, y: number, w: number, h: number,
  card: CardDef, atk: number, blk: number, opts: CardOpts = {},
) {
  // 增益牌是另一个物种：没有题、没有伤害，打出去就一直在。卡面必须一眼分得开，
  // 否则手牌里混着一张能力牌，玩家会以为它也要答题。
  const pc = card.power ? POWER_BY_ID[card.power] : null;
  if (pc) { drawPowerCard(x, y, w, h, pc, opts); return; }

  const tc = card.junk ? C.faint : topicColor(card.topic);
  const r = 12;

  g.save();
  if (opts.dim) g.globalAlpha = 0.45;

  // 投影
  g.save();
  g.shadowColor = opts.glow ? withAlpha(tc, 0.75) : 'rgba(0,0,0,.65)';
  g.shadowBlur = opts.glow ? 34 : 16;
  g.shadowOffsetY = 6;
  roundRect(x, y, w, h, r);
  g.fillStyle = '#0d1018';
  g.fill();
  g.restore();

  // 卡面
  roundRect(x, y, w, h, r);
  const grd = g.createLinearGradient(x, y, x, y + h);
  grd.addColorStop(0, card.junk ? '#1a1c22' : withAlpha(tc, 0.1));
  grd.addColorStop(0.45, '#0e1119');
  grd.addColorStop(1, '#0a0c13');
  g.fillStyle = grd;
  g.fill();

  // 内描边 + 主题色外框。锁着的卡把边框压暗并改成虚线 —— 一眼就能看出"封印"
  const sealed = opts.state === 'locked' || opts.state === 'spent' || opts.state === 'forgotten';
  roundRect(x + 1.5, y + 1.5, w - 3, h - 3, r - 1);
  g.strokeStyle = opts.up ? withAlpha(C.gold, 0.85)
    : opts.state === 'open' ? withAlpha(C.gold, 0.5)
    : opts.state === 'forgotten' ? withAlpha(C.red, 0.5)
    : sealed ? withAlpha(tc, 0.26)
    : withAlpha(tc, opts.hovered ? 0.95 : 0.5);
  g.lineWidth = opts.up ? 2.2 : opts.state === 'open' ? 1.8 : 1.5;
  if (opts.state === 'locked' || opts.state === 'forgotten') g.setLineDash([6, 4]);
  g.stroke();
  g.setLineDash([]);

  // 顶部色条
  g.save();
  roundRect(x, y, w, h, r);
  g.clip();
  const bar1 = g.createLinearGradient(x, 0, x + w, 0);
  bar1.addColorStop(0, withAlpha(tc, 0));
  bar1.addColorStop(0.5, withAlpha(tc, 0.95));
  bar1.addColorStop(1, withAlpha(tc, 0));
  g.fillStyle = bar1;
  g.fillRect(x, y, w, 3);
  g.restore();

  const pad = w * 0.09;
  const s = w / 220;

  // 主题
  g.font = font(Math.round(15 * s), 700, FONT_UI);
  g.fillStyle = card.junk ? C.dim : tc;
  g.textAlign = 'left';
  g.fillText(squeeze(card.junk ? '杂念' : card.topic, w - pad * 2 - 34 * s), x + pad, y + 24 * s);

  // 消耗：所有卡都吃 1 点行动力，画在右上角免得每次都要心算
  if (!card.junk) {
    const cx = x + w - pad - 9 * s;
    const cy = y + 18 * s;
    g.beginPath();
    g.arc(cx, cy, 12 * s, 0, Math.PI * 2);
    g.fillStyle = withAlpha(C.gold, 0.16);
    g.fill();
    g.strokeStyle = withAlpha(C.gold, 0.6);
    g.lineWidth = 1.2;
    g.stroke();
    text('1', cx, cy + 1, { size: Math.round(13 * s), weight: 800, align: 'center', color: C.gold });
  }

  // ── 正文：效果标签 + 卡名 + 效果 ──────────────────────────
  // 卡面上不出现题目。题目是点开这张牌之后才付的代价，提前看到就等于免了那道坎。
  const eff = EFFS[card.eff] ?? EFFS.strike;
  const out = resolveEff(card.eff, atk, blk, 1);
  const per = out.hits[0];
  const lh = 25 * s;
  const eh = 21 * s;

  // 效果徽章：同一副牌里"洞察/巩固/内化"必须一眼分得开，靠的就是这一小块颜色
  if (!card.junk) {
    g.font = font(Math.round(11 * s), 700, FONT_UI);
    const lw = g.measureText(eff.name).width + 24 * s;
    const ly = y + 36 * s;
    roundRect(x + pad, ly, lw, 18 * s, 9 * s);
    g.fillStyle = withAlpha(eff.color, 0.2);
    g.fill();
    g.strokeStyle = withAlpha(eff.color, 0.72);
    g.lineWidth = 1.2;
    g.stroke();
    // 前面的小圆点比整块颜色更打眼，扫手牌时先看到点再看字
    g.beginPath();
    g.arc(x + pad + 8 * s, ly + 9 * s, 2.6 * s, 0, Math.PI * 2);
    g.fillStyle = eff.color;
    g.fill();
    text(eff.name, x + pad + 14 * s, ly + 9.5 * s, {
      size: Math.round(11 * s), align: 'left', color: eff.color, weight: 700,
    });
  }

  g.font = font(Math.round(21 * s), 700, FONT_UI);
  const nameLines = card.junk ? ['杂念'] : wrapText(card.name, w - pad * 2).slice(0, 2);
  // 正文在「徽章下沿」和「记忆条上沿」之间居中：两种卡高（手牌 238 / 列表 252）都不会显得头重脚轻
  const bodyH = nameLines.length * lh + 12 * s + 2 * eh;
  const top = y + 58 * s;
  const bot = y + h - 88 * s;
  const by0 = top + Math.max(0, (bot - top - bodyH) / 2) - 6 * s; // 6 是基线补偿

  g.fillStyle = card.junk ? C.dim : C.ink;
  g.textAlign = 'left';
  nameLines.forEach((ln, i) => g.fillText(ln, x + pad, by0 + i * lh));

  // 效果：数字单独放大上色，和卡牌游戏里"造成 6 点伤害"的读法一致
  const ey = by0 + nameLines.length * lh + 9 * s;
  const effLine = (pre: string, num: number, suf: string, yy: number, col: string) => {
    g.textAlign = 'left';
    g.font = font(Math.round(14 * s), 400, FONT_UI);
    g.fillStyle = card.junk ? C.faint : C.ink2;
    g.fillText(pre, x + pad, yy);
    const w1 = g.measureText(pre).width;
    if (num > 0) {
      g.font = font(Math.round(17 * s), 800, FONT_UI);
      g.fillStyle = card.junk ? C.faint : col;
      g.fillText(String(num), x + pad + w1, yy);
    }
    const w2 = num > 0 ? g.measureText(String(num)).width : 0;
    g.font = font(Math.round(14 * s), 400, FONT_UI);
    g.fillStyle = card.junk ? C.faint : C.ink2;
    g.fillText(suf, x + pad + w1 + w2, yy);
  };
  if (card.junk) {
    effLine('无法打出', 0, '', ey, C.faint);
    effLine('回合结束自动散去', 0, '', ey + eh, C.faint);
  } else {
    effLine('造成 ', per, out.hits.length > 1 ? ` 点伤害 ×${out.hits.length}` : ' 点伤害', ey, C.orange);
    // 第二行写的是"这张卡特殊在哪"，六种效果各一句，不再全是千篇一律的格挡
    if (out.blk > 0) effLine('获得 ', out.blk, ' 点格挡', ey + eh, C.blue);
    else if (out.pierce) effLine('无视格挡', 0, '', ey + eh, eff.color);
    else if (out.healRatio > 0) {
      effLine('回复 ', Math.max(1, Math.round(per * out.hits.length * out.healRatio)), ' 点生命', ey + eh, eff.color);
    } else if (out.draw > 0) effLine('抽 ', out.draw, ' 张牌', ey + eh, eff.color);
    else effLine('分两段结算', 0, '', ey + eh, eff.color);
  }

  // 主题水印：卡面下半部空白多，用主题首字压一个大字，既填了空又给主题一个身份
  if (!card.junk) {
    g.save();
    g.globalAlpha = 0.035;
    g.font = `800 ${Math.round(h * 0.52)}px ${FONT_TITLE}`;
    g.fillStyle = tc;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(card.topic.slice(0, 1) || '?', x + w * 0.72, y + h * 0.58);
    g.restore();
  }

  // ── 记忆条：卡面下半部最有信息量的东西 ────────────────────
  // 它回答的是"这张牌我现在有多熟" —— 熟不熟决定的是该不该留着它，而不是该押多大。
  // 手牌底下还要留一行解锁状态，所以记忆条得往上让一格；牌组/奖励没有那一行，就把它压到底。
  if (!card.junk && opts.mem !== undefined) {
    const my = y + h - (opts.state ? 74 : 44) * s;
    const mw = w - pad * 2;
    const mv = Math.max(0, Math.min(1, opts.mem));

    text('记忆', x + pad, my, { size: Math.round(11 * s), color: C.dim });
    const bw2 = mw - 34 * s;
    roundRect(x + pad + 30 * s, my - 5 * s, bw2, 6 * s, 3 * s);
    g.fillStyle = 'rgba(255,255,255,.07)';
    g.fill();
    roundRect(x + pad + 30 * s, my - 5 * s, Math.max(2, bw2 * mv), 6 * s, 3 * s);
    g.fillStyle = withAlpha(tc, 0.8);
    g.fill();
    text(`${Math.round(mv * 100)}%`, x + w - pad, my, {
      size: Math.round(11 * s), color: withAlpha(tc, 0.9), align: 'right', weight: 700,
    });
  }

  // ── 底部：解锁状态 ────────────────────────────────────────
  // 只有手牌会传状态 —— 牌组和奖励列表关心的是"这张卡是什么"，不是"这一场能不能用"。
  if (!card.junk && opts.state) {
    const py = y + h - 34 * s;
    const ly = py - 16 * s;
    g.beginPath();
    g.moveTo(x + pad, ly);
    g.lineTo(x + w - pad, ly);
    g.strokeStyle = withAlpha(tc, 0.22);
    g.lineWidth = 1;
    g.stroke();

    const open = opts.state === 'open';
    const forgot = opts.state === 'forgotten';
    // 底部这一行是玩家在"要不要点它"那一刻唯一能看见的规则：答错的代价。
    // 学习期和复习期的价码不一样，所以这句必须写在卡上，不能只写在帮助页里。
    const reviewLabel = BAL.reviewStrict ? '复习 · 答错作废' : '复习 · 答错不再回来';
    const label = open ? `免答 ×${BAL.freeMult}`
      : forgot ? '本场作废'
        : opts.state === 'spent' ? '这回合已答错'
          : opts.phase === 'review' ? reviewLabel : '学习 · 答错会回来';
    // 复习期那一档用暖色：它和"学习 · 答错会回来"是两种价码，扫一眼就该分开
    const col = open ? C.gold : forgot ? C.red
      : opts.state === 'locked' ? (opts.phase === 'review' ? withAlpha(C.orange, 0.9) : C.dim)
        : C.faint;

    roundRect(x + pad, py - 11 * s, w - pad * 2, 22 * s, 5 * s);
    g.fillStyle = open ? withAlpha(C.gold, 0.14)
      : forgot ? withAlpha(C.red, 0.1)
        : 'rgba(255,255,255,.04)';
    g.fill();
    if (open || forgot) {
      g.strokeStyle = withAlpha(forgot ? C.red : C.gold, 0.45);
      g.lineWidth = 1;
      g.stroke();
    }

    const mark = opts.state === 'locked' || forgot ? 'lock' : open ? 'check' : null;
    if (mark) icon(mark, x + pad + 10 * s, py, 6.5 * s, col);
    text(label, mark ? x + pad + 20 * s : x + w / 2, py + 0.5, {
      size: Math.round(11 * s), align: mark ? 'left' : 'center', color: col,
      weight: open ? 700 : 600,
    });
  }

  // 精炼标记
  if (opts.up) {
    g.font = font(Math.round(14 * s), 800, FONT_UI);
    g.fillStyle = C.gold;
    g.textAlign = 'right';
    g.fillText('精炼', x + w - pad - 26 * s, y + 24 * s);
  }

  if (opts.note) {
    text(opts.note, x + w / 2, y + h + 18, { size: 14, align: 'center', color: C.dim });
  }
  g.restore();
}

/**
 * 增益牌的卡面。
 *
 * 它和知识卡共用尺寸、共用消耗圆，但整套配色和排版都不一样：
 * 斜向金纹、没有"造成 X 点伤害"那种数字行、底部写的是"打出后本场生效"。
 * 手牌里混着两种牌，玩家必须在一瞥之间分出"这张要答题"和"这张要占行动力"。
 */
function drawPowerCard(x: number, y: number, w: number, h: number, p: PowerDef, opts: CardOpts) {
  const tc = p.color;
  const r = 12;
  const pad = w * 0.09;
  const s = w / 220;

  g.save();
  if (opts.dim) g.globalAlpha = 0.45;

  // 投影
  g.save();
  g.shadowColor = opts.glow ? withAlpha(tc, 0.8) : 'rgba(0,0,0,.65)';
  g.shadowBlur = opts.glow ? 34 : 16;
  g.shadowOffsetY = 6;
  roundRect(x, y, w, h, r);
  g.fillStyle = '#0d1018';
  g.fill();
  g.restore();

  // 卡面：左上角是它的颜色，右下角压回暗色 —— 和知识卡"顶部一条主线"的读法错开
  roundRect(x, y, w, h, r);
  const grd = g.createLinearGradient(x, y, x + w * 0.9, y + h);
  grd.addColorStop(0, withAlpha(tc, 0.22));
  grd.addColorStop(0.42, '#141110');
  grd.addColorStop(1, '#0a0a0d');
  g.fillStyle = grd;
  g.fill();

  // 斜纹：只在增益牌上出现，扫一眼手牌就能定位到它
  g.save();
  roundRect(x, y, w, h, r);
  g.clip();
  g.globalAlpha = 0.05;
  g.strokeStyle = tc;
  g.lineWidth = 10 * s;
  for (let i = -h; i < w; i += 26 * s) {
    g.beginPath();
    g.moveTo(x + i, y + h);
    g.lineTo(x + i + h, y);
    g.stroke();
  }
  g.restore();

  // 边框
  roundRect(x + 1.5, y + 1.5, w - 3, h - 3, r - 1);
  g.strokeStyle = withAlpha(tc, opts.hovered ? 1 : 0.62);
  g.lineWidth = opts.hovered ? 2 : 1.6;
  g.stroke();

  // 消耗圆：和知识卡同一个位置、同一个金色，因为价格也是同一个价格
  const cx = x + w - pad - 9 * s;
  const cy = y + 18 * s;
  g.beginPath();
  g.arc(cx, cy, 12 * s, 0, Math.PI * 2);
  g.fillStyle = withAlpha(C.gold, 0.16);
  g.fill();
  g.strokeStyle = withAlpha(C.gold, 0.6);
  g.lineWidth = 1.2;
  g.stroke();
  text('1', cx, cy + 1, { size: Math.round(13 * s), weight: 800, align: 'center', color: C.gold });

  // 左上：增益标签 + 一个字的图标
  const ly = y + 38 * s;
  g.font = font(Math.round(11 * s), 700, FONT_UI);
  const lw = g.measureText('增益').width + 38 * s;
  roundRect(x + pad, ly - 9 * s, lw, 18 * s, 9 * s);
  g.fillStyle = withAlpha(tc, 0.2);
  g.fill();
  g.strokeStyle = withAlpha(tc, 0.72);
  g.lineWidth = 1.2;
  g.stroke();
  text(p.icon, x + pad + 9 * s, ly + 0.5, {
    size: Math.round(11 * s), weight: 800, align: 'center', color: tc,
  });
  text('增益', x + pad + 18 * s, ly + 0.5, {
    size: Math.round(11 * s), align: 'left', color: tc, weight: 700,
  });

  // 卡名
  const nameLines = wrapText(p.name, w - pad * 2).slice(0, 2);
  const lh = 27 * s;
  g.fillStyle = C.ink;
  g.textAlign = 'left';
  g.font = font(Math.round(22 * s), 700, FONT_UI);
  nameLines.forEach((ln, i) => g.fillText(ln, x + pad, y + 80 * s + i * lh));

  // 效果：这段字是唯一要读的内容，所以给它最大的字号和行距。
  // 在「卡名下沿」和「底部分隔线」之间垂直居中 —— 否则短句会贴着卡名，下面留一大块空白。
  const bodyTop = y + 80 * s + nameLines.length * lh + 10 * s;
  const bodyBot = y + h - 64 * s;
  g.font = font(Math.round(14 * s), 400, FONT_UI);
  g.fillStyle = C.ink2;
  const lineH = 21 * s;
  const lines = wrapText(p.card, w - pad * 2);
  const off = Math.max(0, (bodyBot - bodyTop - lines.length * lineH) / 2);
  lines.forEach((ln, i) => {
    g.fillText(ln, x + pad, bodyTop + off + 14 * s + i * lineH);
  });

  // 底部：它什么时候生效 —— 这一句是增益牌和知识卡最大的行为差别
  const py = y + h - 30 * s;
  g.beginPath();
  g.moveTo(x + pad, py - 14 * s);
  g.lineTo(x + w - pad, py - 14 * s);
  g.strokeStyle = withAlpha(tc, 0.22);
  g.lineWidth = 1;
  g.stroke();
  text('打出后本场生效', x + w / 2, py, {
    size: Math.round(11 * s), align: 'center', color: withAlpha(tc, 0.9), weight: 600,
  });

  if (opts.note) {
    text(opts.note, x + w / 2, y + h + 18, { size: 14, align: 'center', color: C.dim });
  }
  g.restore();
}

export function title(s: string, x: number, y: number, size = 44, color = C.ink) {
  text(s, x, y, { size, weight: 700, family: FONT_TITLE, color });
}

/* ── 图标 ───────────────────────────────────────────────────
   emoji 会在不同系统上变成彩色贴纸或方框，UI 里的小图标一律手画。 */

export type IconName = 'attack' | 'shield' | 'junk' | 'buff' | 'check' | 'lock';

export function icon(name: IconName, cx: number, cy: number, s: number, col: string) {
  g.save();
  g.strokeStyle = col;
  g.fillStyle = col;
  g.lineWidth = Math.max(1.6, s * 0.16);
  g.lineCap = 'round';
  g.lineJoin = 'round';

  if (name === 'attack') {
    // 一把竖剑在 13px 下会被读成加号/十字。改成实心矛头，方向朝下指向自己，一眼就知道是伤害
    g.beginPath();
    g.moveTo(cx, cy + s * 0.68);
    g.lineTo(cx - s * 0.44, cy - s * 0.34);
    g.lineTo(cx, cy - s * 0.08);
    g.lineTo(cx + s * 0.44, cy - s * 0.34);
    g.closePath();
    g.fill();
    g.beginPath();
    g.moveTo(cx, cy - s * 0.34);
    g.lineTo(cx, cy - s * 0.62);
    g.stroke();
  } else if (name === 'shield') {
    g.beginPath();
    g.moveTo(cx, cy - s * 0.75);
    g.lineTo(cx + s * 0.62, cy - s * 0.42);
    g.lineTo(cx + s * 0.52, cy + s * 0.3);
    g.quadraticCurveTo(cx, cy + s * 0.85, cx - s * 0.52, cy + s * 0.3);
    g.lineTo(cx - s * 0.62, cy - s * 0.42);
    g.closePath();
    g.stroke();
  } else if (name === 'junk') {
    g.beginPath();
    g.moveTo(cx - s * 0.4, cy - s * 0.4);
    g.lineTo(cx + s * 0.4, cy + s * 0.4);
    g.moveTo(cx + s * 0.4, cy - s * 0.4);
    g.lineTo(cx - s * 0.4, cy + s * 0.4);
    g.stroke();
  } else if (name === 'buff') {
    g.beginPath();
    g.moveTo(cx, cy + s * 0.55);
    g.lineTo(cx, cy - s * 0.55);
    g.moveTo(cx - s * 0.38, cy - s * 0.12);
    g.lineTo(cx, cy - s * 0.58);
    g.lineTo(cx + s * 0.38, cy - s * 0.12);
    g.stroke();
  } else if (name === 'lock') {
    // 锁体 + 锁梁 + 锁孔。缩到 6px 也要认得出，所以只用三段直线和一个半圆
    const bw = s * 0.9;
    const bh = s * 0.62;
    const by = cy - s * 0.04;
    g.beginPath();
    g.moveTo(cx - bw / 2, by);
    g.lineTo(cx + bw / 2, by);
    g.lineTo(cx + bw / 2, by + bh);
    g.lineTo(cx - bw / 2, by + bh);
    g.closePath();
    g.stroke();
    g.beginPath();
    g.arc(cx, by, s * 0.33, Math.PI, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.arc(cx, by + bh * 0.46, s * 0.09, 0, Math.PI * 2);
    g.fill();
  } else {
    g.beginPath();
    g.moveTo(cx - s * 0.45, cy + s * 0.02);
    g.lineTo(cx - s * 0.08, cy + s * 0.42);
    g.lineTo(cx + s * 0.5, cy - s * 0.42);
    g.stroke();
  }
  g.restore();
}
