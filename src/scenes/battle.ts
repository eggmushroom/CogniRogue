import { g, roundRect, VW } from '../gfx/canvas';
import { ART } from '../gfx/assets';
import { C, font, FONT_TITLE, FONT_UI, withAlpha } from '../gfx/theme';
import { bar, drawCard, icon, panel, squeeze, text } from '../gfx/ui';
import { onClick, hover } from '../input';
import { drawBackdrop, drawMotes } from '../gfx/backdrop';
import * as FX from '../gfx/fx';
import { POWER_BY_ID } from '../core/model';
import { G } from '../core/infra';
import { cardKind, defOf, powerOf, statOf } from '../core/cards';
import {
  askCard, canAsk, endTurn, intentText, isForgotten, isUnlocked, playBasic, playPower,
  playUnlocked, unlockStats,
} from '../core/combat';
import type { CardDef, CardInst, Foe } from '../core/model';

/** 增益牌飞向的位置：右上角第一个增益槽。和 topBar 里的排布常量对齐。 */
export const POWER_SLOT = { x: VW - 82, y: 32 };

export const ENEMY = { x: 1150, y: 330 };
export const HERO = { x: 290, y: 462 };
const HAND = { cx: 765, cy: 726, w: 200, h: 238, spread: 194 };

/** 提灯的位置。攻击是从这里甩出去的，不是从卡片飞出去。 */
export const heroHand = () => ({ x: HERO.x + 62, y: HERO.y + 6 });

let lastEnemyKey = '';

/** 换敌人时把战斗内的临时选择清掉，避免索引指向上一场的手牌。 */
export function syncBattle() {
  const key = G.enemy ? G.enemy.key + G.enemy.maxHp : '';
  if (key !== lastEnemyKey) {
    lastEnemyKey = key;
    // 新的一场战斗：手牌表清空，开局那 5–6 张才能重新从牌堆飞进来。
    // 牌实例是跨战斗复用的（deck 里就是同一批对象），不清的话它们会带着上场的坐标出现。
    prevHand = new Set();
    discardFx.length = 0;
  }
}

export function drawBattle(t: number, dt: number) {
  drawBackdrop(t, 0.58);
  drawMotes(t);
  topBar(t);

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
  // 濒死时整条血条微微发红呼吸 —— 不用文字提醒，颜色自己在喊
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
  // 心脏压在血条左端：先看到"这是生命"，再读到数字
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

  // 楼层：图标 + 文字，比一行裸字多一个可辨识的锚点
  const floor = G.node ? G.node.r + 1 : G.pos ? G.pos.r + 1 : 1;
  icon('floor', 424, 31, 9, C.dim);
  text(`第 ${floor} 层`, 438, 31, { size: 17, color: C.ink2, weight: 600 });

  // 敌人等级做成徽章胶囊：普通/精英/首领用色环一圈，比裸文字更像"身份"
  if (G.enemy) {
    const tag = G.enemy.type === 'boss' ? C.gold : G.enemy.type === 'elite' ? C.red : C.ink2;
    const tw = G.enemy.tag.length * 16 + 24;
    roundRect(496, 18, tw, 26, 13);
    g.fillStyle = withAlpha(tag, 0.12);
    g.fill();
    g.strokeStyle = withAlpha(tag, 0.55);
    g.lineWidth = 1.2;
    g.stroke();
    text(G.enemy.tag, 496 + tw / 2, 31, { size: 14, color: tag, weight: 700, align: 'center' });
  }

  // 解锁进度：这一场真正的资源。它比伤害数字更该一眼看见 ——
  // 玩家每一手的取舍都是"要不要花行动力去解锁"。
  const us = unlockStats();
  if (us.total) {
    const full = us.n >= us.total;
    const col = full ? C.gold : C.cyan;
    const pulse = full ? 1 : 1 + Math.sin(t * 5) * 0.03;
    g.save();
    g.translate(636, 26);
    g.scale(pulse, pulse);
    icon(full ? 'check' : 'lock', 0, 5, 9, col);
    text(`${us.n}/${us.total}`, 16, 6, { size: 18, weight: 800, color: col });
    text('已解锁', 62, 7, { size: 12, color: C.dim });
    g.restore();
    // 计数下面一条迷你进度：不占地方，但"还差几个"不用心算了
    bar(636, 44, 92, 4, us.n / us.total, col, { r: 2 });
  }

  // 本场已打出的增益牌。它不再是"装备栏"：每场开头清空、每场重新打，
  // 所以这一排实际上是这一场你已经花掉的行动力账本。
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
    text('本场增益', rx - 24, 33, { size: 11, color: C.dim, align: 'right' });
  }
}

/* ── 敌人 ─────────────────────────────────────────────────── */

