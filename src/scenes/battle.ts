import { g, roundRect, VW } from '../gfx/canvas';
import { ART } from '../gfx/assets';
import { C, font, FONT_NUM, FONT_TITLE, FONT_UI, withAlpha } from '../gfx/theme';
import { bar, drawCard, icon, panel, text } from '../gfx/ui';
import type { IconName } from '../gfx/ui';
import { onClick, hover } from '../input';
import { drawBackdrop, drawMotes } from '../gfx/backdrop';
import { groundGlow, shieldDome, shieldSeal } from '../gfx/aura';
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

/**
 * 两个立绘共用一条视觉带（上沿 ~150、下沿 ~535），下方同高状态牌，
 * 再下面才是手牌。旧版玩家立绘压低到 462，底摆扎进手牌区、血条却远在左上角，
 * 两边人物和读数都不在同一水平线上，整个画面因此显得散。
 */
export const ENEMY = { x: 1150, y: 308 };
export const HERO = { x: 290, y: 352 };
/**
 * 敌人脚下那一片地面。立绘是浮空的，光要托在它视觉下沿附近，
 * 又要收在状态牌上沿之上 —— 直接取立绘方框底边会被状态牌盖掉一半。
 */
export const ENEMY_GROUND = { x: ENEMY.x, y: ENEMY.y + 165 };
const HAND = { cx: 765, cy: 740, w: 200, h: 238, spread: 194 };
const HERO_ART = { size: 380, cx: HERO.x - 16, cy: HERO.y - 8 };
/** 玩家 / 敌人共用的状态牌：同一 y、同一宽、同一三段结构。 */
const PLATE = { y: 530, h: 84, w: 400 };
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
    prevTurn = G.turn;
    discardFx.length = 0;
  }
}

export function drawBattle(t: number, dt: number) {
  drawBackdrop(t, 0.58);
  drawMotes(t);
  topBar();
  // 只报会影响卡面数值的状态，玩家要能回答"为什么这张牌现在是 14 点"。
  const ls = linkStatus();
  if (ls.length) {
    // 接着顶部条最后一块牌排，永远不压到右侧增益。
    text(`联动 · ${ls.join('　·　')}`, topRowEnd + 18, 31, {
      size: 12, color: C.gold, weight: 700, maxW: Math.max(120, VW - 470 - topRowEnd),
    });
  }

  if (G.enemy) drawEnemy(G.enemy, t);
  drawHero(t);
  energyOrb(t);
  piles();
  drawHand(t, dt);
  drawDiscards(dt);
  endTurnButton();
}

/* ── 顶部：只放本局元信息 ─────────────────────────────────── */

/** 顶部这一行最后一块牌的右边界；联动状态从它后面接着排。 */
let topRowEnd = 0;

/** 顶部所有小块都是同一规格：26 高、微圆角、1px 细边、无胶囊无发光。 */
function topChip(x: number, label: string, color: string) {
  g.font = font(13, 600, FONT_UI);
  const w = Math.ceil(g.measureText(label).width) + 26;
  roundRect(x + 0.5, 18.5, w - 1, 25, 3);
  g.fillStyle = withAlpha(color, 0.1);
  g.fill();
  g.strokeStyle = withAlpha(color, 0.45);
  g.lineWidth = 1;
  g.stroke();
  text(label, x + w / 2, 31, { size: 13, color, weight: 600, align: 'center' });
  return w;
}

