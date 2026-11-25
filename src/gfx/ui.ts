import { g, roundRect, wrapText } from './canvas';
import { onClick, hover, pointer } from '../input';
import { C, PRESS, font, FONT_TITLE, FONT_UI, FONT_NUM, withAlpha } from './theme';
import { EFFS, effFace } from '../core/model';
import { cardKind, cardType, costGlyph, isXCost, CARD_TYPE_META } from '../core/cards';
import type { CardDef, EffOut } from '../core/model';
import { drawArtIcon, type ArtIconName } from './art/icons';
import { reduceMotion } from './motion';


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

/** 刻痕留在边缘，不穿过正文。 */
export function cutRule(x: number, y: number, w: number, color: string = C.gold, alpha = 0.42) {
  g.save();
  g.fillStyle = withAlpha(color, alpha);
  g.fillRect(x, y, w, 1);
  g.fillRect(x, y - 2, 3, 5);
  g.fillRect(x + w - 3, y - 2, 3, 5);
  g.restore();
}

export function panel(
  x: number, y: number, w: number, h: number,
  opts: { r?: number; radius?: number; fill?: string; stroke?: string; accent?: string } = {},
) {
  g.save();
  const r = Math.max(0, opts.radius ?? Math.min(3, opts.r ?? 3));
  roundRect(x, y, w, h, r);
  g.fillStyle = opts.fill ?? C.panel;
  g.fill();
  g.shadowBlur = 0;
  if (opts.stroke !== 'none') {
    g.strokeStyle = opts.stroke ?? C.line;
    g.lineWidth = 1;
    g.stroke();
  }
  if (opts.accent) {
    const edge = opts.accent;
    g.strokeStyle = withAlpha(edge, 0.26);
    g.strokeRect(x + 6.5, y + 6.5, w - 13, h - 13);
    cutRule(x + 16, y + 7, Math.min(64, w / 4), edge, 0.8);
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const px = x + w - 12 - i * 4;
      g.moveTo(px, y + h - 7);
      g.lineTo(px - 4, y + h - 12);
    }
    g.stroke();
  }

  g.restore();
}

export type BtnKind = 'primary' | 'ghost' | 'danger';
type ButtonOpts = { size?: number; sub?: string; mark?: ArtIconName; disabled?: boolean; r?: number };

export function button(
  x: number, y: number, w: number, h: number, label: string,
  kind: BtnKind = 'ghost', opts: ButtonOpts = {},
) {
  const hv = !opts.disabled && hover(x, y, w, h);
  const pressed = hv && pointer.down && pointer.dragDist < 8;
  g.save();
  if (pressed && !reduceMotion()) g.translate(0, 2);

  const base = kind === 'primary' ? (hv ? PRESS.vermilionHi : PRESS.vermilion)
    : kind === 'danger' ? withAlpha(C.red, hv ? 0.24 : 0.1)
      : hv ? C.panelHi : PRESS.sheet;
  const edge = kind === 'danger' ? C.red : C.gold;
  panel(x, y, w, h, {
    radius: opts.r,
    fill: opts.disabled ? C.panel : base,
    stroke: opts.disabled ? C.lineHi : hv ? edge : withAlpha(edge, kind === 'ghost' ? 0.37 : 0.7),
  });
  if (!opts.disabled && w >= 64 && h >= 30) {
    cutRule(x + 7, y + h - 6, w - 14, edge, pressed ? 1 : hv ? 0.78 : 0.34);
  }
  if (opts.mark) drawArtIcon(opts.mark, x + 24, y + h / 2, 20, opts.disabled ? C.dim : hv ? C.ink : C.gold);

  const cy = opts.sub ? y + h / 2 - 9 : y + h / 2;
  text(label, x + w / 2, cy, {
    size: opts.size ?? 20,
    weight: 600,
    align: 'center',
    color: opts.disabled ? C.dim : kind === 'primary' ? C.ink : C.ink2,
  });
  if (opts.sub) {
    text(opts.sub, x + w / 2, y + h / 2 + 14, { size: 14, align: 'center', color: !opts.disabled && kind === 'primary' ? C.ink : C.dim });
  }
  g.restore();
  return hv;
}