function drawEnemy(e: Foe, t: number) {
  const bob = Math.sin(t * 1.5) * 9;
  const breathe = 1 + Math.sin(t * 1.5 + 1) * 0.012;
  const size = 430 * breathe;
  const art = ART[e.art];

  // 出招和被击退都是身体的位移：冲出去 90，挨打退 34
  const lunge = FX.enemyLunge();
  const kick = FX.enemyRecoil();
  const hitGlow = FX.enemyFlash();

  // 敌人自己的动作也要落在身体上：只在外围飘一圈特效，读出来是"界面在动、怪没动"。
  // 举盾后缩、变强涨大、塞杂念前倾、观察期微微收住，各给一个 sin 脉冲。
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
  const eh = 1 + kick * 0.05; // 挨打时横向压扁一点，重量感来自这里
  const ew = 1 - kick * 0.025;
  // poseScale 只作用在立绘尺寸上，别再乘进 g.scale —— 那样会平方，涨大一次就穿出画面
  const drawnSize = size * poseScale;

  // 地面光
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

  // 立绘是黑底 screen 叠上来的，发光轮廓很容易融进同样发黑的柱廊里。
  // 身后垫一层很淡的冷光把它托出来 —— 不改立绘，也不碰"黑即透明"的混合规则。
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
    // 立绘是"纯黑底 + 发光主体"：先拉对比把底色压成纯黑，screen 混合后就没有方框边
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

  // 敌人状态条：意图 + 血量 + 名字压成一组。
  // 以前意图飘在头顶（ENEMY.y-236）、血条贴着立绘下沿、名字又在血条下面 38px，
  // 三样分处三段，玩家得在三个位置拼出"它下回合打几点"。现在意图是血条左边的
  // 一格、名字紧跟血条下面 —— 关于这只怪的所有数字都在同一条横带上。
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

  // 名字 + 类型徽章：徽章要跟着名字宽度走，不能叠在长名字上
  text(e.name, ENEMY.x, by + 40, { size: 24, align: 'center', color: C.ink, weight: 700 });
  {
    g.save();
    g.font = font(24, 700, FONT_TITLE);
    const nameW = g.measureText(e.name).width;
    g.restore();
    const tag = e.type === 'boss' ? C.gold : e.type === 'elite' ? C.red : C.ink2;
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
}

/**
 * 意图格：血条左边的一枚标签。
 *
 * 它原来是一个"头顶气泡"，下面还有个小尖角指向立绘 —— 但那 400px 的立绘把
 * 气泡和血量隔开了，尖角指着的是一片空空气。并到状态条里之后，尖角没有意义了，
 * 改成左边一道与类型同色的竖条：读起来像"下一步"这一格，而不是一句飘着的话。
 */
function intentChip(
  x: number, cy: number, w: number, h: number,
  label: string, kind: 'attack' | 'shield' | 'junk' | 'buff', col: string, t: number,
) {
  const y = cy - h / 2;
  // 呼吸的辉光代替原来的上下浮动：位置要稳定在状态条上，但也不能死板
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

  // 竖条：这一格的身份色，比给整个框上色安静，也不会和血条的红撞
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
  const { x, y } = HERO;
  const bob = Math.sin(t * 1.25) * 5;
  const hurt = FX.heroFlash();
  const lunge = FX.heroLunge();
  const recoil = FX.heroRecoil();
  // 冲刺时整个身体前压、抬头；被击退时后仰。位移和倾斜要一起动，才像有重量
  const dx = lunge * 96 - recoil * 30;
  const dy = -lunge * 10 + bob;
  // 答错时灯焰会暗下去再回来：这一手没亮起来，比任何文字都快
  const dim = FX.lampDim();

  // 光晕
  const glow = g.createRadialGradient(x + dx * 0.6, y - 20, 8, x + dx * 0.6, y - 20, 190);
  glow.addColorStop(0, hurt > 0 ? withAlpha(C.red, 0.4) : withAlpha(C.gold, 0.2 + lunge * 0.18));
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = glow;
  g.beginPath();
  g.arc(x + dx * 0.6, y - 20, 190, 0, Math.PI * 2);
  g.fill();

  // 地面投影
  g.beginPath();
  g.ellipse(x + dx * 0.4, y + 74, 74, 20, 0, 0, Math.PI * 2);
  g.fillStyle = 'rgba(0,0,0,.55)';
  g.fill();

  g.save();
  g.translate(dx, dy);
  g.rotate(lunge * 0.09 - recoil * 0.1);

  // 布料有惯性：下摆摆动比呼吸慢半拍，像被风吹着
  const sw = Math.sin(t * 1.6);
  const sw2 = Math.sin(t * 1.6 - 0.9);

  // 披风剪影（下摆随时间摆动）
  const cloak = () => {
    g.beginPath();
    g.moveTo(x, y - 104);
    g.bezierCurveTo(x - 34, y - 96, x - 52 - sw * 3, y - 26, x - 72 - sw * 6, y + 70);
    g.quadraticCurveTo(x + sw2 * 5, y + 88, x + 72 + sw * 5, y + 70);
    g.bezierCurveTo(x + 52 + sw * 3, y - 26, x + 34, y - 96, x, y - 104);
    g.closePath();
  };
  cloak();
  const cg = g.createLinearGradient(x, y - 100, x, y + 80);
  cg.addColorStop(0, hurt > 0 ? '#5a1f22' : '#232b40');
  cg.addColorStop(0.55, hurt > 0 ? '#3a1518' : '#141a28');
  cg.addColorStop(1, '#080a10');
  g.fillStyle = cg;
  g.fill();
  g.strokeStyle = hurt > 0 ? withAlpha(C.red, 0.8) : withAlpha(C.blue, 0.35);
  g.lineWidth = 1.6;
  g.stroke();

  // 提灯一侧的轮廓光：灯在人右手边，光会把右边那道边照亮
  g.save();
  g.beginPath();
  g.rect(x + 24, y - 112, 80, 205);
  g.clip();
  cloak();
  const rim = g.createLinearGradient(x + 30, y, x + 78, y);
  rim.addColorStop(0, 'rgba(0,0,0,0)');
  rim.addColorStop(1, withAlpha(C.gold, 0.35 * (1 - 0.6 * dim)));
  g.strokeStyle = rim;
  g.lineWidth = 4.5;
  g.stroke();
  g.restore();

  // 围巾：从领口向身后飘，与提灯反方向，让剪影不对称
  const f1 = Math.sin(t * 2.1) * 6;
  const f2 = Math.sin(t * 2.1 - 1.2) * 9;
  g.beginPath();
  g.moveTo(x - 10, y - 64);
  g.quadraticCurveTo(x - 42 + f1, y - 68 + f2, x - 80 + f2, y - 46 + f1);
  g.lineTo(x - 76 + f2, y - 30 + f1);
  g.quadraticCurveTo(x - 42 + f1 * 0.6, y - 38, x - 10, y - 50);
  g.closePath();
  const sg = g.createLinearGradient(x - 10, y - 60, x - 78, y - 40);
  sg.addColorStop(0, hurt > 0 ? '#a33a34' : '#8c3a3a');
  sg.addColorStop(1, hurt > 0 ? '#5a1f1e' : '#4c2024');
  g.fillStyle = sg;
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,.4)';
  g.lineWidth = 1;
  g.stroke();
  // 围巾尾梢再垂下一条小布带，破一破「一根棍」的感觉
  g.beginPath();
  g.moveTo(x - 62 + f2 * 0.8, y - 42 + f1 * 0.6);
  g.quadraticCurveTo(x - 76 + f2, y - 30 + f1, x - 66 + f2, y - 16 + f1 * 0.5);
  g.quadraticCurveTo(x - 60 + f2 * 0.7, y - 26, x - 52 + f1, y - 34);
  g.closePath();
  g.fillStyle = hurt > 0 ? '#5a1f1e' : '#54262a';
  g.fill();

  // 兜帽（外层 + 帽口阴影）
  g.beginPath();
  g.ellipse(x, y - 84, 25, 29, 0, 0, Math.PI * 2);
  g.fillStyle = hurt > 0 ? '#4a1a1e' : '#1b2233';
  g.fill();
  g.strokeStyle = withAlpha(C.blue, 0.3);
  g.lineWidth = 1.2;
  g.stroke();
  // 帽口压暗：脸藏在阴影里，只露两点眼
  g.beginPath();
  g.ellipse(x + 2, y - 80, 13, 15, 0, 0, Math.PI * 2);
  g.fillStyle = '#05060a';
  g.fill();

  // 眼：偶尔眨一下
  const blink = Math.sin(t * 1.05) > 0.965 ? 0.12 : 1;
  const eg = (0.55 + 0.45 * Math.sin(t * 2.4) + lunge * 0.4) * blink;
  g.fillStyle = withAlpha(C.gold, Math.min(1, eg));
  g.beginPath();
  g.arc(x - 6, y - 82, 2.4, 0, Math.PI * 2);
  g.arc(x + 9, y - 82, 2.4, 0, Math.PI * 2);
  g.fill();

  // 领口搭扣
  g.beginPath();
  g.moveTo(x, y - 55);
  g.lineTo(x + 6, y - 49);
  g.lineTo(x, y - 43);
  g.lineTo(x - 6, y - 49);
  g.closePath();
  g.fillStyle = '#6e5524';
  g.fill();
  g.strokeStyle = withAlpha(C.gold, 0.75);
  g.lineWidth = 1.2;
  g.stroke();

  // 腰带
  roundRect(x - 33, y - 2, 66, 9, 4);
  g.fillStyle = '#0c0f16';
  g.fill();
  g.strokeStyle = '#2c3346';
  g.lineWidth = 1;
  g.stroke();
  roundRect(x - 6, y - 1, 11, 7, 2);
  g.fillStyle = '#6e5524';
  g.fill();
  g.strokeStyle = withAlpha(C.gold, 0.6);
  g.stroke();

  // 腰间书袋：旅人的随身物，和「答题解锁卡牌」的世界观呼应
  // 挂带先把袋子和腰带连起来，否则像一块漂在披风上的补丁
  roundRect(x - 46, y - 3, 16, 9, 3);
  g.fillStyle = '#0c0f16';
  g.fill();
  g.strokeStyle = '#2c3346';
  g.lineWidth = 1;
  g.stroke();
  roundRect(x - 54, y + 4, 19, 24, 5);
  const pg = g.createLinearGradient(x - 54, y, x - 35, y + 28);
  pg.addColorStop(0, '#232c44');
  pg.addColorStop(1, '#121724');
  g.fillStyle = pg;
  g.fill();
  g.strokeStyle = '#2c3346';
  g.lineWidth = 1.2;
  g.stroke();
  g.beginPath();
  g.moveTo(x - 47, y + 7);
  g.lineTo(x - 47, y + 25);
  g.strokeStyle = withAlpha(C.gold, 0.45);
  g.lineWidth = 1.6;
  g.stroke();

  // 持灯的手臂：从披风里伸出来，把灯送到身前
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(x + 12, y - 52);
  g.quadraticCurveTo(x + 38, y - 30, x + 56, y + 2);
  g.strokeStyle = '#242e48';
  g.lineWidth = 10;
  g.stroke();
  g.beginPath();
  g.moveTo(x + 12, y - 53);
  g.quadraticCurveTo(x + 38, y - 31, x + 56, y + 1);
  g.strokeStyle = '#3a4767';
  g.lineWidth = 5;
  g.stroke();
  g.beginPath();
  g.arc(x + 57, y + 2, 5, 0, Math.PI * 2);
  g.fillStyle = '#3a4767';
  g.fill();
  g.strokeStyle = withAlpha(C.gold, 0.35);
  g.lineWidth = 1.2;
  g.stroke();

  // 提灯：出招的瞬间它是最亮的东西，光刃就是从这里甩出去的
  const lx = x + 62;
  const ly = y + 6 + Math.sin(t * 2 + 1) * 3;
  const flare = Math.max(0, lunge);
  // 答错时焰会暗下去再回来：这一手没亮起来，比任何文字都快
  const lr = (42 + flare * 34) * (1 - 0.45 * dim);
  const lg = g.createRadialGradient(lx, ly, 2, lx, ly, lr);
  lg.addColorStop(0, withAlpha(C.gold, 0.85 * (1 - 0.82 * dim)));
  lg.addColorStop(0.35, withAlpha(C.gold, (0.3 + flare * 0.35) * (1 - 0.86 * dim)));
  lg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = lg;
  g.beginPath();
  g.arc(lx, ly, lr, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.arc(lx, ly, (5 + flare * 3) * (1 - 0.5 * dim), 0, Math.PI * 2);
  g.fillStyle = withAlpha('#fff0c0', 1 - 0.7 * dim);
  g.fill();

  // 灯壳：挂绳、提手、顶盖、玻璃腔、底座
  g.strokeStyle = '#4a5674';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(x + 58, y + 3);
  g.lineTo(lx - 3, ly - 20);
  g.stroke();
  g.beginPath();
  g.arc(lx, ly - 21, 4, Math.PI * 0.9, Math.PI * 2.1);
  g.stroke();

  roundRect(lx - 12, ly - 19, 24, 6, 2);
  g.fillStyle = '#39435c';
  g.fill();
  g.strokeStyle = '#5a688a';
  g.lineWidth = 1;
  g.stroke();

  roundRect(lx - 9, ly - 12, 18, 23, 3);
  g.fillStyle = 'rgba(232,182,76,.10)';
  g.fill();
  g.strokeStyle = '#4a5674';
  g.lineWidth = 1.2;
  g.stroke();
  g.beginPath();
  g.moveTo(lx - 3.5, ly - 12);
  g.lineTo(lx - 3.5, ly + 11);
  g.moveTo(lx + 3.5, ly - 12);
  g.lineTo(lx + 3.5, ly + 11);
  g.strokeStyle = '#4a5674';
  g.lineWidth = 1.4;
  g.stroke();

  roundRect(lx - 12, ly + 12, 24, 6, 2);
  g.fillStyle = '#39435c';
  g.fill();
  g.strokeStyle = '#5a688a';
  g.lineWidth = 1;
  g.stroke();

  // 焰：答错时暗下去（dim），出招时腾起（flare）
  const fl = (1 - 0.75 * dim) * (1 + flare * 0.6);
  const fy = ly - 1 - flare * 3;
  g.beginPath();
  g.moveTo(lx, fy - 8 - flare * 2);
  g.quadraticCurveTo(lx + 4.5, fy - 2, lx, fy + 5);
  g.quadraticCurveTo(lx - 4.5, fy - 2, lx, fy - 8 - flare * 2);
  g.closePath();
  const fg = g.createLinearGradient(lx, fy - 10, lx, fy + 5);
  fg.addColorStop(0, withAlpha('#fff3cd', Math.min(1, fl)));
  fg.addColorStop(1, withAlpha(C.gold, 0.75 * fl));
  g.fillStyle = fg;
  g.fill();
  g.restore();

  // 格挡环
  if (G.block > 0) {
    g.save();
    g.translate(dx, dy);
    g.strokeStyle = withAlpha(C.blue, 0.55);
    g.lineWidth = 3;
    g.setLineDash([10, 8]);
    g.lineDashOffset = -t * 22;
    g.beginPath();
    g.ellipse(x, y + 10, 96, 108, 0, 0, Math.PI * 2);
    g.stroke();
    g.restore();
    text(String(G.block), x + 96 + dx, y - 40 + dy, { size: 22, weight: 800, color: C.blue });
  }

  // 状态文字
  text('你', x, y + 104, { size: 15, color: C.dim, align: 'center', weight: 600 });
  const weak = Object.entries(G.topicWrong).filter(([, n]) => n > 0).length;
  if (weak) text(`错题 ${weak} 主题`, x + 62, y + 104, { size: 11, color: C.redDim });
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

  // 剩余量用弧线表示
  g.beginPath();
  g.arc(x, y, r - 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p);
  g.strokeStyle = withAlpha(C.gold, 0.85);
  g.lineWidth = 4;
  g.lineCap = 'round';
  g.stroke();

  // 每格行动力一个刻度口：弧线读"还剩多少"，刻度读"一共几格"
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
  text('/ ' + G.apMax, x, y + 26, { size: 14, align: 'center', color: C.dim });

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
    // 收到牌的那一下数字顶起来，缩回去 —— 牌堆是"有反应"的，不是一块背景板
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

  // 还在飞的牌已经在 G.discard 里了，但玩家还没看见它落地 —— 计数要等落地才 +1。
  // 洗牌那一帧弃牌堆会被清空，此时差额会变成负数，所以卡在 0。
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

  // 底板以前是 rgba(9,11,17,.72) + 一道 #252b3a 的边 —— 在近黑的背景上
  // 两者都看不见，五行动态读起来像直接写在书架上的裸字。现在把面板做实：
  // 填充抬到 .93、边框换成能看见的 lineHi、左侧加一道金色竖线当锚点。
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

  // 标题带：给这块面板一个"头"，否则一列飘着的字分不清是界面还是背景装饰。
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
    // 越老的行越淡，但不再淡到读不出：0.5 → 0.72 起。
    g.globalAlpha = 0.72 + 0.28 * (i / Math.max(1, lines.length - 1));
    g.textAlign = 'left';
    // 按像素宽度截断。以前按 24 个字符切，一行 23 个汉字约 320px，
    // 面板内宽只有 276px —— 长句会直接溢出到面板外面。
    g.fillText(squeeze(l.msg, w - 30), x + 16, y0 + head + 11 + i * lh);
    g.globalAlpha = 1;
  });
}

