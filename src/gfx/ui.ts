import { g, roundRect, wrapText } from './canvas';
import { onClick, hover } from '../input';
import { C, font, FONT_UI, FONT_TITLE, FONT_NUM, withAlpha } from './theme';
import { EFFS, effFace, resolveEff } from '../core/model';
import { cardGrade, cardKind, cardType, costGlyph, GRADE_META, isXCost, CARD_TYPE_META } from '../core/cards';
import { applyCardBonus } from '../core/cards/powers';
import type { CardDef, PowerDef } from '../core/model';
import { drawArtIcon } from './art/icons';


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

/** 单行截断，避免卡面文字溢出。 */
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

  // 内高光裁在圆角内，防止四角漏光。
  g.save();
  roundRect(x, y, w, h, opts.r ?? 14);
  g.clip();
  const sheenH = Math.min(70, h * 0.24);
  const sheen = g.createLinearGradient(0, y, 0, y + sheenH);
  sheen.addColorStop(0, 'rgba(255,255,255,.07)');
  sheen.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = sheen;
  g.fillRect(x, y, w, sheenH);
  g.restore();
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
  if (hv) {
    g.fillStyle = 'rgba(255,255,255,.13)';
    g.fillRect(x + 12, y + 2, w - 24, 1.5);
  }
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

/** 可点击按钮，内部把 onClick 注册到回调。 */
export function action(
  x: number, y: number, w: number, h: number, label: string, fn: () => void,
  kind: BtnKind = 'ghost', opts: { size?: number; disabled?: boolean; sub?: string } = {},
) {
  button(x, y, w, h, label, kind, opts);
  if (!opts.disabled) onClick(x, y, w, h, fn, label);
}

/**
 * 进度 / 血量槽，全站共用（战斗血条、地图生命、结算掌握度）。
 * 造型是「档案尺」：微圆角细金框 + 哑光填充 + 淡金刻度 + 当前值游标。
 * 旧版是荧光色胶囊加半条白色高光、黑色粗刻度和发光描边，像另一套手游 HUD；
 * 这里刻意不加任何发光，颜色和线宽都跟模式面板、卡牌外框取同一套。
 */
export function bar(
  x: number, y: number, w: number, h: number, pct: number,
  color: string, opts: { bg?: string; ghost?: number; r?: number; label?: string; ticks?: number } = {},
) {
  const r = opts.r ?? 3;
  const p = Math.max(0, Math.min(1, pct));
  g.save();

  // 槽底压到跟面板一个明度：读的是「剩多少」，不是「槽本身有多亮」。
  roundRect(x, y, w, h, r);
  g.fillStyle = opts.bg ?? 'rgba(255,255,255,.035)';
  g.fill();

  // 掉血前的虚影，只画差的那一段（预留给掉血演出）。
  if (opts.ghost !== undefined && opts.ghost > p) {
    g.save();
    roundRect(x, y, w, h, r);
    g.clip();
    g.fillStyle = withAlpha(color, 0.18);
    g.fillRect(x + w * p, y, w * (Math.min(1, opts.ghost) - p), h);
    g.restore();
  }

  if (p > 0.001) {
    const fw = Math.max(2, w * p);
    g.save();
    // 裁在整个槽内而不是填充块内，两端才不会顶出圆角。
    roundRect(x, y, w, h, r);
    g.clip();
    const grd = g.createLinearGradient(0, y, 0, y + h);
    grd.addColorStop(0, withAlpha(color, 0.78));
    grd.addColorStop(1, withAlpha(color, 0.48));
    g.fillStyle = grd;
    g.fillRect(x, y, fw, h);
    // 纸页上缘：1px 亮线，替代原来占掉四成高度的白色高光。
    g.fillStyle = withAlpha(color, 0.85);
    g.fillRect(x, y, fw, 1);
    g.restore();
    // 当前值游标：血量停在哪一格一眼可读，也顶替了粗黑刻度的功能。
    if (p < 0.999) {
      g.fillStyle = 'rgba(255,255,255,.55)';
      g.fillRect(Math.round(x + fw) - 1, y + 1, 1, h - 2);
    }
  }

  // 刻度：极细淡金线，压在全槽上；不再把血条切成黑边四段。
  if (opts.ticks && opts.ticks > 1) {
    g.save();
    roundRect(x, y, w, h, r);
    g.clip();
    g.strokeStyle = withAlpha(C.gold, 0.22);
    g.lineWidth = 1;
    for (let i = 1; i < opts.ticks; i++) {
      const tx = Math.round(x + (w * i) / opts.ticks) + 0.5;
      g.beginPath();
      g.moveTo(tx, y + 2);
      g.lineTo(tx, y + h - 2);
      g.stroke();
    }
    g.restore();
  }

  // 1px 细金框，和模式面板 / 卡牌外框同一条语言。
  roundRect(x + 0.5, y + 0.5, w - 1, h - 1, r);
  g.strokeStyle = withAlpha(C.gold, 0.32);
  g.lineWidth = 1;
  g.stroke();

  if (opts.label) {
    // 等宽数字 + 一层极淡暗影当描边；压在填充上和空槽上都能读，不用粗白大字。
    g.shadowColor = 'rgba(4,6,10,.85)';
    g.shadowBlur = 3;
    text(opts.label, x + w / 2, y + h / 2 + 1, {
      size: Math.min(h * 0.68, 16), align: 'center', weight: 600,
      family: FONT_NUM, color: '#f5edda',
    });
  }
  g.restore();
}