function topBar() {
  g.save();
  const grd = g.createLinearGradient(0, 0, 0, 70);
  grd.addColorStop(0, 'rgba(6,8,13,.92)');
  grd.addColorStop(1, 'rgba(6,8,13,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, VW, 84);
  g.restore();

  // 生命与格挡已经移到人物下方的状态牌里，这里只留「这一局走到哪」。
  const st = stageOf(G.stage);
  let x = 36;
  icon('floor', x + 7, 31, 9, C.dim);
  x += 22;
  const floorLabel = `第 ${curFloor()} 层`;
  text(floorLabel, x, 31, { size: 18, family: FONT_TITLE, color: C.ink2, weight: 600 });
  g.font = font(18, 600, FONT_TITLE);
  x += g.measureText(floorLabel).width + 16;
  divider(x);
  x += 17;
  const stageLabel = `${st.name} · ${G.stageTopic}`;
  text(stageLabel, x, 31, { size: 13, color: st.color, weight: 600 });
  g.font = font(13, 600, FONT_UI);
  x += g.measureText(stageLabel).width + 16;
  divider(x);
  x += 17;

  const mode = G.mode ? MODE_BY_ID[G.mode] : null;
  if (mode) {
    x += topChip(x, `◆ ${mode.name}`, mode.color) + 8;
  }
  // 本场剩余新题数。答错的代价落在这里；0 时显示「题 复用」，不是锁牌。
  const left = G.qLeft.length;
  const reusing = left === 0;
  const qcol = reusing ? C.dim : left <= 2 ? C.red : left <= 4 ? C.gold : C.cyan;
  x += topChip(x, reusing ? '题 复用' : `题 ${left}`, qcol);
  topRowEnd = x;

  // 增益是一排等大的方形小牌，跟顶部其它牌同一条基线；悬停只提亮边框。
  let rx = VW - 36;
  for (let i = G.powers.length - 1; i >= 0; i--) {
    const p = POWER_BY_ID[G.powers[i]];
    if (!p) continue;
    const s = 30;
    rx -= s + 8;
    const hv = hover(rx, 17, s, 30);
    roundRect(rx + 0.5, 17.5, s - 1, 29, 3);
    g.fillStyle = withAlpha(p.color, hv ? 0.28 : 0.12);
    g.fill();
    g.strokeStyle = withAlpha(p.color, hv ? 0.95 : 0.48);
    g.lineWidth = 1;
    g.stroke();
    text(p.icon, rx + s / 2, 32, { size: 15, color: p.color, align: 'center', weight: 800 });
    if (hv) {
      const tw = 250;
      panel(rx + s / 2 - tw / 2, 58, tw, 50, { r: 6, fill: 'rgba(8,10,16,.95)' });
      text(p.name, rx + s / 2, 76, { size: 14, weight: 700, align: 'center', color: p.color });
      text(p.card, rx + s / 2, 94, { size: 11, align: 'center', color: C.ink2, maxW: tw - 20 });
    }
  }
  if (G.powers.length) {
    text('增益', rx - 12, 32, { size: 11, color: C.dim, align: 'right' });
  }
}

/** 顶部两根细竖线，把层号 / 幕名 / 状态牌分开，不用色块切段。 */
function divider(x: number) {
  g.strokeStyle = withAlpha(C.gold, 0.26);
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(x + 0.5, 19);
  g.lineTo(x + 0.5, 43);
  g.stroke();
}

/* ── 双方共用的状态牌 ─────────────────────────────────────── */

interface PlateBadge {
  icon: IconName;
  label: string;
  color: string;
  /** 攻击预警：只让 1px 边框随呼吸加深，不发光。 */
  pulse?: boolean;
}

interface PlateOpts {
  cx: number;
  name: string;
  hp: number;
  maxHp: number;
  hpColor: string;
  danger?: boolean;
  tag?: string;
  tagColor?: string;
  /** 右对齐的一组细边徽章；敌人可同时放意图和格挡。 */
  badges?: PlateBadge[];
  note?: string;
  noteColor?: string;
  t: number;
}

/**
 * 玩家和敌人各一块、同一 y、同一宽、同一三段结构：
 * 名字 / 状态徽章 → 血条 → 说明。旧版玩家血条在左上角、敌人血条在立绘下、
 * 意图和名字又各占一行，两边完全不对称；读数散在人物四周，画面因此显乱。
 */
function statusPlate(o: PlateOpts) {
  const w = PLATE.w;
  const h = PLATE.h;
  const x = o.cx - w / 2;
  const y = PLATE.y;

  // 暗底 + 微圆角 + 1px 细金框，和模式面板、档案尺同一套；左脊当索引标。
  g.save();
  roundRect(x + 0.5, y + 0.5, w - 1, h - 1, 4);
  g.fillStyle = 'rgba(8,10,16,.86)';
  g.fill();
  g.strokeStyle = withAlpha(C.gold, o.danger ? 0.46 : 0.26);
  g.lineWidth = 1;
  g.stroke();
  g.save();
  roundRect(x, y, w, h, 4);
  g.clip();
  g.fillStyle = withAlpha(C.gold, 0.42);
  g.fillRect(x, y, 2, h);
  const lg = g.createLinearGradient(x, 0, x + w, 0);
  lg.addColorStop(0, withAlpha(C.gold, 0));
  lg.addColorStop(0.5, withAlpha(C.gold, 0.24));
  lg.addColorStop(1, withAlpha(C.gold, 0));
  g.fillStyle = lg;
  g.fillRect(x + 10, y + 1, w - 20, 1);
  g.restore();
  g.restore();

  // 三段各留足行距：名字（含徽章）→ 血条 → 说明，谁都不许压到下一行。
  // 第一行：名字 + 类型签（左），一枚状态徽章（右）。
  const row1 = y + 22;
  text(o.name, x + 16, row1, { size: 19, family: FONT_TITLE, weight: 700, color: C.ink });
  g.font = font(19, 700, FONT_TITLE);
  const nameEnd = x + 16 + g.measureText(o.name).width;
  if (o.tag) {
    const tagC = o.tagColor ?? C.gold;
    g.font = font(11, 700, FONT_UI);
    const tagW = Math.ceil(g.measureText(o.tag).width) + 16;
    const tx = nameEnd + 10;
    roundRect(tx + 0.5, row1 - 12.5, tagW - 1, 19, 3);
    g.fillStyle = withAlpha(tagC, 0.12);
    g.fill();
    g.strokeStyle = withAlpha(tagC, 0.5);
    g.lineWidth = 1;
    g.stroke();
    text(o.tag, tx + tagW / 2, row1 - 2, { size: 11, align: 'center', color: tagC, weight: 700 });
  }

  const badges = o.badges ?? [];
  if (badges.length) {
    g.font = font(15, 700, FONT_NUM);
    const widths = badges.map((b) => Math.ceil(g.measureText(b.label).width) + 42);
    const groupW = widths.reduce((a, b) => a + b, 0) + (badges.length - 1) * 8;
    let bx = x + w - 14 - groupW;
    badges.forEach((b, i) => {
      const bw = widths[i];
      const p = b.pulse ? 0.55 + 0.45 * Math.sin(o.t * 2.4) : 0.5;
      roundRect(bx + 0.5, row1 - 12.5, bw - 1, 25, 3);
      g.fillStyle = withAlpha(b.color, 0.1);
      g.fill();
      g.strokeStyle = withAlpha(b.color, 0.4 + p * 0.28);
      g.lineWidth = 1;
      g.stroke();
      icon(b.icon, bx + 15, row1, 10, b.color);
      text(b.label, bx + 27, row1, {
        size: 15, family: FONT_NUM, weight: 700, color: C.ink2,
      });
      bx += bw + 8;
    });
  }

  // 第二行：血条。双方共用同一个 bar()、同一个宽度和高度，读数一眼可比。
  const barY = y + 38;
  const barH = 20;
  bar(x + 14, barY, w - 28, barH, o.hp / o.maxHp, o.hpColor, {
    label: `${Math.max(0, o.hp)} / ${o.maxHp}`, ticks: 4,
  });
  if (o.danger && o.hp > 0) {
    g.save();
    roundRect(x + 14.5, barY + 0.5, w - 29, barH - 1, 3);
    g.strokeStyle = withAlpha(C.hpDanger, 0.45 + 0.3 * Math.sin(o.t * 4));
    g.lineWidth = 1;
    g.stroke();
    g.restore();
  }

  // 第三行整行留给说明：机制文案最长的一句也要能读完，不能被右侧数值挤掉。
  // 格挡和意图都收进第一行的徽章组，这里不再放别的东西。
  const row3 = y + 72;
  if (o.note) {
    text(o.note, x + 16, row3, {
      size: 12, color: o.noteColor ?? C.dim, weight: 600,
      maxW: w - 32,
    });
  }
}

/* ── 敌人 ─────────────────────────────────────────────────── */

function drawEnemy(e: Foe, t: number) {
  const bob = Math.sin(t * 1.5) * 9;
  const breathe = 1 + Math.sin(t * 1.5 + 1) * 0.012;
  // Boss 460、小怪 400：下沿都收在状态牌上方，不再压到读数上。
  const size = (e.type === 'boss' ? 460 : 400) * breathe;
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
  // 脚下的光落在立绘视觉下沿附近（不是立绘方框底边）：这些敌人是浮空的，
  // 光要托在它下面，压在状态牌上沿之上，否则一半会被状态牌盖掉。
  const groundY = ENEMY_GROUND.y;
  const groundRx = e.type === 'boss' ? 214 : 196;
  const shieldP = e.block > 0 ? Math.max(0.4, Math.min(1, e.block / 14)) : 0;
  groundGlow({
    x: ENEMY.x, y: groundY, rx: groundRx, ry: groundRx * 0.25,
    color: groundCol, t, power: 1, phase: 2.1,
    boost: hitGlow + pulse * 0.5,
  });

  // 黑底 screen 立绘容易融进柱廊，身后垫一层冷光托出来。
  const halo = g.createRadialGradient(ENEMY.x, ENEMY.y, 12, ENEMY.x, ENEMY.y, 240);
  halo.addColorStop(0, withAlpha(groundCol, 0.11));
  halo.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = halo;
  g.beginPath();
  g.arc(ENEMY.x, ENEMY.y, 240, 0, Math.PI * 2);
  g.fill();
  // 护盾的罩画在立绘之前，和玩家同款。
  if (shieldP > 0) shieldDome({ x: ENEMY.x, y: groundY, rx: e.type === 'boss' ? 164 : 142, ry: 26, t, power: shieldP });
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

  // 敌人叠了格挡也得看得见：和玩家同一套地面封环，压在立绘之后（脚前面）。
  // 以前这里什么都没有，玩家只能从状态牌上一个数字猜它还有没有挡。
  if (shieldP > 0) {
    shieldSeal({ x: ENEMY.x, y: groundY, rx: groundRx * 0.72, ry: groundRx * 0.72 * 0.25, t, power: shieldP });
  }

  // 名字 / 意图 / 血条 / 机制全部收进一块状态牌，与玩家那块同一 y、同一结构。
  const it = intentText(e);
  const kind = it.icon === 'attack' ? 'attack' : it.icon === 'shield' ? 'shield'
    : it.icon === 'junk' ? 'junk' : 'buff';
  const icol = kind === 'attack' ? C.red : kind === 'shield' ? C.blue
    : kind === 'junk' ? C.orange : C.purple;
  statusPlate({
    cx: ENEMY.x,
    name: e.name,
    hp: e.hp, maxHp: e.maxHp,
    hpColor: e.type === 'boss' ? C.hpBoss : C.hpFoe,
    tag: e.type !== 'fight' ? e.tag : undefined,
    tagColor: e.type === 'boss' ? C.gold : C.red,
    badges: [
      { icon: kind, label: it.text, color: icol, pulse: kind === 'attack' },
      ...(e.block > 0
        ? [{ icon: 'shield' as const, label: String(e.block), color: C.blue }]
        : []),
    ],
    // 机制改决策，玩家得在做决定之前知道；整行都给它，不靠截断省地方。
    note: mechNote(e) ?? undefined,
    noteColor: C.orange,
    t,
  });
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

  const groundCol = hurt > 0 ? C.red : C.gold;
  const shieldP = G.block > 0 ? Math.max(0.4, Math.min(1, G.block / 14)) : 0;

  // 脚下：外散光 / 光池 / 接地点 + 地面细环 + 浮尘，和敌人共用同一套。
  // 提灯是暖的，地面也跟着暖；受击整滩转红，格挡另有蓝色封环（画在立绘之后）。
  groundGlow({
    x: cx + dx * 0.4, y: cy + 158, rx: 172, ry: 40,
    color: groundCol, t, power: 0.95, phase: 0.6, boost: hurt,
  });

  // 身后一层淡金光，把黑底立绘从柱廊里托出来。
  g.save();
  const halo = g.createRadialGradient(cx, cy, 12, cx, cy, 215);
  halo.addColorStop(0, withAlpha(C.gold, 0.075));
  halo.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = halo;
  g.beginPath();
  g.arc(cx, cy, 215, 0, Math.PI * 2);
  g.fill();
  g.restore();

  // 护盾的"罩"必须画在立绘之前：光是从脚下升起来的，人才像被包住。
  if (shieldP > 0) shieldDome({ x: cx + dx, y: cy + 152, rx: 146, ry: 24, t, power: shieldP });

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

  // 护盾不再套一圈会转的蓝色虚线大椭圆，也不在人物旁边浮一个大数字：
  // 现在是脚下的一圈封环（细线 + 慢转虚线 + 扫光 + 上升光屑），读数交给状态牌里的盾徽章。
  if (shieldP > 0) {
    shieldSeal({ x: cx + dx, y: cy + 152, rx: 120, ry: 16, t, power: shieldP });
  }

  const weak = Object.entries(G.topicWrong).filter(([, n]) => n > 0).length;
  const hpPct = G.hp / G.maxHp;
  statusPlate({
    cx: HERO.x,
    name: '你',
    hp: G.hp, maxHp: G.maxHp,
    hpColor: hpPct > 0.5 ? C.hpCalm : hpPct > 0.25 ? C.hpWarn : C.hpDanger,
    danger: hpPct <= 0.25 && G.hp > 0,
    badges: G.block > 0
      ? [{ icon: 'shield' as const, label: String(G.block), color: C.blue }]
      : [],
    note: weak ? `错题 ${weak} 主题` : `第 ${G.turn} 回合`,
    noteColor: weak ? C.redDim : C.dim,
    t,
  });
}

/* ── 光球 / 牌堆 ─────────────────────────────────────────── */

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
    // 微圆角 + 1px 细边，和状态牌、顶部牌同一套；两块牌堆与光球共用左边界。
    roundRect(x + 0.5, y + 0.5, 95, 41, 3);
    g.fillStyle = hv ? 'rgba(255,255,255,.09)' : 'rgba(255,255,255,.035)';
    g.fill();
    g.strokeStyle = pulse > 0 ? withAlpha(col, 0.35 + pulse * 0.5) : hv ? withAlpha(col, 0.7) : C.line;
    g.lineWidth = 1;
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
  // 离手的牌现在全都进弃牌堆，不用再按去处筛选。
  const incoming = discardFx.length;

  pile(38, 752, '抽牌', G.draw.length, C.blue, 'cards', () => { G.panel = { k: 'pile', kind: 'draw' }; });
  pile(38, 800, '弃牌', Math.max(0, G.discard.length - incoming), C.orange, 'discard', () => {
    G.panel = { k: 'pile', kind: 'discard' };
  }, discardPulse);
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

/** 与左下角两块牌堆牌的中心一致（38 + 48），卡牌飞行终点不悬空。 */
const DRAW_FROM = { x: 86, y: 773 };
/** 弃牌堆中心：敌人塞的杂念要真的飞到这里。 */
export const DISCARD_TO = { x: 86, y: 821 };
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
}

