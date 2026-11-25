import { g, roundRect, VH, VW } from '../../gfx/canvas';
import { C, FONT_TITLE, withAlpha } from '../../gfx/theme';
import { panel, text } from '../../gfx/ui';
import { consumeWheel, hover, onDrag } from '../../input';
import { clamp } from '../../core/infra';
import { drawExitControl, type ExitAction } from '../exit-control';
import { panelExit } from '../navigation';

/** Top-level menu panels share one frame so switching between them does not shift the UI. */
export const MENU_W = 1104;
export const MENU_H = 736;
export const MENU_X = (VW - MENU_W) / 2;
export const MENU_Y = (VH - MENU_H) / 2;
export const MENU_PAD = 40;
export const MENU_RADIUS = 10;
export const MENU_ROW_RADIUS = 10;
export const MENU_GAP = 10;
export const MENU_BUTTON_H = 44;

export function box(
  x: number, y: number, w: number, h: number,
  accent: string = C.goldDim, exit: ExitAction | null = panelExit(), radius = 3,
) {
  panel(x + 5, y + 7, w, h, { radius, stroke: 'none', fill: withAlpha(C.void, 0.84) });
  panel(x, y, w, h, { radius, stroke: C.lineHi, accent });

  drawExitControl(x, y, w, exit, radius);
}

export function heading(s: string, x: number, y: number, sub?: string) {
  text(s, x, y, { size: 30, weight: 600, family: FONT_TITLE, color: C.ink });
  if (sub) text(sub, x, y + 32, { size: 14, color: C.dim });
}

const scrolls = new Map<string, number>();
export const resetScroll = (key: string) => scrolls.delete(key);
export function scrollArea(
  x: number, y: number, w: number, h: number, contentH: number,
  key = '', wheel?: number, anchorDelta = 0,
) {
  const max = Math.max(0, contentH - h);
  const delta = wheel ?? consumeWheel();
  const cur = clamp((scrolls.get(key) ?? 0) + anchorDelta + (hover(x, y, w + 16, h) ? delta * 0.7 : 0), 0, max);
  scrolls.set(key, cur);
  g.save();
  roundRect(x, y, w, h, 10);
  g.clip();
  return { x, y: y - cur, restore: () => g.restore(), y0: y, h, max, cur, key };
}

export function overflowAffordance(a: ReturnType<typeof scrollArea>, x: number, w: number, interactive = true) {
  if (a.max <= 0) return;
  if (a.cur < a.max - 1) {
    const fadeH = 24;
    const fd = g.createLinearGradient(0, a.y0 + a.h - fadeH, 0, a.y0 + a.h);
    fd.addColorStop(0, withAlpha(C.panel, 0));
    fd.addColorStop(1, C.panel);
    g.fillStyle = fd;
    g.fillRect(x, a.y0 + a.h - fadeH, w, fadeH);
  }

  const tx = x + w + 6;
  const trackH = a.h - 12;
  if (trackH <= 1) return;
  roundRect(tx, a.y0 + 6, 4, trackH, 2);
  g.fillStyle = 'rgba(255,255,255,.06)';
  g.fill();
  const thumbH = Math.min(trackH - 1, Math.max(32, trackH * (a.h / (a.h + a.max))));
  const travel = trackH - thumbH;
  const ty = a.y0 + 6 + travel * (a.cur / a.max);
  const lit = interactive && hover(tx - 4, ty, 12, thumbH);
  roundRect(tx, ty, 4, thumbH, 2);
  g.fillStyle = lit ? C.gold : withAlpha(C.lineHi, 0.9);
  g.fill();
  if (interactive) onDrag(tx - 4, ty, 12, thumbH, (dy) => {
    scrolls.set(a.key, clamp(a.cur + dy * a.max / travel, 0, a.max));
  }, `scroll:${a.key}`);
}
