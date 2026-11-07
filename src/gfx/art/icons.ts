import { g } from '../canvas';

/**
 * gfx/art/icons —— **自建图标素材库**（v1：八种效果原型）。
 *
 * 设计约定：
 *   1. 每个图标是 24×24 坐标系里的 SVG path 数据，绘制时整体缩放 ——
 *      矢量数据几百字节一个，不进任何位图，单文件构建不受影响；
 *   2. 只描形状不上色：颜色一律由调用方传入，图标永远跟着
 *      效果色 / 主题色 / 警示色走，换肤只改 theme.ts；
 *   3. s 是描边路径，f 是实心路径（先实心后描边）。风格和 ui.ts 的
 *      手画线条图标同一种语言：圆头、粗细随尺寸、剪影优先。
 *
 * 加新图标时在 ART_ICONS 里加一项、在图集页（?dev=atlas）看协调度即可。
 */
export interface ArtIcon {
  /** 描边路径（24×24 坐标系） */
  s: string[];
  /** 实心路径（可选，先画，垫在描边下面） */
  f?: string[];
}

export const ART_ICONS = {
  /** 猛击：尖朝下的剑 —— 和 ui.ts 的矛头同一个读法，加了护手和剑柄 */
  strike: {
    s: ['M7.5 9.5 L16.5 9.5', 'M12 9 L12 4'],
    f: ['M12 22 L9.2 10.5 L14.8 10.5 Z'],
  },
  /** 洞察：箭从圆环里偏心穿过（环像被串在箭上）—— 环在穿越点断开，"穿透"才读得出来 */
  pierce: {
    s: [
      'M12.26 17.79 A4.3 4.3 0 0 1 9.57 18.8',
      'M5.98 16.97 A4.3 4.3 0 1 1 13.76 13.9',
      'M4.5 22 L21.5 5',
      'M15.5 5 L21.5 5 L21.5 11.5',
    ],
  },
  /** 巩固：盾 + 中脊 */
  guard: {
    s: [
      'M12 3 L19 5.8 L19 11.5 C19 16.5 16.2 19.8 12 21.3 C7.8 19.8 5 16.5 5 11.5 L5 5.8 Z',
      'M12 7 L12 16.5',
    ],
  },
  /** 内化：水滴落入杯 —— 把伤害收进自己身体 */
  drain: {
    s: ['M5.5 13.5 L18.5 13.5 L16.8 21 L7.2 21 Z'],
    f: ['M12 2.5 C13.8 5.6 15.4 7.4 15.4 9.6 A3.4 3.4 0 1 1 8.6 9.6 C8.6 7.4 10.2 5.6 12 2.5 Z'],
  },
  /** 串联：三环相扣 —— 多段伤害 */
  chain: {
    s: [
      'M3 12 A3.4 3.4 0 1 0 9.8 12 A3.4 3.4 0 1 0 3 12',
      'M8.6 12 A3.4 3.4 0 1 0 15.4 12 A3.4 3.4 0 1 0 8.6 12',
      'M14.2 12 A3.4 3.4 0 1 0 21 12 A3.4 3.4 0 1 0 14.2 12',
    ],
  },
  /** 专注：棱面宝石 —— 聚起来的一股劲（抽牌） */
  focus: {
    s: [
      'M12 3 L17.5 9 L12 21 L6.5 9 Z',
      'M6.5 9 L17.5 9',
      'M12 3 L9.5 9 L12 21',
      'M12 3 L14.5 9 L12 21',
    ],
  },
  /** 增益：双重上升箭头 */
  power: {
    s: ['M6 12.5 L12 6.5 L18 12.5', 'M6 19 L12 13 L18 19'],
  },
  /** 杂念：乱线团 —— 缠成一团理不清的念头 */
  junk: {
    s: [
      'M6.5 9 C9 3.5 19 4 19.5 10 C20 15.5 12 17 8.5 14.5 C5 12 7.5 7.5 11.5 8.5 C15.5 9.5 16 14.5 12.5 16.5 C9.5 18.2 5 16 6 12.5 C6.7 10 9.5 10.5 10.5 12',
    ],
  },
} satisfies Record<string, ArtIcon>;

export type ArtIconName = keyof typeof ART_ICONS;

/** 六种效果原型 → 图标名（EFFS.key 与这里同名，画卡面时直接用 eff.key） */
export const EFF_ICON: Record<string, ArtIconName> = {
  strike: 'strike', pierce: 'pierce', guard: 'guard',
  drain: 'drain', chain: 'chain', focus: 'focus',
};

/**
 * 画一枚图标。cx/cy 是中心点，size 是外接方框边长；
 * lineWidth 定义在 24 坐标系里，随缩放走，小尺寸也不会糊成一团。
 */
export function drawArtIcon(
  name: ArtIconName, cx: number, cy: number, size: number, color: string,
  opts: { alpha?: number } = {},
) {
  const ic: ArtIcon = ART_ICONS[name];
  const k = size / 24;
  g.save();
  g.translate(cx - 12 * k, cy - 12 * k);
  g.scale(k, k);
  if (opts.alpha !== undefined) g.globalAlpha = opts.alpha;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = 1.9;
  if (ic.f) for (const d of ic.f) g.fill(new Path2D(d));
  for (const d of ic.s) g.stroke(new Path2D(d));
  g.restore();
}
