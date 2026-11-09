import { g, roundRect, VH, VW } from '../gfx/canvas';
import { C, FONT_TITLE, FONT_UI, withAlpha } from '../gfx/theme';
import { bar, panel, text } from '../gfx/ui';
import { onClick, hover } from '../input';
import { drawBackdrop, drawMotes } from '../gfx/backdrop';
import { NODE_META, STAGES, STAGE_ROWS, stageOf } from '../core/model';
import { G } from '../core/infra';
import { topics } from '../core/cards';
import { deckPowers } from '../core/cards';
import { FLOOR_MAX, availableNodes, curFloor, floorOf } from '../core/map';
import { enterNode } from '../core/journey';
import type { MapNode } from '../core/model';


const TOP_Y = 132;
const BOT_Y = 788;
const X0 = 540;
const DX = 260;
/** 一行 74px：一屏刚好看见 9 行，当前层落在下三分之一处 —— 上面 6 行是"接下来能走的路" */
const ROW_GAP = 74;
const VISIBLE = Math.floor((BOT_Y - TOP_Y) / ROW_GAP) + 1;

/**
 * 纵向镜头。**地图一次只显示 9 行**，因为一幕有 20 层 ——
 * 全画出来每行只有 33px，节点会挤成一条珠链，分支就不存在了。
 *
 * 镜头不做缓动：这一屏的信息是"我下一步能去哪"，任何拖影都只是延迟。
 * 当前层固定在下数第三行，于是"往上爬"在视觉上永远成立。
 */
function camRow(): number {
  const r = G.pos ? G.pos.r : G.node ? G.node.r : 0;
  return Math.max(0, Math.min(STAGE_ROWS - VISIBLE, r - 2));
}

const yOf = (r: number, cam: number) => BOT_Y - (r - cam) * ROW_GAP;
const xOf = (c: number) => X0 + c * DX;

export function drawMap(t: number) {
  drawBackdrop(t, 0.66);
  drawMotes(t);

  const cam = camRow();
  const st = stageOf(G.stage);

  // 每一幕给整屏加一层自己的色：换幕时最先察觉的不是新怪，是"这里的光变了"。
  // 只压 8% 的透明度 —— 再多，节点类型色（战斗橙/精英红）就会被染得认不出来。
  g.save();
  const amb = g.createRadialGradient(X0 + DX, VH * 0.42, 60, X0 + DX, VH * 0.42, 820);
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
  const lo = Math.max(0, cam - 1);
  const hi = Math.min(STAGE_ROWS - 1, cam + VISIBLE);

  // 连线先画，节点压在上面
  for (let r = lo; r < hi; r++) {
    for (const nd of G.map[r]) {
      const a = { x: xOf(nd.col), y: yOf(nd.r, cam) };
      const walked = G.seen[nd.key];
      for (const j of nd.next) {
        const b = { x: xOf(G.map[r + 1][j].col), y: yOf(r + 1, cam) };
        const live = walked || avail.has(`${r + 1}:${j}`);
        g.save();
        g.beginPath();
        g.moveTo(a.x, a.y);
        g.bezierCurveTo(a.x, a.y - 42, b.x, b.y + 42, b.x, b.y);
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
          g.strokeStyle = 'rgba(132,150,190,.34)';
          g.lineWidth = 1.6;
        }
        g.stroke();
        g.restore();
      }
    }
  }

  for (let r = lo; r <= hi; r++) {
    for (const nd of G.map[r]) {
      if (!G.map[r]) continue;
      drawNode(nd, t, avail.has(nd.key), nd.key === cur, cam);
    }
  }

  // 层号刻度：每 5 层一支，画在地图左缘 —— 挂在节点旁边会读成"这个节点叫 10"
  for (let r = lo; r <= hi; r++) {
    if (r !== 0 && (r + 1) % 5 !== 0 && r !== STAGE_ROWS - 1) continue;
    const yy = yOf(r, cam);
    text(`${floorOf(G.stage, r)}`, X0 - 62, yy + 4, {
      size: 11, align: 'right', color: r === STAGE_ROWS - 1 ? withAlpha(C.gold, 0.8) : C.faint, weight: 600,
    });
  }

  // 视野之外还有多少路：不给这个数，玩家会以为地图到顶了。
  // 摆在右缘（地图列之外），免得和刻度尺、底部提示挤在同一个角上。
  if (cam > 0) {
    text(`↑ 上面还有 ${cam} 层`, VW - 76, TOP_Y - 26, { size: 12, align: 'right', color: C.dim });
  }
  if (hi < STAGE_ROWS - 1) {
    text(`↓ 下面还有 ${STAGE_ROWS - 1 - hi} 层`, VW - 76, BOT_Y + 40, { size: 12, align: 'right', color: C.faint });
  }

  text(
    avail.size ? '点击发光的节点继续' : '这条路的尽头，是你要面对的东西',
    X0 + DX, 878, { size: 14, align: 'center', color: C.dim },
  );
}

