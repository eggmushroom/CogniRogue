import { g, roundRect, VW } from '../gfx/canvas';
import { ART } from '../gfx/assets';
import { C, font, FONT_TITLE, FONT_UI, withAlpha } from '../gfx/theme';
import { bar, drawCard, icon, panel, squeeze, text } from '../gfx/ui';
import { onClick, hover } from '../input';
import { drawBackdrop, drawMotes } from '../gfx/backdrop';
import * as FX from '../gfx/fx';
import { BAL, EFFS, MODE_BY_ID, POWER_BY_ID, stageOf } from '../core/model';
import { G } from '../core/infra';
import { linkStatus, liveStatOf } from '../core/combat/link';
import { curFloor } from '../core/map';
import { canPay, cardKind, costOf, defOf, isUpgraded, isXCost, statOf } from '../core/cards';
import {
  askCard, cardAskState, endTurn, intentText, playBasic, playFree,
} from '../core/combat';
import type { CardDef, Foe, Mech } from '../core/model';

export const ENEMY = { x: 1150, y: 330 };
export const HERO = { x: 290, y: 462 };
const HAND = { cx: 765, cy: 726, w: 200, h: 238, spread: 194 };
/** 玩家立绘 410px，略小于小怪的 430；中心压低，头顶避开左上角战斗记录面板。 */
const HERO_ART = { size: 410, cx: HERO.x - 16, cy: HERO.y - 14 };
/** 提灯焰心在素材里的相对坐标；光刃从这里甩出。 */
const LAMP = { u: 0.715, v: 0.555 };
const lampAt = () => ({
  x: HERO_ART.cx + (LAMP.u - 0.5) * HERO_ART.size,
  y: HERO_ART.cy + (LAMP.v - 0.5) * HERO_ART.size,
});

let heroT = 0;

/** 提灯的位置；攻击从这里甩出去，不是从卡片。 */
export const heroHand = () => {
  const lunge = FX.heroLunge();
  const recoil = FX.heroRecoil();
  const p = lampAt();
  return {
    x: p.x + lunge * 96 - recoil * 30,
    y: p.y - lunge * 10 + Math.sin(heroT * 1.25) * 5,
  };
};

let lastEnemyKey = '';

/** 换敌人时把战斗内的临时选择清掉，避免索引指向上一场的手牌。 */
export function syncBattle() {
  const key = G.enemy ? G.enemy.key + G.enemy.maxHp : '';
  if (key !== lastEnemyKey) {
    lastEnemyKey = key;
    // 记录跨战斗复用；不清的话，新手牌会带着上一场的坐标出现。
    prevHand = [];
    prevFx = [];
    handFx = [];
    discardFx.length = 0;
  }
}

export function drawBattle(t: number, dt: number) {
  drawBackdrop(t, 0.58);
  drawMotes(t);
  topBar(t);
  // 只报会影响卡面数值的状态，玩家要能回答"为什么这张牌现在是 14 点"。
  const ls = linkStatus();
  if (ls.length) {
    text(`联动 · ${ls.join('　·　')}`, 706, 40, {
      size: 13, color: C.gold, weight: 700, maxW: 430,
    });
  }

  if (G.enemy) drawEnemy(G.enemy, t);
  drawHero(t);
  combatLog();
  energyOrb(t);
  piles();
  drawHand(t, dt);
  drawDiscards(dt);
  endTurnButton();
}

/* ── 顶部：生命 / 位置 / 解锁进度 / 本场增益 ───────────────── */

