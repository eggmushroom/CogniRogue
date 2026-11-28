import { g } from './canvas';
import { C, font, FONT_NUM, PRESS, PRINT, withAlpha } from './theme';
import { roll } from '../core/infra/util';
import { drawArtIcon } from './art/icons';
import { reduceMotion } from './motion';
import { playBattleSound } from './battle-audio';

/**
 * 表现层的"后果"。逻辑层只发事件，怎么演由这里决定：
 * 命中要震、数字要弹、答错要红一下。
 */

interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; max: number; size: number;
  color: string; grav: number; drag: number; shape: 'chip' | 'spark' | 'ring' | 'shield';
  /** 细线环：默认环是 3–8px 的粗圈，护盾类演出用 1px 才不抢画面。 */
  thin?: boolean;
}

interface FloatText {
  x: number; y: number; life: number; max: number;
  text: string; color: string; size: number; weight: number;
  vx: number; vy: number;
}

interface Slash {
  x: number; y: number; angle: number; life: number; max: number;
  len: number; color: string; width: number;
}

const particles: Particle[] = [];
const texts: FloatText[] = [];
const slashes: Slash[] = [];

let shakeAmp = 0;
let shakeT = 0;
let flashColor = '';
let flashA = 0;

const MAX_P = 420;

export function shake(power: number) {
  shakeAmp = Math.max(shakeAmp, power);
  shakeT = 0;
}

export function flash(color: string, a: number) {
  flashColor = color;
  flashA = Math.max(flashA, a);
}

export function floatText(
  x: number, y: number, text: string, color: string, size = 46, opts: { vy?: number; vx?: number; weight?: number; life?: number } = {},
) {
  texts.push({
    x, y, text, color, size,
    weight: opts.weight ?? 800,
    vx: opts.vx ?? 0,
    vy: opts.vy ?? -60,
    life: opts.life ?? 1.1,
    max: opts.life ?? 1.1,
  });
}

export function burst(
  x: number, y: number, color: string, n = 16,
  opts: { speed?: number; size?: number; grav?: number; life?: number; spread?: number; angle?: number } = {},
) {
  const speed = opts.speed ?? 260;
  const spread = opts.spread ?? Math.PI * 2;
  const base = opts.angle ?? 0;
  for (let i = 0; i < n; i++) {
    if (particles.length > MAX_P) break;
    const a = base + (Math.random() - 0.5) * spread;
    const s = speed * (0.35 + Math.random() * 0.9);
    particles.push({
      x, y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      life: (opts.life ?? 0.55) * (0.6 + Math.random() * 0.7),
      max: opts.life ?? 0.55,
      size: (opts.size ?? 5) * (0.6 + Math.random() * 0.9),
      color,
      grav: opts.grav ?? 420,
      drag: 0.92,
      shape: roll() <= 30 ? 'spark' : 'chip',
    });
  }
}

export function ring(
  x: number, y: number, color: string, radius = 90, life = 0.4, thin = false,
) {
  particles.push({
    x, y, vx: 0, vy: 0, life, max: life, size: radius,
    color, grav: 0, drag: 1, shape: 'ring', thin,
  });
}

export function slash(x: number, y: number, angle: number, color = '#fff6e0', len = 260) {
  slashes.push({ x, y, angle, life: 0.26, max: 0.26, len, color, width: 10 });
}

function shieldPrint(x: number, y: number, size: number) {
  if (particles.length >= MAX_P) return;
  particles.push({ x, y, vx: 0, vy: 0, life: 0.44, max: 0.44, size,
    color: PRINT.ward, grav: 0, drag: 1, shape: 'shield' });
}

/* ── 打击 ── */
/* 蓄力 → 冲出 → 光刃 → 命中 → 击退。逻辑已结算完，这里只补演出。 */

export type StrikeKind = 'strike' | 'pierce' | 'guard' | 'drain' | 'chain' | 'focus';

interface Vec { x: number; y: number }

