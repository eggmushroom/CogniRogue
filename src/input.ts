import { resize } from './gfx/canvas';

interface Hot {
  x: number; y: number; w: number; h: number;
  fn: () => void;
  /** 只给自动化测试认按钮用，运行时不参与任何判断。 */
  label?: string;
}

export const pointer = {
  x: -9999,
  y: -9999,
  down: false,
  /** 滚轮增量，绘制时消费掉 */
  wheel: 0,
};

let last: Hot[] = [];
let building: Hot[] = [];
/**
 * 按下时记住的是这一帧的矩形，但帧与帧之间矩形会被重新创建（动画、布局都会动），
 * 所以抬起来时不能用对象引用判断"还是不是同一个按钮"，只能比几何。
 * 早期版本用 `h === downHot`，在真实浏览器里几乎每次点击都被判成"移出了按钮"。
 */
let downRect: { x: number; y: number; w: number; h: number } | null = null;

/**
 * 演出期间锁住点击。打击动画还没演完时反馈面板没弹出来，
 * 但底下的手牌、牌堆、结束回合仍然画在屏幕上 —— 不锁的话玩家能点到"还没轮到他"的东西。
 */
let locked = false;
export function setInputLock(v: boolean) {
  locked = v;
  if (v) downRect = null;
}

const inside = (r: { x: number; y: number; w: number; h: number }, x: number, y: number) =>
  x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

/** 同一个按钮的两帧矩形：位置允许小幅动画漂移，尺寸基本不变。 */
function sameBox(a: { x: number; y: number; w: number; h: number }, b: typeof a) {
  return Math.abs(a.w - b.w) < 8 && Math.abs(a.h - b.h) < 8
    && Math.abs(a.x - b.x) < 24 && Math.abs(a.y - b.y) < 24;
}

function hit(x: number, y: number): Hot | null {
  for (let i = last.length - 1; i >= 0; i--) {
    const h = last[i];
    if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return h;
  }
  return null;
}

/** 当帧光标是否落在这个矩形里。位置实时算，所以没有延迟。 */
export const hover = (x: number, y: number, w: number, h: number) =>
  pointer.x >= x && pointer.x <= x + w && pointer.y >= y && pointer.y <= y + h;

export function onClick(
  x: number, y: number, w: number, h: number, fn: () => void, label?: string,
) {
  building.push({ x, y, w, h, fn, label });
}

/** 当前帧所有可点区域（逻辑坐标）。冒烟测试用它按名字找按钮。 */
export const hotRects = () => last.map((h) => ({
  x: h.x, y: h.y, w: h.w, h: h.h, label: h.label ?? '',
}));

export function beginInput() {
  building = [];
}

export function endInput() {
  last = building;
  document.body.style.cursor = hit(pointer.x, pointer.y) ? 'pointer' : 'default';
}

export function consumeWheel() {
  const w = pointer.wheel;
  pointer.wheel = 0;
  return w;
}

export function bindInput(el: HTMLCanvasElement, toLogic: (cx: number, cy: number) => { x: number; y: number }) {
  const set = (e: PointerEvent) => {
    const p = toLogic(e.clientX, e.clientY);
    pointer.x = p.x;
    pointer.y = p.y;
  };

  el.addEventListener('pointermove', set);

  el.addEventListener('pointerdown', (e) => {
    set(e);
    pointer.down = true;
    if (locked) { downRect = null; return; }
    const h = hit(pointer.x, pointer.y);
    downRect = h ? { x: h.x, y: h.y, w: h.w, h: h.h } : null;
    // 合成事件（自动化测试、部分触屏）可能没有合法的 pointerId，捕获失败不该打断点击
    try { el.setPointerCapture(e.pointerId); } catch { /* 忽略 */ }
  });

  el.addEventListener('pointerup', (e) => {
    set(e);
    pointer.down = false;
    if (locked) { downRect = null; return; }
    const h = hit(pointer.x, pointer.y);
    // 按下的和抬起的是同一个按钮 → 才算一次点击；顺带用当前帧的回调，避免闭包读到过期状态
    if (h && downRect && inside(downRect, pointer.x, pointer.y) && sameBox(h, downRect)) h.fn();
    downRect = null;
  });

  el.addEventListener('pointerleave', () => {
    pointer.x = -9999;
    pointer.y = -9999;
    pointer.down = false;
    downRect = null;
  });

  el.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      pointer.wheel += e.deltaY;
    },
    { passive: false },
  );

  window.addEventListener('resize', () => resize());
}

export function keyHandler(fn: (k: string) => void) {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') fn('escape');
    else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); fn('confirm'); }
    else if (/^[1-9]$/.test(e.key)) fn(e.key);
  });
}
