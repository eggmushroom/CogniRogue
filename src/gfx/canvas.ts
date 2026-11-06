/**
 * 逻辑分辨率固定 1600×900，按窗口等比 contain 缩放。
 * 所有场景代码里写死坐标，不用管真实像素 —— 这是让"布局稳定"最省事的办法。
 */
export const VW = 1600;
export const VH = 900;

type Ctx = CanvasRenderingContext2D;

export let g: Ctx;
let el: HTMLCanvasElement;
let scale = 1;
let ox = 0;
let oy = 0;
let dpr = 1;

export function initCanvas(canvas: HTMLCanvasElement) {
  el = canvas;
  const c = canvas.getContext('2d', { alpha: false });
  if (!c) throw new Error('浏览器不支持 canvas 2d');
  g = c;
  resize();
  window.addEventListener('resize', resize);
}

export function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth;
  const h = window.innerHeight;
  el.width = Math.max(1, Math.floor(w * dpr));
  el.height = Math.max(1, Math.floor(h * dpr));
  el.style.width = w + 'px';
  el.style.height = h + 'px';
  scale = Math.min(w / VW, h / VH);
  ox = (w - VW * scale) / 2;
  oy = (h - VH * scale) / 2;
}

export function beginFrame() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = '#04050a';
  g.fillRect(0, 0, w, h);
  g.translate(ox, oy);
  g.scale(scale, scale);
  g.textBaseline = 'middle';
}

/** 屏幕像素 → 逻辑坐标。 */
export function toLogic(clientX: number, clientY: number) {
  const r = el.getBoundingClientRect();
  return { x: (clientX - r.left - ox) / scale, y: (clientY - r.top - oy) / scale };
}

/** 逻辑坐标 → 屏幕像素（toLogic 的逆运算）。 */
export function toScreen(lx: number, ly: number) {
  const r = el.getBoundingClientRect();
  return { x: r.left + ox + lx * scale, y: r.top + oy + ly * scale };
}

/* ── 绘制原语 ─────────────────────────────────────────────── */

export function roundRect(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}

/** 不允许出现在行首的标点：让它们悬挂在上一行末尾，避免出现孤零零一个「？」。 */
const HANG = /^[，。、；：！？）」』】…—～%]$/;

/** 中文按字断行、英文按词断行；够用，且没有依赖。 */
export function wrapText(text: string, maxW: number): string[] {
  const tokens = text.match(/[A-Za-z0-9@#%&+\-*/=<>_.'"()]+|\s+|[\s\S]/gu) ?? [];
  const lines: string[] = [];
  let line = '';
  for (const tk of tokens) {
    const test = line + tk;
    if (g.measureText(test).width > maxW && line.trim()) {
      if (HANG.test(tk)) {
        line = test; // 标点跟着上一行走，超一点点比孤字成行好看
        continue;
      }
      lines.push(line.trimEnd());
      line = tk.trimStart();
    } else {
      line = test;
    }
  }
  if (line.trim()) lines.push(line.trimEnd());
  return lines;
}