/* ── 卡牌 ─────────────────────────────────────────────────── */

export interface CardOpts {
  up?: boolean;
  glow?: boolean;
  hovered?: boolean;
  /** 卡内底部注脚，精炼和奖励的数值预览用。 */
  note?: string;
  rule?: string;
  /** 只有手牌传，付不起时费用数字转红。 */
  afford?: boolean;
}

/** 费用数字：白常态、金 X、红付不起；无底色，靠暗描边和弱辉光立起来。 */
function drawCostMark(
  left: number, midY: number, s: number, glyph: string,
  o: { x: boolean; afford: boolean },
) {
  const col = !o.afford ? C.red : o.x ? C.gold : C.ink;
  const size = 19 * s;
  g.save();
  g.font = font(size, 800, FONT_UI);
  g.textAlign = 'left';
  const m = g.measureText(glyph);
  // 老浏览器没有 actualBoundingBox，退回 0.72em 常见 cap height。
  const asc = m.actualBoundingBoxAscent ?? size * 0.72;
  const desc = m.actualBoundingBoxDescent ?? 0;
  const y = midY + (asc - desc) / 2;
  // 描边先画，再填色：和效果行里的伤害数字同一套宽窄，牌面上"数字"这一族长得一样
  g.lineJoin = 'round';
  g.lineWidth = Math.max(2, 3 * s);
  g.strokeStyle = 'rgba(6,8,13,.9)';
  g.strokeText(glyph, left, y);
  g.shadowColor = withAlpha(col, 0.45);
  g.shadowBlur = 8 * s;
  g.fillStyle = col;
  g.fillText(glyph, left, y);
  g.restore();
}

