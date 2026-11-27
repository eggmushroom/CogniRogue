import { g, roundRect, VW, wrapText } from '../gfx/canvas';
import { C, PRESS, font, FONT_NUM, FONT_TITLE, FONT_UI, withAlpha } from '../gfx/theme';
import { bar, cutRule, drawCard, icon, panel, text } from '../gfx/ui';
import type { IconName } from '../gfx/ui';
import { drawPowerIcon } from '../gfx/art/powers';
import { onClick, hover, setInputLock } from '../input';
import { groundGlow, shieldDome } from '../gfx/aura';
import { clamp01, easeOut } from '../gfx/geom';
import { questionEntry, questionReturn, reduceMotion } from '../gfx/motion';
import * as FX from '../gfx/fx';
import { drawEnemy as drawCreatureEnemy, drawHero as drawCreatureHero, enemyWeapon, heroBlade } from '../gfx/creatures';
import { MODE_BY_ID, POWER_BY_ID, mechNote, stageOf } from '../core/model';
import type { EffOut } from '../core/model';
import { G, panelOf } from '../core/infra';
import { linkStatus } from '../core/combat/link';
import { planStrike } from '../core/combat/strike';
import { curFloor } from '../core/map';
import { dismissFeedback } from '../core/journey';
import { canPay, cardKind, costOf, defOf, isUpgraded, isXCost } from '../core/cards';
import {
  askCard, cancelPanel, endTurn, intentText, playBasic,
} from '../core/combat';
import type { CardDef, Foe } from '../core/model';

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
const ENEMY_GROUND = { x: ENEMY.x, y: ENEMY.y + 165 };
const HAND = { cx: 765, cy: 740, w: 200, h: 238, spread: 194 };
const HERO_ART = { size: 410, x: HERO.x - 12, y: HERO.y - 22 };
/** 玩家 / 敌人共用的状态牌：同一 y、同一宽、同一三段结构。 */
const PLATE = { y: 530, h: 84, w: 400 };
let battleT = 0;

const heroPose = () => ({
  ...HERO_ART, t: battleT, lunge: FX.heroLunge(), recoil: FX.heroRecoil(),
  flash: FX.heroFlash(), guard: FX.heroGuard(),
});

const foePose = (e: Foe) => ({
  ...ENEMY, t: battleT, size: e.type === 'boss' ? 427 : e.type === 'elite' ? 389 : 350,
  art: e.art, hue: e.hue, boss: e.type === 'boss', lunge: FX.enemyLunge(), recoil: FX.enemyRecoil(),
  flash: FX.enemyFlash(), guard: FX.enemyGuard(),
});

// FX uses these anchors rather than tracking another copy of the rig's transforms.
export const heroHand = () => heroBlade(heroPose());
export const enemyHand = () => G.enemy ? enemyWeapon(foePose(G.enemy)) : ENEMY;

let lastEnemyKey = '';
let wardEnemy: Foe | null = null;

/** 换敌人时把战斗内的临时选择清掉，避免索引指向上一场的手牌。 */
export function syncBattle() {
  const key = G.enemy ? G.enemy.key + G.enemy.maxHp : '';
  if (key !== lastEnemyKey) {
    lastEnemyKey = key;
    // 记录跨战斗复用；不清的话，新手牌会带着上一场的坐标出现。
    prevHand = [];
    prevFx = [];
    handFx = [];
    questionOrigin = null;
    prevTurn = G.turn;
    discardFx.length = 0;
  }
}