/* ── 手牌 ─────────────────────────────────────────────────── */

interface Slot { x: number; y: number; rot: number; i: number }

/**
 * 一张牌飞进手里的一小段演出。
 *
 * 逻辑层是"瞬间抽满"的（drawTo 一次 push 完），如果照原样画，玩家看到的是
 * 手牌凭空出现 —— 抽牌这件事在画面上根本没有发生过。所以这里补上"牌从牌堆
 * 出来"的那 0.3 秒：每张牌自己算一个出生时间，排队起飞。
 */
interface DrawFx {
  /** 出生后经过的秒数。负数 = 还在排队，不画也不可点 */
  age: number;
  /** 上一次画到的位置，手牌重排时靠它做平滑过渡 */
  px: number;
  py: number;
  /** 上一次真正画出去的位置（含悬停抬升）。牌离手时从这里起飞，否则会向下跳一下 */
  dx: number;
  dy: number;
  /** 上一次画到的倾角，牌离手时从这里接着转，免得跳一下 */
  rot: number;
}

/** 抽牌堆中心（piles() 里 44,762 那个 84×42 的方块） */
const DRAW_FROM = { x: 86, y: 783 };
/** 弃牌堆中心（piles() 里 44,812 那个） */
/** 弃牌堆的位置：敌人塞过来的杂念要真的飞到这里，不能在数字上凭空 +1 */
export const DISCARD_TO = { x: 86, y: 833 };
/** 单张飞行时长 */
const DRAW_DUR = 0.27;
/** 同一批牌之间的间隔：一张接一张，不是一起出现 */
const DRAW_GAP = 0.045;
/** 牌飞进弃牌堆的时长。必须短于 panelHold，否则反馈面板会把它盖掉 */
const DISCARD_DUR = 0.3;
/** 一次弃多张（回合结束）时的错开间隔 */
const DISCARD_GAP = 0.035;