/** 手牌、奖励、牌组共用一种卡面；颜色按三类，不泄露主题。 */
export function drawCard(
  x: number, y: number, w: number, h: number,
  card: CardDef, atk: number, blk: number, opts: CardOpts = {},
) {
  // 身份只算一次，下面所有分支读 kind。
  const kind = cardKind(card);


  const typeMeta = CARD_TYPE_META[cardType(card)];
  const tc = kind === 'junk' ? C.faint : typeMeta.color;
  const eff = EFFS[card.eff] ?? EFFS.strike;
  // 卡面数值必须走 statOf / resolveEff，和结算同一函数，不能手写数字。
  const out = applyCardBonus(resolveEff(card.eff, atk, blk, 1, card.mods));
  const face = effFace(out);
  const per = face.per;
  const r = 12;

  g.save();
  // 投影
  g.save();
  g.shadowColor = opts.glow ? withAlpha(tc, 0.75) : 'rgba(0,0,0,.65)';
  g.shadowBlur = opts.glow ? 34 : 16;
  g.shadowOffsetY = 6;
  roundRect(x, y, w, h, r);
  g.fillStyle = '#0d1018';
  g.fill();
  g.restore();

  roundRect(x, y, w, h, r);
  const grd = g.createLinearGradient(x, y, x, y + h);
  grd.addColorStop(0, kind === 'junk' ? '#1a1c22' : withAlpha(tc, 0.17));
  grd.addColorStop(0.45, '#101420');
  grd.addColorStop(1, '#0b0e16');
  g.fillStyle = grd;
  g.fill();

  roundRect(x + 1.5, y + 1.5, w - 3, h - 3, r - 1);
  g.strokeStyle = opts.up ? withAlpha(C.gold, 0.85)
    : withAlpha(tc, opts.hovered ? 0.95 : 0.5);
  g.lineWidth = opts.up ? 2.2 : 1.5;
  g.stroke();

  g.save();
  roundRect(x, y, w, h, r);
  g.clip();
  const washH = 34 * (w / 220);
  const wash = g.createLinearGradient(0, y, 0, y + washH);
  wash.addColorStop(0, withAlpha(tc, 0.14));
  wash.addColorStop(1, withAlpha(tc, 0));
  g.fillStyle = wash;
  g.fillRect(x, y, w, washH);
  const bar1 = g.createLinearGradient(x, 0, x + w, 0);
  bar1.addColorStop(0, withAlpha(tc, 0.12));
  bar1.addColorStop(0.5, withAlpha(tc, 1));
  bar1.addColorStop(1, withAlpha(tc, 0.12));
  g.fillStyle = bar1;
  g.fillRect(x, y, w, 4);
  g.restore();

  const pad = w * 0.09;
  const s = w / 220;

  g.save();
  roundRect(x, y, w, h, r);
  g.clip();
  const lowH = h * 0.44;
  const low = g.createLinearGradient(0, y + h - lowH, 0, y + h);
  low.addColorStop(0, withAlpha(tc, 0));
  low.addColorStop(1, withAlpha(tc, kind === 'junk' ? 0.03 : 0.08));
  g.fillStyle = low;
  g.fillRect(x, y + h - lowH, w, lowH);
  g.restore();

  g.save();
  roundRect(x, y, w, h, r);
  g.clip();
  let hsh = 0;
  for (let i = 0; i < card.id.length; i++) hsh = (hsh * 31 + card.id.charCodeAt(i)) >>> 0;
  const cx = x + w * 0.5;
  const cy = y + h * 0.7;
  const rays = 14 + (hsh % 9);
  const phase = (hsh % 628) / 100;
  g.strokeStyle = withAlpha(tc, 0.075);
  g.lineWidth = 1;
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2 + phase;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * 30 * s, cy + Math.sin(a) * 30 * s);
    g.lineTo(cx + Math.cos(a) * 132 * s, cy + Math.sin(a) * 132 * s);
    g.stroke();
  }
  g.strokeStyle = withAlpha(tc, 0.11);
  g.beginPath();
  g.arc(cx, cy, (30 + (hsh % 5) * 4) * s, 0, Math.PI * 2);
  g.stroke();
  for (let yy = y + h * 0.52; yy < y + h; yy += 9 * s) {
    g.fillStyle = 'rgba(255,255,255,.014)';
    g.fillRect(x, yy, w, 1);
  }
  g.restore();

  // 费用：左上角，与右上角类别徽章同一条中心线。
  if (kind !== 'junk') {
    drawCostMark(x + pad, y + 30 * s, s, costGlyph(card), {
      x: isXCost(card), afford: opts.afford !== false,
    });
  }

  const xc = isXCost(card);
  const lh = 26 * s;
  const eh = 24 * s;

  // 类别徽章：右上角，知识卡写「类别·效果」，基础牌只写类别。
  const badgeName = kind === 'basic' ? typeMeta.name : `${typeMeta.name}·${eff.name}`;
  const badgeColor = kind === 'basic' ? typeMeta.color : eff.color;
  if (kind !== 'junk') {
    g.font = font(Math.round(11 * s), 700, FONT_UI);
    const lw = g.measureText(badgeName).width + 24 * s;
    const bh = 18 * s;
    const bx = x + w - pad - lw;
    const by = y + 21 * s;
    roundRect(bx, by, lw, bh, bh / 2);
    g.fillStyle = withAlpha(badgeColor, 0.2);
    g.fill();
    g.strokeStyle = withAlpha(badgeColor, 0.72);
    g.lineWidth = 1.2;
    g.stroke();
    g.beginPath();
    g.arc(bx + 8 * s, by + bh / 2, 2.6 * s, 0, Math.PI * 2);
    g.fillStyle = badgeColor;
    g.fill();
    text(badgeName, bx + 14 * s, by + bh / 2 + 0.5, {
      size: Math.round(11 * s), align: 'left', color: badgeColor, weight: 700,
    });
  }

  // 等级：这一场要答对几次才免答，紧跟费用数字。
  if (kind === 'knowledge') {
    const gr = cardGrade(card);
    const gm = GRADE_META[gr];
    g.font = font(Math.round(11 * s), 800, FONT_UI);
    const gw = g.measureText(gr).width + 12 * s;
    const gh = 15 * s;
    const gx = x + pad + 16 * s;
    const gy = y + 23 * s;
    roundRect(gx, gy, gw, gh, 4 * s);
    g.fillStyle = withAlpha(gm.color, 0.18);
    g.fill();
    g.strokeStyle = withAlpha(gm.color, 0.7);
    g.lineWidth = 1;
    g.stroke();
    text(gr, gx + gw / 2, gy + gh / 2 + 0.5, {
      size: Math.round(11 * s), align: 'center', color: gm.color, weight: 800,
    });
  }

  // 牌名字体先设再量行，顺序反了会沿用上次的字号。
  g.font = font(Math.round(21 * s), 700, FONT_UI);
  const nameLines = kind === 'junk' ? ['杂念'] : wrapText(card.name, w - pad * 2).slice(0, 2);
  const by0 = y + 76 * s;

  // 水印先于文字绘制；大小和位置按效果行剩余空间算。
  let ruleLines: string[] = [];
  if (opts.rule && kind !== 'junk') {
    // 量规则行要换小字号，但量完必须还原：联动卡带着 opts.rule 进来，
    // 不还原的话牌名、名字下短线和精炼 + 号都按 14px 排版，跟其他卡不是一套版式。
    g.save();
    g.font = font(Math.round(14 * s), 400, FONT_UI);
    ruleLines = wrapText(opts.rule, w - pad * 2).slice(0, 2);
    g.restore();
  }
  const rows = (per > 0 ? 1 : 0)
    + (out.blk > 0 || out.pierce || out.healRatio > 0 || out.draw > 0 ? 1 : 0)
    + (out.selfHp > 0 ? 1 : 0)
    + (xc ? 0.75 : 0)
    + ruleLines.length;
  const textBot = by0 + nameLines.length * lh + 9 * s + rows * eh;
  const bottomY = y + h - 15 * s;
  const room = Math.max(0, bottomY - textBot);
  const artS = Math.min(h * 0.42, Math.max(h * 0.22, room * 1.05));
  drawArtIcon(
    kind === 'junk' ? 'junk' : eff.key,
    x + w * 0.5, textBot + room * 0.5, artS,
    kind === 'junk' ? C.faint : tc,
    { alpha: kind === 'junk' ? 0.2 : 0.1 },
  );

  const bodyCol = kind === 'junk' ? C.faint : C.ink2;

  g.fillStyle = kind === 'junk' ? C.dim : C.ink;
  g.textAlign = 'left';
  nameLines.forEach((ln, i) => g.fillText(ln, x + pad, by0 + i * lh));

  // 精炼标记放在名字后，右上角留给类别徽章。
  if (opts.up) {
    const nw = g.measureText(nameLines[0] ?? '').width;
    text('+', x + pad + nw + 1.5 * s, by0, {
      size: Math.round(21 * s), weight: 800, color: C.gold,
    });
  }

  // 名字下的短线是分隔符，不是装饰框。
  if (kind !== 'junk') {
    const nw = Math.max(40 * s, Math.min(w - pad * 2, g.measureText(nameLines[0] ?? '').width));
    const uy = by0 + (nameLines.length - 1) * lh + 9.5 * s;
    const ug = g.createLinearGradient(x + pad, 0, x + pad + nw, 0);
    ug.addColorStop(0, 'rgba(255,255,255,.32)');
    ug.addColorStop(0.6, 'rgba(255,255,255,.1)');
    ug.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = ug;
    g.fillRect(x + pad, uy, nw, Math.max(1.6, 2 * s));
  }

  // 效果行：动词小、数字大、单位小。
  const ey = by0 + nameLines.length * lh + 9 * s;
  const effLine = (pre: string, num: number, suf: string, yy: number, col: string) => {
    const ns = String(num);
    const small = Math.round(14 * s);
    const big = Math.round(18 * s);
    g.textAlign = 'left';
    g.font = font(small, 400, FONT_UI);
    g.fillStyle = bodyCol;
    if (pre) g.fillText(pre, x + pad, yy);
    const w1 = pre ? g.measureText(pre).width : 0;
    let w2 = 0;
    if (num > 0) {
      g.font = font(big, 800, FONT_UI);
      w2 = g.measureText(ns).width;
      g.save();
      g.lineJoin = 'round';
      g.lineWidth = 3 * s;
      g.strokeStyle = 'rgba(6,8,13,.85)';
      g.strokeText(ns, x + pad + w1, yy);
      g.shadowColor = withAlpha(col, 0.5);
      g.shadowBlur = 9 * s;
      g.fillStyle = kind === 'junk' ? C.faint : col;
      g.fillText(ns, x + pad + w1, yy);
      g.restore();
    }
    if (suf) {
      g.font = font(small, 400, FONT_UI);
      g.fillStyle = bodyCol;
      g.fillText(suf, x + pad + w1 + w2, yy);
    }
  };
  if (kind === 'junk') {
    effLine('无法打出', 0, '', ey, C.faint);
    effLine('回合结束进弃牌堆', 0, '', ey + eh, C.faint);
  } else {
    // 逐行往下排，X 费牌的第三行不会压到上一行。
    let ly = ey;
    if (per > 0) {
      const many = face.hits > 1 ? `${face.hits}` : '';
      // X 费牌的数字是每一点行动力的量，后缀写 ×X，串联是 ×2X。
      const suf = xc ? ` 点伤害 ×${many}X`
        : face.hits > 1 ? ` 点伤害 ×${many}` : ' 点伤害';
      effLine('造成 ', per, suf, ly, C.numDmg);
      ly += eh;
    }
    if (face.blk > 0) { effLine('获得 ', face.blk, xc ? ' 点格挡 ×X' : ' 点格挡', ly, C.numBlk); ly += eh; }
    else if (face.pierce) { effLine('无视格挡', 0, '', ly, eff.color); ly += eh; }
    else if (face.healMax > 0) {
      // 「最多」按实际打进去的伤害算，被格挡的部分不回。
      effLine('最多回复 ', face.healMax, xc ? ' 点生命 ×X' : ' 点生命', ly, eff.color);
      ly += eh;
    } else if (face.drawMax > 0) {
      // 抽牌堆和弃牌堆都空时抽不满，牌面写的是上限。
      effLine('最多抽 ', face.drawMax, ' 张牌', ly, eff.color);
      ly += eh;
    }
    if (face.selfHp > 0) {
      // 自伤不是费用，单独占效果区一行。
      effLine('失去 ', face.selfHp, ' 点生命', ly, C.red);
      ly += eh;
    }
    // X 是这回合剩下的行动力，不是固定数字。
    if (xc) {
      g.textAlign = 'left';
      g.font = font(Math.round(12.5 * s), 700, FONT_UI);
      g.fillStyle = withAlpha(C.gold, 0.8);
      g.fillText('耗尽全部行动力', x + pad, ly + 1 * s);
      ly += eh;
    }
    for (const ln of ruleLines) {
      g.textAlign = 'left';
      g.font = font(Math.round(14 * s), 400, FONT_UI);
      g.fillStyle = bodyCol;
      g.fillText(ln, x + pad, ly);
      ly += eh;
    }
  }

  // 卡面收底横线，给效果行下方留出边界。
  if (kind !== 'junk') {
    const fy = y + h - 15 * s;
    const fg = g.createLinearGradient(x + pad, 0, x + w - pad, 0);
    fg.addColorStop(0, withAlpha(tc, 0));
    fg.addColorStop(0.5, withAlpha(tc, 0.2));
    fg.addColorStop(1, withAlpha(tc, 0));
    g.fillStyle = fg;
    g.fillRect(x + pad, fy, w - pad * 2, Math.max(1, 0.8 * s));
  }

  // 说明画在卡内底部，用向下压暗的渐变托底。
  if (opts.note) {
    g.save();
    roundRect(x, y, w, h, r);
    g.clip();
    const nh = 58 * s;
    const ng = g.createLinearGradient(0, y + h - nh, 0, y + h);
    ng.addColorStop(0, 'rgba(7,9,14,0)');
    ng.addColorStop(0.55, 'rgba(7,9,14,.6)');
    ng.addColorStop(1, 'rgba(7,9,14,.92)');
    g.fillStyle = ng;
    g.fillRect(x, y + h - nh, w, nh);
    g.font = font(Math.round(12.5 * s), 600, FONT_UI);
    // 注脚和牌名共用左栏；长句允许两行，避免截掉规则。
    g.textAlign = 'left';
    g.fillStyle = C.ink2;
    const noteLines = wrapText(opts.note, w - pad * 2).slice(0, 2);
    noteLines.forEach((ln, i) => {
      g.fillText(squeeze(ln, w - pad * 2), x + pad, y + h - (20 + (noteLines.length - 1 - i) * 15) * s);
    });
    g.restore();
  }
  g.restore();
}

