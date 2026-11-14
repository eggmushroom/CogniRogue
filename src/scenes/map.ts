import { g, roundRect, VH, VW } from '../gfx/canvas';
import { C, FONT_TITLE, withAlpha } from '../gfx/theme';
import { bar, panel, text } from '../gfx/ui';
import { drawArtIcon } from '../gfx/art/icons';
import type { ArtIconName } from '../gfx/art/icons';
import { consumeDragY, consumeWheel, hover, onClick } from '../input';
import { drawFeed } from './feed';
import { CURRICULUM, NODE_META, POWER_BY_ID, STAGES, STAGE_ROWS, stageOf } from '../core/model';
import { G } from '../core/infra';
import { FLOOR_MAX, MAP_COLS, availableNodes, curFloor, floorOf } from '../core/map';
import { enterNode } from '../core/journey';
import type { MapNode } from '../core/model';

/**
 * 节点图标来自 `gfx/art` 的图标库，和卡面效果图标共用 24×24 坐标系与线宽。
 * 之前地图自己手画了一套：战斗那把剑在 30px 半径里只看得见护手和柄，
 * 一整屏橙色十字，读起来像治疗点。地图不该有第二套图标语言。
 */
const NODE_ICON: Record<MapNode['type'], ArtIconName> = {
  fight: 'strike',
  elite: 'skull',
  rest: 'book',
  event: 'ask',
  boss: 'crown',
};


const TOP_Y = 132;
const BOT_Y = 788;
/**
 * 列距与行距是**一对**，不能单独改：跨列的线斜率 = DX / ROW_GAP。
 * 150 / 92 ≈ 1.6（约 58°）：每一条连线都朝上走，"往上爬"在形状上成立。
 * 列数从 3 加到 5 之后列距必须收，否则五列铺到屏幕外。
 */
const DX = 150;
/**
 * 地图的中心取左面板右侧那块可用区的中心（面板 340 结束，右边界留给滚动条）：
 * 屏幕居中会让五列整体偏左，左边贴着面板、右边空一大块。
 */
const MAP_CX = 930;
/** 五列的左端：入口与 Boss 都落在中间那一列 */
const X0 = MAP_CX - ((MAP_COLS - 1) / 2) * DX;
/** 一行 92px：半径 30 的节点之间留 32px，正好一屏 8 行 —— 也是 README 里写的那个数。 */
const ROW_GAP = 92;
const VISIBLE = Math.floor((BOT_Y - TOP_Y) / ROW_GAP) + 1;
/** 普通 / Boss 节点的底盘半径。也跟着行距收了一档，让两者都留得出空。 */
const NODE_R = 30;
const BOSS_R = 38;

/**
 * 纵向镜头：一幕 20 行，一次只显示 8 行，可以滚轮、按住拖动。
 * 玩家手动调过镜头之后（`camManual`）不再自动跟随当前层。
 */
let cam = 0;
/** 玩家手动调过镜头之后，就不再自动跟随当前层。 */
let camManual = false;
/** 上一帧聚焦的那一行。变了就说明走了一步，自动跟随该复位。 */
let lastFocus = -1;
/** 上一帧是哪一幕。换幕要把镜头复位。 */
let camStage = 0;
/** 上一帧画的是哪张地图（数组身份）。重开一局也会换一张，同样要复位。 */
let camMap: MapNode[][] | null = null;

const clampCam = (v: number) => Math.max(0, Math.min(STAGE_ROWS - VISIBLE, v));
const followRow = (r: number) => clampCam(r - 2);

/**
 * 每帧更新镜头：拖动是像素级的，直接当行号会打滑；自动跟随是一步跳两行，硬切会闪。
 */
