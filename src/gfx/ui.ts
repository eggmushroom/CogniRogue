import { g, roundRect, wrapText } from './canvas';
import { onClick, hover } from '../input';
import { C, font, FONT_UI, FONT_TITLE, withAlpha } from './theme';
import { EFFS, POWER_BY_ID, effFace, resolveEff } from '../core/model';
import { cardGrade, cardKind, cardType, costGlyph, GRADE_META, isXCost, CARD_TYPE_META } from '../core/cards';
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

  // 顶面一道内高光：面板像一块浮起来的玻璃，不是贴在背景上的色块。
  // 裁到圆角里，免得高光从四角漏出去。
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
    // 悬停时上沿一道细光，比只加底色更容易在暗背景上被看见
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
  color: string, opts: { bg?: string; ghost?: number; r?: number; label?: string; ticks?: number } = {},
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
  // 刻度：把长条切成段，血量过了一半没过一半一眼可辨
  if (opts.ticks && opts.ticks > 1) {
    g.save();
    g.strokeStyle = 'rgba(0,0,0,.42)';
    g.lineWidth = 1.4;
    for (let i = 1; i < opts.ticks; i++) {
      const tx = x + (w * i) / opts.ticks;
      g.beginPath();
      g.moveTo(tx, y + 2.5);
      g.lineTo(tx, y + h - 2.5);
      g.stroke();
    }
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
  hovered?: boolean;
  /** 底部额外说明（奖励/牌组列表用） */
  note?: string;
  /**
   * 现在付不付得起这张牌的费用。只有手牌会传 false —— 牌组、奖励、牌堆列表里
   * 不存在"此刻能不能打"这个问题，传了反而是噪音。
   * 付不起时那个数字转红：点下去会被拦，那就该在点之前就看出来。
   */
  afford?: boolean;
}

/**
 * 左上角的费用：一个光秃秃的数字，或者 X。
 *
 * **这里原来套着一个圆。** 圆是多余的：它不携带任何信息（只说明"这里是费用"，
 * 而牌面左上角本来就只有这一件事），却占掉一圈直径 —— 手牌的卡只有 200 宽，
 * 圈内净空 21px，塞一个 800 字重的数字，上下必然贴着环线。先把字号压小，
 * 数字又小到不像关键词。所以把圈去掉：数字直接把这块地方占满。
 *
 * 没有底色之后，数字怎么从类别色卡面上站起来？**用效果行那套同一个手法** ——
 * 暗描边 + 很弱的同色辉光。于是整张牌只有一种"数字怎么读"的语言：
 * 描边把形体从背景里抠出来，颜色带语义。
 *
 *   - 白 = 常态的 0–3；金 = X（它的价格是个变量）；红 = 此刻付不起（只有手牌会有）。
 *
 * 位置：左沿和牌名、效果行对齐，于是左栏是一条竖线；纵向和右上角的类别徽章同一条中心线，
 * 顶部那一行读起来是"几点 · 什么类别"一整条，而不是两个高度不一的小件。
 *
 * 纵向居中读 `actualBoundingBox`，不用手调基线常数：数字没有下伸部分（descent = 0），
 * 任何"大概往下挪一点"的常数都会让它贴住下沿，而 X 和大写字又要各自微调一次。
 */
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
  // 老浏览器没有 actualBoundingBox：退回 0.72em 的常见 cap height，位置略差但不会跑飞。
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

/**
 * 手牌、奖励、牌组列表共用同一种卡面。
 *
 * **牌面只讲机械，不讲知识。** 卡面上没有题干、没有主题名、没有知识点名、没有记忆度 ——
 * 颜色按四类（攻击橙 / 防御蓝 / 技能紫 / 能力金）而不是按主题，所以同主题的两张牌
 * 不会因为"长得像"而被联想。知识只在你点开牌、看到那一道题的时候才出现。
 */