/**
 * 节点底盘形状：**先把类型分开，颜色只是第二层**。
 *
 * 以前五种节点是同一个圆，只换颜色 —— 而战斗 `#c9744a` 和精英 `#d9534f`
 * 两个色几乎一样，缩到 32px 只能靠读图标才分得出，读图标就得停下来。
 * 现在轮廓本身就是信息：圆 = 战斗，六边 = 精英，圆角方 = 复习，虚线圆 = 事件，
 * 大双环 = 首领。颜色退化成"确认"，不再是唯一线索。
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
    // 圆角方：全场唯一的"方"——安全点不该长得像一场战斗
    roundRect(x - r, y - r, r * 2, r * 2, r * 0.42);
    return;
  }
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
}

function drawNode(nd: MapNode, t: number, avail: boolean, isCur: boolean, cam: number) {
  const x = xOf(nd.col);
  const y = yOf(nd.r, cam);
  const meta = NODE_META[nd.type];
  const seen = !!G.seen[nd.key];
  const baseR = nd.type === 'boss' ? 44 : 32;
  // 可前往的节点呼吸着长大一点点。满屏都在发光的时候，尺寸变化比亮度更抗噪 ——
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
  const grd = g.createRadialGradient(x, y - rr * 0.4, 2, x, y, rr);
  if (avail || seen) {
    grd.addColorStop(0, withAlpha(meta.color, 0.4));
    grd.addColorStop(1, 'rgba(10,12,18,.96)');
  } else {
    grd.addColorStop(0, 'rgba(30,34,46,.9)');
    grd.addColorStop(1, 'rgba(8,10,15,.96)');
  }
  g.fillStyle = grd;
  g.fill();
  g.strokeStyle = avail || seen ? withAlpha(meta.color, 0.85) : withAlpha(meta.color, 0.28);
  g.lineWidth = avail ? 2.4 : 1.6;
  if (nd.type === 'event') g.setLineDash([7, 6]);
  g.stroke();
  g.setLineDash([]);

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

  const col = avail || seen ? meta.color : withAlpha(meta.color, 0.55);
  g.save();
  g.globalAlpha = avail || seen ? 1 : 0.85;
  glyph(nd.type, x, y, rr * 1.3, col);
  g.restore();

  // 已走过的打勾
  if (seen && !avail) {
    g.beginPath();
    g.arc(x + rr * 0.75, y - rr * 0.75, 9, 0, Math.PI * 2);
    g.fillStyle = withAlpha(C.green, 0.9);
    g.fill();
    text('✓', x + rr * 0.75, y - rr * 0.74, { size: 12, color: '#04140c', align: 'center', weight: 900 });
  }

  if (isCur) {
    // 当前位置做成胶囊：原来是一行 12px 裸字，和 hover 时才出现的地名混在一起
    const tw = 52;
    roundRect(x - tw / 2, y + baseR + 10, tw, 20, 10);
    g.fillStyle = withAlpha(C.gold, 0.16);
    g.fill();
    g.strokeStyle = withAlpha(C.gold, 0.6);
    g.lineWidth = 1;
    g.stroke();
    text('这里', x, y + baseR + 21, { size: 12, align: 'center', color: C.gold, weight: 700 });
  }

  if (avail) {
    if (hv) text(meta.k, x, y - baseR - 16, { size: 14, align: 'center', color: meta.color, weight: 700 });
    onClick(x - baseR - 8, y - baseR - 8, (baseR + 8) * 2, (baseR + 8) * 2, () => enterNode(nd.key), 'node');
  }
}

/** 三道竖直光柱：给三列节点一个"塔"的结构，不然只是一堆飘着的圆。 */
function columns(t: number) {
  const st = stageOf(G.stage);
  for (let c = 0; c < 3; c++) {
    const x = xOf(c);
    const grd = g.createLinearGradient(0, TOP_Y - 60, 0, BOT_Y + 70);
    grd.addColorStop(0, 'rgba(120,150,220,0)');
    grd.addColorStop(0.5, withAlpha(st.color, 0.05 + Math.sin(t * 0.8 + c) * 0.012));
    grd.addColorStop(1, 'rgba(120,150,220,0)');
    g.fillStyle = grd;
    g.fillRect(x - 46, TOP_Y - 60, 92, BOT_Y - TOP_Y + 130);
  }
  // 镜头边缘的渐隐：把"还有路没画出来"这件事说在暗处
  const fadeTop = g.createLinearGradient(0, TOP_Y - 74, 0, TOP_Y - 18);
  fadeTop.addColorStop(0, 'rgba(6,8,13,.92)');
  fadeTop.addColorStop(1, 'rgba(6,8,13,0)');
  g.fillStyle = fadeTop;
  g.fillRect(360, TOP_Y - 74, VW - 380, 56);
  const fadeBot = g.createLinearGradient(0, BOT_Y + 60, 0, BOT_Y + 10);
  fadeBot.addColorStop(0, 'rgba(6,8,13,.92)');
  fadeBot.addColorStop(1, 'rgba(6,8,13,0)');
  g.fillStyle = fadeBot;
  g.fillRect(360, BOT_Y + 10, VW - 380, 50);
}

