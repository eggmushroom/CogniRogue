import { g } from './canvas';
import { C, withAlpha } from './theme';

/**
 * 脚下光与护盾光，双方共用一套。
 *
 * 立绘是「纯黑底 + 发光主体」，screen 混合上去之后人物没有接地：脚下一片虚空，
 * 敌人叠了格挡也只剩状态牌里一个数字。这一层补两件事：
 *
 *   1. `groundGlow` —— 脚下一滩有层次的光：外散光 / 光池 / 接地点 + 地面细环 + 浮尘。
 *      旧版是一层扁掉的径向渐变，边缘糊成一团，读不出"光照在砖面上"。
 *   2. `shieldDome` + `shieldSeal` —— 护盾的"罩"和地面封环，玩家和敌人同款：
 *      罩在立绘之前画（光从脚下升起来），封环在立绘之后画（压在脚前面）。
 *
 * 语言仍然跟全局一致：最亮的地方只有 1–2px，靠层次而不是靠荧光堆亮度。
 */

const TAU = Math.PI * 2;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

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

/** 护盾的「地面封环」：画在立绘之后，压在脚前面。 */
export function shieldSeal(o: { x: number; y: number; rx: number; ry: number; t: number; power: number }) {
  const a = clamp01(o.power);
  if (a <= 0.01) return;
  const { x, y, rx, ry, t } = o;
  const p = 0.5 + 0.5 * Math.sin(t * 2.2);

  g.save();
  g.globalCompositeOperation = 'lighter';

  // 罩的前景一层：极淡，只为了让护罩"盖到身上"，而不是只在地上画一个圈。
  // 立绘本身是亮的，罩画在它后面会被洗掉，所以这一层必须压在立绘之后。
  g.save();
  g.translate(x, y - 40);
  g.scale(1, 2.4);
  const hz = g.createRadialGradient(0, 0, rx * 0.06, 0, 0, rx * 0.96);
  hz.addColorStop(0, withAlpha(C.blue, 0.085 * a));
  hz.addColorStop(0.55, withAlpha(C.blue, 0.034 * a));
  hz.addColorStop(1, withAlpha(C.blue, 0));
  g.fillStyle = hz;
  g.beginPath();
  g.arc(0, 0, rx * 0.96, 0, TAU);
  g.fill();
  g.restore();

  // 内圈：实线。护盾要有"厚度"，一圈虚线只会读成提示框。
  g.strokeStyle = withAlpha(C.blue, (0.34 + 0.12 * p) * a);
  g.lineWidth = 1;
  g.beginPath();
  g.ellipse(x, y, rx * 0.74, ry * 0.74, 0, 0, TAU);
  g.stroke();

  // 外圈：细虚线沿地面慢慢转 —— 转的是地上的封环，不是套在身上的大圈。
  g.setLineDash([7, 11]);
  g.lineDashOffset = -t * 11;
  g.strokeStyle = withAlpha(C.blue, 0.3 * a);
  g.beginPath();
  g.ellipse(x, y, rx, ry, 0, 0, TAU);
  g.stroke();
  g.setLineDash([]);

  // 扫光：一段带尾巴的亮弧绕圈，是"封环在运转"唯一的证据。
  const sweeps = 6;
  for (let i = 0; i < sweeps; i++) {
    const a0 = t * 0.8 - i * 0.1;
    g.strokeStyle = withAlpha(C.blue, 0.5 * a * (1 - i / sweeps));
    g.lineWidth = i === 0 ? 1.8 : 1.1;
    g.beginPath();
    g.ellipse(x, y, rx, ry, 0, a0 - 0.1, a0);
    g.stroke();
  }

  // 四个铆点：沿椭圆法线方向伸出的短线，像封条上的钉
  for (let i = 0; i < 4; i++) {
    const ang = Math.PI / 4 + (i * Math.PI) / 2;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const nx = ca / rx;
    const ny = sa / ry;
    const L = Math.hypot(nx, ny) || 1;
    const px = x + ca * rx * 0.87;
    const py = y + sa * ry * 0.87;
    g.strokeStyle = withAlpha(C.blue, 0.42 * a);
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(px - (nx / L) * 5, py - (ny / L) * 5);
    g.lineTo(px + (nx / L) * 5, py + (ny / L) * 5);
    g.stroke();
  }

  // 光栅：从封环上升起来的几道短线，把"罩"的边界勾出来。
  // 只画到一半高度就淡掉，绝不连成整圈 —— 连起来就又变成套在身上的箍了。
  const fence = 10;
  for (let i = 0; i < fence; i++) {
    const ang = (i / fence) * TAU + 0.31;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const px = x + ca * rx * 0.99;
    const py = y + sa * ry * 0.99;
    const h = 26;
    const al = (0.16 + 0.1 * (0.5 + 0.5 * Math.sin(t * 1.7 + i * 1.3))) * a;
    g.strokeStyle = withAlpha(C.blue, al);
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(px, py);
    g.lineTo(px, py - h * 0.55);
    g.stroke();
    g.strokeStyle = withAlpha(C.blue, al * 0.4);
    g.beginPath();
    g.moveTo(px, py - h * 0.55);
    g.lineTo(px, py - h);
    g.stroke();
  }

  // 光屑：从封环上升起来的蓝点，越往上越淡 —— 护罩正在"充能"
  for (let i = 0; i < 6; i++) {
    const seed = (i * 0.371) % 1;
    const ang = seed * TAU;
    const u = (t * (0.2 + (i % 3) * 0.04) + seed) % 1;
    const al = Math.sin(Math.PI * u) * 0.55 * a;
    if (al <= 0.02) continue;
    const px = x + Math.cos(ang) * rx * (0.82 - u * 0.14);
    const py = y + Math.sin(ang) * ry * (0.82 - u * 0.14) - u * 54;
    g.fillStyle = withAlpha(C.blue, al);
    g.beginPath();
    g.arc(px, py, 1.1 + (i % 2) * 0.6, 0, TAU);
    g.fill();
  }

  g.restore();
}