export function drawCard(
  x: number, y: number, w: number, h: number,
  card: CardDef, atk: number, blk: number, opts: CardOpts = {},
) {
  // 身份只问一次：知识卡 / 增益牌 / 杂念 / 基础牌。下面所有分支都读这个 kind，
  // 不再各自去翻 card.junk、card.power —— 加第五种牌时只改 cards/kinds.ts。
  const kind = cardKind(card);

  // 增益牌是另一个物种：没有题、没有伤害，打出去就一直在。卡面必须一眼分得开，
  // 否则手牌里混着一张能力牌，玩家会以为它也要答题。
  const pc = kind === 'power' && card.power ? POWER_BY_ID[card.power] : null;
  if (pc) { drawPowerCard(x, y, w, h, pc, opts); return; }

  // 牌面色 = 类别色，不是主题色。主题色会泄露"这张牌对应哪个知识点"，
  // 而且同一主题的牌看起来像一套 —— 颜色改用四类之后，扫一眼读的是"它干什么"。
  const typeMeta = CARD_TYPE_META[cardType(card)];
  const tc = kind === 'junk' ? C.faint : typeMeta.color;
  const eff = EFFS[card.eff] ?? EFFS.strike;
  const out = resolveEff(card.eff, atk, blk, 1, card.mods);
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

  // 卡面：主题色从顶部浸下来，越往下越沉到近黑 —— 牌才有厚度，不是一张平贴纸
  roundRect(x, y, w, h, r);
  const grd = g.createLinearGradient(x, y, x, y + h);
  grd.addColorStop(0, kind === 'junk' ? '#1a1c22' : withAlpha(tc, 0.17));
  grd.addColorStop(0.45, '#101420');
  grd.addColorStop(1, '#0b0e16');
  g.fillStyle = grd;
  g.fill();

  // 内描边 + 主题色外框。
  roundRect(x + 1.5, y + 1.5, w - 3, h - 3, r - 1);
  g.strokeStyle = opts.up ? withAlpha(C.gold, 0.85)
    : withAlpha(tc, opts.hovered ? 0.95 : 0.5);
  g.lineWidth = opts.up ? 2.2 : 1.5;
  g.stroke();

  // 顶部色条：一条实色 + 一层往下散的辉光。
  // 原来只有 3px 细线，手牌摊开时主题色几乎读不出来；加一层浸染后，
  // 扫一眼就能靠颜色分组，不必逐张去读左上角那两个字。
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

  // 底部再浸一层同色（比顶部弱得多）：卡面上下各有一层颜色，中间夹着的那段最暗，
  // 文字区因此被"框"出来、对比反而更高；下半部也不再是一块纯黑 —— 没有这层底，
  // 水印是漂在黑里的，像贴上去的一张贴纸。
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

  // ── 费用：左上角，一个数字，没有圈 ──────────────────────────
  // 以前 83 张牌全是 1 点，这个角落空着是对的（印 83 遍同一个数不是信息）。
  // 现在 0/1/2/3/X 并存，价格成了每张牌最该先读到的一个数。
  // 纵向和右上角的类别徽章同一条中心线（徽章占 21s–39s，中线 30s）：
  // 顶部那一行于是读成"几点 · 什么类别"一整条，而不是两个高度不一的小件。
  if (kind !== 'junk') {
    drawCostMark(x + pad, y + 30 * s, s, costGlyph(card), {
      x: isXCost(card), afford: opts.afford !== false,
    });
  }

  const xc = isXCost(card);
  const lh = 26 * s;
  const eh = 24 * s;

  // ── 类别徽章：右上角 ─────────────────────────────────────
  // 知识卡写「类别 · 效果」（攻击·洞察 / 防御·巩固 / 技能·专注），
  // 基础牌只写类别（攻击 / 防御）—— 它没有效果原型，只负责把数字换成伤害或格挡。
  // 左上归费用、右上归类别，两个角各说一件事，中间那块空白正好留给牌名往上顶。
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
    // 前面的小圆点比整块颜色更打眼，扫手牌时先看到点再看字
    g.beginPath();
    g.arc(bx + 8 * s, by + bh / 2, 2.6 * s, 0, Math.PI * 2);
    g.fillStyle = badgeColor;
    g.fill();
    text(badgeName, bx + 14 * s, by + bh / 2 + 0.5, {
      size: Math.round(11 * s), align: 'left', color: badgeColor, weight: 700,
    });
  }

  // ── 等级：左上角费用旁边的一个小字 ───────────────────────
  // 等级不是稀有度，是"这张牌这一场要答对几次才免答"（C 0 / B 1 / A 2 / S 3）。
  // 它必须画在卡面上：玩家选牌时的第一个问题就是"这一手要不要答题"，
  // 而答案由等级决定。位置紧贴费用数字右侧，读成"几点 · 几级"一个词组。
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

  // ── 牌名：卡面上唯一的大字 ──────────────────────────────
  // 读序是「顶部信息 → 牌名 → 效果 → 下半的纹章」。
  // 牌名和效果行之间压一条同色渐隐的短线：不加这条线，两段白字在暗底上是同一团，
  // 眼睛得逐行去数才知道读到哪了（尤其牌名两个字、效果两行的牌）。
  // 字体要先设、再调 wrapText —— 换行是按当前字体的宽度量的，
  // 顺序反了就会用上一次遗留的字号去断行。
  g.font = font(Math.round(21 * s), 700, FONT_UI);
  const nameLines = kind === 'junk' ? ['杂念'] : wrapText(card.name, w - pad * 2).slice(0, 2);
  const by0 = y + 76 * s;

  // ── 水印：整张卡的底纹 ─────────────────────────────────────
  // 两条规矩：
  //
  // 1. 它必须画在**文字之前**。上一版画在最后，等于把一层影子盖在效果行上 ——
  //    alpha 再低也是在压字，于是只好压到 .085，下半部看起来就像"没画完"。
  //    放到最底层就没这个两难，可以放心画到 .12。
  // 2. 位置和大小按"效果写完还剩多少地方"算，不是写死一个高度。写死的话：
  //    一行效果的牌（猛击类）下半空出一大片，三行的牌（X 费）又会和字挤在一起。
  //    现在按剩余空间取中间、按可用高度定尺寸，一行和四行的牌都填得满。
  const rows = (per > 0 ? 1 : 0)
    + (out.blk > 0 || out.pierce || out.healRatio > 0 || out.draw > 0 ? 1 : 0)
    + (xc ? 0.75 : 0);
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

  // 精炼 = 这张牌打过一遍、证明过了。标记从右上角的「精炼」两个字改成名字后面的
  // 一个「+」（杀戮尖塔的写法）：右上角要完整让给类别徽章，而「名字＋」本来就是
  // 一句话读下来的，不必在另一个角上再立两个字。
  if (opts.up) {
    const nw = g.measureText(nameLines[0] ?? '').width;
    text('+', x + pad + nw + 1.5 * s, by0, {
      size: Math.round(21 * s), weight: 800, color: C.gold,
    });
  }

  // 名字下的短线：长度跟着名字走，向右渐隐 —— 它是分隔符，不是装饰框
  if (kind !== 'junk') {
    const nw = Math.max(40 * s, Math.min(w - pad * 2, g.measureText(nameLines[0] ?? '').width));
    const uy = by0 + (nameLines.length - 1) * lh + 9.5 * s;
    const ug = g.createLinearGradient(x + pad, 0, x + pad + nw, 0);
    // 用白而不是类别色。第一版是 tc（0.6 alpha）：在同类色的卡面上根本读不出来 ——
    // 技能牌的紫线压在紫底上等于没画。白线在八种卡面上都稳，而且它只做分隔，
    // 不带语义，本来也不该抢类别的颜色。
    ug.addColorStop(0, 'rgba(255,255,255,.32)');
    ug.addColorStop(0.6, 'rgba(255,255,255,.1)');
    ug.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = ug;
    g.fillRect(x + pad, uy, nw, Math.max(1.6, 2 * s));
  }

  // ── 效果：动词小、数字大、单位跟着小 ──────────────────────
  // 和卡牌游戏里"造成 6 点伤害"的读法一致：一眼扫过去先接住数字，再接住单位。
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
      // 数字必须用它自己的字号量宽度。上一版按正文的 14px 量、按 17px 画，
      // 算出来的位置永远偏左，数字和后缀会贴在一起（"造成 7 点伤害"里那个 7 就挤）。
      g.font = font(big, 800, FONT_UI);
      w2 = g.measureText(ns).width;
      g.save();
      // 先描一圈暗边：牌面底色是类别色浸下来的，同色系数字只靠放大立不住
      // （攻击牌的橙色 6 叠在橙色卡面上最明显），一道暗边把数字从背景里"抠"出来，
      // 六个效果共用这一条，不用逐个调色。
      g.lineJoin = 'round';
      g.lineWidth = 3 * s;
      g.strokeStyle = 'rgba(6,8,13,.85)';
      g.strokeText(ns, x + pad + w1, yy);
      // 一点同色辉光：暗底上让数字先跳出来。可读性由描边负责，所以光很弱 ——
      // 亮过头，整行字会糊成一片。
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
    effLine('回合结束自动散去', 0, '', ey + eh, C.faint);
  } else {
    // 逐行往下排。X 费牌要多一句话，写死 y 的话第三行会压到上一行上。
    let ly = ey;
    // 纯防御的牌（基础格挡）没有伤害行，格挡那一行直接顶上来
    if (per > 0) {
      const many = face.hits > 1 ? `${face.hits}` : '';
      // X 费牌的数字是"每一点行动力"的量，所以后缀写 ×X（串联是 ×2X）
      const suf = xc ? ` 点伤害 ×${many}X`
        : face.hits > 1 ? ` 点伤害 ×${many}` : ' 点伤害';
      effLine('造成 ', per, suf, ly, C.numDmg);
      ly += eh;
    }
    // 第二行写的是"这张卡特殊在哪"：格挡 / 破防 / 回血 / 抽牌 / 分段。
    // 猛击本身没有第二件事（它的价值全在数字上），所以这一行留空，不硬凑一句。
    if (face.blk > 0) { effLine('获得 ', face.blk, xc ? ' 点格挡 ×X' : ' 点格挡', ly, C.numBlk); ly += eh; }
    else if (face.pierce) { effLine('无视格挡', 0, '', ly, eff.color); ly += eh; }
    else if (face.healMax > 0) {
      // 「最多」不是谦词：回血按实际打进去的伤害算，被格挡吃掉的部分不回。
      effLine('最多回复 ', face.healMax, xc ? ' 点生命 ×X' : ' 点生命', ly, eff.color);
      ly += eh;
    } else if (face.drawMax > 0) {
      // 同理：抽牌堆和弃牌堆都空时抽不满，牌面写的是上限。
      effLine('最多抽 ', face.drawMax, ' 张牌', ly, eff.color);
      ly += eh;
    }
    // X 费牌必须自己说清"X 是多少" —— 牌面上只有一个 X 字形，不写这一句，
    // 玩家会以为它是"某个固定数字"而不是"这回合剩下的行动力"。
    // 它是注解不是第二项效果，所以字号降一档、染成金色，跟上面的数字行读开。
    if (xc) {
      g.textAlign = 'left';
      g.font = font(Math.round(12.5 * s), 700, FONT_UI);
      g.fillStyle = withAlpha(C.gold, 0.8);
      g.fillText('耗尽全部行动力', x + pad, ly + 1 * s);
    }
  }

  // 卡面收底：一条几乎看不见的横线。没有它，效果行下面就是一片黑，
  // 牌的"下沿"是理出来的、不是画出来的 —— 有这条线，下半部才叫留白。
  if (kind !== 'junk') {
    const fy = y + h - 15 * s;
    const fg = g.createLinearGradient(x + pad, 0, x + w - pad, 0);
    fg.addColorStop(0, withAlpha(tc, 0));
    fg.addColorStop(0.5, withAlpha(tc, 0.2));
    fg.addColorStop(1, withAlpha(tc, 0));
    g.fillStyle = fg;
    g.fillRect(x + pad, fy, w - pad * 2, Math.max(1, 0.8 * s));
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

  // 费用和知识卡同一个位置、同一套读法 —— 手牌里两种牌混着，
  // "要先答题的"和"不用答题的"可以长得不一样，但"要花几点"必须读得一样。
  drawCostMark(x + pad, y + 30 * s, s, String(p.cost).toUpperCase(), {
    x: p.cost === 'x', afford: opts.afford !== false,
  });

  // 右上：类别标签（能力 + 一个字的图标）。位置和知识卡的「类别·效果」对齐 ——
  // 于是"左上读价、右上读类别"这条视线在任何一张牌上都成立，不用分两种读法。
  g.font = font(Math.round(11 * s), 700, FONT_UI);
  const lw = g.measureText('能力').width + 38 * s;
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
  text('能力', bx + 18 * s, by + bh / 2 + 0.5, {
    size: Math.round(11 * s), align: 'left', color: tc, weight: 700,
  });

  // 卡名。字体先设、再调 wrapText —— 换行是按当前字体的宽度量的，
  // 顺序反了就会用上一次遗留的字号去断行（名短的牌看不出来，长的会断在奇怪的地方）。
  g.font = font(Math.round(22 * s), 700, FONT_UI);
  const nameLines = wrapText(p.name, w - pad * 2).slice(0, 2);
  const lh = 27 * s;
  const by0 = y + 78 * s;
  g.fillStyle = C.ink;
  g.textAlign = 'left';
  nameLines.forEach((ln, i) => g.fillText(ln, x + pad, by0 + i * lh));

  // 精炼标记。和知识卡一样用名字后的「+」，不用另立一行字
  if (opts.up) {
    const nw = g.measureText(nameLines[0] ?? '').width;
    text('+', x + pad + nw + 1.5 * s, by0, {
      size: Math.round(22 * s), weight: 800, color: C.gold,
    });
  }

  // 名字下的短线：和知识卡同一处。两种牌混在手牌里，"名字"这一层要对得齐，
  // 否则摊开一排会看出两种版式在打架。
  {
    const nw = Math.max(40 * s, Math.min(w - pad * 2, g.measureText(nameLines[0] ?? '').width));
    const uy = by0 + (nameLines.length - 1) * lh + 9.5 * s;
    const ug = g.createLinearGradient(x + pad, 0, x + pad + nw, 0);
    // 用白而不是类别色。第一版是 tc（0.6 alpha）：在同类色的卡面上根本读不出来 ——
    // 技能牌的紫线压在紫底上等于没画。白线在八种卡面上都稳，而且它只做分隔，
    // 不带语义，本来也不该抢类别的颜色。
    ug.addColorStop(0, 'rgba(255,255,255,.32)');
    ug.addColorStop(0.6, 'rgba(255,255,255,.1)');
    ug.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = ug;
    g.fillRect(x + pad, uy, nw, Math.max(1.6, 2 * s));
  }

  // 效果：这段字是唯一要读的内容，所以给它最大的字号和行距。
  // 在「名字下沿」和「底部分隔线」之间垂直居中 —— 否则短句会贴着卡名，下面留一大块空白。
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
    // 中脊：盾的立体感来自这条线，光也从这里读出"防御是有方向的"
    g.beginPath();
    g.moveTo(cx, cy - s * 0.7);
    g.lineTo(cx, cy + s * 0.72);
    g.stroke();
  } else if (name === 'heart') {
    // 实心心：两瓣圆弧收到下尖。生命图标必须实心 —— 描边心在 12px 下读成圆
    g.beginPath();
    g.moveTo(cx, cy + s * 0.72);
    g.bezierCurveTo(cx - s * 1.05, cy - s * 0.05, cx - s * 0.62, cy - s * 0.82, cx, cy - s * 0.28);
    g.bezierCurveTo(cx + s * 0.62, cy - s * 0.82, cx + s * 1.05, cy - s * 0.05, cx, cy + s * 0.72);
    g.closePath();
    g.fill();
  } else if (name === 'flame') {
    // 火苗：外焰实心 + 内焰留白，行动力/灯的意象
    g.beginPath();
    g.moveTo(cx, cy + s * 0.75);
    g.bezierCurveTo(cx - s * 0.72, cy + s * 0.45, cx - s * 0.5, cy - s * 0.25, cx + s * 0.02, cy - s * 0.78);
    g.bezierCurveTo(cx + s * 0.1, cy - s * 0.3, cx + s * 0.3, cy - s * 0.2, cx + s * 0.48, cy + s * 0.05);
    g.bezierCurveTo(cx + s * 0.68, cy + s * 0.35, cx + s * 0.55, cy + s * 0.62, cx, cy + s * 0.75);
    g.closePath();
    g.fill();
  } else if (name === 'cards') {
    // 一叠卡：后一张斜垫着，前一张立着 —— 牌堆的"叠"
    roundRect(cx - s * 0.05, cy - s * 0.62, s * 0.82, s * 1.15, s * 0.12);
    g.stroke();
    g.beginPath();
    g.moveTo(cx - s * 0.32, cy - s * 0.42);
    g.lineTo(cx - s * 0.5, cy - s * 0.32);
    g.lineTo(cx - s * 0.28, cy + s * 0.72);
    g.stroke();
  } else if (name === 'discard') {
    // 弃牌：一张卡落进托盘 —— 箭头朝下插进槽里
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
    // 沙漏：上宽下宽中间收腰，两条横梁压住 —— "这一回合的时间"
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
    // 楼层：三条渐窄的横线叠起来 —— 往下走的层
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