/**
 * 一张正在离开手牌的牌。
 *
 * 逻辑层出牌是瞬时的（answer 里 push 进 discard 再 splice 掉），画面上如果不补
 * 这一段，牌就是凭空消失 —— 玩家看不到"我这张牌去哪了"，也读不出牌堆在变厚。
 */
interface DiscardFx {
  card: CardDef;
  atk: number;
  blk: number;
  up: boolean;
  /** 出发点：最后一次画到的位置 */
  x: number;
  y: number;
  rot: number;
  /** 负数 = 还在排队 */
  age: number;
  /**
   * 这张牌离手之后去哪。
   *  - discard：飞向左下角的弃牌堆，落地时计数 +1
   *  - return：学习模式答错的牌 **退回抽牌堆** —— 它没离开循环，下一回合就回来，
   *    所以不能飞进弃牌堆（那个动作读出来是"被收走了"）
   *  - junk：杂念原地化掉（它根本不进取牌堆）
   *  - power：增益牌飞向右上角的增益槽 —— 它已经从牌组循环里出去了，不能飞进弃牌堆，
   *    否则玩家会以为它下场还能再打一次
   */
  mode: 'discard' | 'return' | 'junk' | 'power';
}

const handFx = new Map<CardInst, DrawFx>();
const discardFx: DiscardFx[] = [];
let prevHand = new Set<CardInst>();
/** 弃牌堆收到牌时冒一下：0..1 衰减，用来让计数跳起来 */
let discardPulse = 0;

