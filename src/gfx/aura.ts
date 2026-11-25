import { g } from './canvas';
import { C, withAlpha } from './theme';
import { clamp01 } from './geom';

/**
 * 脚下光与护盾光，双方共用一套。
 *
 * 立绘是「纯黑底 + 发光主体」，screen 混合上去之后人物没有接地：脚下一片虚空，
 * 敌人叠了格挡也只剩状态牌里一个数字。这一层补两件事：
 *
 *   1. `groundGlow` —— 脚下一滩有层次的光：外散光 / 光池 / 接地点 + 地面细环 + 浮尘。
 *      旧版是一层扁掉的径向渐变，边缘糊成一团，读不出"光照在砖面上"。
 *   2. `shieldDome` —— 双方共用的护盾光，垫在立绘后面，不盖住人物轮廓。
 *
 * 语言仍然跟全局一致：最亮的地方只有 1–2px，靠层次而不是靠荧光堆亮度。
 */

const TAU = Math.PI * 2;

export interface GroundOpts {
  x: number;
  y: number;
  /** 光池横半径；纵向默认按 0.26 压扁，看起来才像躺在地上 */
  rx: number;
  ry?: number;
  color: string;
  t: number;
  /** 0..1 基础亮度 */
  power?: number;
  /** 呼吸速度（弧度/秒） */
  breathe?: number;
  /** 呼吸相位：两边的光不要同时亮，否则像在同步闪 */
  phase?: number;
  /** 一次性提亮：受击 / 刚获得格挡 */
  boost?: number;
  /** 浮尘数量 */
  motes?: number;
}

/** 一滩光。几瓣错开的光斑 + 一圈断续亮缝 + 几粒浮尘。 */
export function groundGlow(o: GroundOpts) {
  const rx = o.rx;
  const ry = o.ry ?? rx * 0.26;
  const { x, y, color, t } = o;
  const k = 0.86 + 0.14 * Math.sin(t * (o.breathe ?? 0.9) + (o.phase ?? 0));
  const a = Math.max(0, (o.power ?? 1) * k + (o.boost ?? 0) * 0.55);
  if (a <= 0.01) return;

  // 全部画在同一套"压扁"的坐标里：半径才是砖面上的椭圆，不是圆。
  g.save();
  g.translate(x, y);
  g.scale(1, ry / rx);

  const blob = (cx: number, cy: number, r: number, al: number) => {
    const gr = g.createRadialGradient(cx, cy, r * 0.04, cx, cy, r);
    gr.addColorStop(0, withAlpha(color, al));
    gr.addColorStop(0.55, withAlpha(color, al * 0.42));
    gr.addColorStop(1, withAlpha(color, 0));
    g.fillStyle = gr;
    g.beginPath();
    g.arc(cx, cy, r, 0, TAU);
    g.fill();
  };

  // 外散光：大而淡，负责让光溢到砖面上
  blob(0, -rx * 0.1, rx * 2.05, 0.1 * a);
  // 三瓣错开的光池：一个正圆只会读成一个玻璃盘，错开才有"地面高低不平"的感觉
  blob(-rx * 0.3, rx * 0.04, rx * 0.72, 0.17 * a);
  blob(rx * 0.26, -rx * 0.03, rx * 0.66, 0.15 * a);
  blob(rx * 0.02, rx * 0.09, rx * 0.58, 0.13 * a);
  // 接地点：真正踩住地面的那一小块，比光池亮一档 —— 人物才"站得住"
  blob(0, rx * 0.02, rx * 0.34, 0.3 * a);
  g.restore();

  // 地面亮缝：不画整圈椭圆。整圈会变成"站在一个盘子上"，
  // 断续的几段才像砖缝被光照到的样子。
  g.save();
  g.lineWidth = 1;
  const seams: [number, number, number][] = [
    [0.06, 0.34, 0.2], [0.4, 0.47, 0.09], [0.56, 0.74, 0.15],
    [0.8, 0.9, 0.08], [1.04, 1.26, 0.13], [1.34, 1.44, 0.06],
  ];
  for (const [a0, a1, al] of seams) {
    g.strokeStyle = withAlpha(color, al * a);
    g.beginPath();
    g.ellipse(x, y, rx * 0.94, ry * 0.94, 0, a0 * Math.PI, a1 * Math.PI);
    g.stroke();
  }
  g.restore();

  // 浮尘：从光里慢慢升起来。纯函数，没有粒子状态，也不占粒子池。
  const n = o.motes ?? 7;
  g.save();
  for (let i = 0; i < n; i++) {
    const seed = (i * 0.618034) % 1;
    const ang = seed * TAU * 3.1;
    const rf = 0.22 + ((i * 0.37) % 0.7);
    const u = (t * (0.13 + (i % 4) * 0.022) + seed) % 1;
    const al = Math.sin(Math.PI * u) * 0.5 * a;
    if (al <= 0.015) continue;
    const px = x + Math.cos(ang) * rx * rf;
    const py = y + Math.sin(ang) * ry * rf - u * 48;
    g.fillStyle = withAlpha(color, al);
    g.beginPath();
    g.arc(px, py, 1 + (i % 3) * 0.5, 0, TAU);
    g.fill();
  }
  g.restore();
}

/** 护盾的「罩」：必须画在立绘之前，光是从脚下升上去的。 */
export function shieldDome(o: { x: number; y: number; rx: number; ry: number; t: number; power: number }) {
  const a = clamp01(o.power) * (0.8 + 0.2 * Math.sin(o.t * 1.3));
  if (a <= 0.01) return;
  // 竖长的径向渐变：横向和纵向同时在衰减，才不会留下一道裁剪出来的硬边
  // （旧写法是"椭圆裁剪 + 竖向线性渐变"，两侧边缘是一条笔直的亮边，像个锥形罩子）。
  const ry = o.ry + 168;

  g.save();
  g.globalCompositeOperation = 'screen';
  g.translate(o.x, o.y);
  g.scale(1, ry / o.rx);
  const gr = g.createRadialGradient(0, -o.rx * 0.34, o.rx * 0.05, 0, 0, o.rx * 1.02);
  gr.addColorStop(0, withAlpha(C.blue, 0.26 * a));
  gr.addColorStop(0.34, withAlpha(C.blue, 0.13 * a));
  gr.addColorStop(0.7, withAlpha(C.blue, 0.045 * a));
  gr.addColorStop(1, withAlpha(C.blue, 0));
  g.fillStyle = gr;
  g.beginPath();
  g.arc(0, 0, o.rx * 1.02, 0, TAU);
  g.fill();
  g.restore();
}
