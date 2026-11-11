import { resize } from './gfx/canvas';

interface Hot {
  x: number; y: number; w: number; h: number;
  fn: () => void;
  /** 只给自动化测试认按钮用，运行时不参与任何判断。 */
  label?: string;
  /**
   * 在同一个列表里的位置（手牌下标）。列表里少注册一项（比如还在飞的牌没有热区），
   * "第几个 card" 就和"第几张牌"对不上了 —— 下标必须由绘制方直接给出，不能让外面去数。
   */
  idx?: number;
}

export const pointer = {
  x: -9999,
  y: -9999,
  down: false,
  /** 滚轮增量，绘制时消费掉 */
  wheel: 0,
  /**
   * 本次按下以来指针累计移动了多少逻辑像素。
   *
   * 地图要能**按住拖动**，而拖动与点击是同一个手势 —— 区别只在松开时的距离。
   * 累计值放在这里是因为判定必须发生在 pointerup：只有那一刻才知道
   * 玩家是"按了一下"还是"拖了一段"。超过 `DRAG_MIN` 就不当成点击。
   */
  dragDist: 0,
  /** 上一帧之间累计的竖直位移，`consumeDragY()` 取走 */
  dragY: 0,
};

/** 超过这个距离就算拖动，不再触发点击。8px 在 1600×900 逻辑坐标下约等于一颗指尖的抖动。 */
const DRAG_MIN = 8;

let lastX = 0;
let lastY = 0;

let last: Hot[] = [];
let building: Hot[] = [];
/**
 * 按下时记住的是这一帧的矩形，但帧与帧之间矩形会被重新创建（动画、布局都会动），
 * 所以抬起来时不能用对象引用判断"还是不是同一个按钮"，只能比几何。
 * 早期版本用 `h === downHot`，在真实浏览器里几乎每次点击都被判成"移出了按钮"。
 */
let downRect: { x: number; y: number; w: number; h: number } | null = null;
/**
 * 按下时那张牌的下标。手牌悬停会整张抬高 44px，比下面 sameBox 的 24px 容差还大 ——
 * 手指/鼠标按下去的那 1~2 帧里牌正好被抬起来，这次点击就会被误判成"移到了别的按钮"
 * 而丢掉。有了下标就能直接判断"还是不是同一张牌"，不必去比几何。
 */
let downIdx: number | null = null;

/**
 * 最近一次"真的被接受"的点击。只给自动化用：点没点中，测试得能自己看出来 ——
 * 否则一个被吞掉的点击只会表现成"状态没变"，排查时要从十几种可能里一个个猜。
 * `n` 是自增序号，测试用它判断"这一下是新的"，而不是拿旧值当结果。
 */
let clickSeq = 0;
let lastClick: { label: string; idx?: number; n: number } | null = null;
export const lastClickInfo = () => lastClick;

/**
 * 演出期间锁住点击。打击动画还没演完时反馈面板没弹出来，
 * 但底下的手牌、牌堆、结束回合仍然画在屏幕上 —— 不锁的话玩家能点到"还没轮到他"的东西。
 */
let locked = false;
export function setInputLock(v: boolean) {
  locked = v;
  if (v) { downRect = null; downIdx = null; }
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
  x: number, y: number, w: number, h: number, fn: () => void, label?: string, idx?: number,
) {
  building.push({ x, y, w, h, fn, label, idx });
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
  document.body.style.cursor = hit(pointer.x, pointer.y) ? 'pointer' : 'default';
}

export function consumeWheel() {
  const w = pointer.wheel;
  pointer.wheel = 0;
  return w;
}

/**
 * 取走这一帧累计的竖直拖动距离（逻辑像素，向下为正）。
 *
 * 地图用它来滚动镜头：`cam -= dy / ROW_GAP`。之所以要"取走"，是因为
 * 绘制是每帧重算的 —— 留着不清会让镜头一直往一个方向漂。
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
    // 归零：上一次拖动的余量不应算进这一次
    pointer.dragDist = 0;
    pointer.dragY = 0;
    if (locked) { downRect = null; downIdx = null; return; }
    const h = hit(pointer.x, pointer.y);
    downRect = h ? { x: h.x, y: h.y, w: h.w, h: h.h } : null;
    downIdx = h && h.idx !== undefined ? h.idx : null;
    // 合成事件（自动化测试、部分触屏）可能没有合法的 pointerId，捕获失败不该打断点击
    try { el.setPointerCapture(e.pointerId); } catch { /* 忽略 */ }
  });

  el.addEventListener('pointerup', (e) => {
    set(e);
    const dragged = pointer.dragDist > DRAG_MIN;
    pointer.down = false;
    pointer.dragDist = 0;
    pointer.dragY = 0;
    if (locked) { downRect = null; downIdx = null; return; }
    // 拖动过的这一下不算点击：否则"拖着地图找路"会在松手时把镜头底下那个节点点进去。
    // 这是拖动和点击共存唯一需要的规则 —— 不必给它们分配不同的按键。
    if (dragged) { downRect = null; downIdx = null; return; }
    const h = hit(pointer.x, pointer.y);
    // 按下的和抬起的是同一个按钮 → 才算一次点击；顺带用当前帧的回调，避免闭包读到过期状态。
    // 同一张牌（下标相同）不看几何：悬停抬升本身就会让它离开原来那块矩形。
    const sameSlot = downIdx !== null && h?.idx === downIdx;
    if (h && downRect && inside(downRect, pointer.x, pointer.y) && (sameSlot || sameBox(h, downRect))) {
      lastClick = { label: h.label ?? '', idx: h.idx, n: ++clickSeq };
      h.fn();
    }
    downRect = null;
    downIdx = null;
  });

  el.addEventListener('pointerleave', () => {
    pointer.x = -9999;
    pointer.y = -9999;
    pointer.down = false;
    pointer.dragDist = 0;
    pointer.dragY = 0;
    downRect = null;
    downIdx = null;
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