/** 增益徽记：与知识卡共用尺寸，配色排版不同，只出现在掉落面板。 */
export function drawPowerEmblem(
  x: number, y: number, w: number, h: number, p: PowerDef, opts: CardOpts,
) {
  const tc = p.color;
  const r = 12;
  const pad = w * 0.09;
  const s = w / 220;

  g.save();

  // 投影
  g.save();
  g.shadowColor = opts.glow ? withAlpha(tc, 0.8) : 'rgba(0,0,0,.65)';
  g.shadowBlur = opts.glow ? 34 : 16;
  g.shadowOffsetY = 6;
  roundRect(x, y, w, h, r);
  g.fillStyle = '#0d1018';
  g.fill();
  g.restore();

  roundRect(x, y, w, h, r);
  const grd = g.createLinearGradient(x, y, x + w * 0.9, y + h);
  grd.addColorStop(0, withAlpha(tc, 0.22));
  grd.addColorStop(0.42, '#141110');
  grd.addColorStop(1, '#0a0a0d');
  g.fillStyle = grd;
  g.fill();

  // 斜纹只出现在增益徽记上。
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

  roundRect(x + 1.5, y + 1.5, w - 3, h - 3, r - 1);
  g.strokeStyle = withAlpha(tc, opts.hovered ? 1 : 0.62);
  g.lineWidth = opts.hovered ? 2 : 1.6;
  g.stroke();

  // 左上角回答「这个东西要花我什么」，这里是生效范围。
  text('整局', x + pad, y + 30 * s, {
    size: Math.round(13 * s), weight: 700, color: withAlpha(tc, 0.95),
  });

  // 右上角是类别标签，和知识卡的位置对齐。
  g.font = font(Math.round(11 * s), 700, FONT_UI);
  const lw = g.measureText('增益').width + 38 * s;
  const bh = 18 * s;
  const bx = x + w - pad - lw;
  const by = y + 21 * s;
  roundRect(bx, by, lw, bh, bh / 2);
  g.fillStyle = withAlpha(tc, 0.2);
  g.fill();
  g.strokeStyle = withAlpha(tc, 0.72);
  g.lineWidth = 1.2;
  g.stroke();
  text(p.icon, bx + 9 * s, by + bh / 2 + 0.5, {
    size: Math.round(11 * s), weight: 800, align: 'center', color: tc,
  });
  text('增益', bx + 18 * s, by + bh / 2 + 0.5, {
    size: Math.round(11 * s), align: 'left', color: tc, weight: 700,
  });

  // 字体先设再量行。
  g.font = font(Math.round(22 * s), 700, FONT_UI);
  const nameLines = wrapText(p.name, w - pad * 2).slice(0, 2);
  const lh = 27 * s;
  const by0 = y + 78 * s;
  g.fillStyle = C.ink;
  g.textAlign = 'left';
  nameLines.forEach((ln, i) => g.fillText(ln, x + pad, by0 + i * lh));

  {
    const nw = Math.max(40 * s, Math.min(w - pad * 2, g.measureText(nameLines[0] ?? '').width));
    const uy = by0 + (nameLines.length - 1) * lh + 9.5 * s;
    const ug = g.createLinearGradient(x + pad, 0, x + pad + nw, 0);
    ug.addColorStop(0, 'rgba(255,255,255,.32)');
    ug.addColorStop(0.6, 'rgba(255,255,255,.1)');
    ug.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = ug;
    g.fillRect(x + pad, uy, nw, Math.max(1.6, 2 * s));
  }

  // 效果文字居中于名字下沿和底部分隔线之间。
  const bodyTop = by0 + nameLines.length * lh + 12 * s;
  const bodyBot = y + h - 64 * s;
  g.font = font(Math.round(14 * s), 400, FONT_UI);
  g.fillStyle = C.ink2;
  const lineH = 22 * s;
  const lines = wrapText(p.card, w - pad * 2);
  const off = Math.max(0, (bodyBot - bodyTop - lines.length * lineH) / 2);
  lines.forEach((ln, i) => {
    g.fillText(ln, x + pad, bodyTop + off + 14 * s + i * lineH);
  });

  // 底部写生效时机，这是增益徽记和知识卡的行为差别。
  const py = y + h - 30 * s;
  g.beginPath();
  g.moveTo(x + pad, py - 14 * s);
  g.lineTo(x + w - pad, py - 14 * s);
  g.strokeStyle = withAlpha(tc, 0.22);
  g.lineWidth = 1;
  g.stroke();
  text('拾取即生效 · 整局', x + w / 2, py, {
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

/* ── 图标（emoji 跨系统不稳定，一律手画） ─────────────────── */

export type IconName =
  | 'attack' | 'shield' | 'junk' | 'buff' | 'check'
  | 'heart' | 'flame' | 'cards' | 'discard' | 'turn' | 'floor';

export function icon(name: IconName, cx: number, cy: number, s: number, col: string) {
  g.save();
  g.strokeStyle = col;
  g.fillStyle = col;
  g.lineWidth = Math.max(1.6, s * 0.16);
  g.lineCap = 'round';
  g.lineJoin = 'round';

  if (name === 'attack') {
    // 竖剑在小尺寸下像加号，改用实心矛头。
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
    // 中脊给盾立体感。
    g.beginPath();
    g.moveTo(cx, cy - s * 0.7);
    g.lineTo(cx, cy + s * 0.72);
    g.stroke();
  } else if (name === 'heart') {
    // 描边心在小尺寸下像圆，生命图标用实心。
    g.beginPath();
    g.moveTo(cx, cy + s * 0.72);
    g.bezierCurveTo(cx - s * 1.05, cy - s * 0.05, cx - s * 0.62, cy - s * 0.82, cx, cy - s * 0.28);
    g.bezierCurveTo(cx + s * 0.62, cy - s * 0.82, cx + s * 1.05, cy - s * 0.05, cx, cy + s * 0.72);
    g.closePath();
    g.fill();
  } else if (name === 'flame') {
    // 火苗外焰实心、内焰留白。
    g.beginPath();
    g.moveTo(cx, cy + s * 0.75);
    g.bezierCurveTo(cx - s * 0.72, cy + s * 0.45, cx - s * 0.5, cy - s * 0.25, cx + s * 0.02, cy - s * 0.78);
    g.bezierCurveTo(cx + s * 0.1, cy - s * 0.3, cx + s * 0.3, cy - s * 0.2, cx + s * 0.48, cy + s * 0.05);
    g.bezierCurveTo(cx + s * 0.68, cy + s * 0.35, cx + s * 0.55, cy + s * 0.62, cx, cy + s * 0.75);
    g.closePath();
    g.fill();
  } else if (name === 'cards') {
    // 后一张斜垫、前一张立着，读出牌堆的叠。
    roundRect(cx - s * 0.05, cy - s * 0.62, s * 0.82, s * 1.15, s * 0.12);
    g.stroke();
    g.beginPath();
    g.moveTo(cx - s * 0.32, cy - s * 0.42);
    g.lineTo(cx - s * 0.5, cy - s * 0.32);
    g.lineTo(cx - s * 0.28, cy + s * 0.72);
    g.stroke();
  } else if (name === 'discard') {
    // 弃牌：一张卡落进托盘：箭头朝下插进槽里
    g.beginPath();
    g.moveTo(cx - s * 0.55, cy + s * 0.05);
    g.lineTo(cx - s * 0.55, cy + s * 0.6);
    g.lineTo(cx + s * 0.55, cy + s * 0.6);
    g.lineTo(cx + s * 0.55, cy + s * 0.05);
    g.stroke();
    g.beginPath();
    g.moveTo(cx, cy - s * 0.72);
    g.lineTo(cx, cy + s * 0.18);
    g.moveTo(cx - s * 0.3, cy - s * 0.12);
    g.lineTo(cx, cy + s * 0.2);
    g.lineTo(cx + s * 0.3, cy - s * 0.12);
    g.stroke();
  } else if (name === 'turn') {
    // 沙漏：上宽下宽中间收腰，两条横梁压住："这一回合的时间"
    g.beginPath();
    g.moveTo(cx - s * 0.5, cy - s * 0.62);
    g.lineTo(cx + s * 0.5, cy - s * 0.62);
    g.lineTo(cx + s * 0.08, cy + s * 0.05);
    g.lineTo(cx + s * 0.5, cy + s * 0.68);
    g.lineTo(cx - s * 0.5, cy + s * 0.68);
    g.lineTo(cx - s * 0.08, cy + s * 0.05);
    g.closePath();
    g.stroke();
  } else if (name === 'floor') {
    // 楼层：三条渐窄的横线叠起来：往下走的层
    g.beginPath();
    g.moveTo(cx - s * 0.55, cy - s * 0.42);
    g.lineTo(cx + s * 0.55, cy - s * 0.42);
    g.moveTo(cx - s * 0.38, cy + s * 0.02);
    g.lineTo(cx + s * 0.38, cy + s * 0.02);
    g.moveTo(cx - s * 0.2, cy + s * 0.46);
    g.lineTo(cx + s * 0.2, cy + s * 0.46);
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
  } else {
    g.beginPath();
    g.moveTo(cx - s * 0.45, cy + s * 0.02);
    g.lineTo(cx - s * 0.08, cy + s * 0.42);
    g.lineTo(cx + s * 0.5, cy - s * 0.42);
    g.stroke();
  }
  g.restore();
}