interface Strike {
  t: number;
  fly: number;
  /** 光刃是否已经落地（落地只演一次） */
  landed: boolean;
  /** 起点：出招者的手。飞行中会跟着身体走，看起来才是"从手上甩出去的" */
  a: Vec;
  follow: (() => Vec) | null;
  b: Vec;
  color: string;
  dmg: number;
  absorbed: number;
  target: 'enemy' | 'hero';
  kind: StrikeKind;
  arc: number;
  /** 同一手里的第几段。多段伤害的飘字要错开，否则 "4" "4" 会念成 "44" */
  seq: number;
  /** 这一下被玩家全挡住了：落地不能爆红，得是撞在盾上的蓝 */
  blocked: boolean;
}

interface Star {
  x: number; y: number; life: number; max: number; size: number; color: string; rot: number;
}

const strikes: Strike[] = [];
const stars: Star[] = [];

let lungeT = 9;
let eLungeT = 9;
let eKnock = 0;
let hKnock = 0;
let eFlash = 0;
let hFlash = 0;
let heroGuardT = 9;
let enemyGuardT = 9;
const ward = { hero: 0, enemy: 0 };
const WARD_TARGETS = ['hero', 'enemy'] as const;
export const resetWards = () => { ward.hero = 0; ward.enemy = 0; };

export function updateWards(dt: number, hero: boolean, enemy: boolean) {
  const instant = reduceMotion();
  for (const target of WARD_TARGETS) {
    // Rules can clear block before the projectile lands. Keep the ward through the last absorbing hit.
    const holding = (target === 'hero' ? hero : enemy)
      || (!instant && strikes.some((s) => s.target === target && s.absorbed > 0 && !s.landed));
    if (instant) ward[target] = Number(holding);
    else if (holding) ward[target] = Math.min(1, ward[target] + dt / 0.14);
    else ward[target] = Math.max(0, ward[target] - dt / 0.32);
  }
}

export function wardPower(target: keyof typeof ward) {
  const k = ward[target];
  return k * k * (3 - 2 * k);
}
/** 火星落地后刀锋才恢复亮色。 */
let lampDimT = 0;
const LAMP_DIM = 0.34;

/** 答错时暂时压暗随武器出手的光。 */
export function lampDim(): number {
  return Math.max(0, Math.min(1, lampDimT / LAMP_DIM));
}

const LUNGE_BACK = 0.075;
const LUNGE_OUT = 0.115;

/**
 * 出招的身体位移，-0.28 = 后撤蓄力，1 = 完全冲出去。
 * 蓄力必须比冲刺长一点点，不然只是"抖了一下"。
 */
export function heroLunge(): number {
  const t = lungeT;
  if (t >= 0.62) return 0;
  if (t < LUNGE_BACK) return -0.28 * (t / LUNGE_BACK);
  const out = LUNGE_BACK + LUNGE_OUT;
  if (t < out) {
    const k = (t - LUNGE_BACK) / LUNGE_OUT;
    return -0.28 + 1.28 * (k * k * (3 - 2 * k));
  }
  const k = (t - out) / (0.62 - out);
  return Math.pow(1 - k, 2.4);
}

export function enemyLunge(): number {
  const t = eLungeT;
  if (t >= 0.62) return 0;
  if (t < LUNGE_BACK) return -0.3 * (t / LUNGE_BACK);
  const out = LUNGE_BACK + LUNGE_OUT * 1.15;
  if (t < out) {
    const k = (t - LUNGE_BACK) / (LUNGE_OUT * 1.15);
    return -0.3 + 1.3 * (k * k * (3 - 2 * k));
  }
  const k = (t - out) / (0.62 - out);
  return Math.pow(1 - k, 2.2);
}

/** 被击退的余量，0..1 */
export const enemyRecoil = () => eKnock;
export const heroRecoil = () => hKnock;
/** 飞刃拖尾和命中高光消退后，才让敌人退场；飘字与粒子可以自然收尾。 */
export const playerStrikeActive = () => eFlash > 0 || strikes.some((s) => s.target === 'enemy');
/** 命中瞬间的高光，卡面/立绘用来闪一下 */
export const enemyFlash = () => eFlash;
export const heroFlash = () => hFlash;

const GUARD_DUR = 0.52;

function guardPose(t: number, power: number, lunge: number) {
  const rest = power * 0.32 * (1 - Math.max(0, lunge));
  if (t >= GUARD_DUR) return rest;
  const raise = Math.min(1, t / 0.09);
  const lower = Math.min(1, (GUARD_DUR - t) / 0.23);
  return rest + (1 - rest) * raise * lower;
}