function star(cx: number, cy: number, n: number, r1: number, r2: number) {
  g.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = (i * Math.PI) / n - Math.PI / 2;
    const rr = i % 2 ? r2 : r1;
    const px = cx + Math.cos(a) * rr;
    const py = cy + Math.sin(a) * rr;
    if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
  }
  g.closePath();
}

/** emoji 在部分系统会被渲染成方框或彩色贴纸，节点图标一律手画。 */
function glyph(type: MapNode['type'], x: number, y: number, s: number, col: string) {
  g.save();
  g.strokeStyle = col;
  g.fillStyle = col;
  g.lineWidth = Math.max(2, s * 0.11);
  g.lineCap = 'round';
  g.lineJoin = 'round';

  if (type === 'fight') {
    // 一把剑：菱形剑身 + 护手 + 柄。之前用两条线交叉，远看像餐叉
    g.beginPath();
    g.moveTo(x, y - s * 0.58);
    g.lineTo(x + s * 0.1, y - s * 0.5);
    g.lineTo(x + s * 0.1, y + s * 0.02);
    g.lineTo(x - s * 0.1, y + s * 0.02);
    g.lineTo(x - s * 0.1, y - s * 0.5);
    g.closePath();
    g.fill();
    g.beginPath();
    g.moveTo(x - s * 0.32, y + s * 0.1);
    g.lineTo(x + s * 0.32, y + s * 0.1);
    g.stroke();
    g.beginPath();
    g.moveTo(x, y + s * 0.1);
    g.lineTo(x, y + s * 0.44);
    g.stroke();
    g.beginPath();
    g.arc(x, y + s * 0.52, s * 0.07, 0, Math.PI * 2);
    g.fill();
  } else if (type === 'elite') {
    // 骷髅：圆颅 + 两个眼窝 + 三颗牙。只画弧线的版本会被读成笑脸
    g.beginPath();
    g.arc(x, y - s * 0.06, s * 0.34, Math.PI * 0.86, Math.PI * 2.14);
    g.lineTo(x + s * 0.24, y + s * 0.26);
    g.lineTo(x - s * 0.24, y + s * 0.26);
    g.closePath();
    g.stroke();
    g.beginPath();
    g.arc(x - s * 0.15, y - s * 0.1, s * 0.085, 0, Math.PI * 2);
    g.arc(x + s * 0.15, y - s * 0.1, s * 0.085, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = Math.max(1.4, s * 0.055);
    for (let i = -1; i <= 1; i++) {
      g.beginPath();
      g.moveTo(x + i * s * 0.14, y + s * 0.1);
      g.lineTo(x + i * s * 0.14, y + s * 0.24);
      g.stroke();
    }
  } else if (type === 'rest') {
    star(x, y, 4, s * 0.48, s * 0.14);
    g.fill();
  } else if (type === 'event') {
    g.font = `800 ${Math.round(s * 0.9)}px ${FONT_UI}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('?', x, y + 1);
  } else {
    star(x, y, 8, s * 0.52, s * 0.24);
    g.fill();
  }
  g.restore();
}

function header(st: { name: string; sub: string; color: string }) {
  text('记忆的档案馆', 40, 52, { size: 34, weight: 700, family: FONT_TITLE, color: C.ink });
  const floor = curFloor();
  // 幕名是这一屏最重要的一个字：它告诉玩家"换地方了"，层号只回答"爬了多远"
  text(`第 ${G.stage} 幕 · ${st.name}`, 40, 86, { size: 16, color: st.color, weight: 700 });
  text(`第 ${floor} / ${FLOOR_MAX} 层`, 40, 110, { size: 13, color: C.dim });
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
  roundRect(x + 1, y + 1, w - 2, 2, 12);
  g.fillStyle = 'rgba(255,255,255,.05)';
  g.fill();

  // 生命
  text('生命', x + 20, y + 28, { size: 13, color: C.dim, weight: 600 });
  const pct = G.hp / G.maxHp;
  bar(x + 20, y + 42, w - 40, 18, pct, pct > 0.5 ? C.green : pct > 0.25 ? C.gold : C.red, {
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
  text(`${topics().length} 个主题`, x + w - 24, dy + 17, { size: 12, color: C.dim, align: 'right' });
  onClick(x + 16, dy, w - 32, 34, () => { G.panel = { k: 'deck' }; });

  // 增益牌：它们就躺在牌组里，这里只回答"这一局我带了什么进场"
  const powers = deckPowers();
  text('增益牌', x + 20, y + 146, { size: 13, color: C.dim, weight: 600 });
  if (!powers.length) {
    text('还没有。精英和幕 Boss 会掉。', x + 20, y + 170, { size: 12, color: C.faint });
    for (let i = 0; i < 3; i++) {
      g.save();
      roundRect(x + 20 + i * 48, y + 186, 40, 46, 6);
      g.fillStyle = 'rgba(255,255,255,.018)';
      g.fill();
      g.setLineDash([3, 4]);
      g.strokeStyle = C.line;
      g.lineWidth = 1;
      g.stroke();
      g.restore();
    }
  } else {
    powers.slice(0, 4).forEach((p, i) => {
      const yy = y + 164 + i * 24;
      text(p.icon, x + 24, yy + 8, { size: 12, color: p.color, weight: 800 });
      text(p.name, x + 42, yy + 8, { size: 13, color: C.ink2 });
    });
    if (powers.length > 4) {
      text(`等 ${powers.length} 张`, x + 24, y + 164 + 4 * 24 + 8, { size: 12, color: C.faint });
    }
  }

  // ── 五幕进度 ─────────────────────────────────────────────
  // 这是 100 层唯一能一眼看懂的刻度：五条横杠，每条代表 20 层。
  // 逐层画 100 个点没有意义 —— 玩家记不住 100 个位置，但记得住"我在第几幕"。
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
    // 图例必须和地图上用同一套轮廓 —— 否则"六边形是精英"这件事在图上认得出，
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