/** 与 `prevFx` / `prevHand` 平行；每帧先用 `alignHand()` 把记录挪到新下标。 */
let handFx: DrawFx[] = [];
const discardFx: DiscardFx[] = [];
let prevHand: string[] = [];
let prevFx: DrawFx[] = [];
/** 上一帧的回合号：跨回合时整手牌换人，同 id 的副本也不能当「同一张」认。 */
let prevTurn = G.turn;
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
  /**
   * 回合边界：上一回合的整手牌都要飞进弃牌堆，新手牌全部从抽牌堆飞进来。
   * 不能走 alignHand —— 它按 id 找最长公共子序列，新抽到的同名副本会被认成
   * 「这张牌没动过」，玩家看到的就是「有的牌没回弃牌堆」。
   */
  const turnChanged = G.turn !== prevTurn;
  if (turnChanged) eject = null;

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
  const keep = turnChanged
    ? new Array<number>(G.hand.length).fill(-1)
    : alignHand(prevHand, G.hand, skip);
  const kept = new Set(keep.filter((i) => i >= 0));
  const nextFx: DrawFx[] = new Array(G.hand.length);
  keep.forEach((pi, j) => { if (pi >= 0) nextFx[j] = prevFx[pi]; });

  // 离手的牌从最后画到的位置起飞；弃牌堆是唯一去处，杂念也一样飞过去。
  let laneOut = 0;
  for (let pi = 0; pi < prevHand.length; pi++) {
    if (kept.has(pi)) continue;
    const fx = prevFx[pi];
    const id = prevHand[pi];
    if (!fx || !id) continue;
    const card = defOf(id);
    const st = statOf(id);
    discardFx.push({
      card, atk: st.atk, blk: st.blk, up: isUpgraded(id),
      x: fx.dx, y: fx.dy, rot: fx.rot,
      age: -laneOut * DISCARD_GAP,
    });
    laneOut += 1;
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
        text('杂念打不出去，回合结束进弃牌堆', HAND.cx, HAND.cy - 40, {
          size: 18, align: 'center', color: C.dim,
        });
        FX.shake(4);
      }, 'junk', s.i);
    }
  }


  // 存画出去的坐标（含悬停抬升），牌离手时才不向下跳。
  prevHand = G.hand.slice();
  prevFx = handFx.slice();
  prevTurn = G.turn;

  if (!G.hand.length && G.pending === null) {
    text('手里没牌了：结束回合', HAND.cx, HAND.cy - 40, { size: 20, align: 'center', color: C.dim });
  }
}


