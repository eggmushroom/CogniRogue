import { g, VH, VW } from './canvas';
import { ART } from './assets';
import { C, PRESS, withAlpha } from './theme';

let print: HTMLCanvasElement | undefined;

function archivePrint() {
  if (print) return print;
  const img = ART.arena;
  if (!img.complete || !img.naturalWidth) return;
  const surface = document.createElement('canvas');
  const w = surface.width = VW / 2;
  const h = surface.height = VH / 2;
  const ctx = surface.getContext('2d');
  if (!ctx) return;
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const iw = img.naturalWidth * scale;
  const ih = img.naturalHeight * scale;
  ctx.drawImage(img, (w - iw) / 2, (h - ih) / 2, iw, ih);

  // 亮部保留纸色与稀疏刀纹，暗部并作墨块；只在资源载入后处理一次。
  const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const ink = rgb(C.void);
  const paper = rgb(PRESS.stock);
  const image = ctx.getImageData(0, 0, w, h);
  const data = image.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const light = (data[i] * 2 + data[i + 1] * 5 + data[i + 2]) / 8;
      const hatch = (x + Math.floor(y / 2)) % 5 === 0 ? 12 : 0;
      const shade = Math.max(0, Math.min(9, Math.floor((light - hatch) / 18))) / 9;
      for (let c = 0; c < 3; c++) data[i + c] = ink[c] + (paper[c] - ink[c]) * shade;
    }
  }
  ctx.putImageData(image, 0, 0);
  return (print = surface);
}

export function drawBackdrop(dim = 0.5) {
  const surface = archivePrint();
  if (surface) g.drawImage(surface, 0, 0, VW, VH);
  else {
    g.fillStyle = C.void;
    g.fillRect(0, 0, VW, VH);
  }

  // 压暗：中部只吃 dim 的七成，让砖缝和柱子能被看见；底部压重，手牌才压得住。
  const lg = g.createLinearGradient(0, 0, 0, VH);
  lg.addColorStop(0, withAlpha(C.void, Math.min(0.92, dim + 0.06)));
  lg.addColorStop(0.42, withAlpha(C.void, dim * 0.76));
  lg.addColorStop(1, withAlpha(C.void, Math.min(0.94, dim + 0.26)));
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
 * 只用小点，避免背景尘埃和战斗效果争注意力。
 */
const motes = Array.from({ length: 62 }, (_, i) => ({
  x: Math.random() * VW,
  y: Math.random() * VH,
  r: i % 9 === 0 ? 1.9 + Math.random() * 1.3 : 0.7 + Math.random() * 1.5,
  sp: 6 + Math.random() * 16,
  ph: Math.random() * Math.PI * 2,
  a: 0.07 + Math.random() * 0.17,
}));

export function drawMotes(t: number) {
  g.save();
  for (const m of motes) {
    const y = ((m.y - t * m.sp) % VH + VH) % VH;
    const x = m.x + Math.sin(t * 0.5 + m.ph) * 18;
    const a = m.a * (0.55 + 0.45 * Math.sin(t * 1.4 + m.ph));
    g.fillStyle = C.gold;
    g.globalAlpha = a;
    g.beginPath();
    g.arc(x, y, m.r, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}
