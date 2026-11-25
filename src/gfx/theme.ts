/** 一套颜色和字体，所有绘制都从这里取，改主题只改这一处。 */
export const C = {
  void: '#0c0e0d',
  bg: '#141614',
  panel: '#20231f',
  panelHi: '#2b3029',
  line: '#474c40',
  lineHi: '#777c68',

  ink: '#f6ebd2',
  ink2: '#e0d4bb',
  dim: '#c1b59e',
  faint: '#a99e88',

  gold: '#dfbc7f',
  goldDim: '#a48756',
  red: '#e58d79',
  redDim: '#c77d70',
  green: '#a2bf92',
  blue: '#91bbca',
  purple: '#c2a5bd',
  cyan: '#98c5b4',
  orange: '#e6a979',

  // 卡面数值专用：类别色提亮一档。
  // 牌面底色是从类别色浸下来的，橙色数字叠在橙色卡面上几乎融进背景：
  // 数字比正文大了 3px 却读不出来，等于白放大。数值要压得住自己那张卡。
  numDmg: '#ffc684',
  numBlk: '#a6dcff',

  // 血量条专用：旧纸 / 铜 / 朱砂 / 灰紫，都是降过饱和的档案色。
  // 原先直接拿 green / gold / red 填胶囊，荧光色在深蓝黑底上比立绘还亮：
  // HUD 抢了画面，也和「细金线 + 衬线字」的全局语言对不上。
  hpCalm: '#d7bd8b',
  hpWarn: '#c68a52',
  hpDanger: '#b95048',
  hpFoe: '#ab5049',
  hpBoss: '#9b7088',
} as const;

/** 版画立绘按墨、暗面、承光面、材料边缘排色；小面积印记用独立的朱砂或铜色。 */
export const PRINT = {
  ink: '#15181a', black: '#242627', parchment: '#f1d8a1', brass: '#d1a266',
  stamp: '#9d443f', cord: '#ed866a', ward: '#a9d8d5', wardDark: '#345b62',
  jade: ['#233e43', '#386168', '#578782', '#a4b2a0', '#e1b773'],
  paper: ['#3c3636', '#66504c', '#aa806e', '#ead4a6', '#dc7960'],
  bronze: ['#373234', '#624542', '#a16a51', '#d5a675', '#eb9c60'],
  sage: ['#293d3a', '#3d5350', '#768573', '#c2bd92', '#d9b479'],
  plum: ['#3c3243', '#634855', '#986a7d', '#d1a3a0', '#e2aa80'],
  steel: ['#2c3642', '#474f63', '#758194', '#b8c1bd', '#e0b078'],
} as const;

/** 界面印色比立绘更平，给密集规则文字留足对比度。 */
export const PRESS = {
  sheet: '#191d19',
  card: '#242923',
  vermilion: '#804536',
  vermilionHi: '#9a5141',
  cut: '#d1af77',
  groove: '#131613',
  stock: '#c8ae7c',
} as const;

/**
 * 全屏遮罩的**氛围**不透明度。它只负责让书架纹理退到面板后面，不负责挡字——`scenes/layers.ts`
 * 在只留背景的面板下根本不画世界层，所以底层没有文字可透出来。
 * 答题 / 判定面板走 `dimQuestion()` 的渐变，刻意让右侧战场可见。
 */
export const SCRIM = 0.34;

export const FONT_UI =
  '"Noto Sans SC","PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif';
export const FONT_TITLE =
  '"Noto Serif SC","Songti SC","Source Han Serif SC","SimSun",Georgia,serif';
export const FONT_NUM = '"SF Mono",ui-monospace,"Cascadia Mono",Consolas,monospace';

export const font = (size: number, weight = 400, family = FONT_UI) =>
  `${weight} ${size}px ${family}`;

/** 主题色：同一主题在牌、结算里颜色一致，形成视觉记忆。 */
const TOPIC_COLORS = [C.blue, C.green, C.gold, C.purple, '#da9cab', C.cyan, C.orange];

export function topicColor(topic: string): string {
  let h = 0;
  for (let i = 0; i < topic.length; i++) h = (h * 31 + topic.charCodeAt(i)) >>> 0;
  return TOPIC_COLORS[h % TOPIC_COLORS.length];
}

export function withAlpha(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
