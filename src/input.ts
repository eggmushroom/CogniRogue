interface Hot {
  x: number; y: number; w: number; h: number;
  fn: () => void;
  drag?: (dy: number) => void;
  /** 只给自动化测试认按钮用，运行时不参与任何判断。 */
  label?: string;
  /**
   * 在同一个列表里的位置（手牌下标）。列表里少注册一项（比如还在飞的牌没有热区），
   * "第几个 card" 就和"第几张牌"对不上了：下标必须由绘制方直接给出，不能让外面去数。
   */
  idx?: number;
  cursor?: 'default' | 'pointer';
}

export const pointer = {
  x: -9999,
  y: -9999,
  down: false,
  /** 滚轮增量，绘制时消费掉 */
  wheel: 0,
  /** 本次按下以来指针累计移动的逻辑像素；拖动判定在 pointerup 发生。 */
  dragDist: 0,
  /** 上一帧之间累计的竖直位移，`consumeDragY()` 取走 */
  dragY: 0,
};

/** 超过这个距离算拖动，不再触发点击。 */
const DRAG_MIN = 8;

let lastX = 0;
let lastY = 0;

let last: Hot[] = [];
let building: Hot[] = [];
let inputX = 0;
let inputY = 0;
let inputActive = true;

/** 位移与热区共用一个作用域；退场内容只绘制，不再接收输入。 */
export function inputScope(x: number, y: number, active: boolean, draw: () => void) {
  const previous = { x: inputX, y: inputY, active: inputActive };
  inputX += x;
  inputY += y;
  inputActive = inputActive && active;
  try { draw(); }
  finally {
    inputX = previous.x;
    inputY = previous.y;
    inputActive = previous.active;
  }
}
/**
 * 按下时记住这一帧的矩形：帧与帧之间矩形会重建，抬起来时只能比几何，不能比对象引用。
 */
let downRect: { x: number; y: number; w: number; h: number } | null = null;
/**
 * 按下时那张牌的下标。手牌悬停会整张抬高，比 `sameBox` 的容差还大；
 * 有下标就能直接判断是不是同一张牌。
 */
let downIdx: number | null = null;
let activeDrag: { move: (dy: number) => void; y: number } | null = null;

/**
 * 最近一次被接受的点击，只给自动化用：测试据此判断"这一下有没有被吞掉"。
 */
let clickSeq = 0;
let lastClick: { label: string; idx?: number; n: number } | null = null;
export const lastClickInfo = () => lastClick;

/** 演出期间锁住点击，避免玩家点到"还没轮到他"的东西。 */
let locked = false;
let wheelShielded = false;
export function setInputLock(v: boolean) {
  locked = v;
  if (v) { downRect = null; downIdx = null; activeDrag = null; }
}

