import { g, VH, VW } from './canvas';
import { ART } from './assets';
import { C } from './theme';

/** 背景图铺满 + 压暗 + 暗角。所有场景共用一套底，视觉才是一台机器。 */
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
    g.globalAlpha = 0.85;
    g.drawImage(img, px + Math.sin(t * 0.09) * 12, py + Math.cos(t * 0.07) * 8, w, h);
    g.restore();
  }

  // 压暗：让前景的牌和数字先跳出来
  const lg = g.createLinearGradient(0, 0, 0, VH);
  lg.addColorStop(0, `rgba(5,6,10,${dim + 0.14})`);
  lg.addColorStop(0.45, `rgba(5,6,10,${dim})`);
  lg.addColorStop(1, `rgba(5,6,10,${Math.min(0.96, dim + 0.3)})`);
  g.fillStyle = lg;
  g.fillRect(0, 0, VW, VH);

  // 暗角
  const rg = g.createRadialGradient(VW / 2, VH * 0.45, VH * 0.25, VW / 2, VH * 0.45, VW * 0.72);
  rg.addColorStop(0, 'rgba(0,0,0,0)');
  rg.addColorStop(1, 'rgba(0,0,0,.78)');
  g.fillStyle = rg;
  g.fillRect(0, 0, VW, VH);
}

/** 漂浮的尘埃：便宜，但"这个场景是活的"。 */
const motes = Array.from({ length: 46 }, () => ({
  x: Math.random() * VW,
  y: Math.random() * VH,
  r: 0.7 + Math.random() * 1.8,
  sp: 6 + Math.random() * 16,
  ph: Math.random() * Math.PI * 2,
  a: 0.06 + Math.random() * 0.16,
}));

export function drawMotes(t: number) {
  g.save();
  for (const m of motes) {
    const y = ((m.y - t * m.sp) % VH + VH) % VH;
    const x = m.x + Math.sin(t * 0.5 + m.ph) * 18;
    g.globalAlpha = m.a * (0.55 + 0.45 * Math.sin(t * 1.4 + m.ph));
    g.fillStyle = '#cfe0ff';
    g.beginPath();
    g.arc(x, y, m.r, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}
