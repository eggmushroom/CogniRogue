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
/**
 * 玩家和敌人现在用同一类素材：纯黑底 + 发光的厚涂立绘，screen 混合叠上来。
 * 以前玩家是手写矢量剪影，补再多光晕也和 430px 的怪物不是一层空气 ——
 * 不是"画得不够细"，是素材语言不同。换成同款立绘后，两边共享背光、地光、
 * 位移、受击闪的同一套画法，风格才真正咬合。
 *
 * 尺寸略小于小怪（410 / 430），中心压低：玩家站在前景、靠画面下方，
 * 同时头顶要躲开左上角那块战斗记录面板。
 */
const HERO_ART = { size: 410, cx: HERO.x - 16, cy: HERO.y - 14 };
/** 提灯焰心在素材里的相对坐标。光刃必须从这里甩出去。 */
const LAMP = { u: 0.715, v: 0.555 };
const lampAt = () => ({
  x: HERO_ART.cx + (LAMP.u - 0.5) * HERO_ART.size,
  y: HERO_ART.cy + (LAMP.v - 0.5) * HERO_ART.size,
});

/** drawHero 每帧记下时间，让 heroHand() 能跟着呼吸和冲刺一起动。 */
let heroT = 0;

/** 提灯的位置。攻击是从这里甩出去的，不是从卡片飞出去的。 */
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
    // 新的一场战斗：手牌表清空，开局那 5–6 张才能重新从牌堆飞进来。
    // 记录是跨战斗复用的，不清的话新的手牌会带着上一场的坐标出现。
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
  // 只报「此刻会影响卡面数值」的状态，不是连击计数，也不是装饰：
  // 玩家要能回答"为什么这张牌现在是 14 点"。
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

  // 楼层：图标 + 文字，比一行裸字多一个可辨识的锚点。
  // 100 层之后，光有层号不够用 —— 下面补一行幕名，玩家才知道自己在哪一带，
  // 而"这一带的怪会反伤还是要塞杂念"是能影响这一手怎么打的。
  const st = stageOf(G.stage);
  icon('floor', 424, 31, 9, C.dim);
  text(`第 ${curFloor()} 层`, 438, 31, { size: 17, color: C.ink2, weight: 600 });
  text(`${st.name} · ${G.stageTopic}`, 438, 52, { size: 11, color: st.color, weight: 600 });

  // 开局模式：整局不变，所以只说一次。它决定开局带几张能力，而不是难度档位。
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

  // 本场还剩几道**新题**（不是"还能不能答"）。答错不扣行动力，代价落在
  // 这个数上；新题用完会进入复用，所以 0 不该报警 —— 它显示「题 复用」，
  // 知识卡仍然能打，只是问的是本章被问得最少的题。
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

  // 这一局已经拿到的增益。它是整局的东西（掉一个就有一个，跨战斗保留），
  // 所以这一排读的是"我现在会什么"，不是"这一场花了多少"。
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
  // Boss 大一号：一局只有五只，幕末那只必须在体量上就不一样。
  // 只放大立绘，不动它头顶的意图和血条 —— 那两样要留在同一个高度上。
  const size = (e.type === 'boss' ? 512 : 430) * breathe;
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

  // 名字 + 等级徽章。徽章只在**不是普通怪**的时候出现：
  // 「普通」是默认值，标出来等于给水贴一张"这是水"的标签，还占掉名字右边的位置。
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

  // 机制：常驻一行，写"什么时候发生、发生多少"。
  //
  // 三十五条 hint 从加进来那天起就躺在 data 里，从来没被画出来过 —— 于是
  // "我答错它为什么回血"只能靠战斗日志里一闪而过的一行字猜。这不属于隐藏信息：
  // 机制改的是玩家的决策，玩家得在**做决定之前**知道它。
  // 只放数值和触发条件，味道文案留在日志里（常驻的一行字要能被扫读）。
  //
  // 位置贴着名字下方而不是头顶：那里已经被意图格和血条占了，
  // 而这一行是"关于这只怪是谁"，读起来该跟在名字后面。
  const note = mechNote(e);
  if (note) {
    text(note, ENEMY.x, by + 64, { size: 13, align: 'center', color: C.orange, weight: 700 });
  }
}