export const heroGuard = () => guardPose(heroGuardT, wardPower('hero'), heroLunge());
export const enemyGuard = () => guardPose(enemyGuardT, wardPower('enemy'), enemyLunge());

export function heroBlock(at: Vec, n: number, showFx: boolean) {
  heroGuardT = 0;
  if (showFx) gainBlock(at.x, at.y, n);
}

/**
 * 一次打击。dmg 只用于命中反馈，血量在逻辑层已经扣过了。
 */
export function attack(o: {
  from: Vec;
  to: Vec;
  color?: string;
  dmg?: number;
  absorbed?: number;
  target?: 'enemy' | 'hero';
  kind?: StrikeKind;
  /** 同一手第几段，用来错开飘字 */
  seq?: number;
  /** 起点跟着谁走：给了就每帧重新取，甩出去的光刃才不会脱手 */
  follow?: () => Vec;
  /** 被格挡全挡下：只画盾环和「全挡下」，不画受伤 */
  blocked?: boolean;
}) {
  const target = o.target ?? 'enemy';
  const kind = o.kind ?? 'strike';
  const fly = kind === 'pierce' ? 0.15 : 0.2;
  strikes.push({
    t: 0,
    fly,
    landed: false,
    a: { ...o.from },
    follow: o.follow ?? null,
    b: { ...o.to },
    color: o.color ?? C.gold,
    dmg: o.dmg ?? 0,
    absorbed: o.absorbed ?? 0,
    target,
    kind,
    // 每条弧线抬的高度不一样，两段伤害才不会叠成一条
    arc: kind === 'chain' ? 82 + (o.seq ?? 0) % 3 * 32 : target === 'hero' ? 72 : 118,
    seq: o.seq ?? 0,
    blocked: o.blocked ?? false,
  });
  if (target === 'enemy') lungeT = 0; else eLungeT = 0;
}

/** 答错的那一手：不朝敌人飞任何东西，反馈只落在出手的地方。 */
export function fizzle(o: { at: () => Vec; color?: string }) {
  playBattleSound('fizzle');
  const p = o.at();
  const col = o.color ?? C.red;
  // 亮屑只窜起来一点就熄：力量没能离开手
  burst(p.x, p.y, col, 15, { speed: 150, size: 5, grav: -170, life: 0.45 });
  // 暗屑往下掉，是"泄掉"的那一半
  burst(p.x, p.y, 'rgba(126,90,72,.9)', 13, { speed: 92, size: 6, grav: 470, life: 0.55 });
  ring(p.x, p.y, withAlpha(C.red, 0.45), 58, 0.28);
  lampDimT = 0.34;
  shake(3);
}

function bezPath(s: Strike, u: number): Vec {
  const cx = (s.a.x + s.b.x) / 2;
  const cy = Math.min(s.a.y, s.b.y) - (s.kind === 'pierce' ? 24 : s.arc);
  const iu = 1 - u;
  return {
    x: iu * iu * s.a.x + 2 * iu * u * cx + u * u * s.b.x,
    y: iu * iu * s.a.y + 2 * iu * u * cy + u * u * s.b.y,
  };
}

