import { g, roundRect, VW } from '../gfx/canvas';
import { C, FONT_TITLE, FONT_UI, withAlpha } from '../gfx/theme';
import { bar, panel, text } from '../gfx/ui';
import { onClick, hover } from '../input';
import { drawBackdrop, drawMotes } from '../gfx/backdrop';
import { NODE_META } from '../core/model';
import { G } from '../core/infra';
import { topics } from '../core/cards';
import { deckPowers } from '../core/cards';
import { MAP_ROWS, availableNodes } from '../core/map';
import { enterNode } from '../core/journey';
import type { MapNode } from '../core/model';


const TOP_Y = 132;
const BOT_Y = 788;
const X0 = 540;
const DX = 260;

const yOf = (r: number) => BOT_Y - ((BOT_Y - TOP_Y) * r) / (MAP_ROWS - 1);
const xOf = (c: number) => X0 + c * DX;

export function drawMap(t: number) {
  drawBackdrop(t, 0.66);
  drawMotes(t);

  columns(t);
  header();
  leftPanel();

  const avail = new Set(availableNodes());
  const cur = G.pos ? G.map[G.pos.r][G.pos.i].key : null;

  // 连线先画，节点压在上面
  for (let r = 0; r < MAP_ROWS - 1; r++) {
    for (const nd of G.map[r]) {
      const a = { x: xOf(nd.col), y: yOf(nd.r) };
      const walked = G.seen[nd.key];
      for (const j of nd.next) {
        const b = { x: xOf(G.map[r + 1][j].col), y: yOf(r + 1) };
        const live = walked || avail.has(`${r + 1}:${j}`);
        g.save();
        g.beginPath();
        g.moveTo(a.x, a.y);
        g.bezierCurveTo(a.x, a.y - 46, b.x, b.y + 46, b.x, b.y);
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

  for (let r = 0; r < MAP_ROWS; r++) {
    for (const nd of G.map[r]) drawNode(nd, t, avail.has(nd.key), nd.key === cur);
  }

  // 底部提示
  text(
    avail.size ? '点击发光的节点继续' : '这条路的尽头，是你要面对的东西',
    VW / 2 + 120, 866, { size: 15, align: 'center', color: C.dim },
  );
}

function drawNode(nd: MapNode, t: number, avail: boolean, isCur: boolean) {
  const x = xOf(nd.col);
  const y = yOf(nd.r);
  const meta = NODE_META[nd.type];
  const seen = !!G.seen[nd.key];
  const r = nd.type === 'boss' ? 44 : 32;
  const hv = avail && hover(x - r - 8, y - r - 8, (r + 8) * 2, (r + 8) * 2);

  // 可选节点的呼吸光环
  if (avail) {
    const p = 0.5 + 0.5 * Math.sin(t * 3 + nd.r * 0.8);
    g.save();
    const gl = g.createRadialGradient(x, y, r * 0.5, x, y, r * 2.6);
    gl.addColorStop(0, withAlpha(meta.color, 0.4 + p * 0.25));
    gl.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gl;
    g.beginPath();
    g.arc(x, y, r * 2.6, 0, Math.PI * 2);
    g.fill();
    g.restore();

    g.beginPath();
    g.arc(x, y, r + 6 + p * 5, 0, Math.PI * 2);
    g.strokeStyle = withAlpha(meta.color, 0.55 + p * 0.35);
    g.lineWidth = 2;
    g.stroke();
  }

  // 底盘
  g.beginPath();
  g.arc(x, y, r * (hv ? 1.09 : 1), 0, Math.PI * 2);
  const grd = g.createRadialGradient(x, y - r * 0.4, 2, x, y, r);
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
  g.stroke();

  // 内圈细环：底盘从"一个圆"变成"一枚徽章"，图标才不像直接贴在背景上
  g.beginPath();
  g.arc(x, y, r - 5, 0, Math.PI * 2);
  g.strokeStyle = withAlpha(meta.color, avail || seen ? 0.3 : 0.14);
  g.lineWidth = 1;
  g.stroke();

  const col = avail || seen ? meta.color : withAlpha(meta.color, 0.55);
  g.save();
  g.globalAlpha = avail || seen ? 1 : 0.85;
  glyph(nd.type, x, y, r * 1.3, col);
  g.restore();

  // 已走过的打勾
  if (seen && !avail) {
    g.beginPath();
    g.arc(x + r * 0.75, y - r * 0.75, 9, 0, Math.PI * 2);
    g.fillStyle = withAlpha(C.green, 0.9);
    g.fill();
    text('✓', x + r * 0.75, y - r * 0.74, { size: 12, color: '#04140c', align: 'center', weight: 900 });
  }

  if (isCur) {
    text('这里', x, y + r + 22, { size: 12, align: 'center', color: C.ink2 });
  }

  if (avail) {
    if (hv) text(meta.k, x, y - r - 14, { size: 14, align: 'center', color: meta.color, weight: 700 });
    onClick(x - r - 8, y - r - 8, (r + 8) * 2, (r + 8) * 2, () => enterNode(nd.key), 'node');
  }
}

/** 三道竖直光柱：给三列节点一个"塔"的结构，不然只是一堆飘着的圆。 */
function columns(t: number) {
  for (let c = 0; c < 3; c++) {
    const x = xOf(c);
    const grd = g.createLinearGradient(0, TOP_Y - 60, 0, BOT_Y + 70);
    grd.addColorStop(0, 'rgba(120,150,220,0)');
    grd.addColorStop(0.5, `rgba(120,150,220,${0.035 + Math.sin(t * 0.8 + c) * 0.008})`);
    grd.addColorStop(1, 'rgba(120,150,220,0)');
    g.fillStyle = grd;
    g.fillRect(x - 46, TOP_Y - 60, 92, BOT_Y - TOP_Y + 130);
  }
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

function header() {
  text('记忆的档案馆', 40, 52, { size: 34, weight: 700, family: FONT_TITLE, color: C.ink });
  const floor = G.pos ? G.pos.r + 1 : 1;
  text(`第 ${floor} / ${MAP_ROWS} 层`, 40, 86, { size: 15, color: C.gold, weight: 600 });
  // 一道短金线把标题和层级收在一起，和地图里"走过的路"同一个颜色
  g.fillStyle = withAlpha(C.gold, 0.55);
  g.fillRect(40, 98, 46, 2);
}

function leftPanel() {
  const x = 40;
  const y = 118;
  const w = 300;
  const h = 470;

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
  const dy = y + 88;
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
  text('增益牌', x + 20, y + 150, { size: 13, color: C.dim, weight: 600 });
  if (!powers.length) {
    text('还没有。精英会掉，事件里也有。', x + 20, y + 176, { size: 12, color: C.faint });
    // 三个虚线空槽：这一块原本是大片空白，空槽让它读成"还没填的卡位"，而不是没画完
    for (let i = 0; i < 3; i++) {
      g.save();
      roundRect(x + 20 + i * 48, y + 194, 40, 52, 6);
      g.fillStyle = 'rgba(255,255,255,.018)';
      g.fill();
      g.setLineDash([3, 4]);
      g.strokeStyle = C.line;
      g.lineWidth = 1;
      g.stroke();
      g.restore();
    }
  } else {
    // 面板高度装得下 5 行；再多就折成一句，别压到下面的图例上
    powers.slice(0, 5).forEach((p, i) => {
      const yy = y + 168 + i * 26;
      text(p.icon, x + 24, yy + 8, { size: 12, color: p.color, weight: 800 });
      text(p.name, x + 42, yy + 8, { size: 13, color: C.ink2 });
    });
    if (powers.length > 5) {
      text(`等 ${powers.length} 张`, x + 24, y + 168 + 5 * 26 + 8, { size: 12, color: C.faint });
    }
  }

  // 路径进度：把"走到第几层了"做成一条看得见的轨道，
  // 顺手填上增益牌和图例之间那两百多像素的空白。
  const floorNow = G.pos ? G.pos.r + 1 : 1;
  const py = y + 268;
  text('路径', x + 20, py, { size: 13, color: C.dim, weight: 600 });
  text(`${Math.min(MAP_ROWS, floorNow)} / ${MAP_ROWS}`, x + w - 20, py, {
    size: 12, color: C.gold, align: 'right', weight: 700,
  });
  const tx = x + 24;
  const tw = w - 48;
  const step = tw / (MAP_ROWS - 1);
  const ty = py + 30;
  g.beginPath();
  g.moveTo(tx, ty);
  g.lineTo(tx + tw, ty);
  g.strokeStyle = C.line;
  g.lineWidth = 2;
  g.stroke();
  for (let i = 0; i < MAP_ROWS; i++) {
    const cx = tx + i * step;
    const done = i < floorNow - 1;
    const now = i === floorNow - 1;
    if (now) {
      const gl = g.createRadialGradient(cx, ty, 1, cx, ty, 16);
      gl.addColorStop(0, withAlpha(C.gold, 0.45));
      gl.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gl;
      g.beginPath();
      g.arc(cx, ty, 16, 0, Math.PI * 2);
      g.fill();
    }
    g.beginPath();
    g.arc(cx, ty, now ? 6 : 4, 0, Math.PI * 2);
    g.fillStyle = done ? withAlpha(C.gold, 0.8) : now ? C.gold : C.panel;
    g.fill();
    g.strokeStyle = done || now ? C.gold : C.lineHi;
    g.lineWidth = 1.4;
    g.stroke();
  }

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
    const cx = x + 30 + (i % 3) * 96;
    const cy = ly + 48 + Math.floor(i / 3) * 28;
    glyph(k, cx, cy, 26, NODE_META[k].color);
    text(NODE_META[k].k, cx + 16, cy, { size: 12, color: C.ink2 });
  });
}