/** 可点击按钮，内部把 onClick 注册到回调。 */
export function action(
  x: number, y: number, w: number, h: number, label: string, fn: () => void,
  kind: BtnKind = 'ghost', opts: ButtonOpts = {},
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
  color: string, opts: { bg?: string; r?: number; label?: string; ticks?: number } = {},
) {
  const r = opts.r ?? 1;
  const p = Math.max(0, Math.min(1, pct));
  g.save();

  // 槽底压到跟面板一个明度：读的是「剩多少」，不是「槽本身有多亮」。
  roundRect(x, y, w, h, r);
  g.fillStyle = opts.bg ?? PRESS.groove;
  g.fill();

  if (p > 0.001) {
    const fw = Math.max(2, w * p);
    g.save();
    // 裁在整个槽内而不是填充块内，两端才不会顶出圆角。
    roundRect(x, y, w, h, r);
    g.clip();
    g.fillStyle = withAlpha(color, 0.64);
    g.fillRect(x, y, fw, h);
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

/** 费用数字：白常态、金 X、红付不起。 */
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
  g.strokeStyle = C.void;
  g.strokeText(glyph, left, y);
  g.fillStyle = col;
  g.fillText(glyph, left, y);
  g.restore();
}

/** 卡面绘制拆出来的各段；每段自己 save/restore，不依赖上一段留下的画布状态。 */

type CardKindView = ReturnType<typeof cardKind>;
type FaceView = ReturnType<typeof effFace>;
type EffView = (typeof EFFS)[keyof typeof EFFS];

function drawCardFrame(
  x: number, y: number, w: number, h: number, tc: string, opts: CardOpts,
) {
  const edge = opts.up ? C.gold : tc;
  const raised = opts.hovered || opts.glow;
  panel(x, y + 4, w, h, { fill: C.void, stroke: 'none' });
  panel(x, y, w, h, {
    fill: raised ? C.panelHi : PRESS.card,
    stroke: withAlpha(edge, opts.up || raised ? 1 : 0.56), accent: edge,
  });
  if (raised) cutRule(x + 12, y + h - 8, w - 24, edge, 0.82);
}

function drawCardHeader(
  x: number, y: number, w: number, s: number, pad: number,
  kind: CardKindView, typeMeta: { name: string; color: string }, eff: EffView,
  card: CardDef, opts: CardOpts,
) {
  // 费用：左上角，与右上角类别徽章同一条中心线。
  if (kind !== 'junk') {
    drawCostMark(x + pad, y + 30 * s, s, costGlyph(card), {
      x: isXCost(card), afford: opts.afford !== false,
    });
  }

  // 类别徽章：右上角，知识卡写「类别·效果」，基础牌只写类别。
  const badgeName = typeMeta.name;
  const badgeColor = kind === 'basic' ? typeMeta.color : eff.color;
  if (kind !== 'junk') {
    g.font = font(Math.round(11 * s), 700, FONT_UI);
    const lw = g.measureText(badgeName).width + 24 * s;
    const bh = 18 * s;
    const bx = x + w - pad - lw;
    const by = y + 21 * s;
    panel(bx, by, lw, bh, { r: 1, fill: PRESS.sheet, stroke: withAlpha(badgeColor, 0.5) });
    g.fillStyle = badgeColor;
    g.fillRect(bx + 6 * s, by + 6 * s, 2 * s, bh - 12 * s);
    text(badgeName, bx + 14 * s, by + bh / 2 + 0.5, {
      size: Math.round(11 * s), align: 'left', color: badgeColor, weight: 700,
    });
  }

}

function drawCardFooter(x: number, y: number, w: number, h: number, pad: number, s: number, tc: string) {
  const fy = y + h - 15 * s;
  cutRule(x + pad, fy, w - pad * 2, tc, 0.22);
}

function drawCardNote(x: number, y: number, w: number, h: number, r: number, pad: number, s: number, note: string) {
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
  const noteLines = wrapText(note, w - pad * 2).slice(0, 2);
  noteLines.forEach((ln, i) => {
    g.fillText(squeeze(ln, w - pad * 2), x + pad, y + h - (20 + (noteLines.length - 1 - i) * 15) * s);
  });
  g.restore();
}

interface CardEffectsView {
  x: number;
  w: number;
  s: number;
  pad: number;
  kind: CardKindView;
  face: FaceView;
  per: number;
  xc: boolean;
  nameLines: string[];
  by0: number;
  lh: number;
  eh: number;
  bodyCol: string;
  ruleLines: string[];
  eff: EffView;
}

function drawCardEffects(c: CardEffectsView) {
  const { x, s, pad, kind, face, per, xc, nameLines, by0, lh, eh, bodyCol, ruleLines, eff } = c;
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
      g.fillStyle = kind === 'junk' ? C.faint : col;
      g.fillText(ns, x + pad + w1, yy);
    }
    if (suf) {
      g.font = font(small, 400, FONT_UI);
      g.fillStyle = bodyCol;
      g.fillText(suf, x + pad + w1 + w2, yy);
    }
  };
  if (kind === 'junk') {
    effLine('无法打出', 0, '', ey, C.faint);
  } else {
    // 逐行往下排，X 费牌的第三行不会压到上一行。
    let ly = ey;
    if (per > 0) {
      const many = face.hits > 1 ? `${face.hits}` : '';
      // X 费牌的数字是每一点行动力的量，后缀写 ×X，串联是 ×2X。
      const suf = xc ? ` 点伤害 ×${many}X`
        : face.hits > 1 ? ` 点伤害 ×${many}` : ' 点伤害';
      effLine('', per, suf, ly, C.numDmg);
      ly += eh;
    }
    if (face.blk > 0) { effLine('', face.blk, xc ? ' 点格挡 ×X' : ' 点格挡', ly, C.numBlk); ly += eh; }
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
}

