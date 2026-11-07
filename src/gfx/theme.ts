/** 一套颜色和字体，所有绘制都从这里取，改主题只改这一处。 */
export const C = {
  void: '#05060a',
  bg: '#0a0c12',
  panel: '#12151f',
  panelHi: '#1b2030',
  line: '#2c3346',
  lineHi: '#485272',

  ink: '#eef2fb',
  ink2: '#c1cadc',
  // 暗背景上的次级文字原来压得太灰，长句读起来费眼；整体抬一档，
  // 但仍和 ink / ink2 拉开层级，不乱主次。
  dim: '#8794ad',
  faint: '#59647c',

  gold: '#e8b64c',
  goldDim: '#8a6b2c',
  red: '#e0574f',
  redDim: '#7a2f2b',
  green: '#3ddc97',
  blue: '#5aa9f5',
  purple: '#a78bfa',
  cyan: '#4fd6cf',
  orange: '#e08a4a',
} as const;

export const FONT_UI =
  '"Noto Sans SC","PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif';
export const FONT_TITLE =
  '"Noto Serif SC","Songti SC","Source Han Serif SC",serif';
export const FONT_NUM = '"SF Mono",ui-monospace,"Cascadia Mono",Consolas,monospace';

export const font = (size: number, weight = 400, family = FONT_UI) =>
  `${weight} ${size}px ${family}`;

/** 主题色：同一主题在牌、日志、结算里颜色一致，形成视觉记忆。 */
const TOPIC_COLORS = ['#5aa9f5', '#3ddc97', '#e8b64c', '#a78bfa', '#ef8bb0', '#4fd6cf', '#e08a4a'];

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