function land(s: Strike) {
  const { x, y } = s.b;
  const stopped = s.target === 'hero' ? s.blocked : s.absorbed > 0 && s.dmg === 0;
  // Sound follows the player: enemy attacks are silent until they actually
  // hurt the hero or hit the hero's shield. Hits on the enemy are visual only.
  if (s.target === 'hero' && (stopped || s.dmg > 0)) {
    playBattleSound(stopped ? 'block' : 'hurt', stopped ? s.absorbed : s.dmg, s.seq);
  }
  if (s.target === 'enemy') {
    if (s.absorbed > 0) {
      enemyGuardT = 0.07;
      shieldPrint(x, y, 132);
    }
    eKnock = stopped ? 0.28 : 1;
    eFlash = stopped ? 0 : 1;
    slash(x, y, s.seq % 2 ? Math.PI / 3 : -Math.PI / 3, stopped ? PRINT.ward : PRINT.parchment, stopped ? 105 : 165);
    burst(x, y, stopped ? PRINT.ward : s.color, 15, { speed: 295, size: 4.5, grav: 280 });
    if (!stopped) burst(x, y, PRINT.parchment, 6, { speed: 210, size: 3, grav: 240 });
    shake(stopped ? 3 : 7);
    floatText(x + 30 + s.seq * 34, y - 60 - s.seq * 46, String(s.dmg), '#fff0c2', 66, { vy: -110 });
    if (s.absorbed > 0) floatText(x - 90, y + 30, `-${s.absorbed} 格挡`, C.blue, 34, { vy: -60, weight: 600 });
  } else if (s.blocked) {
    // 敌人确实出手了，但被格挡全接住。这里必须演"撞在盾上"而不是"挨了一下"：
    // 否则玩家叠了半天挡，画面上却什么都不发生，会以为这次格挡白叠了。
    hKnock = 0.32;
    heroGuardT = 0.07;
    shieldPrint(x, y, 178);
    burst(x, y, C.blue, 10, { speed: 200, size: 3 });
    slash(x, y, -Math.PI / 4, withAlpha(C.blue, 0.6), 180);
    shake(5);
    floatText(x, y - 40, '全挡下', C.blue, 38, { vy: -70, weight: 700 });
  } else {
    if (s.absorbed > 0) {
      heroGuardT = 0.07;
      shieldPrint(x + 38, y, 132);
    }
    hKnock = 1;
    hFlash = 1;
    burst(x, y, C.red, 26, { speed: 380, size: 6 });
    ring(x, y, withAlpha(C.red, 0.6), 150, 0.4);
    star(x, y, C.red);
    flash(C.red, 0.15);
    shake(18);
    floatText(x, y - 40, `-${Math.max(1, s.dmg)}`, '#ff9a92', 62, { vy: -90 });
  }
}

function star(x: number, y: number, color: string) {
  stars.push({ x, y, life: 0.22, max: 0.22, size: 150, color, rot: (Math.random() - 0.5) * 0.5 });
}

/* ── 语义化特效 ───────────────────────────────────────────── */

function gainBlock(x: number, y: number, n: number) {
  shieldPrint(x, y, 132);
  burst(x, y + 22, PRINT.ward, 7, { speed: 85, size: 3, grav: 105, life: 0.38 });
  floatText(x, y - 46, `+${n}`, PRINT.ward, 32, { vy: -58, weight: 600 });
}

export function heal(x: number, y: number, n: number) {
  burst(x, y, C.green, 18, { speed: 160, size: 4, grav: -120 });
  floatText(x, y - 50, `+${n}`, C.green, 42, { vy: -80, weight: 700 });
}

/* ── 敌人动作 ── */
/* 五种意图各一小段演出；坐标由调用方注入，这一层不认识场景常量。 */

export type EnemyActKind = 'atk' | 'def' | 'jam' | 'buff' | 'calm';

interface Debris {
  t: number;
  delay: number;
  fly: number;
  a: Vec;
  b: Vec;
  arc: number;
  rot: number;
  landed: boolean;
}

const debris: Debris[] = [];
let poseKind: EnemyActKind = 'atk';
let poseAt: Vec = { x: 0, y: 0 };
let poseT = 9;
const POSE_DUR = 0.62;

/** 敌人当前动作的进度 0..1；没在演时返回 null。battle.ts 拿它做身体倾斜、缩放。 */
export function enemyPose(): { k: EnemyActKind; p: number } | null {
  return poseT >= POSE_DUR ? null : { k: poseKind, p: poseT / POSE_DUR };
}

/**
 * 敌人还在出手。core 的 endTurn 是同步的，不压住抽牌动画两拨飞行物会叠成一团。
 */
export const enemyBusy = () => poseT < POSE_DUR;

/** 还在演的敌人动作单元数：冒烟测试靠它确认"敌人真的动了"，而不是只看数值变了。 */
export const enemyActCount = () => debris.length + (poseT < POSE_DUR ? 1 : 0)
  + strikes.filter((s) => s.target === 'hero').length;