function updateCam(dt: number) {
  // 换幕 / 重开一局：镜头复位，否则新地图会带着上一张图的滚动位置打开。
  if (camStage !== G.stage || camMap !== G.map) {
    camStage = G.stage;
    camMap = G.map;
    cam = followRow(G.pos ? G.pos.r : 0);
    camManual = false;
    lastFocus = G.pos ? G.pos.r : -1;
  }
  const focus = G.pos ? G.pos.r : G.node ? G.node.r : 0;
  if (focus !== lastFocus) {
    // 走了一步：恢复自动跟随。这样"边走边看"不需要玩家自己把镜头拨回来。
    lastFocus = focus;
    camManual = false;
  }

  // 有面板盖在地图上时不取滚轮：面板长在地图上，取走等于它的列表滚不动。
  // 关掉面板时要防的那一格由 main 负责清掉。
  if (G.panel.k !== 'none') {
    consumeDragY(); // 拖动只有地图认，面板不用，留着反而会在关掉后拽一下镜头
    return;
  }
  const wheel0 = consumeWheel();
  const dy0 = consumeDragY();

  // 滚轮：一格接近一行；向下滚 = 往塔底看
  if (wheel0) { cam -= wheel0 / (ROW_GAP * 1.2); camManual = true; }

  // 拖动：纸往下走，露出的是上面那几层
  if (dy0) { cam += dy0 / ROW_GAP; camManual = true; }

  const target = camManual ? clampCam(cam) : followRow(focus);
  // 手动时 target 就是 cam，只需收敛浮点尾巴
  cam += (target - cam) * (camManual ? 1 : 1 - Math.exp(-dt * 9));
  cam = clampCam(cam);
}

/**
 * 调试/冒烟用：当前镜头行号与是否被手动拨过。
 * 冒烟测试读它，因为"能不能滚"从命中矩形上看不出来。
 */
export function mapCam() {
  return { cam, manual: camManual };
}

const yOf = (r: number) => BOT_Y - (r - cam) * ROW_GAP;
const xOf = (c: number) => X0 + c * DX;

/**
 * 视野边缘的淡出：视野内是 1，越出上下边界后 46px 内线性消失。
 * 比"在边缘盖一块渐变"稳 —— 矩形渐隐有自己的左右硬边，顶部会露出一块方形的暗；
 * 按元素算的话，边界就是节点和连线自己的形状。
 */
const edgeFade = (y: number) => {
  const d = y < TOP_Y ? TOP_Y - y : y - BOT_Y;
  return d <= 0 ? 1 : Math.max(0, 1 - d / 46);
};