/**
 * 这只怪的机制，一句话。
 *
 * `mechV` 优先，和结算同源 —— 幕 Boss 的量比小怪重（反伤 3 对 1、格挡 14 对 8），
 * 界面要是写死默认值，玩家会按小怪的账去打 Boss。
 */
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

  // 地面光 + 身后冷光：和 drawEnemy 是同一套画法，两边才像站在同一个地面上
  g.save();
  const groundCol = hurt > 0 ? C.red : C.blue;
  const gy = cy + 188;
  // 渐变跟着椭圆一起压扁，边缘才会自然淡出；往椭圆里直接填圆形渐变会留一道硬边
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
    // 与敌人完全一致的对比度规则：底色压成纯黑，screen 后没有方框边。
    // 常态比敌人亮一档（人形立绘的暗部更多），受击提亮；答错时整张稍暗，
    // 配合下面变矮的灯焰 = 这一手没亮起来。
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

  // 灯壳已经在立绘里了，这里只补一层会呼吸的光晕：静态贴图才不像贴纸。
  // dim 让焰暗下去、lunge 让出招时腾起，和原来矢量提灯的节奏一致。
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

  // 绕身打转的书页：静态立绘之外留一点活气，和背景里飞散的纸片是同一种东西
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

  // 格挡环贴着人物，不套在旧剪影的尺寸上：太大就变成一个空荡荡的 UI 圈
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

  // 状态贴在角色左腰外侧：立绘下摆一直垂到手牌区，放在头顶或脚下都会漂着
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
  // 环上的刻度已经写出了"一共几格"，再写一遍 "/ 3" 是重复；
  // 这里换成标签：牌面上那个"1"撤掉之后，玩家得知道这个数字是行动力。
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
 *
 * ## 为什么按**槽位下标**记，而不是按 card id 记
 *
 * 手牌里现在只是一串 id（见 `CardId`），同名的牌会出现好几次 —— 一副起手
 * 有 4 张基础斩击。按 id 记的话，两张基础斩击会共用同一条飞行记录，
 * 于是"打掉一张"这件事在画面上完全看不出来（另一张还挂着同一条 fx）。
 * 所以手牌这边一律按 `G.hand` 的下标记：id 只用来取卡面。
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
   */
  mode: 'discard' | 'return' | 'junk';
}

/**
 * 手牌的飞行记录，**按槽位下标**存（见 `DrawFx` 的说明）。
 *
 * `prevFx` 和 `prevHand` 平行：上一帧画出来的那一排。手牌是一串 id，
 * 出牌会让后面的牌整体左移，所以每帧先用 `alignHand()` 求一份对齐表，
 * 把还活着的记录挪到新下标上，再让多出来的那些飞进来、少掉的那些飞出去。
 */
let handFx: DrawFx[] = [];
const discardFx: DiscardFx[] = [];
/** 上一帧的手牌 id 序列（与 `prevFx` 平行）。 */
let prevHand: string[] = [];
/** 上一帧的手牌记录，用来给"飞走的那张"提供出发点。 */
let prevFx: DrawFx[] = [];
/**
 * 刚被点开的那一张：`{ id, at }`（`at` 是它当时在手牌里的下标）。
 *
 * 手牌只存 id，所以同名的几份副本在规则上完全等价、可以互换；但**画面上**必须让
 * 玩家点中的那一格飞出去。记到"手牌真的少了一张这个 id"的那一帧才用掉它 ——
 * 知识卡点下去只是出题，牌要到答完才离手，中间会隔好几帧。
 */
let eject: { id: string; at: number } | null = null;
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

/**
 * 上一帧的手牌 → 这一帧的手牌，谁还是谁。
 *
 * 用手牌 id 序列求最长公共子序列：手牌最多八张，O(n·m) 可以忽略。
 * 之所以要 LCS 而不是逐位比对：牌组里有四张一模一样的基础斩击，逐位比对
 * 无法区分"打掉了左边那张"和"打掉了右边那张"，而后者会让整排牌看起来
 * 全都错位飞了一次。LCS 选出的是**最大化保留**的那种对齐，画面上最稳。
 *
 * 返回 `keep[j] = 上一帧的下标`（-1 = 这一帧新抽到的）。
 *
 * `skip` 是"这一帧确定已经离开手牌"的那一格（点它打出去的那一张）。
 * 它必须**不参与**对齐：同名的四张基础斩击在 id 上完全一样，LCS 一律保留最左边那份，
 * 于是点右边那张时飞出去的是左边那张 —— 玩家读作"用的不是我点的这张"。
 * 把被点的那一格从头到尾剔掉，剩下的副本仍然按 id 对齐，飞出去的才正是它。
 */