export interface EnemyActSpec {
  /** 攻击段由 `enemyStrike` 一段一事件地演，不再在这里成组编排。 */
  k: Exclude<EnemyActKind, 'atk'>;
  n: number;
  /** 敌人 / 玩家 / 弃牌堆的位置 */
  from: Vec;
  to: Vec;
  discard: Vec;
}

/**
 * 敌人一段攻击的演出。core 的执行器在每一段扣血的同刻发一个 enemyHit，
 * 这里只画这一段：节拍由 `SEG_MS` 决定，表现层不再自己排 `setTimeout`。
 */
export function enemyStrike(o: {
  n: number; absorbed: number; seq: number; times: number; totalAbsorbed: number;
  from: Vec; to: Vec; follow: () => Vec;
}): number {
  poseKind = 'atk';
  poseAt = { ...o.from };
  poseT = 0;
  // 扣血为 0 但确实有格挡吸收，才是"全挡下"；伤害本来就 0 的情况不算。
  const blocked = o.n === 0 && o.absorbed > 0;
  attack({
    from: o.follow(),
    follow: o.follow,
    to: { x: o.to.x + (blocked ? 58 : 0) + (Math.random() - 0.5) * 30, y: o.to.y - 10 },
    color: blocked ? PRINT.ward : PRINT.cord,
    kind: 'strike',
    dmg: o.n,
    absorbed: o.absorbed,
    target: 'hero',
    seq: o.seq,
    blocked,
  });
  if (o.seq === o.times - 1 && o.totalAbsorbed > 0) {
    floatText(o.to.x, o.to.y - 110, `吸收 ${o.totalAbsorbed}`, C.blue, 30, { vy: -50, weight: 600 });
  }
  return 0.5;
}

/** 编排一次敌人非攻击动作，返回演完要多久 —— 调用方拿这个数锁输入。 */
export function enemyAct(o: EnemyActSpec): number {
  poseKind = o.k;
  poseAt = { ...o.from };
  poseT = 0;
  const { from } = o;

  if (o.k === 'def') {
    enemyGuardT = 0;
    gainBlock(from.x - 128, from.y - 14, o.n);
    return 0.55;
  }

  if (o.k === 'jam') {
    const n = Math.max(1, Math.round(o.n));
    for (let i = 0; i < n; i++) {
      debris.push({
        t: 0, delay: i * 0.13, fly: 0.5,
        a: { x: from.x - 60, y: from.y - 20 },
        b: { x: o.discard.x, y: o.discard.y },
        arc: 190 + Math.random() * 90,
        rot: (Math.random() - 0.5) * 1.2,
        landed: false,
      });
    }
    shake(4);
    return 0.7 + (n - 1) * 0.13;
  }

  if (o.k === 'buff') {
    ring(from.x, from.y, withAlpha(C.red, 0.55), 180, 0.5);
    ring(from.x, from.y, withAlpha(C.orange, 0.4), 240, 0.65);
    burst(from.x, from.y + 100, C.orange, 28, { speed: 150, size: 5, grav: -240, life: 0.75 });
    floatText(from.x, from.y - 70, `攻击 +${o.n}`, C.orange, 36, { vy: -55, weight: 700 });
    shake(5);
    return 0.6;
  }

  // calm：第一回合的观察期。敌人没出手也得让玩家看见"它忍住了"，
  // 否则会以为敌人卡住了，或者以为下次点结束回合会连挨两下。
  ring(from.x, from.y, withAlpha(C.cyan, 0.32), 165, 0.7);
  floatText(from.x, from.y - 70, '观察中…', C.cyan, 28, { vy: -34, weight: 600 });
  return 0.5;
}

/* ── 更新与绘制 ───────────────────────────────────────────── */