function drawNameUnderline(
  x: number, w: number, pad: number, s: number,
  nameLines: string[], by0: number, lh: number,
) {
  const nw = Math.max(40 * s, Math.min(w - pad * 2, g.measureText(nameLines[0] ?? '').width));
  const uy = by0 + (nameLines.length - 1) * lh + 9.5 * s;
  cutRule(x + pad, uy, nw, C.gold, 0.35);
}

/** 手牌、奖励、牌组共用一种卡面；颜色按三类，不泄露知识归属。 */
export function drawCard(
  x: number, y: number, w: number, h: number,
  card: CardDef, out: EffOut, opts: CardOpts = {},
) {
  // 身份只算一次，下面所有分支读 kind。
  const kind = cardKind(card);


  const typeMeta = CARD_TYPE_META[cardType(card)];
  const tc = kind === 'junk' ? C.faint : typeMeta.color;
  const eff = EFFS[card.eff] ?? EFFS.strike;
  // 卡面不再自己折算：调用方传的就是 planStrike 给结算用的同一份 EffOut。
  const face = effFace(out);
  const per = face.per;
  const r = 3;

  g.save();
  drawCardFrame(x, y, w, h, tc, opts);

  const pad = w * 0.09;
  const s = w / 220;

  const xc = isXCost(card);
  const lh = 26 * s;
  const eh = 24 * s;

  drawCardHeader(x, y, w, s, pad, kind, typeMeta, eff, card, opts);

  g.font = font(Math.round(21 * s), 700, FONT_TITLE);
  const nameLines = kind === 'junk' ? ['杂念'] : wrapText(card.name, w - pad * 2).slice(0, 2);
  const by0 = y + 71 * s;

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
    + (out.blk > 0 || out.pierce || out.healPer > 0 || out.draw > 0 ? 1 : 0)
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
    { alpha: kind === 'junk' ? 0.18 : 0.08 },
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
  if (kind !== 'junk') drawNameUnderline(x, w, pad, s, nameLines, by0, lh);

  // 效果行：动词小、数字大、单位小。
  drawCardEffects({
    x, w, s, pad, kind, face, per, xc, nameLines, by0, lh, eh,
    bodyCol, ruleLines, eff,
  });

  // 卡面收底横线，给效果行下方留出边界。
  if (kind !== 'junk') drawCardFooter(x, y, w, h, pad, s, tc);

  // 说明画在卡内底部，用向下压暗的渐变托底。
  if (opts.note) drawCardNote(x, y, w, h, r, pad, s, opts.note);
  g.restore();
}

