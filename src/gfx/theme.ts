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
  dim: '#939fb6',
  // 再抬一档：这一层承担图例、卡牌底注、脚注、面板提示，全都是要读的字，
  // 不是装饰。原来的 #59647c 在面板色上只有 3.1:1；#717e98 约 4.4:1，
  // 仍卡在 AA 的 4.5:1 之下。再抬一档过线，和 dim 的层级差依然在。
  // 这是全局对比度，不是调字号 —— 局部放字会把固定版式撑乱。
  faint: '#7e8ca6',

  gold: '#e8b64c',
  goldDim: '#8a6b2c',
  red: '#e0574f',
  redDim: '#7a2f2b',
  green: '#3ddc97',
  blue: '#5aa9f5',
  purple: '#a78bfa',
  cyan: '#4fd6cf',
  orange: '#e08a4a',

  // 卡面数值专用：类别色提亮一档。
  // 牌面底色是从类别色浸下来的，橙色数字叠在橙色卡面上几乎融进背景 ——
  // 数字比正文大了 3px 却读不出来，等于白放大。数值要压得住自己那张卡。
  numDmg: '#ffc684',
  numBlk: '#a6dcff',
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