export function update(dt: number) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += p.grav * dt;
    p.vx *= Math.pow(p.drag, dt * 60);
    p.vy *= Math.pow(p.drag, dt * 60);
  }
  for (let i = strikes.length - 1; i >= 0; i--) {
    const s = strikes[i];
    const before = s.t;
    s.t += dt;
    if (s.follow && !s.landed) s.a = s.follow();
    // The sound belongs to the player's forward thrust, not the enemy contact.
    const thrustAt = s.fly - 0.075;
    if (s.target === 'enemy' && before < thrustAt && s.t >= thrustAt
        && (s.dmg > 0 || s.absorbed > 0)) {
      playBattleSound('thrust', s.dmg + s.absorbed, s.seq);
    }
    if (!s.landed && s.t >= s.fly) { s.landed = true; land(s); }
    if (s.t > s.fly + 0.26) strikes.splice(i, 1);
  }
  for (let i = stars.length - 1; i >= 0; i--) {
    stars[i].life -= dt;
    if (stars[i].life <= 0) stars.splice(i, 1);
  }
  for (let i = debris.length - 1; i >= 0; i--) {
    const d = debris[i];
    d.t += dt;
    if (!d.landed && d.t >= d.delay + d.fly) {
      d.landed = true;
      burst(d.b.x, d.b.y, C.purple, 9, { speed: 130, size: 4, grav: 280, life: 0.35 });
    }
    if (d.t > d.delay + d.fly + 0.18) debris.splice(i, 1);
  }
  poseT = Math.min(9, poseT + dt);
  lungeT = Math.min(9, lungeT + dt);
  eLungeT = Math.min(9, eLungeT + dt);
  heroGuardT = Math.min(9, heroGuardT + dt);
  enemyGuardT = Math.min(9, enemyGuardT + dt);
  lampDimT = Math.max(0, lampDimT - dt);
  eKnock = Math.max(0, eKnock - dt * 4.2);
  hKnock = Math.max(0, hKnock - dt * 4.2);
  eFlash = Math.max(0, eFlash - dt * 3.4);
  hFlash = Math.max(0, hFlash - dt * 3.4);
  for (let i = texts.length - 1; i >= 0; i--) {
    const t = texts[i];
    t.life -= dt;
    if (t.life <= 0) { texts.splice(i, 1); continue; }
    t.x += t.vx * dt;
    t.y += t.vy * dt;
    t.vy += 90 * dt;
  }
  for (let i = slashes.length - 1; i >= 0; i--) {
    slashes[i].life -= dt;
    if (slashes[i].life <= 0) slashes.splice(i, 1);
  }
  if (shakeAmp > 0) {
    shakeT += dt;
    shakeAmp *= Math.pow(0.0025, dt);
    if (shakeAmp < 0.4) shakeAmp = 0;
  }
  if (flashA > 0) flashA = Math.max(0, flashA - dt * 0.55);
}

export function shakeOffset() {
  if (shakeAmp <= 0 || reduceMotion()) return { x: 0, y: 0 };
  const a = shakeAmp;
  return { x: (Math.random() - 0.5) * a * 2, y: (Math.random() - 0.5) * a * 2 };
}

export function drawFlash() {
  if (flashA <= 0 || reduceMotion()) return;
  g.save();
  g.globalAlpha = flashA;
  g.fillStyle = flashColor;
  g.fillRect(-200, -200, 2000, 1300);
  g.restore();
}

/**
 * 一道飞过去的光刃。宽度从尾到头递增、颜色从效果色到白色，
 * 读到的是"能量被甩出去"，不是一根棍子平移。
 */