/** 离手的牌加速下坠、缩小淡出，落到左下角弃牌堆；杂念也走这一条。 */
function drawDiscards(dt: number) {
  discardPulse = Math.max(0, discardPulse - dt * 2.4);

  for (let i = discardFx.length - 1; i >= 0; i--) {
    const f = discardFx[i];
    f.age += dt;
    if (f.age < 0) continue;
    const p = clamp01(f.age / DISCARD_DUR);

    const landing = p >= 1;
    const e = p * p;
    const cx = (f.x + DISCARD_TO.x) / 2;
    const cy = Math.min(f.y, DISCARD_TO.y) + 46;
    const iu = 1 - e;
    const px = iu * iu * f.x + 2 * iu * e * cx + e * e * DISCARD_TO.x;
    const py = iu * iu * f.y + 2 * iu * e * cy + e * e * DISCARD_TO.y;
    const rot = f.rot - 0.5 * e;
    const scale = 1 - 0.62 * e;
    const alpha = 1 - Math.max(0, (p - 0.74) / 0.26) * 0.9;

    if (landing) {
      discardFx.splice(i, 1);
      discardPulse = 1;
      FX.burst(DISCARD_TO.x, DISCARD_TO.y - 6, C.orange, 3, {
        speed: 90, size: 3, grav: 320, life: 0.3,
      });
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
  // 右下两块和左下光球 / 牌堆同一个底栏：等宽、同一 x、微圆角、1px 细边。
  const x = 1392;
  const w = 176;
  const dy = 690;
  const dh = 46;
  const y = dy + dh + 12;
  const h = 64;
  const hv = hover(x, y, w, h);
  /**
   * 「结束回合」必须永远注册热区：无牌可打时它是唯一还能做的事，按"有没有牌"决定会锁死。
   * 只有演出中和结算中才不该点。
   */
  const ready = !G.busy && G.pending === null;

  roundRect(x + 0.5, y + 0.5, w - 1, h - 1, 4);
  g.fillStyle = hv && ready ? withAlpha(C.gold, 0.2) : 'rgba(20,24,34,.9)';
  g.fill();
  g.strokeStyle = !ready ? withAlpha(C.gold, 0.22) : hv ? C.gold : withAlpha(C.gold, 0.5);
  g.lineWidth = 1.4;
  g.stroke();

  icon('turn', x + 44, y + h / 2, 15, ready ? (hv ? C.gold : C.ink2) : C.faint);
  text('结束回合', x + w / 2 + 18, y + h / 2 + 1, {
    size: 21, weight: 700, align: 'center', color: ready ? C.ink : C.dim,
  });
  onClick(x, y, w, h, () => endTurn(), 'endturn');

  const dhv = hover(x, dy, w, dh);
  roundRect(x + 0.5, dy + 0.5, w - 1, dh - 1, 4);
  g.fillStyle = dhv ? 'rgba(255,255,255,.1)' : 'rgba(20,24,34,.85)';
  g.fill();
  g.strokeStyle = dhv ? C.lineHi : C.line;
  g.lineWidth = 1;
  g.stroke();
  icon('cards', x + 42, dy + dh / 2, 11, dhv ? C.ink2 : C.dim);
  text(`牌组 ${G.deck.length}`, x + 97, dy + dh / 2, {
    size: 15, align: 'center', color: dhv ? C.ink : C.ink2,
  });
  onClick(x, dy, w, dh, () => { G.panel = { k: 'deck' }; }, 'deck');
}

/** 调试/冒烟用：在飞的牌数量；飞不完的单元会在屏幕上永远留一张牌。 */
export function fxCount() {
  return {
    hand: handFx.length,
    discard: discardFx.length,
    /** 调试/冒烟用：每张飞出去的牌去了哪；离手的牌一律进弃牌堆。 */
    discardModes: discardFx.map(() => 'discard'),
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
  prevTurn = G.turn;
  // 换场时清掉被点走的那格；下标和 id 都是旧的。
  eject = null;
  discardFx.length = 0;
  discardPulse = 0;
  FX.clearFx();
}