/** 世界层：立绘、状态牌、HUD 和手牌；书架由 layers.ts 的背景层统一画。 */
export function drawBattle(t: number, dt: number, defeat = 0) {
  battleT = reduceMotion() ? 0 : t;
  if (wardEnemy !== G.enemy) { wardEnemy = G.enemy; FX.resetWards(); }
  FX.updateWards(dt, G.block > 0, (G.enemy?.block ?? 0) > 0);
  topBar();
  // 只报会影响卡面数值的状态，玩家要能回答"为什么这张牌现在是 14 点"。
  const ls = linkStatus();
  if (ls.length) {
    // 接着顶部条最后一块牌排，永远不压到右侧增益。
    text(`联动 · ${ls.join('　·　')}`, topRowEnd + 18, 31, {
      size: 12, color: C.gold, weight: 700, maxW: Math.max(120, VW - 470 - topRowEnd),
    });
  }

  if (G.enemy && defeat < 1) drawEnemy(G.enemy, t, defeat);
  drawHero(t);
  energyStamp();
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
  grd.addColorStop(0, withAlpha(C.void, 0.92));
  grd.addColorStop(1, withAlpha(C.void, 0));
  g.fillStyle = grd;
  g.fillRect(0, 0, VW, 84);
  g.restore();

  // 生命与格挡已经移到人物下方的状态牌里，这里只留「这一局走到哪」。
  const st = stageOf(G.stage);
  let x = 192;
  icon('floor', x + 7, 31, 9, C.dim);
  x += 22;
  const floorLabel = `第 ${curFloor()} 层`;
  text(floorLabel, x, 31, { size: 18, family: FONT_TITLE, color: C.ink2, weight: 600 });
  g.font = font(18, 600, FONT_TITLE);
  x += g.measureText(floorLabel).width + 16;
  divider(x);
  x += 17;
  const stageLabel = `${st.name} · ${G.stageTopic}`;
  text(stageLabel, x, 31, { size: 13, color: st.color, weight: 600, maxW: 300 });
  g.font = font(13, 600, FONT_UI);
  x += Math.min(300, g.measureText(stageLabel).width) + 16;
  divider(x);
  x += 17;

  const mode = G.mode ? MODE_BY_ID[G.mode] : null;
  if (mode) {
    x += topChip(x, `◆ ${mode.name}`, mode.color) + 8;
  }
  // 本场剩余新题数。点开牌时由 takeQuestion 扣掉，答对答错都一样；
  // 0 时显示「题 复用」，不是锁牌。
  const left = G.qLeft.length;
  const reusing = left === 0;
  const qcol = reusing ? C.dim : left <= 2 ? C.red : left <= 4 ? C.gold : C.cyan;
  x += topChip(x, reusing ? '题 复用' : `题 ${left}`, qcol);
  topRowEnd = x;

  // 和其他顶部读数对齐，同时给右侧任务入口留空间。
  let rx = VW - 180;
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
    drawPowerIcon(rx + 1, 18, s - 2, p.id);
    if (hv) {
      const tw = 280;
      const tx = Math.max(12, Math.min(VW - tw - 12, rx + s / 2 - tw / 2));
      const size = 13;
      g.font = font(size);
      const lines = wrapText(p.card, tw - 28);
      panel(tx, 58, tw, 38 + lines.length * 19, { fill: PRESS.sheet, stroke: C.goldDim });
      text(p.name, tx + 14, 76, { size: 14, weight: 700, color: p.color });
      lines.forEach((ln, j) => text(ln, tx + 14, 98 + j * 19, { size, color: C.ink2 }));
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

  panel(x, y, w, h, {
    fill: PRESS.sheet, accent: o.hpColor,
    stroke: withAlpha(o.hpColor, o.danger ? 0.9 : 0.52),
  });

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

function drawEnemy(e: Foe, t: number, defeat: number) {
  const pose = foePose(e);
  const ward = { x: ENEMY_GROUND.x - pose.lunge * 58, y: ENEMY_GROUND.y,
    rx: pose.size * 0.37, ry: 24, t: battleT, power: FX.wardPower('enemy') };
  g.save();
  g.globalAlpha *= 1 - defeat;
  groundGlow({
    x: ENEMY_GROUND.x - pose.lunge * 58, y: ENEMY_GROUND.y, rx: pose.size * 0.39, ry: 27,
    color: C.hpFoe, t, power: 0.28, phase: 2.1,
    boost: pose.flash * 0.3,
  });
  shieldDome(ward);
  if (defeat > 0) {
    const sink = defeat * defeat;
    g.save();
    g.translate(pose.x + 18 * sink, pose.y + 44 * sink);
    g.rotate(0.16 * sink);
    g.scale(1, 1 - 0.12 * sink);
    g.translate(-pose.x, -pose.y);
    drawCreatureEnemy(pose);
    g.restore();
  } else drawCreatureEnemy(pose);

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
    // 12px 小字叠在暗状态牌上，橙色 #e08a4a 会被压成一团；金色更亮，
    // 也和 Boss 的名牌色一致，仍和血条/意图的语义色分开。
    note: mechNote(e) ?? undefined,
    noteColor: C.gold,
    t,
  });
  g.restore();
}

/* ── 玩家 ─────────────────────────────────────────────────── */