function drawStrike(s: Strike) {
  const head = Math.min(1, s.t / s.fly);
  const after = s.t - s.fly;
  const fade = s.landed ? Math.max(0, 1 - after / 0.24) : 1;
  if (fade <= 0 || head <= 0) return;

  // 洞察是一道光束，尾巴要一直连到手上；其余是甩出去的刃，留一截拖尾就够
  const tailLen = s.kind === 'pierce' ? 1 : 0.62;
  const tail = Math.max(0, head - tailLen);
  const N = 26;
  const pts: Vec[] = [];
  for (let i = 0; i <= N; i++) pts.push(bezPath(s, tail + (head - tail) * (i / N)));

  const wmax = s.kind === 'pierce' ? 9 : s.target === 'hero' ? 36 : 30;
  const left: Vec[] = [];
  const right: Vec[] = [];
  for (let i = 0; i <= N; i++) {
    const q = pts[i];
    const qa = pts[Math.max(0, i - 1)];
    const qb = pts[Math.min(N, i + 1)];
    let dx = qb.x - qa.x;
    let dy = qb.y - qa.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    // Taper both ends so the motion reads as a cut, not a moving bar.
    const u = i / N;
    const w = wmax * Math.pow(Math.sin(u * Math.PI), 0.85) * (0.24 + u * 0.76);
    left.push({ x: q.x - dy * w, y: q.y + dx * w });
    right.push({ x: q.x + dy * w, y: q.y - dx * w });
  }

  const a0 = pts[0];
  const a1 = pts[N];
  const grd = g.createLinearGradient(a0.x, a0.y, a1.x, a1.y);
  grd.addColorStop(0, withAlpha(s.color, 0));
  grd.addColorStop(0.5, withAlpha(s.color, 0.34 * fade));
  grd.addColorStop(1, withAlpha(s.color, 0.92 * fade));

  g.save();
  g.beginPath();
  g.moveTo(left[0].x, left[0].y);
  for (const q of left) g.lineTo(q.x, q.y);
  for (let i = right.length - 1; i >= 0; i--) g.lineTo(right[i].x, right[i].y);
  g.closePath();
  g.fillStyle = grd;
  if (s.kind === 'pierce') {
    g.strokeStyle = grd;
    g.lineWidth = 2;
    g.stroke();
  }
  g.fill();

  g.beginPath();
  g.moveTo(left[12].x, left[12].y);
  for (let i = 13; i <= N; i++) g.lineTo(left[i].x, left[i].y);
  g.strokeStyle = withAlpha(PRINT.parchment, 0.87 * fade);
  g.lineWidth = s.kind === 'pierce' ? 1.5 : 2.5;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.stroke();

  g.restore();
}