export function setWheelShield(v: boolean) {
  wheelShielded = v;
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
  inputActive && pointer.x >= x + inputX && pointer.x <= x + inputX + w
    && pointer.y >= y + inputY && pointer.y <= y + inputY + h;

export function onClick(
  x: number, y: number, w: number, h: number, fn: () => void, label?: string, idx?: number,
  cursor: 'default' | 'pointer' = 'pointer',
) {
  if (inputActive) building.push({ x: x + inputX, y: y + inputY, w, h, fn, label, idx, cursor });
}

/** 背景命中区只挡点击，不提示这里有操作。 */
export function onBlock(x: number, y: number, w: number, h: number, label?: string) {
  onClick(x, y, w, h, () => {}, label, undefined, 'default');
}

/** 可关闭的遮罩响应点击，但保留普通光标。 */
export function onDismiss(
  x: number, y: number, w: number, h: number, fn: () => void, label?: string,
) {
  onClick(x, y, w, h, fn, label, undefined, 'default');
}

export function onDrag(x: number, y: number, w: number, h: number, move: (dy: number) => void, label: string) {
  if (inputActive) building.push({ x: x + inputX, y: y + inputY, w, h, fn: () => {}, drag: move, label });
}

/** 当前帧所有可点区域（逻辑坐标）。冒烟测试用它按名字找按钮。 */
export const hotRects = () => last.map((h) => ({
  x: h.x, y: h.y, w: h.w, h: h.h, label: h.label ?? '', idx: h.idx,
}));

/** 这个点此刻会点到谁。冒烟测试用它确认"选中的那个位置真的属于那张牌"。 */
export const hitAt = (x: number, y: number) => {
  const h = hit(x, y);
  return h ? { label: h.label ?? '', idx: h.idx } : null;
};

export function beginInput() {
  building = [];
}

export function endInput() {
  last = building;
  const target = hit(pointer.x, pointer.y);
  document.body.style.cursor = activeDrag ? 'grabbing' : target?.drag ? 'grab'
    : target?.cursor === 'default' ? 'default' : target ? 'pointer' : 'default';
}

export function consumeWheel() {
  if (wheelShielded) return 0;
  const w = pointer.wheel;
  pointer.wheel = 0;
  return w;
}

export function consumeModalWheel() {
  const w = pointer.wheel;
  pointer.wheel = 0;
  return w;
}

/**
 * 丢掉攒下的滚轮增量。面板换屏时用：那一屏没有列表，增量会攒在手心里，
 * 面板一关就整截落到地图镜头上。
 */
export function clearWheel() {
  pointer.wheel = 0;
}

/**
 * 取走这一帧累计的竖直拖动距离（逻辑像素，向下为正）。
 * 必须取走：绘制每帧重算，留着会让镜头一直往一个方向漂。
 */
export function consumeDragY() {
  const d = pointer.dragY;
  pointer.dragY = 0;
  return d;
}

export function bindInput(el: HTMLCanvasElement, toLogic: (cx: number, cy: number) => { x: number; y: number }) {
  const set = (e: PointerEvent) => {
    const p = toLogic(e.clientX, e.clientY);
    lastX = pointer.x;
    lastY = pointer.y;
    pointer.x = p.x;
    pointer.y = p.y;
    if (activeDrag) { activeDrag.move(p.y - activeDrag.y); return; }
    if (pointer.down) {
      // 只在按下期间累计：没按住时的移动只是悬停，不该被当成拖拽。
      const dx = p.x - lastX;
      const dy = p.y - lastY;
      // 起点那一帧 lastX/lastY 可能是 (-9999,-9999)，那一下的位移不算拖动
      if (Math.abs(dx) < 4000 && Math.abs(dy) < 4000) {
        pointer.dragDist += Math.hypot(dx, dy);
        pointer.dragY += dy;
      }
    }
  };

  el.addEventListener('pointermove', set);

  el.addEventListener('pointerdown', (e) => {
    set(e);
    pointer.down = true;
    // 归零：上一次拖动的余量不算进这一次
    pointer.dragDist = 0;
    pointer.dragY = 0;
    if (locked) { downRect = null; downIdx = null; return; }
    const h = hit(pointer.x, pointer.y);
    if (h?.drag) activeDrag = { move: h.drag, y: pointer.y };
    downRect = h ? { x: h.x, y: h.y, w: h.w, h: h.h } : null;
    downIdx = h && h.idx !== undefined ? h.idx : null;
    // 合成事件可能没有合法 pointerId，捕获失败不打断点击
    try { el.setPointerCapture(e.pointerId); } catch { /* 忽略 */ }
  });

  el.addEventListener('pointerup', (e) => {
    set(e);
    const scrollbar = !!activeDrag;
    activeDrag = null;
    const dragged = pointer.dragDist > DRAG_MIN;
    pointer.down = false;
    pointer.dragDist = 0;
    pointer.dragY = 0;
    if (locked) { downRect = null; downIdx = null; return; }
    // 拖动过就不算点击，否则拖着地图会在松手时把底下那个节点点进去。
    if (dragged || scrollbar) { downRect = null; downIdx = null; return; }
    const h = hit(pointer.x, pointer.y);
    // 按下与抬起是同一个按钮才算点击；同一张牌看下标，不看几何（悬停会抬升）。
    const sameSlot = downIdx !== null && h?.idx === downIdx;
    if (h && downRect && inside(downRect, pointer.x, pointer.y) && (sameSlot || sameBox(h, downRect))) {
      lastClick = { label: h.label ?? '', idx: h.idx, n: ++clickSeq };
      h.fn();
    }
    downRect = null;
    downIdx = null;
  });

  const release = () => {
    pointer.x = -9999;
    pointer.y = -9999;
    pointer.down = false;
    pointer.dragDist = 0;
    pointer.dragY = 0;
    downRect = null;
    downIdx = null;
    activeDrag = null;
  };
  el.addEventListener('pointerleave', release);
  el.addEventListener('pointercancel', release);

  el.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      // A wheel event can arrive without a preceding pointermove.
      const p = toLogic(e.clientX, e.clientY);
      pointer.x = p.x;
      pointer.y = p.y;
      pointer.wheel += e.deltaY;
    },
    { passive: false },
  );
}

/** 一个按键，外加修饰键状态。画布里的输入框要靠它区分 `v` 和 `Ctrl+V`。 */
export interface KeyIn {
  key: string;
  ctrl: boolean;
}

/**
 * `edit` 是输入框的优先通道：它先拿到每一个按键，返回 true 就表示吃掉了 ——
 * 这一下不再当快捷键。否则 `Escape` / 空格会被输入框和游戏同时响应。
 */
export function keyHandler(fn: (k: string) => void, edit?: (k: KeyIn) => boolean, modal?: () => boolean) {
  window.addEventListener('keydown', (e) => {
    if (modal?.()) {
      if (e.key === 'Escape') fn('escape');
      e.preventDefault();
      return;
    }
    if (edit?.({ key: e.key, ctrl: e.ctrlKey || e.metaKey })) {
      e.preventDefault();
      return;
    }
    if (e.key === 'Escape') fn('escape');
    else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); fn('confirm'); }
    else if (/^[1-9]$/.test(e.key)) fn(e.key);
  });
}
