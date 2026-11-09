import { g, roundRect, wrapText } from './canvas';
import { onClick, hover } from '../input';
import { C, font, FONT_UI, FONT_TITLE, withAlpha } from './theme';
import { EFFS, MODES, POWER_BY_ID, resolveEff } from '../core/model';
import { cardKind, cardType, CARD_TYPE_META } from '../core/cards';
import type { CardDef, PowerDef, RunMode } from '../core/model';
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
  dim?: boolean;
  hovered?: boolean;
  /** 底部额外说明（奖励/牌组列表用） */
  note?: string;
  /** 隐藏底部的攻/挡 */
  bare?: boolean;
  /**
   * 战斗中的解锁状态。只有手牌会传 —— 牌组/奖励列表传了没意义，
   * 那两个界面关心的是"这张卡是什么"，不是"这一场能不能用"。
   *
   * 牌面上它由两件事共同表达：右上角那枚锁章（合锁 / 开锁），
   * 以及正文的明暗（锁着的牌名与效果整体压一档）。不写文字 ——
   * "这张能不能打"是一个字的状态，不值得占一整条。
   *
   * `forgotten` 是测试模式答错的结果：这一场这个卡种作废了（既不能答题，也打不出去）。
   * `basic` 是初始牌组：不参与解锁，所以不画章、正文保持全亮。
   */
  state?: 'locked' | 'open' | 'spent' | 'forgotten' | 'basic';
  /**
   * 本局模式。整局不变，不写进牌面文字，只决定锁章的冷暖色 ——
   * 学习灰、复习橙、测试红，扫一眼就知道这一局答错要付多少。
   */
  mode?: RunMode;
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
  const per = out.hits[0];
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

  // 卡面：主题色从顶部浸下来，越往下越沉到近黑 —— 牌才有厚度，不是一张平贴纸
  roundRect(x, y, w, h, r);
  const grd = g.createLinearGradient(x, y, x, y + h);
  grd.addColorStop(0, kind === 'junk' ? '#1a1c22' : withAlpha(tc, 0.17));
  grd.addColorStop(0.45, '#101420');
  grd.addColorStop(1, '#0b0e16');
  g.fillStyle = grd;
  g.fill();

  // 内描边 + 主题色外框。锁着的卡把边框压暗并改成虚线 —— 一眼就能看出"封印"
  // 这张牌现在能不能用，只有一种判断；边框、暗幕、正文都用它。
  const sealed = opts.state === 'locked' || opts.state === 'spent' || opts.state === 'forgotten';

  // 锁着的牌整体压一层暗幕。只把正文字变灰不够：字暗了，牌面还是亮的，
  // 整张卡看上去依旧"可以打"。画在底色之后、边框之前 —— 边框和右上角的锁章
  // 要留在暗幕之上，否则连"它锁着"这件事都被自己盖住。
  if (sealed) {
    g.save();
    roundRect(x, y, w, h, r);
    g.clip();
    g.fillStyle = 'rgba(6,8,13,.34)';
    g.fillRect(x, y, w, h);
    g.restore();
  }

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

  // 消耗不画在牌上：83 张牌无一例外都是 1 点，印一个"1"在每张牌右上角
  // 是重复 83 遍同一个常量，不是信息。这条规则说一次就够 —— 行动力环上
  // 写了「行动力」，帮助页写了「出牌 1 点」。省下的角落留给牌面自己。

  // ── 正文：牌名 + 类别徽章 + 效果数字 ──────────────────────
  // 卡面只有机械信息：叫什么、什么类别、打出去发生什么。
  // 题干、主题、知识点、记忆度一概不出现 —— 那四样都是"知识"，不该在牌面上。
  const lh = 25 * s;
  const eh = 21 * s;

  // 类别徽章：知识卡写「类别 · 效果」（攻击·洞察 / 防御·巩固 / 技能·专注），
  // 基础牌只写类别（攻击 / 防御）—— 它没有效果原型，只负责把数字换成伤害或格挡。
  const badgeName = kind === 'basic' ? typeMeta.name : `${typeMeta.name}·${eff.name}`;
  const badgeColor = kind === 'basic' ? typeMeta.color : eff.color;
  if (kind !== 'junk') {
    g.font = font(Math.round(11 * s), 700, FONT_UI);
    const lw = g.measureText(badgeName).width + 24 * s;
    const ly = y + 36 * s;
    roundRect(x + pad, ly, lw, 18 * s, 9 * s);
    g.fillStyle = withAlpha(badgeColor, 0.2);
    g.fill();
    g.strokeStyle = withAlpha(badgeColor, 0.72);
    g.lineWidth = 1.2;
    g.stroke();
    // 前面的小圆点比整块颜色更打眼，扫手牌时先看到点再看字
    g.beginPath();
    g.arc(x + pad + 8 * s, ly + 9 * s, 2.6 * s, 0, Math.PI * 2);
    g.fillStyle = badgeColor;
    g.fill();
    text(badgeName, x + pad + 14 * s, ly + 9.5 * s, {
      size: Math.round(11 * s), align: 'left', color: badgeColor, weight: 700,
    });
  }

  // 牌名正文：最多两行，超出截断（牌名都控制在七个字以内，两行只是兜底）。
  // 版式改成"从上往下读"：类别徽章 → 牌名 → 效果，下半部留给纹章水印。
  // 以前正文是垂直居中排的，撤掉主题行和记忆条之后居中会留出一大块空，读起来散。
  g.font = font(Math.round(21 * s), 700, FONT_UI);
  const nameLines = kind === 'junk' ? ['杂念'] : wrapText(card.name, w - pad * 2).slice(0, 2);
  const by0 = y + 84 * s;

  // 锁着 = 现在用不了。灰字是这件事的通行语言，比在牌面下沿补一行解释更直接，
  // 也不用为"一个字的状态"占掉一整条。已解锁的牌才是全亮的。
  const bodyCol = kind === 'junk' ? C.faint : sealed ? C.dim : C.ink2;

  g.fillStyle = kind === 'junk' ? C.dim : sealed ? C.ink2 : C.ink;
  g.textAlign = 'left';
  nameLines.forEach((ln, i) => g.fillText(ln, x + pad, by0 + i * lh));

  // 效果：数字单独放大上色，和卡牌游戏里"造成 6 点伤害"的读法一致
  const ey = by0 + nameLines.length * lh;
  const effLine = (pre: string, num: number, suf: string, yy: number, col: string) => {
    g.textAlign = 'left';
    g.font = font(Math.round(14 * s), 400, FONT_UI);
    g.fillStyle = bodyCol;
    g.fillText(pre, x + pad, yy);
    const w1 = g.measureText(pre).width;
    if (num > 0) {
      g.save();
      g.font = font(Math.round(17 * s), 800, FONT_UI);
      // 先描一圈暗边再填色：牌面底色是类别色浸下来的，同色系数字只靠放大
      // 是立不住的（攻击牌的橙色 6 叠在橙色卡面上最明显），一道暗边把数字
      // 从背景里"抠"出来，六个效果共用这一条，不用逐个调色。
      g.lineJoin = 'round';
      g.lineWidth = 3 * s;
      g.strokeStyle = 'rgba(6,8,13,.8)';
      g.strokeText(String(num), x + pad + w1, yy);
      // 锁着的牌数字跟着压暗：亮红亮蓝会让玩家以为现在就能打出去
      g.fillStyle = kind === 'junk' ? C.faint : sealed ? withAlpha(col, 0.55) : col;
      g.fillText(String(num), x + pad + w1, yy);
      g.restore();
    }
    const w2 = num > 0 ? g.measureText(String(num)).width : 0;
    g.font = font(Math.round(14 * s), 400, FONT_UI);
    g.fillStyle = bodyCol;
    g.fillText(suf, x + pad + w1 + w2, yy);
  };
  if (kind === 'junk') {
    effLine('无法打出', 0, '', ey, C.faint);
    effLine('回合结束自动散去', 0, '', ey + eh, C.faint);
  } else {
    // 纯防御的牌（基础格挡）没有伤害行，格挡那一行直接顶上来
    if (per > 0) effLine('造成 ', per, out.hits.length > 1 ? ` 点伤害 ×${out.hits.length}` : ' 点伤害', ey, C.numDmg);
    const dy = per > 0 ? ey + eh : ey;
    // 第二行写的是"这张卡特殊在哪"：格挡 / 破防 / 回血 / 抽牌 / 分段。
    // 猛击本身没有第二件事（它的价值全在数字上），所以这一行留空，不硬凑一句。
    if (out.blk > 0) effLine('获得 ', out.blk, ' 点格挡', dy, C.numBlk);
    else if (out.pierce) effLine('无视格挡', 0, '', dy, eff.color);
    else if (out.healRatio > 0) {
      effLine('回复 ', Math.max(1, Math.round(per * out.hits.length * out.healRatio)), ' 点生命', dy, eff.color);
    } else if (out.draw > 0) effLine('抽 ', out.draw, ' 张牌', dy, eff.color);
  }

  // 效果纹章：按效果原型画一枚小徽记压在右下。六种效果六种形，
  // 扫手牌时不用读字就能把"串联"和"洞察"分开；杂念是一团乱线。
  drawArtIcon(
    kind === 'junk' ? 'junk' : eff.key,
    x + w - pad - 15 * s, ey + eh * 0.55,
    (kind === 'junk' ? 25 : 30) * s,
    kind === 'junk' ? C.faint : eff.color,
    { alpha: kind === 'junk' ? 0.45 : 0.85 },
  );

  // 水印：用效果纹章放大压在下半部，单纯填版面 —— 它是机械信息，不是知识。
  // 以前这里是主题首字，等于把"这张牌属于哪一块知识"印在牌面上，撤掉了。
  // 底部那行状态带撤掉之后下半部更空了，纹章相应放大一圈，让留白是留白、不是没画完。
  if (kind !== 'junk') {
    drawArtIcon(eff.key, x + w * 0.58, y + h * 0.73, h * 0.42, tc, { alpha: 0.085 });
  }

  // ── 右上角：这张牌现在能不能直接打 ─────────────────────────
  // 以前这件事写在牌面下沿一条通栏状态带里，一整条只为说一个字的状态。
  // 现在收成一枚角章：合锁 = 要先答题，开锁 = 免答可打。
  // 基础牌不参与解锁（顶栏的解锁进度也不算它），所以不画章 ——
  // 有章 / 无章本身就区分了"这张牌在不在解锁系统里"。
  if (kind !== 'junk' && opts.state && opts.state !== 'basic') {
    const mode = opts.mode ? MODES[opts.mode] : null;
    const open = opts.state === 'open';
    const forgot = opts.state === 'forgotten';
    // 三档沿用原来的语义：学习冷、复习暖、测试红，扫一眼就知道这局犯错多贵
    const col = open ? C.gold
      : forgot ? C.red
        : opts.state === 'spent' ? C.orange
          : mode?.key === 'test' ? withAlpha(C.red, 0.9)
            : mode?.key === 'review' ? withAlpha(C.orange, 0.9)
              // 学习模式没有"贵"的含义，但锁本身要读得出，所以不是 dim 而是 ink2
              : C.ink2;
    const cx = x + w - pad - 9 * s;
    const cy = y + 18 * s;
    // 近黑实心底：和卡面数字同一个手法 —— 这枚章要能从任何类别色的牌面上立起来
    g.beginPath();
    g.arc(cx, cy, 12 * s, 0, Math.PI * 2);
    g.fillStyle = open ? withAlpha(C.gold, 0.2) : 'rgba(6,8,13,.86)';
    g.fill();
    g.strokeStyle = withAlpha(col, open ? 0.85 : 0.6);
    g.lineWidth = 1.2;
    g.stroke();
    icon(open ? 'unlock' : 'lock', cx, cy, 8.5 * s, col);
    // 本场作废再加一道斜杠：锁是"这回合不行"，划掉才是"这场没了"
    if (forgot) {
      g.beginPath();
      g.moveTo(cx - 7.5 * s, cy + 7.5 * s);
      g.lineTo(cx + 7.5 * s, cy - 7.5 * s);
      g.strokeStyle = withAlpha(C.red, 0.9);
      g.lineWidth = 1.6;
      g.stroke();
    }
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

  // 消耗同样不画：增益牌也是一张 1 点，和知识卡同一个价，不需要在牌面上再声明一次。

  // 左上：类别标签（能力）+ 一个字的图标
  const ly = y + 38 * s;
  g.font = font(Math.round(11 * s), 700, FONT_UI);
  const lw = g.measureText('能力').width + 38 * s;
  roundRect(x + pad, ly - 9 * s, lw, 18 * s, 9 * s);
  g.fillStyle = withAlpha(tc, 0.2);
  g.fill();
  g.strokeStyle = withAlpha(tc, 0.72);
  g.lineWidth = 1.2;
  g.stroke();
  text(p.icon, x + pad + 9 * s, ly + 0.5, {
    size: Math.round(11 * s), weight: 800, align: 'center', color: tc,
  });
  text('能力', x + pad + 18 * s, ly + 0.5, {
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

export type IconName =
  | 'attack' | 'shield' | 'junk' | 'buff' | 'check' | 'lock' | 'unlock'
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
  } else if (name === 'lock' || name === 'unlock') {
    // 锁体 + 锁孔两态共用，只有锁梁不一样：
    // 合锁是全拱（扣在锁体上），开锁只留左半边并往上翘 —— 梁弹起来了。
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
    if (name === 'lock') g.arc(cx, by, s * 0.33, Math.PI, Math.PI * 2);
    else g.arc(cx + s * 0.05, by - s * 0.1, s * 0.3, Math.PI, Math.PI * 1.6);
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