/** 世界层：节点、连线和 HUD；书架由 layers.ts 的背景层统一画。 */
export function drawMap(t: number, dt = 1 / 60) {
  updateCam(dt);
  const st = stageOf(G.stage);

  // 每一幕给整屏加一层自己的色：换幕时最先察觉的不是新怪，是"这里的光变了"。
  // 只压 8% 的透明度：再多，节点类型色（战斗橙/精英红）就会被染得认不出来。
  g.save();
  const amb = g.createRadialGradient(MAP_CX, VH * 0.42, 60, MAP_CX, VH * 0.42, 820);
  amb.addColorStop(0, withAlpha(st.color, 0.09));
  amb.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = amb;
  g.fillRect(0, 0, VW, VH);
  g.restore();

  columns(t);
  header(st);
  leftPanel();

  const avail = new Set(availableNodes());
  const cur = G.pos ? G.map[G.pos.r][G.pos.i].key : null;
  const lo = Math.max(0, Math.floor(cam) - 1);
  const hi = Math.min(STAGE_ROWS - 1, Math.ceil(cam) + VISIBLE);

  // 连线先画，节点压在上面
  for (let r = lo; r < hi; r++) {
    for (const nd of G.map[r]) {
      const a = { x: xOf(nd.col), y: yOf(nd.r) };
      const walked = G.seen[nd.key];
      for (const j of nd.next) {
        const b = { x: xOf(G.map[r + 1][j].col), y: yOf(r + 1) };
        const live = walked || avail.has(`${r + 1}:${j}`);
        g.save();
        g.globalAlpha = edgeFade(Math.min(a.y, b.y));
        g.beginPath();
        g.moveTo(a.x, a.y);
        // 控制点跟着行距走，但要**朝对面的 x 靠一点**：只往竖直方向偏移时，
        // 两个控制点在同一条竖线上，曲线中段的切线就接近水平 —— 跨一列的边
        // 会读成一条横线，几行连起来像电网。带一点 x 偏移之后，整条边都朝上。
        const bow = ROW_GAP * 0.52;
        const drift = (b.x - a.x) * 0.34;
        g.bezierCurveTo(a.x + drift, a.y - bow, b.x - drift, b.y + bow, b.x, b.y);
        if (live) {
          // 走过的、马上能走的路是一道光：中段最亮，两端收进节点里。
          // 纯色细线在暗背景上分不出"哪条是我选的"，渐变 + 一点辉光就分得出。
          const lg = g.createLinearGradient(a.x, a.y, b.x, b.y);
          lg.addColorStop(0, withAlpha(C.gold, 0.2));
          lg.addColorStop(0.55, withAlpha(C.gold, 0.82));
          lg.addColorStop(1, withAlpha(C.gold, 0.34));
          g.strokeStyle = lg;
          g.lineWidth = 2.6;
          g.shadowColor = withAlpha(C.gold, 0.4);
          g.shadowBlur = 9;
        } else {
          // 还没走的路退到背景里，但不能退到看不见：地图要回答"我还能往哪走"，
          // 所以留一档比背景亮、又明显低于金线的灰蓝。
          g.strokeStyle = 'rgba(132,150,190,.28)';
          g.lineWidth = 1.5;
        }
        g.stroke();
        g.restore();
      }
    }
  }

  for (let r = lo; r <= hi; r++) {
    if (!G.map[r]) continue;
    for (const nd of G.map[r]) {
      drawNode(nd, t, avail.has(nd.key), nd.key === cur);
    }
  }

  // 层号标尺：一条竖轴 + 每 5 层一支刻度，数字挂在轴左。
  // 之前只有一个飘着的数字，读者既不知道它是层号，也不知道它指着哪一行。
  const axisX = X0 - NODE_R - 32;
  g.fillStyle = 'rgba(120,140,180,.14)';
  g.fillRect(axisX, TOP_Y, 1, BOT_Y - TOP_Y);
  for (let r = lo; r <= hi; r++) {
    if (r !== 0 && (r + 1) % 5 !== 0 && r !== STAGE_ROWS - 1) continue;
    const ty = yOf(r);
    // 滚动到中段时，视野外的刻度会飘到屏幕顶上（数字跑到标题那一行），跟着淡出
    const f = edgeFade(ty);
    if (f <= 0.02) continue;
    const last = r === STAGE_ROWS - 1;
    g.save();
    g.globalAlpha = f;
    g.fillStyle = withAlpha(last ? C.gold : C.lineHi, last ? 0.7 : 0.45);
    g.fillRect(axisX - 7, ty - 0.5, 7, 1);
    text(`${floorOf(G.stage, r)}`, axisX - 12, ty + 4, {
      size: 11, align: 'right', color: last ? withAlpha(C.gold, 0.85) : C.faint, weight: 600,
    });
    g.restore();
  }

  scrollBar();
  hint(avail.size > 0);
  // 左面板收在 760，下面到屏幕底是空的。事件结果就落在这里：
  // 它是**玩家唯一能读到"刚才那一下付了什么代价"的地方**。
  drawFeed(t, { x: 36, y: 880, w: 520 });
}

/**
 * 右侧滚动条：回答"我现在看到的是 20 层里的哪一段"。
 */
function scrollBar() {
  const x = VW - 60;
  const top = TOP_Y - 10;
  const h = BOT_Y - TOP_Y + 20;
  roundRect(x, top, 4, h, 2);
  g.fillStyle = 'rgba(255,255,255,.06)';
  g.fill();
  const span = VISIBLE / STAGE_ROWS;
  const thumbH = Math.max(36, h * span);
  // cam 越大 = 看到的位置越高（行号大），而屏幕上方是"上面"，所以进度要反过来。
  const prog = (STAGE_ROWS - VISIBLE - cam) / Math.max(1, STAGE_ROWS - VISIBLE);
  const ty = top + (h - thumbH) * prog;
  roundRect(x, ty, 4, thumbH, 2);
  g.fillStyle = withAlpha(C.lineHi, camManual ? 0.95 : 0.6);
  g.fill();
  if (camManual) {
    text('手动', x - 8, top - 12, { size: 10, align: 'right', color: withAlpha(C.gold, 0.7) });
  }
}

function hint(hasAvail: boolean) {
  text(hasAvail ? '点击发光的节点继续' : '这条路的尽头，是你要面对的东西',
    MAP_CX, 862, { size: 14, align: 'center', color: C.dim });
  text('滚轮 / 按住拖动 · 走一步自动回到当前位置',
    MAP_CX, 884, { size: 11, align: 'center', color: C.faint });
  // 上下还有多少路：和滚动条一起回答"我是不是看到底了"
  const above = Math.max(0, STAGE_ROWS - 1 - Math.round(cam));
  const below = Math.max(0, Math.round(cam));
  if (above > 0) text(`↑ 上面还有 ${above} 层`, VW - 86, TOP_Y - 26, { size: 12, align: 'right', color: C.dim });
  if (below > 0) text(`↓ 下面还有 ${below} 层`, VW - 86, BOT_Y + 34, { size: 12, align: 'right', color: C.faint });
}