function drawHero(t: number) {
  const pose = heroPose();
  const ward = { x: pose.x + pose.lunge * 60, y: pose.y + 160,
    rx: 144, ry: 24, t: battleT, power: FX.wardPower('hero') };
  groundGlow({
    x: pose.x + pose.lunge * 60, y: pose.y + 160, rx: 144, ry: 26,
    color: pose.flash > 0 ? C.red : C.gold, t, power: 0.28, phase: 0.6, boost: pose.flash * 0.3,
  });
  shieldDome(ward);
  drawCreatureHero({ ...pose, dim: FX.lampDim() });

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

/* ── 行动力 / 牌堆 ───────────────────────────────────────── */

function energyStamp() {
  const active = G.ap > 0;
  panel(38, 640, 96, 96, { fill: active ? PRESS.vermilion : PRESS.sheet, accent: C.gold, stroke: active ? C.gold : C.lineHi });
  text('行动力', 86, 660, { size: 12, align: 'center', color: C.ink2 });
  text(String(G.ap), 86, 689, {
    size: 39, weight: 700, align: 'center', family: FONT_TITLE, color: active ? C.ink : C.faint,
  });
  bar(52, 714, 68, 7, G.ap / G.apMax, C.gold, { ticks: G.apMax });
}

function piles() {
  const pile = (
    x: number, y: number, label: string, n: number, col: string,
    ic: 'cards' | 'discard', fn: () => void, pulse = 0,
  ) => {
    const hv = hover(x, y, 96, 42);
    panel(x, y, 96, 42, { fill: hv ? C.panelHi : PRESS.sheet,
      stroke: pulse > 0 ? withAlpha(col, 0.35 + pulse * 0.5) : hv ? col : C.line });
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
  /** 上一帧画出来的卡面数值：离手动画要沿用它，别在加成已兑现后重算成旧数字。 */
  out?: EffOut;
}

/** 与左下角两块牌堆牌的中心一致（38 + 48），卡牌飞行终点不悬空。 */
const DRAW_FROM = { x: 86, y: 773 };
/** 弃牌堆中心：敌人塞的杂念要真的飞到这里。 */
export const DISCARD_TO = { x: 86, y: 821 };
const DRAW_DUR = 0.27;
const DRAW_GAP = 0.045;
const DISCARD_DUR = 0.3;
const DISCARD_GAP = 0.035;

/** 出牌在逻辑层是瞬时的；不补这段飞行，牌就是凭空消失。 */
interface DiscardFx {
  card: CardDef;
  /** 离手瞬间的卡面数值快照。 */
  out: EffOut;
  up: boolean;
  x: number;
  y: number;
  rot: number;
  /** 逻辑已弃牌；答错的牌由解析页翻出，不在战场层重复画。 */
  waitFor?: typeof G.panel;
  exitAge?: number;
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
let eject: { id: string; at: number; lift?: number } | null = null;
interface CardBounds {
  x: number; y: number; w: number; h: number; rotation: number;
}
export interface QuizFlipCard extends CardBounds {
  drawFront(): void;
  landing?: CardBounds;
}
interface QuestionCardOrigin extends QuizFlipCard {
  progress: number;
  exit?: { from: number; age: number };
}
let questionOrigin: (QuestionCardOrigin & { panel: NonNullable<ReturnType<typeof panelOf<'question'>>> }) | null = null;

export function questionCard() {
  return questionOrigin?.panel === G.panel && !reduceMotion() ? questionOrigin : null;
}

export const questionReturning = () => questionOrigin?.panel === G.panel && !!questionOrigin.exit;

export function cancelQuestion() {
  const origin = questionCard();
  if (!origin || origin.progress === 0) { cancelPanel(); return; }
  if (origin.exit) return;
  origin.exit = { from: origin.progress, age: 0 };
  // Key and pointer events can both arrive before the next frame registers new hit areas.
  setInputLock(true);
}

export function animateQuestion(age: number, dt: number) {
  const origin = questionCard();
  if (!origin) {
    if (questionReturning()) cancelPanel();
    return null;
  }
  const exit = origin.exit;
  const motion = exit ? questionReturn(exit.age, exit.from) : questionEntry(age);
  origin.progress = motion.progress;
  if (exit) {
    if (motion.ready) { cancelPanel(); return null; }
    exit.age += dt;
  }
  return motion;
}
let discardPulse = 0;

const feedbackDiscard = () => discardFx.find((f) => f.waitFor === G.panel);
export const feedbackLeaving = () => feedbackDiscard()?.exitAge !== undefined;

export function closeFeedback() {
  const f = feedbackDiscard();
  if (!f || reduceMotion()) { dismissFeedback(); return; }
  if (f.exitAge !== undefined) return;
  f.exitAge = 0;
  setInputLock(true);
}

export function animateFeedbackClose(dt: number) {
  const f = feedbackDiscard();
  if (f?.exitAge === undefined) return null;
  const motion = questionReturn(f.exitAge, 1);
  if (motion.ready || reduceMotion()) {
    discardFx.splice(discardFx.indexOf(f), 1);
    if (!reduceMotion()) pulseDiscard();
    dismissFeedback();
    return null;
  }
  f.exitAge += dt;
  const w = HAND.w * 0.38;
  const h = HAND.h * 0.38;
  const card: QuizFlipCard = { ...DISCARD_TO, w, h, rotation: -0.5,
    drawFront: () => drawCard(-w / 2, -h / 2, w, h, f.card, f.out, { up: f.up }),
  };
  return { motion, card };
}

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

/**
 * 手牌点击只在这里注册：热区用上一帧的槽位，闭包里的 slot 可能已经指向别的牌。
 * 拆出来之后 `drawHand` 只负责布局、飞行和绘制。
 */
function bindHandCard(args: {
  px: number; py: number; w: number; h: number; rot: number; id: string; slot: number;
  card: CardDef; isBase: boolean; isJunk: boolean;
  drawFace(): void;
}) {
  const { px, py, w, h, rot, id, slot, card, isBase, isJunk, drawFace } = args;
  const payUp = () => {
    if (canPay(card)) return true;
    FX.shake(6);
    FX.floatText(HAND.cx, HAND.cy - 54,
      isXCost(card) ? '行动力不够：X 费牌至少要 1 点'
        : `行动力不够：这张牌要 ${costOf(card)} 点`,
      C.red, 20, { vy: -34 });
    return false;
  };

  // 先认原位，不在了才 indexOf；同名四张一律 indexOf 会总是拿走最左份。
  const idxOf = () => (G.hand[slot] === id ? slot : G.hand.indexOf(id));
  const cardPulse = (c: string) => {
    FX.ring(px, py - h / 2, withAlpha(c, 0.5), 46, 0.32);
    FX.burst(px, py - h / 2 + 10, c, 8, { speed: 140, size: 3, grav: -90, life: 0.42 });
  };

  if (isBase) {
    onClick(px - w / 2, py - h / 2, w, h, () => {
      const i = idxOf();
      if (i < 0 || !payUp()) return;
      cardPulse(C.gold);
      eject = { id, at: i };
      playBasic(i);
    }, 'card', slot);
  } else if (!isJunk) {
    onClick(px - w / 2, py - h / 2, w, h, () => {
      const i = idxOf();
      if (i < 0 || !payUp()) return;
      const lift = (handFx[i]?.py ?? py) - py;
      eject = { id, at: i, lift };
      askCard(i);
      const panel = panelOf('question');
      if (panel?.idx === i && !reduceMotion()) {
        questionOrigin = { panel, x: px, y: py, w, h, rotation: rot, drawFront: drawFace, progress: 0 };
        setInputLock(true);
      }
    }, 'card', slot);
  } else {
    onClick(px - w / 2, py - h / 2, w, h, () => {
      text('杂念打不出去，回合结束进弃牌堆', HAND.cx, HAND.cy - 40, {
        size: 18, align: 'center', color: C.dim,
      });
      FX.shake(4);
    }, 'junk', slot);
  }
}

function drawHand(t: number, dt: number) {
  const slots = layoutHand();
  const foeActing = FX.enemyBusy();
  const asked = G.panel.k === 'question' ? G.panel.idx : -1;
  const miss = G.panel.k === 'feedback' && !G.panel.fb.right ? G.panel.fb : null;
  if (questionOrigin?.panel !== G.panel) questionOrigin = null;
  const inQuestion = questionCard();
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
    const fromQuiz = pi === skip && pi === miss?.idx;
    if (fromQuiz && reduceMotion()) continue;
    const card = defOf(id);
    discardFx.push({
      card, out: fx.out ?? planStrike(id, { noBoost: true }), up: isUpgraded(id),
      x: fx.dx, y: fx.dy, rot: fx.rot,
      waitFor: fromQuiz ? G.panel : undefined,
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
    // 手牌数字就是这一刻真打出去的每段伤害：与结算共用同一份 planStrike。
    const out = planStrike(id);
    fx.out = out;

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
    const picked = s.i === asked;
    if (hv) { scale *= 1.06; py -= 44; }
    else if (!flying) py -= Math.sin(t * 1.4 + s.i) * 2;

    const w = HAND.w * scale;
    const h = HAND.h * scale;
    fx.dx = px;
    fx.dy = py;
    // 题框沿用这张牌的身份，手里只留槽位。答完仍从这格更新弃牌动画。
    if (picked && inQuestion) {
      inQuestion.landing = { x: px, y: py, w, h, rotation: rot };
      continue;
    }

    const kind = cardKind(card);
    const isJunk = kind === 'junk';
    const isBase = kind === 'basic';

    const drawFace = () => drawCard(-w / 2, -h / 2, w, h, card, out, {
      up: isUpgraded(id), glow: hv || picked, hovered: hv,
      afford: isJunk || canPay(card),
      rule: card.link?.note,
    });
    g.save();
    g.globalAlpha = alpha;
    g.translate(px, py);
    g.rotate(rot);
    drawFace();
    g.restore();

    // 还在飞的牌不注册热区，但下标必须带上；少一项会让热区和牌整体错位。
    if (flying) continue;
    bindHandCard({ px, py, w, h, rot, id, slot: s.i, card, isBase, isJunk, drawFace });
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
    if (f.waitFor) {
      if (f.waitFor !== G.panel) discardFx.splice(i, 1);
      continue;
    }
    f.age += dt;
    if (f.age < 0) continue;
    if (f.age >= DISCARD_DUR) {
      discardFx.splice(i, 1);
      pulseDiscard();
      continue;
    }

    drawDiscardCard(f);
  }
}

function pulseDiscard() {
  discardPulse = 1;
  FX.burst(DISCARD_TO.x, DISCARD_TO.y - 6, C.orange, 3, {
    speed: 90, size: 3, grav: 320, life: 0.3,
  });
}

function drawDiscardCard(f: DiscardFx) {
  const p = clamp01(f.age / DISCARD_DUR);
  const e = p * p;
  const cx = (f.x + DISCARD_TO.x) / 2;
  const cy = Math.min(f.y, DISCARD_TO.y) + 46;
  const iu = 1 - e;
  const px = iu * iu * f.x + 2 * iu * e * cx + e * e * DISCARD_TO.x;
  const py = iu * iu * f.y + 2 * iu * e * cy + e * e * DISCARD_TO.y;
  const scale = 1 - 0.62 * e;
  const alpha = 1 - Math.max(0, (p - 0.74) / 0.26) * 0.9;
  const w = HAND.w * scale;
  const h = HAND.h * scale;
  g.save();
  g.globalAlpha *= alpha;
  g.translate(px, py);
  g.rotate(f.rot - 0.5 * e);
  drawCard(-w / 2, -h / 2, w, h, f.card, f.out, { up: f.up });
  g.restore();
}

function endTurnButton() {
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

  panel(x, y, w, h, { fill: !ready ? PRESS.sheet : hv ? PRESS.vermilionHi : PRESS.vermilion,
    stroke: !ready ? C.line : hv ? C.ink : C.gold });
  cutRule(x + 8, y + h - 7, w - 16, C.gold, hv && ready ? 0.78 : 0.34);

  icon('turn', x + 44, y + h / 2, 15, ready ? (hv ? C.gold : C.ink2) : C.faint);
  text('结束回合', x + w / 2 + 18, y + h / 2 + 1, {
    size: 21, weight: 700, align: 'center', color: ready ? C.ink : C.dim,
  });
  onClick(x, y, w, h, () => endTurn(), 'endturn');

  const dhv = hover(x, dy, w, dh);
  panel(x, dy, w, dh, { fill: dhv ? C.panelHi : PRESS.sheet, stroke: dhv ? C.gold : C.line });
  icon('cards', x + 42, dy + dh / 2, 11, dhv ? C.ink2 : C.dim);
  text(`牌组 ${G.deck.length}`, x + 97, dy + dh / 2, {
    size: 15, align: 'center', color: dhv ? C.ink : C.ink2,
  });
  onClick(x, dy, w, dh, () => { G.panel = { k: 'deck' }; }, 'deck');
}

/** 调试/冒烟用：在飞的牌数量；飞不完的单元会在屏幕上永远留一张牌。 */
export function fxCount() {
  const active = discardFx.filter((f) => !f.waitFor || f.exitAge !== undefined);
  return {
    hand: handFx.length,
    discard: active.length,
    /** 调试/冒烟用：每张飞出去的牌去了哪；离手的牌一律进弃牌堆。 */
    discardModes: active.map(() => 'discard'),
  };
}

/**
 * 调试/冒烟用：所有牌飞完且离落点不到 1px。测试不能拿 sleep 当状态，
 * 慢机器会点到半空中的牌。
 */
export function handSettled() {
  const slots = layoutHand();
  // 调试工具会原位换牌；旧牌的坐标即使已经对齐，也不能当作新牌的热区。
  if (slots.length !== handFx.length || G.hand.some((id, i) => id !== prevHand[i])) return false;
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
  questionOrigin = null;
  discardFx.length = 0;
  discardPulse = 0;
  FX.clearFx();
}
