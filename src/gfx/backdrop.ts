import { g, VH, VW } from './canvas';
import { ART } from './assets';
import { C } from './theme';

/**
 * 背景图铺满 + 压暗 + 暗角。所有场景共用一套底，视觉才是一台机器。
 *
 * 压暗不是"盖一层黑布"：中间留一口气让档案馆的柱廊透出来，上下压重一点
 * 当作取景框。背景太黑时前景的牌会像浮在虚空里，整台机器就没有空间感了。
 */
export function drawBackdrop(t: number, dim = 0.5) {
  g.fillStyle = C.void;
  g.fillRect(0, 0, VW, VH);

  const img = ART.arena;
  if (img.complete && img.naturalWidth) {
    const ir = img.naturalWidth / img.naturalHeight;
    const vr = VW / VH;
    let w = VW;
    let h = VH;
    if (ir > vr) { h = VH; w = h * ir; } else { w = VW; h = w / ir; }
    const px = (VW - w) / 2;
    const py = (VH - h) / 2;

    g.save();
    g.globalCompositeOperation = 'screen';
    g.globalAlpha = 0.94;
    g.drawImage(img, px + Math.sin(t * 0.09) * 12, py + Math.cos(t * 0.07) * 8, w, h);
    g.restore();
  }

  // 顶部一盏长明灯：纯冷色的柱廊里掺一点暖光，画面才有"有人提着灯走过"的温度。
  // 它落在压暗之前，所以不会盖住任何前景文字。
  const lamp = g.createRadialGradient(VW * 0.5, -VH * 0.14, 20, VW * 0.5, -VH * 0.14, VH * 1.2);
  lamp.addColorStop(0, 'rgba(232,182,76,.13)');
  lamp.addColorStop(0.5, 'rgba(232,182,76,.04)');
  lamp.addColorStop(1, 'rgba(232,182,76,0)');
  g.fillStyle = lamp;
  g.fillRect(0, 0, VW, VH);

  // 压暗：中部只吃 dim 的七成，让砖缝和柱子能被看见；底部压重，手牌才压得住。
  const lg = g.createLinearGradient(0, 0, 0, VH);
  lg.addColorStop(0, `rgba(5,6,10,${Math.min(0.92, dim + 0.06)})`);
  lg.addColorStop(0.42, `rgba(5,6,10,${dim * 0.76})`);
  lg.addColorStop(1, `rgba(5,6,10,${Math.min(0.94, dim + 0.26)})`);
  g.fillStyle = lg;
  g.fillRect(0, 0, VW, VH);

  // 暗角：只收边，不把中央一起吃掉
  const rg = g.createRadialGradient(VW / 2, VH * 0.44, VH * 0.34, VW / 2, VH * 0.44, VW * 0.8);
  rg.addColorStop(0, 'rgba(0,0,0,0)');
  rg.addColorStop(1, 'rgba(0,0,0,.6)');
  g.fillStyle = rg;
  g.fillRect(0, 0, VW, VH);
}

/**
 * 漂浮的尘埃：便宜，但"这个场景是活的"。
 * 分两档 —— 细屑是冷白的，偶尔几粒大的是暖色光尘，带一层淡晕。
 * 暖冷混着，才不会像一层均匀的噪点。
 */
const motes = Array.from({ length: 62 }, (_, i) => ({
  x: Math.random() * VW,
  y: Math.random() * VH,
  big: i % 9 === 0,
  r: i % 9 === 0 ? 1.9 + Math.random() * 1.3 : 0.7 + Math.random() * 1.5,
  sp: 6 + Math.random() * 16,
  ph: Math.random() * Math.PI * 2,
  a: 0.07 + Math.random() * 0.17,
  warm: i % 5 === 0,
}));

export function drawMotes(t: number) {
  g.save();
  for (const m of motes) {
    const y = ((m.y - t * m.sp) % VH + VH) % VH;
    const x = m.x + Math.sin(t * 0.5 + m.ph) * 18;
    const a = m.a * (0.55 + 0.45 * Math.sin(t * 1.4 + m.ph));
    g.fillStyle = m.warm ? '#f2d9a0' : '#cfe0ff';
    if (m.big) {
      g.globalAlpha = a * 0.24;
      g.beginPath();
      g.arc(x, y, m.r * 2.6, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = a;
    g.beginPath();
    g.arc(x, y, m.r, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}