/**
 * 节点底盘形状：先用轮廓区分类型，颜色只是第二层。
 * 圆 = 战斗，六边 = 精英，圆角方 = 复习，虚线圆 = 事件，大双环 = 首领。
 */
function platePath(type: MapNode['type'], x: number, y: number, r: number) {
  if (type === 'elite') {
    // 六边形：尖角轮廓本身就是"危险"，不用读骷髅
    g.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 3;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.closePath();
    return;
  }
  if (type === 'rest') {
    // 圆角方：全场唯一的"方"：安全点不该长得像一场战斗
    roundRect(x - r, y - r, r * 2, r * 2, r * 0.42);
    return;
  }
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
}

function drawNode(nd: MapNode, t: number, avail: boolean, isCur: boolean) {
  const x = xOf(nd.col);
  const y = yOf(nd.r);
  const fade = edgeFade(y);
  // 完全在视野外的行不必画，也不必挂命中区
  if (fade <= 0.02) return;
  g.save();
  g.globalAlpha = fade;
  const meta = NODE_META[nd.type];
  const seen = !!G.seen[nd.key];
  const baseR = nd.type === 'boss' ? BOSS_R : NODE_R;
  // 可前往的节点呼吸着长大一点点。满屏都在发光的时候，尺寸变化比亮度更抗噪：
  // "亮"在这张图上已经很廉价了，光柱、浮纸、走过的路全都在发亮。
  const p = 0.5 + 0.5 * Math.sin(t * 3 + nd.r * 0.8);
  const r = baseR * (avail ? 1 + 0.06 * p : 1);
  const hv = avail && hover(x - baseR - 8, y - baseR - 8, (baseR + 8) * 2, (baseR + 8) * 2);

  // 可选节点的呼吸光环
  if (avail) {
    g.save();
    const gl = g.createRadialGradient(x, y, baseR * 0.5, x, y, baseR * 2.6);
    gl.addColorStop(0, withAlpha(meta.color, 0.4 + p * 0.25));
    gl.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gl;
    g.beginPath();
    g.arc(x, y, baseR * 2.6, 0, Math.PI * 2);
    g.fill();
    g.restore();

    platePath(nd.type, x, y, r + 6 + p * 5);
    g.strokeStyle = withAlpha(meta.color, 0.55 + p * 0.35);
    g.lineWidth = 2;
    if (nd.type === 'event') g.setLineDash([7, 6]);
    g.stroke();
    g.setLineDash([]);
  }

  // 底盘
  const rr = r * (hv ? 1.09 : 1);
  platePath(nd.type, x, y, rr);
  // 上亮下暗的径向：和卡面的"洗底"同一个做法，底盘才像一枚徽章而不是一块玻璃
  const grd = g.createRadialGradient(x, y - rr * 0.55, 1, x, y, rr);
  if (avail || seen) {
    grd.addColorStop(0, withAlpha(meta.color, 0.46));
    grd.addColorStop(1, 'rgba(9,11,17,.97)');
  } else {
    grd.addColorStop(0, 'rgba(34,38,52,.92)');
    grd.addColorStop(1, 'rgba(8,10,15,.97)');
  }
  g.fillStyle = grd;
  g.fill();
  g.strokeStyle = avail || seen ? withAlpha(meta.color, 0.85) : withAlpha(meta.color, 0.28);
  g.lineWidth = avail ? 2.4 : 1.6;
  if (nd.type === 'event') g.setLineDash([7, 6]);
  g.stroke();
  g.setLineDash([]);

  // 顶缘高光：一段短弧压在边框内侧，读成"光从上方来"。
  // 圆、六边、圆角方都能用同一条弧，底盘因此像同一套模具压出来的。
  g.save();
  platePath(nd.type, x, y, rr - 1.6);
  g.clip();
  g.beginPath();
  g.arc(x, y, rr - 1, -Math.PI * 0.78, -Math.PI * 0.22);
  g.strokeStyle = withAlpha(meta.color, avail || seen ? 0.75 : 0.3);
  g.lineWidth = 2.4;
  g.stroke();
  g.restore();

  // 内圈细环：底盘从"一个圆"变成"一枚徽章"，图标才不像直接贴在背景上。
  // 六边形和圆角方放内环会糊成一团，只给圆的这几种画。
  if (nd.type === 'fight' || nd.type === 'event' || nd.type === 'boss') {
    g.beginPath();
    g.arc(x, y, rr - 5, 0, Math.PI * 2);
    g.strokeStyle = withAlpha(meta.color, avail || seen ? 0.3 : 0.14);
    g.lineWidth = 1;
    g.stroke();
  }
  if (nd.type === 'boss') {
    g.beginPath();
    g.arc(x, y, rr - 9, 0, Math.PI * 2);
    g.strokeStyle = withAlpha(meta.color, avail || seen ? 0.42 : 0.2);
    g.lineWidth = 1.4;
    g.stroke();
  }

  // 还没走到的节点也要读得出类型：地图得回答"那边有什么"，玩家才能选。
  // 退后的层次交给底盘灰度和边框透明度，图标本身别压到像一颗空圈。
  const col = avail || seen ? meta.color : withAlpha(meta.color, 0.78);
  g.save();
  g.globalAlpha = fade * (avail || seen ? 1 : 0.92);
  // 图标库是 24×24 满框构图，1.3 倍半径会顶到边框内侧；1.14 留出一圈底盘。
  glyph(nd.type, x, y, rr * 1.14, col);
  g.restore();

  // 已走过的打勾：底色用面板色、勾用走过的路那支金，不用荧光绿 ——
  // 绿色在整屏「暗金 + 身份色」里是最跳的一点，会把「已过」读成「奖励」。
  if (seen && !avail) {
    g.beginPath();
    g.arc(x + rr * 0.75, y - rr * 0.75, 9, 0, Math.PI * 2);
    g.fillStyle = 'rgba(10,12,18,.92)';
    g.fill();
    g.strokeStyle = withAlpha(C.gold, 0.55);
    g.lineWidth = 1;
    g.stroke();
    text('✓', x + rr * 0.75, y - rr * 0.74, { size: 11, color: C.gold, align: 'center', weight: 900 });
  }

  if (isCur) {
    // 当前位置做成胶囊：原来是一行 12px 裸字，和 hover 时才出现的地名混在一起。
    // 贴着底盘下沿 6px：行距 92、半径 30 之后，"这里"和下一行节点只剩 2px 的余量，
    // 放到 10px 就会和下面那个节点咬在一起。
    const tw = 52;
    roundRect(x - tw / 2, y + baseR + 6, tw, 19, 9.5);
    g.fillStyle = withAlpha(C.gold, 0.16);
    g.fill();
    g.strokeStyle = withAlpha(C.gold, 0.6);
    g.lineWidth = 1;
    g.stroke();
    text('这里', x, y + baseR + 16, { size: 11, align: 'center', color: C.gold, weight: 700 });
  }

  if (avail) {
    if (hv) text(meta.k, x, y - baseR - 16, { size: 14, align: 'center', color: meta.color, weight: 700 });
    onClick(x - baseR - 8, y - baseR - 8, (baseR + 8) * 2, (baseR + 8) * 2, () => enterNode(nd.key), 'node');
  }
  g.restore();
}