/** 三选一用的目录卡：序号 + 徽记 + 标题 + 说明 + 底部事实行 + 动作提示。 */
export interface ChoiceCardOpts {
  /** 身份色：刻线、边框和徽记。 */
  color: string;
  /** 左上角序号，读成"目录里的第几条" */
  tag: string;
  /** 右上角徽记的一个字 */
  mark: string;
  title: string;
  desc: string;
  hovered: boolean;
  /** 底部事实行：标签（如「初始增益 · 2」）+ 值（如「借书证 · 课表」） */
  factLabel: string;
  fact: string;
  /** 值为"空"时压暗，不假装这是一条正经信息 */
  factMuted?: boolean;
  /** 说明占几行槽位（默认 3）。槽位是排版锚点：卡高按它算，不留多余空档。 */
  descLines?: number;
  /** 动作提示：常态 / hover 两版 */
  cta: [string, string];
}

/**
 * 三张卡的说明行数可以不同，但事实行用同一锚点，底边始终对齐。
 */
export function choiceCard(x: number, y: number, w: number, h: number, o: ChoiceCardOpts) {
  const pad = 30;
  g.save();
  // 抬升只动画，不动命中矩形：鼠标停在原处时卡不会自己跑开再回来
  if (o.hovered && !reduceMotion()) g.translate(0, pointer.down ? -3 : -7);

  panel(x, y, w, h, {
    accent: o.color, fill: o.hovered ? C.panelHi : PRESS.sheet,
    stroke: withAlpha(o.color, o.hovered ? 0.95 : 0.48),
  });

  text(o.tag, x + pad, y + 42, { size: 12, weight: 700, color: withAlpha(o.color, 0.72) });

  // 徽记和增益徽记右上角那个标签同一个位置：玩家已经学会"右上角是身份"
  const mx = x + w - pad - 16;
  const my = y + 38;
  panel(mx - 17, my - 17, 34, 34, { r: 1, fill: withAlpha(o.color, 0.14), stroke: o.color });
  text(o.mark, mx, my + 1, {
    size: 19, weight: 700, align: 'center', family: FONT_TITLE, color: o.color,
  });

  cutRule(x + pad, y + 60, w - pad * 2, o.color, 0.44);

  text(o.title, x + pad, y + 106, {
    size: 27, weight: 700, family: FONT_TITLE, color: C.ink,
  });
  g.font = font(27, 700, FONT_TITLE);
  const tw = Math.min(w - pad * 2 - 40, g.measureText(o.title).width);
  cutRule(x + pad, y + 118, tw + 14, o.color, o.hovered ? 0.84 : 0.44);

  g.font = font(13, 400, FONT_UI);
  g.fillStyle = C.ink2;
  g.textAlign = 'left';
  // 装不下的说明必须留省略号：静默截断的文案会被读成"这句本来就这样"
  const maxLines = o.descLines ?? 3;
  const lines = wrapText(o.desc, w - pad * 2);
  lines.slice(0, maxLines).forEach((ln, i) => {
    const cut = i === maxLines - 1 && lines.length > maxLines;
    g.fillText(cut ? ln.slice(0, -1) + '…' : ln, x + pad, y + 140 + i * 21);
  });

  const fy = y + h - 92;
  cutRule(x + pad, fy, w - pad * 2, o.color, 0.26);

  text(o.factLabel, x + pad, fy + 24, { size: 11, weight: 700, color: C.faint });
  text(o.fact, x + pad, fy + 48, {
    size: 13, weight: 600, color: o.factMuted ? C.faint : C.ink2, maxW: w - pad * 2,
  });

  text(o.hovered ? o.cta[1] : o.cta[0], x + w - pad, y + h - 20, {
    size: 12, align: 'right', weight: 700,
    color: o.hovered ? o.color : C.faint,
  });

  g.restore();
}

const HUD_ICONS = {
  attack: 'strike', shield: 'guard', junk: 'disrupt', buff: 'power', check: 'check',
  heart: 'heart', flame: 'flame', cards: 'cards', discard: 'discard', turn: 'turn', floor: 'floor',
} as const;

export type IconName = keyof typeof HUD_ICONS;

export function icon(name: IconName, cx: number, cy: number, s: number, col: string) {
  drawArtIcon(HUD_ICONS[name], cx, cy, s * 1.65, col);
}