function topBar(t: number) {
  g.save();
  const grd = g.createLinearGradient(0, 0, 0, 76);
  grd.addColorStop(0, 'rgba(6,8,13,.92)');
  grd.addColorStop(1, 'rgba(6,8,13,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, VW, 100);
  g.restore();

  const pct = G.hp / G.maxHp;
  const hpCol = pct > 0.5 ? C.green : pct > 0.25 ? C.gold : C.red;
  if (pct <= 0.25 && pct > 0) {
    g.save();
    g.shadowColor = withAlpha(C.red, 0.55 + 0.25 * Math.sin(t * 6));
    g.shadowBlur = 14;
    roundRect(36, 20, 268, 22, 11);
    g.strokeStyle = withAlpha(C.red, 0.7);
    g.lineWidth = 2;
    g.stroke();
    g.restore();
  }
  bar(36, 20, 268, 22, pct, hpCol, {
    label: `${Math.max(0, G.hp)} / ${G.maxHp}`,
    ticks: 4,
  });
  icon('heart', 22, 31, 11, hpCol);

  if (G.block > 0) {
    const bx = 316;
    g.save();
    g.shadowColor = withAlpha(C.blue, 0.4);
    g.shadowBlur = 10;
    roundRect(bx, 16, 76, 30, 8);
    g.fillStyle = withAlpha(C.blue, 0.16);
    g.fill();
    g.restore();
    roundRect(bx, 16, 76, 30, 8);
    g.strokeStyle = withAlpha(C.blue, 0.6);
    g.lineWidth = 1.4;
    g.stroke();
    icon('shield', bx + 18, 31, 11, C.blue);
    text(String(G.block), bx + 37, 31, { size: 20, weight: 800, color: C.blue });
  }

  // 100 层后光看层号不够，补一行幕名；这一带的怪有什么机制会影响这一手。
  const st = stageOf(G.stage);
  icon('floor', 424, 31, 9, C.dim);
  text(`第 ${curFloor()} 层`, 438, 31, { size: 17, color: C.ink2, weight: 600 });
  text(`${st.name} · ${G.stageTopic}`, 438, 52, { size: 11, color: st.color, weight: 600 });

  const mode = G.mode ? MODE_BY_ID[G.mode] : null;
  /** 模式胶囊占多宽；没有模式时题数胶囊直接从 524 排起 */
  let modeW = 0;
  if (mode) {
    const label = `◆ ${mode.name}`;
    g.font = font(13, 600, FONT_UI);
    const tw = g.measureText(label).width + 30;
    modeW = tw + 10;
    roundRect(524, 18, tw, 26, 13);
    g.fillStyle = withAlpha(mode.color, 0.12);
    g.fill();
    g.strokeStyle = withAlpha(mode.color, 0.5);
    g.lineWidth = 1.2;
    g.stroke();
    text(label, 524 + tw / 2, 31, { size: 13, color: mode.color, weight: 600, align: 'center' });
  }

  // 本场剩余新题数。答错的代价落在这里；0 时显示「题 复用」，不是锁牌。
  {
    const left = G.qLeft.length;
    const reusing = left === 0;
    const col = reusing ? C.dim : left <= 2 ? C.red : left <= 4 ? C.gold : C.cyan;
    const bx = 524 + modeW;
    g.font = font(13, 700, FONT_UI);
    const label = reusing ? '题 复用' : `题 ${left}`;
    const bw = g.measureText(label).width + 30;
    roundRect(bx, 18, bw, 26, 13);
    g.fillStyle = withAlpha(col, 0.12);
    g.fill();
    g.strokeStyle = withAlpha(col, 0.5);
    g.lineWidth = 1.2;
    g.stroke();
    text(label, bx + bw / 2, 31, { size: 13, color: col, weight: 700, align: 'center' });
  }

  let rx = VW - 40;
  for (let i = G.powers.length - 1; i >= 0; i--) {
    const p = POWER_BY_ID[G.powers[i]];
    if (!p) continue;
    rx -= 42;
    const r = 17;
    const hv = hover(rx - r, 15, r * 2, r * 2);
    g.save();
    if (hv) { g.shadowColor = withAlpha(p.color, 0.6); g.shadowBlur = 16; }
    g.beginPath();
    g.arc(rx, 32, r, 0, Math.PI * 2);
    g.fillStyle = withAlpha(p.color, hv ? 0.3 : 0.14);
    g.fill();
    g.strokeStyle = withAlpha(p.color, hv ? 0.95 : 0.6);
    g.lineWidth = 1.4;
    g.stroke();
    g.restore();
    text(p.icon, rx, 33, { size: 15, color: p.color, align: 'center', weight: 800 });
    if (hv) {
      const tw = 250;
      panel(rx - tw / 2, 60, tw, 50, { r: 8, fill: 'rgba(8,10,16,.95)' });
      text(p.name, rx, 78, { size: 14, weight: 700, align: 'center', color: p.color });
      text(p.card, rx, 96, { size: 11, align: 'center', color: C.ink2 });
    }
  }
  if (G.powers.length) {
    text('增益', rx - 24, 33, { size: 11, color: C.dim, align: 'right' });
  }
}

/* ── 敌人 ─────────────────────────────────────────────────── */

function drawEnemy(e: Foe, t: number) {
  const bob = Math.sin(t * 1.5) * 9;
  const breathe = 1 + Math.sin(t * 1.5 + 1) * 0.012;
  // Boss 立绘 512、小怪 430；只放大立绘，意图和血条高度不变。
  const size = (e.type === 'boss' ? 512 : 430) * breathe;
  const art = ART[e.art];

  const lunge = FX.enemyLunge();
  const kick = FX.enemyRecoil();
  const hitGlow = FX.enemyFlash();

  const pose = FX.enemyPose();
  const pulse = pose ? Math.sin(Math.PI * pose.p) : 0;
  let posePush = 0;
  let poseScale = 1;
  let poseRot = 0;
  let poseBright = 0;
  if (pose?.k === 'def') { posePush = 26 * pulse; poseScale = 1 - 0.06 * pulse; }
  else if (pose?.k === 'buff') { poseScale = 1 + 0.11 * pulse; poseBright = 0.7 * pulse; }
  else if (pose?.k === 'jam') { posePush = -20 * pulse; poseRot = 0.055 * pulse; }
  else if (pose?.k === 'calm') { posePush = 12 * pulse; poseScale = 1 - 0.02 * pulse; }

  const ex = ENEMY.x - lunge * 96 + kick * 30 + posePush;
  const eh = 1 + kick * 0.05;
  const ew = 1 - kick * 0.025;
  // poseScale 只乘立绘尺寸，别再乘进 g.scale，平方后会穿出画面。
  const drawnSize = size * poseScale;

  g.save();
  const groundCol = pose?.k === 'buff' ? C.orange : pose?.k === 'def' ? C.blue
    : pose?.k === 'calm' ? C.cyan : e.type === 'boss' ? C.purple : C.cyan;
  const base = g.createRadialGradient(ENEMY.x, ENEMY.y + 210, 10, ENEMY.x, ENEMY.y + 210, 240);
  base.addColorStop(0, withAlpha(groundCol, 0.22 + hitGlow * 0.2 + pulse * 0.18));
  base.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = base;
  g.beginPath();
  g.ellipse(ENEMY.x, ENEMY.y + 210, 260, 70, 0, 0, Math.PI * 2);
  g.fill();

  // 黑底 screen 立绘容易融进柱廊，身后垫一层冷光托出来。
  const halo = g.createRadialGradient(ENEMY.x, ENEMY.y, 12, ENEMY.x, ENEMY.y, 240);
  halo.addColorStop(0, withAlpha(groundCol, 0.11));
  halo.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = halo;
  g.beginPath();
  g.arc(ENEMY.x, ENEMY.y, 240, 0, Math.PI * 2);
  g.fill();
  g.restore();

  if (art.complete && art.naturalWidth) {
    g.save();
    g.globalCompositeOperation = 'screen';
    g.globalAlpha = 0.95;
    // 先拉对比把底色压成纯黑，screen 后没有方框边。
    const hue = e.hue ? ` hue-rotate(${e.hue}deg)` : '';
    const bright = (hitGlow > 0 || poseBright > 0)
      ? ` brightness(${1 + hitGlow * 2.6 + poseBright}) saturate(1.5)` : '';
    g.filter = `contrast(1.5)${hue}${bright}`;
    g.translate(ex, ENEMY.y + bob);
    g.rotate(lunge * 0.05 - kick * 0.03 + poseRot);
    g.scale(eh, ew);
    g.drawImage(art, -drawnSize / 2, -drawnSize / 2, drawnSize, drawnSize);
    g.filter = 'none';
    g.restore();
  } else {
    g.fillStyle = withAlpha(C.purple, 0.3);
    g.beginPath();
    g.arc(ex, ENEMY.y + bob, 120, 0, Math.PI * 2);
    g.fill();
  }

  // 意图、血条、名字压成同一条横带，关于这只怪的数字都在一处。
  const by = ENEMY.y + 206;
  const it = intentText(e);
  const kind = it.icon === 'attack' ? 'attack' : it.icon === 'shield' ? 'shield'
    : it.icon === 'junk' ? 'junk' : 'buff';
  const icol = kind === 'attack' ? C.red : kind === 'shield' ? C.blue
    : kind === 'junk' ? C.orange : C.purple;

  const bw = 336;
  g.font = font(19, 700, FONT_UI);
  const iw = Math.max(84, Math.ceil(g.measureText(it.text).width) + 54);
  const gapI = 12;
  const rowW = iw + gapI + bw;
  const rowX = ENEMY.x - rowW / 2;
  intentChip(rowX, by + 10, iw, 30, it.text, kind, icol, t);
  const bx = rowX + iw + gapI;

  bar(bx, by, bw, 20, e.hp / e.maxHp, e.type === 'boss' ? C.purple : C.red, {
    r: 10, label: `${Math.max(0, e.hp)} / ${e.maxHp}`, ticks: 4,
  });
  if (e.block > 0) {
    icon('shield', bx + bw + 18, by + 10, 10, C.blue);
    text(String(e.block), bx + bw + 34, by + 10, { size: 17, color: C.blue, weight: 700 });
  }

  text(e.name, ENEMY.x, by + 40, { size: 24, align: 'center', color: C.ink, weight: 700 });
  if (e.type !== 'fight') {
    g.save();
    g.font = font(24, 700, FONT_TITLE);
    const nameW = g.measureText(e.name).width;
    g.restore();
    const tag = e.type === 'boss' ? C.gold : C.red;
    const tw = e.tag.length * 13 + 18;
    const px = ENEMY.x + nameW / 2 + tw / 2 + 10;
    roundRect(px - tw / 2, by + 28, tw, 22, 11);
    g.fillStyle = withAlpha(tag, 0.12);
    g.fill();
    g.strokeStyle = withAlpha(tag, 0.5);
    g.lineWidth = 1;
    g.stroke();
    text(e.tag, px, by + 39, { size: 12, align: 'center', color: tag, weight: 700 });
  }

  // 机制常驻一行，写触发条件和数值。机制改决策，玩家得在做决定之前知道。
  const note = mechNote(e);
  if (note) {
    text(note, ENEMY.x, by + 64, { size: 13, align: 'center', color: C.orange, weight: 700 });
  }
}

/** 机制一句话。mechV 优先，和结算同源；写死默认值会让玩家按小怪的量打 Boss。 */
function mechNote(e: Foe): string | null {
  if (!e.mech) return null;
  const v = e.mechV ?? (BAL.mech as Partial<Record<Mech, number>>)[e.mech] ?? 0;
  switch (e.mech) {
    case 'leech': return `你答错，它回 ${v} 点血`;
    case 'thorns': return `你每打出一次攻击，自己挨 ${v} 点（击杀不反伤；你的格挡挡不住）`;
    case 'bulwark': return `你答错，它 +${v} 格挡`;
    case 'fog': return `每回合少抽 ${v} 张`;
    case 'siphon': return `被它打中，下回合 −${v} 行动力`;
    case 'haste': return `每回合攻击 +${v}`;
    case 'reviewer': return `一回合没答对，额外 ${v} 点（意图已计入）`;
    case 'pierce': return '攻击无视一半格挡';
    case 'oblivion':
      return `错题主题：它 +${v}；该主题答对则 −${BAL.mech.oblivionReduce}（意图已计入）`;
    case 'lethe': return `你错一次，它永久 +${v} 攻`;
    default: return null;
  }
}

function intentChip(
  x: number, cy: number, w: number, h: number,
  label: string, kind: 'attack' | 'shield' | 'junk' | 'buff', col: string, t: number,
) {
  const y = cy - h / 2;
  const p = kind === 'attack' ? 0.55 + 0.45 * Math.sin(t * 2.4) : 0.5;
  g.save();
  g.shadowColor = withAlpha(col, 0.3 + p * 0.28);
  g.shadowBlur = 14;
  roundRect(x, y, w, h, 8);
  g.fillStyle = 'rgba(10,12,18,.92)';
  g.fill();
  g.restore();

  roundRect(x, y, w, h, 8);
  g.strokeStyle = withAlpha(col, 0.55 + p * 0.25);
  g.lineWidth = 1.4;
  g.stroke();

  g.save();
  roundRect(x, y, w, h, 8);
  g.clip();
  g.fillStyle = withAlpha(col, 0.85);
  g.fillRect(x, y, 3, h);
  g.restore();

  icon(kind, x + 18, cy, 11, col);
  text(label, x + 32, cy, { size: 18, weight: 700, color: C.ink });
}

/* ── 玩家 ─────────────────────────────────────────────────── */

function drawHero(t: number) {
  heroT = t;
  const bob = Math.sin(t * 1.25) * 5;
  const hurt = FX.heroFlash();
  const lunge = FX.heroLunge();
  const recoil = FX.heroRecoil();
  const dx = lunge * 96 - recoil * 30;
  const dy = -lunge * 10 + bob;
  const dim = FX.lampDim();
  const { cx, cy, size } = HERO_ART;
  const art = ART.hero;

  g.save();
  const groundCol = hurt > 0 ? C.red : C.blue;
  const gy = cy + 188;
  g.save();
  g.translate(cx + dx * 0.4, gy);
  g.scale(1, 0.28);
  const base = g.createRadialGradient(0, 0, 8, 0, 0, 190);
  base.addColorStop(0, withAlpha(groundCol, 0.2 + hurt * 0.2));
  base.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = base;
  g.beginPath();
  g.arc(0, 0, 190, 0, Math.PI * 2);
  g.fill();
  g.restore();
  const halo = g.createRadialGradient(cx, cy, 12, cx, cy, 215);
  halo.addColorStop(0, withAlpha(C.gold, 0.075));
  halo.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = halo;
  g.beginPath();
  g.arc(cx, cy, 215, 0, Math.PI * 2);
  g.fill();
  g.restore();

  if (art.complete && art.naturalWidth) {
    g.save();
    g.globalCompositeOperation = 'screen';
    g.globalAlpha = 0.95;
    // 与敌人同一套对比度规则；受击提亮，答错时整张稍暗，配合灯焰变矮。
    const bright = Math.max(0.4, 1.08 + hurt * 2.6 - dim * 0.2);
    g.filter = `contrast(1.5) brightness(${bright.toFixed(3)})${hurt > 0 ? ' saturate(1.5)' : ''}`;
    g.translate(cx + dx, cy + dy);
    g.rotate(lunge * 0.055 - recoil * 0.055);
    const s = 1 + lunge * 0.02 + Math.sin(t * 1.5 + 1) * 0.006;
    g.drawImage(art, -size * s / 2, -size * s / 2, size * s, size * s);
    g.filter = 'none';
    g.restore();
  } else {
    g.fillStyle = withAlpha(C.blue, 0.22);
    g.beginPath();
    g.ellipse(cx, cy, 100, 170, 0, 0, Math.PI * 2);
    g.fill();
  }

  const lp = lampAt();
  const lx = lp.x + dx;
  const ly = lp.y + dy;
  const flare = Math.max(0, lunge);
  g.save();
  g.globalCompositeOperation = 'screen';
  const lr = (34 + flare * 32) * (1 - 0.4 * dim);
  const lg = g.createRadialGradient(lx, ly, 1, lx, ly, lr);
  lg.addColorStop(0, withAlpha(C.gold, 0.42 * (1 - 0.85 * dim)));
  lg.addColorStop(0.4, withAlpha(C.gold, (0.16 + flare * 0.2) * (1 - 0.9 * dim)));
  lg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = lg;
  g.beginPath();
  g.arc(lx, ly, lr, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.arc(lx, ly, (2.6 + flare * 2) * (1 - 0.55 * dim), 0, Math.PI * 2);
  g.fillStyle = withAlpha('#fff0c0', 0.85 * (1 - 0.85 * dim));
  g.fill();
  g.restore();

  g.save();
  g.translate(dx, dy);
  for (let i = 0; i < 3; i++) {
    const a = t * (0.2 + i * 0.05) + i * 2.1;
    const px = cx + Math.cos(a) * (132 + i * 14);
    const py = cy - 24 + Math.sin(a) * (88 + i * 18);
    g.save();
    g.translate(px, py);
    g.rotate(a * 0.6);
    g.globalAlpha = 0.1 + 0.06 * Math.sin(t * 1.3 + i);
    g.fillStyle = i % 2 ? C.gold : C.ink2;
    g.beginPath();
    g.moveTo(-4, -7);
    g.lineTo(4, -6);
    g.lineTo(4, 7);
    g.lineTo(-4, 6);
    g.closePath();
    g.fill();
    g.restore();
  }
  g.restore();

  // 格挡环贴人物尺寸；太大了就是一个空荡荡的 UI 圈。
  if (G.block > 0) {
    g.save();
    g.translate(dx, dy);
    g.strokeStyle = withAlpha(C.blue, 0.48);
    g.lineWidth = 3;
    g.setLineDash([10, 8]);
    g.lineDashOffset = -t * 22;
    g.beginPath();
    g.ellipse(cx, cy + 24, 112, 158, 0, 0, Math.PI * 2);
    g.stroke();
    g.restore();
    text(String(G.block), cx + 112 + dx, cy - 96 + dy, { size: 22, weight: 800, color: C.blue });
  }

  // 状态贴角色左腰外侧，立绘下摆垂到手牌区，放头顶或脚下都会漂。
  text('你', 118, cy - 6, { size: 15, color: C.dim, align: 'left', weight: 600 });
  const weak = Object.entries(G.topicWrong).filter(([, n]) => n > 0).length;
  if (weak) text(`错题 ${weak} 主题`, 118, cy + 16, { size: 11, color: C.redDim, align: 'left' });
}

/* ── 光球 / 牌堆 / 日志 ───────────────────────────────────── */

function energyOrb(t: number) {
  const x = 86;
  const y = 688;
  const r = 48;
  const p = G.ap / G.apMax;

  g.save();
  const glow = g.createRadialGradient(x, y, 4, x, y, r * 2.1);
  glow.addColorStop(0, withAlpha(C.gold, 0.35 * (0.4 + p)));
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = glow;
  g.beginPath();
  g.arc(x, y, r * 2.1, 0, Math.PI * 2);
  g.fill();
  g.restore();

  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  const ig = g.createRadialGradient(x - 14, y - 16, 4, x, y, r);
  ig.addColorStop(0, p > 0 ? '#2a2412' : '#161821');
  ig.addColorStop(1, '#0a0c12');
  g.fillStyle = ig;
  g.fill();
  g.strokeStyle = withAlpha(C.gold, p > 0 ? 0.9 : 0.25);
  g.lineWidth = 2.5;
  g.stroke();

  g.beginPath();
  g.arc(x, y, r - 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p);
  g.strokeStyle = withAlpha(C.gold, 0.85);
  g.lineWidth = 4;
  g.lineCap = 'round';
  g.stroke();

  for (let i = 0; i < G.apMax; i++) {
    const a = -Math.PI / 2 + (Math.PI * 2 * i) / G.apMax;
    g.beginPath();
    g.moveTo(x + Math.cos(a) * (r - 9), y + Math.sin(a) * (r - 9));
    g.lineTo(x + Math.cos(a) * (r - 3), y + Math.sin(a) * (r - 3));
    g.strokeStyle = 'rgba(6,8,13,.9)';
    g.lineWidth = 3.5;
    g.stroke();
  }

  text(String(G.ap), x, y - 6, {
    size: 38, weight: 800, align: 'center',
    color: p > 0 ? C.gold : C.faint,
  });
  // 刻度已经表示格数，这里写标签，告诉玩家这个数字是行动力。
  text('行动力', x, y + 26, { size: 12, align: 'center', color: C.dim });

  if (p > 0) {
    const pulse = 0.5 + 0.5 * Math.sin(t * 3);
    g.globalAlpha = 0.18 + pulse * 0.12;
    g.beginPath();
    g.arc(x, y, r + 8 + pulse * 4, 0, Math.PI * 2);
    g.strokeStyle = C.gold;
    g.lineWidth = 2;
    g.stroke();
    g.globalAlpha = 1;
  }
}

function piles() {
  const pile = (
    x: number, y: number, label: string, n: number, col: string,
    ic: 'cards' | 'discard', fn: () => void, pulse = 0,
  ) => {
    const hv = hover(x, y, 96, 42);
    roundRect(x, y, 96, 42, 8);
    g.fillStyle = hv ? 'rgba(255,255,255,.09)' : 'rgba(255,255,255,.035)';
    g.fill();
    g.strokeStyle = pulse > 0 ? withAlpha(col, 0.35 + pulse * 0.5) : hv ? withAlpha(col, 0.7) : C.line;
    g.lineWidth = 1.3 + pulse * 1.1;
    g.stroke();
    icon(ic, x + 18, y + 21, 11, hv ? col : C.dim);
    g.save();
    if (pulse > 0) {
      g.translate(x + 44, y + 22);
      g.scale(1 + pulse * 0.32, 1 + pulse * 0.32);
      text(String(n), 0, 0, { size: 19, weight: 800, align: 'center', color: col });
    } else {
      text(String(n), x + 44, y + 22, { size: 19, weight: 800, align: 'center', color: col });
    }
    g.restore();
    text(label, x + 76, y + 22, { size: 12, align: 'center', color: C.dim });
    onClick(x, y, 96, 42, fn);
  };

  // 还在飞的牌已进 G.discard，计数等落地；洗牌帧差额为负，卡在 0。
  let incoming = 0;
  for (const f of discardFx) if (f.mode === 'discard') incoming += 1;

  pile(44, 762, '抽牌', G.draw.length, C.blue, 'cards', () => { G.panel = { k: 'pile', kind: 'draw' }; });
  pile(44, 812, '弃牌', Math.max(0, G.discard.length - incoming), C.orange, 'discard', () => {
    G.panel = { k: 'pile', kind: 'discard' };
  }, discardPulse);
}

function combatLog() {
  const lines = G.log.slice(-5);
  const x = 36;
  const y0 = 92;
  const w = 316;
  const head = 28;
  const lh = 21;
  const h = head + lines.length * lh + 12;

  g.save();
  roundRect(x, y0, w, h, 10);
  g.fillStyle = 'rgba(10,13,20,.93)';
  g.fill();
  g.strokeStyle = withAlpha(C.lineHi, 0.45);
  g.lineWidth = 1.2;
  g.stroke();
  g.save();
  roundRect(x, y0, w, h, 10);
  g.clip();
  g.fillStyle = withAlpha(C.gold, 0.42);
  g.fillRect(x, y0, 2.5, h);
  g.restore();
  g.restore();

  text('战斗记录', x + 16, y0 + 17, { size: 11, weight: 700, color: C.faint });
  g.beginPath();
  g.moveTo(x + 16, y0 + head - 5);
  g.lineTo(x + w - 14, y0 + head - 5);
  g.strokeStyle = 'rgba(255,255,255,.1)';
  g.lineWidth = 1;
  g.stroke();

  lines.forEach((l, i) => {
    const col = l.kind === 'hi' ? C.green : l.kind === 'bad' ? C.red : l.kind === 'turn' ? C.gold : C.dim;
    g.font = font(14, l.kind === 'turn' ? 700 : 400, FONT_UI);
    g.fillStyle = col;
    g.globalAlpha = 0.72 + 0.28 * (i / Math.max(1, lines.length - 1));
    g.textAlign = 'left';
    // 按像素宽度截断；按字符数切，长句会溢出面板。
    g.fillText(squeeze(l.msg, w - 30), x + 16, y0 + head + 11 + i * lh);
    g.globalAlpha = 1;
  });
}

/* ── 手牌 ─────────────────────────────────────────────────── */

interface Slot { x: number; y: number; rot: number; i: number }

/**
 * 抽牌在逻辑层是瞬间的；这里补牌从牌堆出来的 0.3 秒，每张牌排队起飞。
 * 飞行记录按 `G.hand` 下标存，不按 id：同名四张斩击共用一条记录，打掉一张就看不出来。
 */
interface DrawFx {
  age: number;
  px: number;
  py: number;
  /** 含悬停抬升；牌离手时从这里起飞，否则会向下跳。 */
  dx: number;
  dy: number;
  rot: number;
}

const DRAW_FROM = { x: 86, y: 783 };
/** 弃牌堆中心：敌人塞的杂念要真的飞到这里。 */
export const DISCARD_TO = { x: 86, y: 833 };
const DRAW_DUR = 0.27;
const DRAW_GAP = 0.045;
/** 必须短于 panelHold，否则反馈面板会把它盖掉。 */
const DISCARD_DUR = 0.3;
const DISCARD_GAP = 0.035;

/** 出牌在逻辑层是瞬时的；不补这段飞行，牌就是凭空消失。 */
interface DiscardFx {
  card: CardDef;
  atk: number;
  blk: number;
  up: boolean;
  x: number;
  y: number;
  rot: number;
  /** 负数 = 还在排队 */
  age: number;
  /** discard 飞向左下角弃牌堆，落地计数 +1；junk 原地化掉，不进弃牌堆。 */
  mode: 'discard' | 'junk';
}

/** 与 `prevFx` / `prevHand` 平行；每帧先用 `alignHand()` 把记录挪到新下标。 */
let handFx: DrawFx[] = [];
const discardFx: DiscardFx[] = [];
let prevHand: string[] = [];
let prevFx: DrawFx[] = [];
/** 被点开的那一张：id + 当时的下标。知识卡答完才离手，记到真的少一张才用掉。 */
let eject: { id: string; at: number } | null = null;
let discardPulse = 0;

function layoutHand(): Slot[] {
  const n = G.hand.length;
  if (!n) return [];
  // 手牌尽量不重叠。990 是能量球到结束回合按钮的中心跨度；7 张时用 1180 会压到按钮。
  const spread = n <= 1 ? 0 : Math.min(HAND.spread, 990 / (n - 1));
  const totalW = (n - 1) * spread;
  const out: Slot[] = [];
  for (let i = 0; i < n; i++) {
    const x = HAND.cx - totalW / 2 + i * spread;
    const off = (x - HAND.cx) / 620;
    out.push({ x, y: HAND.cy + Math.abs(off) * 34, rot: off * 0.055, i });
  }
  return out;
}

const easeOut = (p: number) => 1 - Math.pow(1 - p, 3);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * 对齐上一帧与这一帧的同一张牌，返回 `keep[j] = 上一帧下标`（-1 = 新抽到）。
 * 逐位比对会让整排同名牌错位；`skip` 是确定离手的那一格，必须剔除，否则飞走的是最左份。
 */
function alignHand(prev: string[], hand: string[], skip = -1): number[] {
  const src: number[] = [];
  for (let i = 0; i < prev.length; i++) if (i !== skip) src.push(i);
  const n = src.length;
  const m = hand.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = prev[src[i]] === hand[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const keep: number[] = new Array(m).fill(-1);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (prev[src[i]] === hand[j]) { keep[j] = src[i]; i += 1; j += 1; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i += 1;
    else j += 1;
  }
  return keep;
}

function drawHand(t: number, dt: number) {
  const slots = layoutHand();
  const foeActing = FX.enemyBusy();

  // 先对齐，再分谁飞进来、谁飞出去；被点中的那格从对齐里剔掉。
  let skip = -1;
  const ej = eject;
  if (ej) {
    const was = prevHand.filter((v) => v === ej.id).length;
    const now = G.hand.filter((v) => v === ej.id).length;
    if (now < was && prevHand[ej.at] === ej.id) { skip = ej.at; eject = null; }
    // 面板关了牌还在手里，说明没打出去，别留到下一手。
    else if (G.panel.k !== 'question') eject = null;
  }
  const keep = alignHand(prevHand, G.hand, skip);
  const kept = new Set(keep.filter((i) => i >= 0));
  const nextFx: DrawFx[] = new Array(G.hand.length);
  keep.forEach((pi, j) => { if (pi >= 0) nextFx[j] = prevFx[pi]; });

  // 离手的牌从最后画到的位置起飞；弃牌堆是唯一去处，杂念原地化掉。
  let laneOut = 0;
  for (let pi = 0; pi < prevHand.length; pi++) {
    if (kept.has(pi)) continue;
    const fx = prevFx[pi];
    const id = prevHand[pi];
    if (!fx || !id) continue;
    const card = defOf(id);
    // 读 core 的结论，表现层不重复算规则。
    const kind = cardKind(card);
    const mode: DiscardFx['mode'] = kind === 'junk' ? 'junk' : 'discard';
    const st = statOf(id);
    discardFx.push({
      card, atk: st.atk, blk: st.blk, up: isUpgraded(id),
      x: fx.dx, y: fx.dy, rot: fx.rot,
      age: mode === 'junk' ? 0 : -laneOut * DISCARD_GAP,
      mode,
    });
    if (mode === 'discard') laneOut += 1;
  }

  let lane = 0;
  for (let j = 0; j < G.hand.length; j++) {
    if (nextFx[j]) continue;
    nextFx[j] = {
      age: -lane * DRAW_GAP,
      px: DRAW_FROM.x, py: DRAW_FROM.y,
      dx: DRAW_FROM.x, dy: DRAW_FROM.y,
      rot: -0.42,
    };
    lane += 1;
  }
  handFx = nextFx;
  // 敌人出手期间新牌留在牌堆，两拨飞行叠在一起会糊；age 推进按牌走，不在这里统一加 dt。

  for (const s of slots) {
    const id = G.hand[s.i];
    if (!id) continue;
    const fx = handFx[s.i];
    if (!fx) continue;
    // 排队中的牌也要推进 age；先 continue 再推进，牌会永远停在队列里，一手牌不落位。
    const before = fx.age;
    if (!foeActing) fx.age += dt;
    if (fx.age < 0) continue; // 还在队列里，这张牌此刻不存在
    const card = defOf(id);
    // 手牌数字是这一刻打出去的数值，不是卡面底数。
    const st = liveStatOf(id);

    if (before < 0) {
      FX.burst(DRAW_FROM.x, DRAW_FROM.y, C.blue, 4, {
        speed: 150, size: 3, grav: -70, life: 0.4,
      });
    }

    const flying = fx.age < DRAW_DUR;
    let px: number;
    let py: number;
    let rot = s.rot;
    let scale = 1;
    let alpha = 1;

    if (flying) {
      const p = clamp01(Math.max(0, fx.age) / DRAW_DUR);
      const e = easeOut(p);
      // 抛物线才有抽牌的重量；弧高错开，连抽不会叠成一条线。
      const cx = (DRAW_FROM.x + s.x) / 2;
      const cy = Math.min(DRAW_FROM.y, s.y) - (92 + (s.i % 3) * 24);
      const iu = 1 - e;
      px = iu * iu * DRAW_FROM.x + 2 * iu * e * cx + e * e * s.x;
      py = iu * iu * DRAW_FROM.y + 2 * iu * e * cy + e * e * s.y;
      rot = -0.42 + (s.rot + 0.42) * e;
      scale = 0.6 + 0.4 * e + 0.05 * Math.sin(p * Math.PI);
      alpha = 0.3 + 0.7 * Math.min(1, p * 2.6);
    } else {
      const k = 1 - Math.exp(-dt * 18);
      px = fx.px + (s.x - fx.px) * k;
      py = fx.py + (s.y - fx.py) * k;
    }
    // 存归位位置而不是含悬停抬升的位置，否则一直悬停会把基准点越推越高。
    fx.px = px;
    fx.py = py;
    fx.rot = rot;

    const hv = !flying && hover(px - HAND.w / 2, py - HAND.h / 2, HAND.w, HAND.h);
    // 悬停只抬高不放大太多；卡面字要清晰，又不能挡邻居。
    if (hv) { scale *= 1.06; py -= 44; }
    else if (!flying) py -= Math.sin(t * 1.4 + s.i) * 2;

    const w = HAND.w * scale;
    const h = HAND.h * scale;
    fx.dx = px;
    fx.dy = py;

    const kind = cardKind(card);
    const isJunk = kind === 'junk';
    const isBase = kind === 'basic';
    // 知识卡两种状态：ask / free。'free' 不压暗，它是最强状态，压暗会读成用不了。
    const askState = isJunk || isBase ? 'other' : cardAskState(id);

    g.save();
    g.globalAlpha = alpha;
    g.translate(px, py);
    g.rotate(rot);
    drawCard(-w / 2, -h / 2, w, h, card, st.atk, st.blk, {
      up: isUpgraded(id), glow: hv, hovered: hv,
      afford: isJunk || canPay(card),
      rule: card.link?.note,
    });
    g.restore();

    // 还在飞的牌不注册热区，但下标必须带上；少一项会让热区和牌整体错位。
    if (flying) continue;

    const payUp = () => {
      if (canPay(card)) return true;
      FX.shake(6);
      FX.floatText(HAND.cx, HAND.cy - 54,
        isXCost(card) ? '行动力不够：X 费牌至少要 1 点'
          : `行动力不够：这张牌要 ${costOf(card)} 点`,
        C.red, 20, { vy: -34 });
      return false;
    };

    /**
     * 热区是上一帧注册的，闭包里的 `s.i` 可能已指向别的牌。
     * 先认原位，不在了才 indexOf；同名四张一律 indexOf 会总是拿走最左份。
     */
    const idxOf = () => (G.hand[s.i] === id ? s.i : G.hand.indexOf(id));
    const cardPulse = (c: string) => {
      FX.ring(px, py - h / 2, withAlpha(c, 0.5), 46, 0.32);
      FX.burst(px, py - h / 2 + 10, c, 8, {
        speed: 140, size: 3, grav: -90, life: 0.42,
      });
    };

    if (isBase) {
      onClick(px - w / 2, py - h / 2, w, h, () => {
        const i = idxOf();
        if (i < 0 || !payUp()) return;
        cardPulse(C.gold);
        eject = { id, at: i };
        playBasic(i);
      }, 'card', s.i);
    } else if (!isJunk) {
      onClick(px - w / 2, py - h / 2, w, h, () => {
        const i = idxOf();
        if (i < 0 || !payUp()) return;
        cardPulse(EFFS[card.eff]?.color ?? C.gold);
        eject = { id, at: i };
        // 攒满等级直接打，否则抽题；新题用完 askCard 会复用，不用单独分支。
        if (askState === 'free') playFree(i); else askCard(i);
      }, 'card', s.i);
    } else {
      onClick(px - w / 2, py - h / 2, w, h, () => {
        text('杂念打不出去，回合结束会自己散去', HAND.cx, HAND.cy - 40, {
          size: 18, align: 'center', color: C.dim,
        });
        FX.shake(4);
      }, 'junk', s.i);
    }
  }


  // 存画出去的坐标（含悬停抬升），牌离手时才不向下跳。
  prevHand = G.hand.slice();
  prevFx = handFx.slice();

  if (!G.hand.length && G.pending === null) {
    text('手里没牌了 —— 结束回合', HAND.cx, HAND.cy - 40, { size: 20, align: 'center', color: C.dim });
  }
}


/** 真牌加速下坠、缩小淡出；杂念原地化掉，和 core 的处理一致。 */
function drawDiscards(dt: number) {
  discardPulse = Math.max(0, discardPulse - dt * 2.4);

  for (let i = discardFx.length - 1; i >= 0; i--) {
    const f = discardFx[i];
    f.age += dt;
    if (f.age < 0) continue;
    const p = clamp01(f.age / DISCARD_DUR);

    let px = f.x;
    let py = f.y;
    let rot = f.rot;
    let scale = 1;
    let alpha = 1;
    let landing = false;

    if (f.mode === 'junk') {
      const e = p * p;
      py = f.y - e * 28;
      scale = 1 - 0.3 * e;
      alpha = 1 - e;
      rot = f.rot + e * 0.2;
    } else {
      const e = p * p;
      const cx = (f.x + DISCARD_TO.x) / 2;
      const cy = Math.min(f.y, DISCARD_TO.y) + 46;
      const iu = 1 - e;
      px = iu * iu * f.x + 2 * iu * e * cx + e * e * DISCARD_TO.x;
      py = iu * iu * f.y + 2 * iu * e * cy + e * e * DISCARD_TO.y;
      rot = f.rot - 0.5 * e;
      scale = 1 - 0.62 * e;
      alpha = 1 - Math.max(0, (p - 0.74) / 0.26) * 0.9;
      if (p >= 1) landing = true;
    }

    if (p >= 1 || landing) {
      discardFx.splice(i, 1);
      if (landing && f.mode === 'discard') {
        discardPulse = 1;
        FX.burst(DISCARD_TO.x, DISCARD_TO.y - 6, C.orange, 3, {
          speed: 90, size: 3, grav: 320, life: 0.3,
        });
      }
      continue;
    }

    const w = HAND.w * scale;
    const h = HAND.h * scale;
    g.save();
    g.globalAlpha = alpha;
    g.translate(px, py);
    g.rotate(rot);
    drawCard(-w / 2, -h / 2, w, h, f.card, f.atk, f.blk, { up: f.up });
    g.restore();
  }
}

function endTurnButton() {
  const x = 1392;
  const y = 736;
  const w = 176;
  const h = 66;
  const hv = hover(x, y, w, h);
  /**
   * 「结束回合」必须永远注册热区：无牌可打时它是唯一还能做的事，按"有没有牌"决定会锁死。
   * 只有演出中和结算中才不该点。
   */
  const ready = !G.busy && G.pending === null;

  g.save();
  if (hv && ready) { g.shadowColor = withAlpha(C.gold, 0.45); g.shadowBlur = 22; }
  roundRect(x, y, w, h, 12);
  g.fillStyle = hv && ready ? withAlpha(C.gold, 0.22) : 'rgba(20,24,34,.9)';
  g.fill();
  g.restore();
  roundRect(x, y, w, h, 12);
  g.strokeStyle = !ready ? withAlpha(C.gold, 0.22) : hv ? C.gold : withAlpha(C.gold, 0.5);
  g.lineWidth = 1.8;
  g.stroke();

  icon('turn', x + 44, y + h / 2, 15, ready ? (hv ? C.gold : C.ink2) : C.faint);
  text('结束回合', x + w / 2 + 18, y + h / 2 + 1, {
    size: 21, weight: 700, align: 'center', color: ready ? C.ink : C.dim,
  });

  onClick(x, y, w, h, () => endTurn(), 'endturn');

  const dx = 1392;
  const dy = 646;
  const dhv = hover(dx, dy, 176, 46);
  roundRect(dx, dy, 176, 46, 10);
  g.fillStyle = dhv ? 'rgba(255,255,255,.1)' : 'rgba(20,24,34,.85)';
  g.fill();
  g.strokeStyle = dhv ? C.lineHi : C.line;
  g.lineWidth = 1.2;
  g.stroke();
  icon('cards', dx + 42, dy + 23, 11, dhv ? C.ink2 : C.dim);
  text(`牌组 ${G.deck.length}`, dx + 97, dy + 23, { size: 15, align: 'center', color: dhv ? C.ink : C.ink2 });
  onClick(dx, dy, 176, 46, () => { G.panel = { k: 'deck' }; }, 'deck');
}

/** 调试/冒烟用：在飞的牌数量；飞不完的单元会在屏幕上永远留一张牌。 */
export function fxCount() {
  return {
    hand: handFx.length,
    discard: discardFx.length,
    /** 调试/冒烟用：每张飞出去的牌去了哪；G.discard 看不出方向。 */
    discardModes: discardFx.map((f) => f.mode),
  };
}

/**
 * 调试/冒烟用：所有牌飞完且离落点不到 1px。测试不能拿 sleep 当状态，
 * 慢机器会点到半空中的牌。
 */
export function handSettled() {
  const slots = layoutHand();
  if (slots.length !== handFx.length) return false;
  for (const s of slots) {
    const fx = handFx[s.i];
    if (!fx || fx.age < DRAW_DUR) return false;
    if (Math.abs(fx.px - s.x) > 1 || Math.abs(fx.py - s.y) > 1) return false;
  }
  return true;
}

export function resetBattleView() {
  lastEnemyKey = '';
  prevHand = [];
  prevFx = [];
  handFx = [];
  // 换场时清掉被点走的那格；下标和 id 都是旧的。
  eject = null;
  discardFx.length = 0;
  discardPulse = 0;
  FX.clearFx();
}