/** 五道竖直光柱：给五列槽位一个"塔"的结构，不然只是一堆飘着的圆。 */
function columns(t: number) {
  const st = stageOf(G.stage);
  // 光柱宽随列距收：列距 150 时 92 宽的光柱会连成一片，五列反而读成一根
  const colW = Math.round(DX * 0.4);
  // 五列比三列多出三分之二的面积，单列浓度要跟着降，否则整屏发蓝
  const a = 0.052 + Math.sin(t * 0.8) * 0.012;
  for (let c = 0; c < MAP_COLS; c++) {
    const x = xOf(c);
    const grd = g.createLinearGradient(0, TOP_Y - 60, 0, BOT_Y + 70);
    grd.addColorStop(0, 'rgba(120,150,220,0)');
    grd.addColorStop(0.5, withAlpha(st.color, a + Math.sin(t * 0.8 + c) * 0.012));
    grd.addColorStop(1, 'rgba(120,150,220,0)');
    g.fillStyle = grd;
    g.fillRect(x - colW / 2, TOP_Y - 60, colW, BOT_Y - TOP_Y + 130);
  }
  // 视野边缘不做矩形渐隐：一块"暗玻璃"有自己的左右硬边，顶上会出现一条
  // 明显的方框。改成每个节点和每条线按自己离边界的距离淡出（edgeFade），
  // 形状是圆是线，边界就是形状本身。
}