function layoutHand(): Slot[] {
  const n = G.hand.length;
  if (!n) return [];
  // 手牌尽量不重叠：重叠会切掉卡面文字。牌多到放不下时才让它们叠起来。
  // 990 是「从能量球右边到结束回合按钮左边」能摆下的中心跨度 —— 索引卡会让手牌变 7 张，
  // 用 1180 算的话第七张会压到「结束回合」上。
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

function drawHand(t: number, dt: number) {
  const slots = layoutHand();

  // 先认一遍"这一帧新进手的牌"。用上一帧的手牌表比对，而不是用逻辑层的事件：
  // 回合开始抽满、专注抽牌、杂念，三种来源都会走这里，表现层不需要知道是谁抽的。
  const inHand = new Set<CardInst>();
  // 敌人出手期间，新抽的手牌先留在牌堆里：core 已经同步换好了手牌，
  // 但两拨飞行物叠在一起会糊成一片。演完再让它们依次飞进来。
  const foeActing = FX.enemyBusy();
  let lane = 0;
  for (const s of slots) {
    const ent = G.hand[s.i];
    if (!ent) continue;
    inHand.add(ent);
    let fx = handFx.get(ent);
    if (!prevHand.has(ent) || !fx) {
      fx = { age: -lane * DRAW_GAP, px: DRAW_FROM.x, py: DRAW_FROM.y, dx: DRAW_FROM.x, dy: DRAW_FROM.y, rot: -0.42 };
      handFx.set(ent, fx);
      lane += 1;
    }
    const before = fx.age;
    if (!foeActing) fx.age += dt;
    // 排队结束、真正起飞的那一帧：牌堆抖一下，牌是从这里出去的
    if (before < 0 && fx.age >= 0) {
      FX.burst(DRAW_FROM.x, DRAW_FROM.y, C.blue, 4, {
        speed: 150, size: 3, grav: -70, life: 0.4,
      });
    }
  }

  // 离手的牌：出牌、或者回合结束整把弃掉。这里先按"上一帧还在手里"算出来，
  // 拿它最后画到的位置当起点 —— 玩家看到的就是那张牌自己飞走的，不是一张新的。
  let laneOut = 0;
  for (const ent of prevHand) {
    if (inHand.has(ent)) continue;
    const fx = handFx.get(ent);
    handFx.delete(ent);
    const card = defOf(ent);
    if (!card || !fx) continue;
    // 判断去处的唯一依据是"逻辑层把它放哪了"：学习模式答错的牌在 draw 里，
    // 其余不是弃掉就是离开循环。表现层不重复算一遍规则。
    const kind = cardKind(card);
    const mode: DiscardFx['mode'] = kind === 'power' ? 'power'
      : G.draw.includes(ent) ? 'return'
        : kind === 'junk' ? 'junk' : 'discard';
    const st = statOf(ent);
    discardFx.push({
      card, atk: st.atk, blk: st.blk, up: !!ent.up,
      x: fx.dx, y: fx.dy, rot: fx.rot,
      age: mode === 'power' || mode === 'junk' ? 0 : -laneOut * DISCARD_GAP,
      mode,
    });
    if (mode === 'discard' || mode === 'return') laneOut += 1;
  }
  prevHand = inHand;

  for (const s of slots) {
    const ent = G.hand[s.i];
    if (!ent) continue;
    const fx = handFx.get(ent);
    if (!fx || fx.age < 0) continue; // 还在队列里，这张牌此刻不存在
    const card = defOf(ent);
    const st = statOf(ent);

    const flying = fx.age < DRAW_DUR;
    let px: number;
    let py: number;
    let rot = s.rot;
    let scale = 1;
    let alpha = 1;

    if (flying) {
      const p = clamp01(fx.age / DRAW_DUR);
      const e = easeOut(p);
      // 抛物线而不是直线：从牌堆甩上来再落进手里，才有"抽"的重量。
      // 每张牌弧高差一点，六张连着抽时才不会叠成一条线上的珠子。
      const cx = (DRAW_FROM.x + s.x) / 2;
      const cy = Math.min(DRAW_FROM.y, s.y) - (92 + (s.i % 3) * 24);
      const iu = 1 - e;
      px = iu * iu * DRAW_FROM.x + 2 * iu * e * cx + e * e * s.x;
      py = iu * iu * DRAW_FROM.y + 2 * iu * e * cy + e * e * s.y;
      // 牌堆里是斜着摞的，出手时先把它扶正
      rot = -0.42 + (s.rot + 0.42) * e;
      scale = 0.6 + 0.4 * e + 0.05 * Math.sin(p * Math.PI);
      alpha = 0.3 + 0.7 * Math.min(1, p * 2.6);
    } else {
      // 落地之后，位置仍然平滑趋近目标 —— 出牌让手牌变少时，剩下的牌是滑过去而不是瞬移
      const k = 1 - Math.exp(-dt * 18);
      px = fx.px + (s.x - fx.px) * k;
      py = fx.py + (s.y - fx.py) * k;
    }
    // 存的是"归位位置"而不是含悬停抬升的位置，否则一直悬停会把基准点越推越高
    fx.px = px;
    fx.py = py;
    fx.rot = rot;

    const hv = !flying && hover(px - HAND.w / 2, py - HAND.h / 2, HAND.w, HAND.h);
    // 悬停只抬高、不放大太多：卡面文字要在放大后仍然清晰，又不能挡住邻居
    if (hv) { scale *= 1.06; py -= 44; }
    else if (!flying) py -= Math.sin(t * 1.4 + s.i) * 2;

    const w = HAND.w * scale;
    const h = HAND.h * scale;
    fx.dx = px;
    fx.dy = py;

    // 四种状态：基础牌（不答题，随时可打）/ 锁着（要答题）/ 已解锁（免答直接打）/
    // 这回合已经答错过，外加一种整场作废（测试模式答错）。增益牌不传状态。
    const kind = cardKind(card);
    const isPow = kind === 'power';
    const isJunk = kind === 'junk';
    const isBase = kind === 'basic';
    const open = !isJunk && !isPow && !isBase && isUnlocked(card.id);
    const state = isJunk || isPow ? undefined
      : isBase ? 'basic'
        : open ? 'open'
          : isForgotten(card.id) ? 'forgotten'
            : G.failedTurn[card.id] ? 'spent'
              : 'locked';

    g.save();
    g.globalAlpha = alpha;
    g.translate(px, py);
    g.rotate(rot);
    drawCard(-w / 2, -h / 2, w, h, card, st.atk, st.blk, {
      up: !!ent.up, glow: hv, state,
      mode: isJunk || isPow || isBase ? undefined : G.mode,
    });
    g.restore();

    // 还在飞的牌不给热区：那时候它画在半空中，点它等于点空气。
    // 但下标一定要带上 —— 少注册一项会让"第几个热区"和"第几张牌"整体错位。
    if (flying) continue;

    // 基础牌点下去直接打，锁着的牌点下去出题，已解锁的牌点下去直接打，
    // 增益牌点下去立刻生效 —— 四种都是"点这张牌"，只是它问你要的东西不一样
    if (isPow) {
      onClick(px - w / 2, py - h / 2, w, h, () => {
        if (G.ap <= 0) { FX.shake(6); return; }
        playPower(s.i);
      }, 'card', s.i);
    } else if (isBase) {
      onClick(px - w / 2, py - h / 2, w, h, () => {
        if (G.ap <= 0) { FX.shake(6); return; }
        playBasic(s.i);
      }, 'card', s.i);
    } else if (!isJunk) {
      onClick(px - w / 2, py - h / 2, w, h, () => {
        if (G.ap <= 0) { FX.shake(6); return; }
        if (open) { playUnlocked(s.i); return; }
        if (isForgotten(card.id)) {
          // 作废的牌打不出去 —— 但不说明白，玩家会以为自己点不动它
          FX.shake(4);
          FX.floatText(HAND.cx, HAND.cy - 54, '这一场它已经作废了 —— 打不出去', C.red, 20, { vy: -34 });
          return;
        }
        if (canAsk(ent)) { askCard(s.i); return; }
        FX.shake(5);
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

  if (!G.hand.length && G.pending === null) {
    text('手里没牌了 —— 结束回合', HAND.cx, HAND.cy - 40, { size: 20, align: 'center', color: C.dim });
  }
}

/**
 * 离手的牌飞向弃牌堆。
 *
 * 分两种：真牌被"收走"（加速下坠、转正、缩小、末段淡出），杂念原地化掉
 * （它不进弃牌堆，所以不能有去处 —— 这一点和 core 里的处理是一致的）。
 */
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
    } else if (f.mode === 'power') {
      // 增益牌不是"被弃掉"，是"被点亮"：往右上角抛一道弧，缩成一个小点钻进槽里。
      // 一路缩小而不是淡出，是为了让"这张牌离开了循环"这件事看起来是升格，不是丢弃。
      const e = p * p;
      const cx = (f.x + POWER_SLOT.x) / 2;
      const cy = Math.min(f.y, POWER_SLOT.y) - 150;
      const iu = 1 - e;
      px = iu * iu * f.x + 2 * iu * e * cx + e * e * POWER_SLOT.x;
      py = iu * iu * f.y + 2 * iu * e * cy + e * e * POWER_SLOT.y;
      rot = f.rot * (1 - e);
      scale = 1 - 0.88 * e;
      alpha = 1 - Math.max(0, (p - 0.72) / 0.28) * 0.95;
      landing = p >= 1;
    } else if (f.mode === 'return') {
      // 退回牌堆：同一段距离，但往上走、走蓝色 —— 这张牌没有离开循环，
      // 它是"下一次还会再来"，不是"被收走了"。颜色是这里唯一的语义。
      const e = p * p;
      const cx = (f.x + DRAW_FROM.x) / 2;
      const cy = Math.min(f.y, DRAW_FROM.y) - 150;
      const iu = 1 - e;
      px = iu * iu * f.x + 2 * iu * e * cx + e * e * DRAW_FROM.x;
      py = iu * iu * f.y + 2 * iu * e * cy + e * e * DRAW_FROM.y;
      rot = f.rot * (1 - e);
      scale = 1 - 0.66 * e;
      alpha = 1 - Math.max(0, (p - 0.7) / 0.3) * 0.9;
      if (p >= 1) landing = true;
    } else {
      // 加速而不是匀速：被收走的牌是"掉"进牌堆的，不是平移过去的
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
      if (landing && (f.mode === 'discard' || f.mode === 'return')) {
        // 落地这一帧才算"进了牌堆"：计数跳一下、牌堆扬一点灰（退回牌堆不动弃牌堆的计数）
        const back = f.mode === 'return';
        if (!back) discardPulse = 1;
        const at = back ? DRAW_FROM : DISCARD_TO;
        FX.burst(at.x, at.y - 6, back ? C.blue : C.orange, back ? 5 : 3, {
          speed: back ? 110 : 90, size: 3, grav: back ? -120 : 320, life: 0.3,
        });
      } else if (f.mode === 'power') {
        // 落进增益槽的那一下冒一圈光：这是"它开始工作了"的唯一提示
        const col = powerOf(f.card)?.color ?? C.gold;
        FX.burst(POWER_SLOT.x, POWER_SLOT.y, col, 7, {
          speed: 120, size: 3, grav: 60, life: 0.42,
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
   * 「结束回合」是战斗中唯一没有替代品的按钮：手牌打空、行动力归零时，
   * 它是玩家唯一还能做的事。所以这里不能按"还有没有牌可打"来决定是否注册热区 ——
   * 那样只会把已经无牌可打的一局彻底锁死（界面上还画着按钮，点下去却毫无反应）。
   * 只有演出中和结算中（checkPending 已置位）才真的不该点。
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

  icon('turn', x + 40, y + h / 2 - 8, 13, ready ? (hv ? C.gold : C.ink2) : C.faint);
  text('结束回合', x + w / 2 + 14, y + h / 2 - 8, {
    size: 20, weight: 700, align: 'center', color: ready ? C.ink : C.dim,
  });
  text(`${G.hand.length} 张手牌 · 行动力 ${G.ap}`, x + w / 2 + 7, y + h / 2 + 16, {
    size: 12, align: 'center', color: C.dim,
  });

  // 热区永远注册，endTurn 内部自己会拦"面板开着 / 正在结算"这些情况
  onClick(x, y, w, h, () => endTurn(), 'endturn');

  // 牌组按钮
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

/** 调试/冒烟用：在飞的牌数量。飞行单元如果清不掉，会在屏幕上永远留一张牌。 */
export function fxCount() {
  return { hand: handFx.size, discard: discardFx.length };
}

/**
 * 手牌是不是已经全部落位、并且停稳了。
 *
 * 抽牌是按 dt 推进的，机器一慢（或者浏览器在后台被节流），动画的真实时长就会变长。
 * 自动化测试如果拿"睡 450ms"当标准，就会在慢机器上点到半空中的牌 —— 那不是布局坏了，
 * 是测试拿时间当状态。这里给出真正的状态：每张牌都飞完了，而且离落点不到 1px。
 */
export function handSettled() {
  const slots = layoutHand();
  if (slots.length !== handFx.size) return false;
  for (const s of slots) {
    const fx = handFx.get(G.hand[s.i]);
    if (!fx || fx.age < DRAW_DUR) return false;
    if (Math.abs(fx.px - s.x) > 1 || Math.abs(fx.py - s.y) > 1) return false;
  }
  return true;
}

export function resetBattleView() {
  lastEnemyKey = '';
  prevHand = new Set();
  handFx.clear();
  discardFx.length = 0;
  discardPulse = 0;
  FX.clearFx();
}