/** 敌人动作的专属图层：护盾环 / 蓄力光 / 观察环，以及飞向弃牌堆的杂念牌。 */
function drawEnemyMotion() {
  const pose = enemyPose();
  if (pose && (pose.k === 'buff' || pose.k === 'calm')) {
    const pulse = Math.sin(Math.PI * pose.p);
    g.save();
    g.translate(poseAt.x, poseAt.y);
    if (pose.k === 'buff') {
      g.strokeStyle = withAlpha(C.orange, 0.5 * pulse);
      g.lineWidth = 2 + 7 * pulse;
      g.beginPath();
      g.arc(0, 0, 120 + 130 * pose.p, 0, Math.PI * 2);
      g.stroke();
    } else {
      // 观察期：一圈慢慢转的虚线：它在盯着你，但还不动
      g.setLineDash([10, 12]);
      g.rotate(pose.p * 0.8);
      g.strokeStyle = withAlpha(C.cyan, 0.45 * pulse);
      g.lineWidth = 2;
      g.beginPath();
      g.arc(0, 0, 175, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
    }
    g.restore();
  }

  for (const d of debris) {
    const u = (d.t - d.delay) / d.fly;
    if (u < 0 || u > 1) continue;
    const e = u * u;
    const cx = (d.a.x + d.b.x) / 2;
    const cy = Math.min(d.a.y, d.b.y) - d.arc;
    const iu = 1 - e;
    const px = iu * iu * d.a.x + 2 * iu * e * cx + e * e * d.b.x;
    const py = iu * iu * d.a.y + 2 * iu * e * cy + e * e * d.b.y;
    g.save();
    g.translate(px, py);
    g.rotate(d.rot + u * 3.4);
    g.globalAlpha = u > 0.85 ? Math.max(0, (1 - u) / 0.15) : 1;
    g.fillStyle = PRESS.card;
    g.strokeStyle = withAlpha(C.purple, 0.85);
    g.lineWidth = 2;
    g.beginPath();
    g.rect(-20, -28, 40, 56);
    g.fill();
    g.stroke();
    drawArtIcon('junk', 0, 0, 28, C.purple);
    g.restore();
  }
}

export function draw() {
  g.save();

  for (const s of strikes) drawStrike(s);
  drawEnemyMotion();

  for (const st of stars) {
    const k = st.life / st.max;
    const pop = 0.5 + (1 - k) * 0.9;
    const a = Math.pow(k, 1.5);
    g.save();
    g.translate(st.x, st.y);
    g.rotate(st.rot);
    g.scale(pop, pop);
    g.globalAlpha = a;
    // 两道细长的光交叉成星芒：比一个圆形更像"被打了"
    g.fillStyle = st.color;
    g.globalAlpha = a * 0.5;
    g.beginPath();
    g.ellipse(0, 0, st.size, st.size * 0.14, 0, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.ellipse(0, 0, st.size * 0.12, st.size * 0.7, 0, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = a;
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.ellipse(0, 0, st.size * 0.62, st.size * 0.05, 0, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.ellipse(0, 0, st.size * 0.045, st.size * 0.42, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  for (const s of slashes) {
    const t = 1 - s.life / s.max;
    g.save();
    g.translate(s.x, s.y);
    g.rotate(s.angle);
    g.globalAlpha = Math.pow(1 - t, 1.6);
    const len = s.len * (reduceMotion() ? 1 : 0.4 + t * 0.8);
    g.fillStyle = s.color;
    // 分开的刀痕在衰减时仍读成利刃，不会糊成一根光管。
    for (let i = 0; i < 3; i++) {
      const half = len * (0.5 - i * 0.09);
      const lift = -i * 8;
      g.beginPath();
      g.moveTo(-half, lift + 5);
      g.lineTo(half * 0.34, lift - s.width * (1 - t * 0.7));
      g.lineTo(half, lift);
      g.lineTo(-half * 0.18, lift + 3);
      g.closePath();
      g.fill();
    }
    g.restore();
  }

  for (const p of particles) {
    const k = p.life / p.max;
    g.globalAlpha = Math.max(0, Math.min(1, k));
    if (p.shape === 'shield') {
      const scale = reduceMotion() ? 1 : 1.18 - k * 0.35;
      drawArtIcon('guard', p.x, p.y, p.size * scale, p.color, { alpha: 0.68 });
      drawArtIcon('guard', p.x, p.y, p.size * (scale + 0.22), p.color, { alpha: 0.24 });
    } else if (p.shape === 'ring') {
      g.strokeStyle = p.color;
      g.lineWidth = p.thin ? 1.2 : 3 + 5 * k;
      g.beginPath();
      g.arc(p.x, p.y, p.size * (1.35 - k * 0.75), 0, Math.PI * 2);
      g.stroke();
    } else if (p.shape === 'spark') {
      g.strokeStyle = p.color;
      g.lineWidth = Math.max(1, p.size * 0.5);
      g.beginPath();
      g.moveTo(p.x, p.y);
      g.lineTo(p.x - p.vx * 0.02, p.y - p.vy * 0.02);
      g.stroke();
    } else {
      const size = p.size * (0.4 + k * 0.8);
      g.save();
      g.translate(p.x, p.y);
      g.rotate(Math.atan2(p.vy, p.vx));
      g.fillStyle = p.color;
      g.beginPath();
      g.moveTo(-size, -size / 3);
      g.lineTo(size, 0);
      g.lineTo(-size / 3, size / 2);
      g.closePath();
      g.fill();
      g.restore();
    }
  }
  g.globalAlpha = 1;

  for (const t of texts) {
    const k = t.life / t.max;
    const pop = k > 0.82 ? 1 + (k - 0.82) * 3.2 : 1;
    g.save();
    g.globalAlpha = Math.min(1, k * 2.2);
    g.translate(t.x, t.y);
    g.scale(pop, pop);
    g.font = font(t.size, t.weight, FONT_NUM);
    g.textAlign = 'center';
    g.lineWidth = 7;
    g.strokeStyle = 'rgba(0,0,0,.72)';
    g.strokeText(t.text, 0, 0);
    g.fillStyle = t.color;
    g.fillText(t.text, 0, 0);
    g.restore();
  }
  g.globalAlpha = 1;
  g.textAlign = 'left';
  g.restore();
}

export function clearFx() {
  particles.length = 0;
  texts.length = 0;
  slashes.length = 0;
  strikes.length = 0;
  stars.length = 0;
  debris.length = 0;
  shakeAmp = 0;
  flashA = 0;
  poseT = 9;
  lungeT = 9;
  eLungeT = 9;
  heroGuardT = 9;
  enemyGuardT = 9;
  resetWards();
  lampDimT = 0;
  eKnock = 0;
  hKnock = 0;
  eFlash = 0;
  hFlash = 0;
}