/** 节点图标统一走 `gfx/art` 的图标库；这一层只负责把类型映射过去。 */
function glyph(type: MapNode['type'], x: number, y: number, s: number, col: string) {
  drawArtIcon(NODE_ICON[type], x, y, s, col);
}

function header(st: { name: string; sub: string; color: string }) {
  text('记忆的档案馆', 40, 52, { size: 34, weight: 700, family: FONT_TITLE, color: C.ink });
  const floor = curFloor();
  // 幕名是这一屏最重要的一个字：它告诉玩家"换地方了"，层号只回答"爬了多远"
  text(`第 ${G.stage} 幕 · ${st.name}`, 40, 86, { size: 16, color: st.color, weight: 700 });
  // 卡题解耦后，"这一章问什么"要单独说：它和牌组没有关系。
  text(`第 ${floor} / ${FLOOR_MAX} 层 · 本章 ${G.stageTopic}`, 40, 110, { size: 13, color: C.dim });
  // 一道短金线把标题和层级收在一起，和地图里"走过的路"同一个颜色
  g.fillStyle = withAlpha(st.color, 0.55);
  g.fillRect(40, 122, 46, 2);
}

function leftPanel() {
  const x = 40;
  const y = 140;
  const w = 300;
  const h = 620;

  panel(x, y, w, h, { r: 14, fill: 'rgba(10,12,18,.86)' });
  // 顶光条跟着这一幕的颜色走，和浮层面板的 box() 同一种收法：
  // 这块面板属于这一屏，不是浮在书架上的一个独立窗口。
  g.save();
  roundRect(x, y, w, h, 14);
  g.clip();
  const st = stageOf(G.stage);
  const tg = g.createLinearGradient(x, 0, x + w, 0);
  tg.addColorStop(0, withAlpha(st.color, 0.1));
  tg.addColorStop(0.45, withAlpha(st.color, 0.62));
  tg.addColorStop(1, withAlpha(st.color, 0.08));
  g.fillStyle = tg;
  g.fillRect(x, y, w, 2.4);
  g.restore();

  // 生命
  text('生命', x + 20, y + 28, { size: 13, color: C.dim, weight: 600 });
  const pct = G.hp / G.maxHp;
  bar(x + 20, y + 42, w - 40, 18, pct,
    pct > 0.5 ? C.hpCalm : pct > 0.25 ? C.hpWarn : C.hpDanger, {
      label: `${G.hp} / ${G.maxHp}`,
    });

  // 牌组
  const dy = y + 82;
  const dhv = hover(x + 16, dy, w - 32, 34);
  roundRect(x + 16, dy, w - 32, 34, 8);
  g.fillStyle = dhv ? 'rgba(255,255,255,.08)' : 'rgba(255,255,255,.03)';
  g.fill();
  g.strokeStyle = dhv ? C.lineHi : C.line;
  g.lineWidth = 1;
  g.stroke();
  text(`牌组 · ${G.deck.length} 张`, x + 30, dy + 17, { size: 14, color: dhv ? C.ink : C.ink2 });
  text(`${CURRICULUM.length} 章 · 本章 ${G.stageTopic}`, x + w - 24, dy + 17, { size: 12, color: C.dim, align: 'right' });
  onClick(x + 16, dy, w - 32, 34, () => { G.panel = { k: 'deck' }; });

  // 增益：整局生效的印记，不进牌组、不占牌位。这里回答"我这一局已经会了什么"。
  const powers = G.powers.map((id) => POWER_BY_ID[id]);
  text(`增益 · ${powers.length}`, x + 20, y + 146, { size: 13, color: C.dim, weight: 600 });
  if (!powers.length) {
    text('还没有。精英和幕 Boss 会掉。', x + 20, y + 170, { size: 12, color: C.faint });
    // 原来这里是三个并排的空槽：玩家会读成"增益最多三个"，而实际没有上限。
    // 换成一条待填的虚线带，只表示"位置空着"，不承诺容量。
    g.save();
    g.setLineDash([4, 5]);
    g.strokeStyle = withAlpha(C.lineHi, 0.3);
    g.lineWidth = 1;
    roundRect(x + 20, y + 184, w - 40, 32, 6);
    g.stroke();
    g.restore();
  } else {
    // 池子从十二个涨到四十七个之后，这里不能再按"两列六行"排：
    // 一局捡到十几张时最后一行会压到「全塔」那一块上。改成三列，
    // 并且**有上限**：超出部分只报一个数字，而不是继续往下长、
    // 把下面的进度条挤出去。玩家真正关心的是"我这一局会了什么"，
    // 不是把四十七张全看一遍（那在牌组/图鉴里）。
    const cols = 3;
    const rowH = 15;
    const maxRows = 5;
    const shown = powers.slice(0, cols * maxRows);
    shown.forEach((p, i) => {
      const ex = x + 22 + (i % cols) * 96;
      const ey = y + 170 + Math.floor(i / cols) * rowH;
      text(p.icon, ex, ey, { size: 11, color: p.color, weight: 800 });
      text(p.name, ex + 14, ey, { size: 11, color: C.ink2 });
    });
    if (powers.length > shown.length) {
      text(`+${powers.length - shown.length} 张`, x + 22 + (shown.length % cols) * 96,
        y + 170 + Math.floor(shown.length / cols) * rowH,
        { size: 11, color: C.faint });
    }
  }

  // ── 五幕进度 ─────────────────────────────────────────────
  // 这是 100 层唯一能一眼看懂的刻度：五条横杠，每条代表 20 层。
  // 逐层画 100 个点没有意义：玩家记不住 100 个位置，但记得住"我在第几幕"。
  const sy = y + 250;
  text('全塔', x + 20, sy, { size: 13, color: C.dim, weight: 600 });
  STAGES.forEach((s, i) => {
    const ry = sy + 20 + i * 40;
    const now = s.i === G.stage;
    const done = s.i < G.stage;
    const col = done || now ? s.color : withAlpha(s.color, 0.4);
    if (now) {
      roundRect(x + 14, ry - 4, w - 28, 34, 8);
      g.fillStyle = withAlpha(s.color, 0.12);
      g.fill();
    }
    text(`${s.i}`, x + 26, ry + 12, { size: 13, color: col, weight: 800 });
    text(s.name, x + 44, ry + 12, { size: 13, color: done || now ? C.ink : C.ink2, weight: now ? 700 : 400 });
    text(done ? '已过' : now ? `${G.pos ? G.pos.r + 1 : 1}/20` : '—', x + w - 22, ry + 12, {
      size: 11, align: 'right', color: now ? s.color : C.faint,
    });
    // 每幕一条细进度线：已过满格，当前按层数填
    const bx = x + 44;
    const bw = w - 96;
    const frac = done ? 1 : now ? Math.min(1, ((G.pos ? G.pos.r : 0) + 0) / (STAGE_ROWS - 1)) : 0;
    g.fillStyle = 'rgba(255,255,255,.07)';
    g.fillRect(bx, ry + 21, bw, 4);
    g.fillStyle = withAlpha(s.color, done ? 0.55 : 0.85);
    g.fillRect(bx, ry + 21, bw * frac, 4);
  });

  // 图例
  const ly = y + h - 108;
  g.beginPath();
  g.moveTo(x + 20, ly);
  g.lineTo(x + w - 20, ly);
  g.strokeStyle = C.line;
  g.lineWidth = 1;
  g.stroke();
  text('节点', x + 20, ly + 22, { size: 12, color: C.dim, weight: 600 });
  const kinds: Array<keyof typeof NODE_META> = ['fight', 'elite', 'rest', 'event', 'boss'];
  kinds.forEach((k, i) => {
    const cx = x + 32 + (i % 3) * 96;
    const cy = ly + 52 + Math.floor(i / 3) * 30;
    // 图例必须和地图上用同一套轮廓：否则"六边形是精英"这件事在图上认得出，
    // 在图例里查不到。形状先于颜色，图例是它唯一的说明书。
    platePath(k, cx, cy, 12);
    g.fillStyle = 'rgba(10,12,18,.9)';
    g.fill();
    g.strokeStyle = withAlpha(NODE_META[k].color, 0.7);
    g.lineWidth = 1.3;
    if (k === 'event') g.setLineDash([4, 4]);
    g.stroke();
    g.setLineDash([]);
    glyph(k, cx, cy, 16, NODE_META[k].color);
    text(NODE_META[k].k, cx + 20, cy, { size: 12, color: C.ink2 });
  });
}