function alignHand(prev: string[], hand: string[], skip = -1): number[] {
  // 剔掉 skip 之后的"上一帧"，连同它每一项在原数组里的下标
  const src: number[] = [];
  for (let i = 0; i < prev.length; i++) if (i !== skip) src.push(i);
  const n = src.length;
  const m = hand.length;
  // dp[i][j] = prev[src[i]..] 与 hand[j..] 的 LCS 长度
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

  // 先对齐，再决定"谁飞进来、谁飞出去"。这一帧的手牌和上一帧的差集就是全部答案。
  // 被点中的那一格从对齐里剔掉 —— 同名副本只能靠这一条认出"走的是哪一份"。
  let skip = -1;
  const ej = eject;
  if (ej) {
    const was = prevHand.filter((v) => v === ej.id).length;
    const now = G.hand.filter((v) => v === ej.id).length;
    if (now < was && prevHand[ej.at] === ej.id) { skip = ej.at; eject = null; }
    // 面板关掉之后牌还在手里：这一下没打出去（取消答题 / 付不起），别留到下一手去
    else if (G.panel.k !== 'question') eject = null;
  }
  const keep = alignHand(prevHand, G.hand, skip);
  const kept = new Set(keep.filter((i) => i >= 0));
  const nextFx: DrawFx[] = new Array(G.hand.length);
  keep.forEach((pi, j) => { if (pi >= 0) nextFx[j] = prevFx[pi]; });

  // 离手的牌：上一帧在、这一帧没被保留下来的那些。拿它最后画到的位置当起点 ——
  // 玩家看到的就是那张牌自己飞走的，不是一张新的。
  //
  // 去处只在一种情况下不是弃牌堆：学习模式答错，那一张被放回抽牌堆。逻辑层把这件事
  // 记在 `G.returned` 上，这里一次性读走 —— 以前是拿 `G.draw.includes(id)` 猜，
  // 而 id 是牌种不是副本：四张基础斩击里只要还有一张躺在抽牌堆，刚进弃牌堆的那张
  // 也会被画成飞回牌堆，读起来就是"这一轮没打出的牌没有回到弃牌堆"。
  const backToDraw = G.returned;
  G.returned = null;
  let laneOut = 0;
  for (let pi = 0; pi < prevHand.length; pi++) {
    if (kept.has(pi)) continue;
    const fx = prevFx[pi];
    const id = prevHand[pi];
    if (!fx || !id) continue;
    const card = defOf(id);
    // 依据是"逻辑层把这一张放哪了"，表现层不重复算一遍规则。
    const kind = cardKind(card);
    const mode: DiscardFx['mode'] = kind === 'junk' ? 'junk'
      : backToDraw === id ? 'return' : 'discard';
    const st = statOf(id);
    discardFx.push({
      card, atk: st.atk, blk: st.blk, up: isUpgraded(id),
      x: fx.dx, y: fx.dy, rot: fx.rot,
      // 杂念原地化掉，不排队；其余一张接一张，读得出"这是一把牌在离开手牌"
      age: mode === 'junk' ? 0 : -laneOut * DISCARD_GAP,
      mode,
    });
    if (mode === 'discard' || mode === 'return') laneOut += 1;
  }

  // 新进手的牌：排一个队，一张接一张从牌堆起飞
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
  // 敌人出手期间，新抽的手牌先留在牌堆里：core 已经同步换好了手牌，
  // 但两拨飞行物叠在一起会糊成一片。演完再让它们依次飞进来 ——
  // 所以 age 的推进放在下面按牌走，而不是在这里统一加 dt。

  for (const s of slots) {
    const id = G.hand[s.i];
    if (!id) continue;
    const fx = handFx[s.i];
    if (!fx) continue;
    // **排队中的牌也要推进 age**。负数变成 0 这一步只发生在这里，
    // 所以"还在队列里"必须是 `continue` 之前的状态判断，而不是它的原因 ——
    // 先 continue 再推进，那些牌就永远停在 -0.045，一手牌永远不落位（冒烟测试
    // 会一直等 handSettled，玩家则会看到一排半空中的牌）。
    const before = fx.age;
    if (!foeActing) fx.age += dt;
    if (fx.age < 0) continue; // 还在队列里，这张牌此刻不存在
    const card = defOf(id);
    // 手牌上的数字必须是**这一刻打出去**会打多少，不是卡面印死的底数。
    const st = liveStatOf(id);

    // 排队结束、真正起飞的那一帧：牌堆抖一下，牌是从这里出去的
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

    // 三种状态：基础牌（不答题，随时可打）/ 要答题 / 这一回合已经答错过。
    // 没有"锁着"这一档了 —— 本场解锁删掉之后，知识卡从第一回合起就能打，只是要答题。
    const kind = cardKind(card);
    const isJunk = kind === 'junk';
    const isBase = kind === 'basic';
    // 知识卡只有两种状态：还欠答题（ask）、这一场已免答（free）。
    // `empty` 只在"整章一道题都没有"时出现，正常载入不会发生；
    // 'free' 不该压暗 —— 它是最强的状态，压暗会读成"用不了"。
    const askState = isJunk || isBase ? 'other' : cardAskState(id);

    g.save();
    g.globalAlpha = alpha;
    g.translate(px, py);
    g.rotate(rot);
    drawCard(-w / 2, -h / 2, w, h, card, st.atk, st.blk, {
      up: isUpgraded(id), glow: hv, hovered: hv,
      // 付不起的牌费用数字转红：这一手现在打不出去，得在点之前就看得出来
      afford: isJunk || canPay(card),
      // 免答的牌在右下角标一个「免」：它是这一场攒出来的状态，不标出来玩家不会知道
      // 为什么这张牌这次没问问题。联动说明则走卡内注脚，和牌面共用同一套字。
      badge: askState === 'free' ? '免答' : undefined,
      rule: card.link?.note,
    });
    g.restore();

    // 还在飞的牌不给热区：那时候它画在半空中，点它等于点空气。
    // 但下标一定要带上 —— 少注册一项会让"第几个热区"和"第几张牌"整体错位。
    if (flying) continue;

    // 四种牌都要先付得起。付不起时不是"点了没反应"，而是抖一下 + 说清差多少 ——
    // 一张画在屏幕上、点下去却什么也不发生的牌，读起来就是坏了。
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
     * 这一下点的是哪一张。
     *
     * 热区是**上一帧**注册的，而手牌可能在这一帧里变过（答对抽牌、敌人塞杂念、
     * 上一张牌刚离手让后面的牌整体左移）。闭包里那个 `s.i` 是当时的下标，
     * 直接用会点到"现在站在这个位置上的另一张牌" —— 基础斩击打了却没反应，
     * 就是这么发生的。
     *
     * 但也不能一律退回 `G.hand.indexOf(id)`：起手就有四张基础斩击，它们是同一个 id
     * 的四份副本，indexOf 永远返回最左边那份 —— 点右边那张，被拿走的却是左边那张。
     * 所以先认"这一格还是不是这张牌"，只有它已经不在原位时才去找一份别的。
     */
    const idxOf = () => (G.hand[s.i] === id ? s.i : G.hand.indexOf(id));
    /** 点下去的当帧就有一圈光从这张牌上起来 —— 别让玩家猜这一下点没点中。 */
    const cardPulse = (c: string) => {
      FX.ring(px, py - h / 2, withAlpha(c, 0.5), 46, 0.32);
      FX.burst(px, py - h / 2 + 10, c, 8, {
        speed: 140, size: 3, grav: -90, life: 0.42,
      });
    };

    // 基础牌点下去直接打，知识卡点下去出题 —— 两种都是"点这张牌"，
    // 只是它问你要的东西不一样
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
        // 攒满等级直接打，否则抽题。新题用完时 askCard 会从本章复用一道，
        // 所以这里不需要再为"没题了"单独分支。
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


  // 这一帧画完，它就是"上一帧"了。存的是画出去的坐标（含悬停抬升），
  // 牌离手时从这里起飞才不会向下跳一下。
  prevHand = G.hand.slice();
  prevFx = handFx.slice();

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

  // 按钮上只留一个动作。原来下面那行"5 张手牌 · 行动力 3"是复述：
  // 手牌就摊在眼前，行动力在左边的环上，再说一遍不会让人多点一次。
  icon('turn', x + 44, y + h / 2, 15, ready ? (hv ? C.gold : C.ink2) : C.faint);
  text('结束回合', x + w / 2 + 18, y + h / 2 + 1, {
    size: 21, weight: 700, align: 'center', color: ready ? C.ink : C.dim,
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
  return {
    hand: handFx.length,
    discard: discardFx.length,
    /**
     * 正在飞出去的每一张牌"去了哪"。
     *
     * 冒烟测试用它盯"回合结束时上一轮没打出的牌会不会被画成飞回抽牌堆"：
     * 这件事看 `G.discard` 是看不出来的 —— 牌堆内容一直是对的，错的是它飞的方向。
     */
    discardModes: discardFx.map((f) => f.mode),
  };
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
  if (slots.length !== handFx.length) return false;
  for (const s of slots) {
    const fx = handFx[s.i];
    if (!fx || fx.age < DRAW_DUR) return false;
    // 手牌变少时剩下的牌会"滑"到新位置，所以还要等它滑到位，否则测试点到的是半路。
    if (Math.abs(fx.px - s.x) > 1 || Math.abs(fx.py - s.y) > 1) return false;
  }
  return true;
}

export function resetBattleView() {
  lastEnemyKey = '';
  prevHand = [];
  prevFx = [];
  handFx = [];
  // 换一场 / 退出这一局：上一场"被点走的那一格"不能再带过来 —— 下标和 id 都是旧的
  eject = null;
  discardFx.length = 0;
  discardPulse = 0;
  FX.clearFx();
}
