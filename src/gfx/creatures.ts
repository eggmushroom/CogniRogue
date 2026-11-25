import type { ArtKey } from '../core/model/types';
import { g } from './canvas';
import { clamp01 } from './geom';
import { PRINT as P } from './theme';

export interface CreaturePose {
  x: number;
  y: number;
  size: number;
  t: number;
  lunge: number;
  recoil: number;
  flash: number;
  guard: number;
}

type Material = typeof P.jade | typeof P.paper | typeof P.bronze | typeof P.sage | typeof P.plum | typeof P.steel;
type Point = { x: number; y: number };
type EnemyPose = CreaturePose & { art: ArtKey; hue?: number; boss: boolean };
type Rig = ReturnType<typeof rig>;

const paths = new Map<string, Path2D>();
function path(d: string) {
  let p = paths.get(d);
  if (!p) { p = new Path2D(d); paths.set(d, p); }
  return p;
}

function cut(d: string, fill: string, edge: string = P.ink, weight = 1.4) {
  const shape = path(d);
  g.fillStyle = fill;
  g.fill(shape);
  if (weight > 0) {
    g.strokeStyle = P.ink;
    g.lineWidth = weight;
    g.stroke(shape);
    if (edge !== P.ink) {
      // A faint registration edge keeps dark shapes legible without outlining them in white.
      g.save();
      g.globalAlpha *= 0.64;
      g.strokeStyle = edge;
      g.lineWidth = weight * 0.43;
      g.stroke(shape);
      g.restore();
    }
  }
}

function line(d: string, color: string, weight = 1) {
  g.strokeStyle = color;
  g.lineWidth = weight;
  g.stroke(path(d));
}

function layer(x: number, y: number, angle: number, draw: () => void, sx = 1, sy = 1) {
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  g.scale(sx, sy);
  draw();
  g.restore();
}

type Limb = { root: Point; joint: Point; tip: Point };
type Cycle = (rate: number, phase?: number) => number;

function idle(o: CreaturePose): Cycle {
  const amount = clamp01(1 - Math.abs(o.lunge) * 2 - o.recoil) * (1 - o.guard * 0.75);
  return (rate, phase = 0) => Math.sin(o.t * rate + phase) * amount;
}

// Solve the bend from the grip or planted foot so the two segments never stretch apart.
function bend(root: Point, target: Point, upper: number, lower: number, side: number): Limb {
  const dx = target.x - root.x, dy = target.y - root.y;
  const distance = Math.hypot(dx, dy);
  const length = Math.max(Math.abs(upper - lower) + 0.1, Math.min(distance, upper + lower - 0.1));
  const x = distance ? dx / distance : 1, y = distance ? dy / distance : 0;
  const along = (upper * upper - lower * lower + length * length) / (2 * length);
  const cross = Math.sqrt(Math.max(0, upper * upper - along * along)) * side;
  return {
    root,
    joint: { x: root.x + x * along - y * cross, y: root.y + y * along + x * cross },
    tip: { x: root.x + x * length, y: root.y + y * length },
  };
}

function drawLimb({ root, joint, tip }: Limb, m: Material, width: number, far = false) {
  const segment = (from: Point, to: Point, sleeve: boolean) => {
    const dx = to.x - from.x, dy = to.y - from.y;
    layer(from.x, from.y, Math.atan2(dy, dx), () => {
      cut(sleeve ? 'M-2 -6 Q7 -7 20 -4 L22 3 Q9 6 -2 5Z' : 'M-2 -4 L6 -5 20 -3 22 2 5 4 -2 3Z',
        far ? m[0] : sleeve ? m[1] : m[2], m[3]);
      line(sleeve ? 'M3 -4 Q9 -5 17 -3' : 'M4 -2 17 -1 M15 -3 15 2', m[far ? 2 : 3], 0.8);
    }, Math.hypot(dx, dy) / 20, width);
  };
  segment(root, joint, true);
  segment(joint, tip, false);
  layer(joint.x, joint.y, 0, () => {
    cut('M-4 0 Q-4 -4 0 -4 Q4 -4 4 0 Q4 4 0 4 Q-4 4 -4 0Z', m[far ? 1 : 2], m[3]);
    line('M-1 0 1 -1', m[3], 0.85);
  }, width, width);
}

function seal(color: string) {
  cut('M0 -5 4.5 -2.6 4.5 2.6 0 5 -4.5 2.6 -4.5 -2.6Z', color);
  line('M-2 0 0 -2 2 0 0 2Z', P.parchment, 0.6);
}

function hatching(d: string, color: string, alpha = 0.28) {
  g.save();
  g.globalAlpha *= alpha;
  line(d, color, 0.48);
  g.restore();
}

function rivet() {
  cut('M-1.8 0 A1.8 1.8 0 1 0 1.8 0 A1.8 1.8 0 1 0 -1.8 0Z', P.brass, P.ink, 0.7);
  line('M-0.8 -0.5 0.6 0.6', P.ink, 0.55);
}

/** Both combatants are drawn facing right, then the enemy rig is mirrored. */
function rig(o: CreaturePose, facing: number, step: number, hover: number) {
  const attack = clamp01(o.lunge);
  const wind = Math.max(0, -o.lunge);
  return {
    x: o.x + facing * (o.lunge * step - o.recoil * 24 - o.guard * 9),
    y: o.y + Math.sin(o.t * 2) * hover + o.guard * 11 + wind * 16 - attack * 6,
    angle: facing * (attack * 0.18 - wind * 0.44 - o.recoil * 0.11 - o.guard * 0.12),
    facing, scale: o.size / 136,
  };
}

function world(r: Rig, p: Point): Point {
  const x = p.x * r.facing * r.scale;
  const y = p.y * r.scale;
  const c = Math.cos(r.angle), s = Math.sin(r.angle);
  return { x: r.x + c * x - s * y, y: r.y + s * x + c * y };
}

function heroJoints(o: CreaturePose) {
  const attack = clamp01(o.lunge);
  const wind = Math.max(0, -o.lunge);
  const w = idle(o);
  return {
    rise: w(1.8) * 2.2,
    lean: w(1.05) * 0.045 + attack * 0.065 - wind * 0.075,
    head: w(1.05, -0.7) * 0.095 + w(1.8, -0.5) * 0.035 - o.guard * 0.1,
    cape: w(1.8, -1.4) * 0.075 + w(0.94) * 0.027 + attack * 0.16,
    sword: bend({ x: 16, y: -20 }, {
      x: 24 + attack * 17 - wind * 35 + w(1.8, -0.5) * 3.5,
      y: 8 - attack * 12 - wind * 52 + o.guard * 9 + w(1.05, 0.5) * 2.7,
    }, 23, 22, 1),
    swing: 0.22 + attack * 1.33 - wind * 2.8 + o.guard * 0.28 + w(1.8, -0.8) * 0.15,
    shield: bend({ x: -18, y: -20 }, {
      x: 2 + o.guard * 23 - attack * 8 + w(1.05, -0.5) * 3,
      y: 12 - o.guard * 23 + w(1.8, -0.8) * 2,
    }, 24, 23, 1),
    bookTilt: -0.24 + o.guard * 0.36 + w(1.8, -0.95) * 0.07,
  };
}

const WAIST = 13;

export function heroBlade(o: CreaturePose): Point {
  const { sword, rise, lean, swing } = heroJoints(o);
  const angle = swing + lean;
  const hand = world({ x: 0, y: WAIST + rise, angle: lean, scale: 1, facing: 1 },
    { x: sword.tip.x, y: sword.tip.y - WAIST });
  return world(rig(o, 1, 90, 0), { x: hand.x + Math.sin(angle) * 48, y: hand.y - Math.cos(angle) * 48 });
}

function book(raised: number) {
  const cover = raised > 0.12 ? P.wardDark : P.jade[0];
  const foil = raised > 0.12 ? P.ward : P.brass;
  cut('M-16 -21 Q-14 -24 -10 -24 L10 -25 20 -19 18 17 Q16 20 11 20 L-12 23 -19 17Z', cover, foil);
  cut('M10 -22 Q15 -21 18 -18 L16 14 Q13 17 8 17Z', P.parchment);
  line('M12 -20 Q11 -3 10 15 M14 -19 Q13 -3 12 15 M16 -18 Q15 -3 14 14', P.paper[2], 0.7);
  cut('M-17 -22 Q-16 -24 -12 -24 L11 -25 8 18 -13 22 Q-17 22 -19 17Z', cover, foil);
  cut('M-16 -20 -12 -21 -14 18 Q-16 20 -17 16Z', P.black, P.ink, 0);
  line('M-11 -19 7 -21 5 15 -13 18Z M-12 -10 -8 -13 -6 -17 M0 15 2 11 6 8', foil, 0.7);
  cut('M-16 -22 -9 -23 -11 -19 -16 -15Z M5 -24 11 -25 10 -18 7 -19Z M-18 14 -13 17 -9 21 -14 22 -18 18Z M3 18 5 14 8 12 8 18Z', foil, P.ink, 0.7);
  hatching('M-16 -11 -14 -13 M-16 -7 -14 -9 M-16 -3 -14 -5 M-17 2 -15 0 M-17 6 -15 4 M-17 10 -15 8 M-10 -8 -8 -10 M-11 8 -8 5 M-11 11 -8 8 M0 -13 4 -17', P.parchment, 0.8);
  cut('M-10 0 Q-6 -3 -2 -8 Q1 -3 5 -2 Q1 1 -3 7 Q-6 3 -10 0Z', P.black, foil, 0.7);
  layer(-3, -1, 0, () => seal(raised > 0.12 ? P.ward : P.stamp), 0.7, 0.7);
  cut('M8 -4 14 -5 15 -1 8 1Z', foil, P.ink, 0.8);
}

export function drawHero(o: CreaturePose & { dim: number }) {
  const m = P.jade;
  const r = rig(o, 1, 90, 0);
  const { sword, shield, rise, lean, head, cape, swing, bookTilt } = heroJoints(o);
  const stride = clamp01(o.lunge) * 10;
  layer(r.x, r.y, r.angle, () => {
    for (const side of [-1, 1]) {
      const far = side < 0;
      const leg = bend({ x: far ? -16 : 9, y: WAIST + rise },
        { x: (far ? -23 : 12) + stride * side, y: 42 }, 17, 17, -1);
      drawLimb(leg, m, 1.15, far);
      layer(leg.tip.x, leg.tip.y, 0, () => {
        cut('M-7 -5 Q0 -6 5 -2 Q9 2 14 4 L16 9 14 12 H-6 Q-11 11 -11 7Z', m[0], m[2]);
        cut('M-6 5 Q2 3 9 5 L13 8 2 9Z', m[far ? 1 : 2]);
        line('M-7 9 Q0 11 13 10 M-5 1 4 0', m[far ? 2 : 3], 0.8);
      }, side, 1);
    }
    layer(0, -29 + rise, cape, () => {
      cut('M-12 -3 C-30 1 -32 15 -37 39 Q-42 61 -53 74 Q-45 74 -38 70 L-38 77 Q-30 74 -25 69 Q-22 74 -16 78 Q-8 73 -2 66 Q7 66 11 71 C12 49 24 29 13 11Z', m[0], m[2]);
      cut('M-15 3 C-29 15 -27 51 -47 70 Q-36 68 -30 61 C-23 48 -21 23 -12 12Z M0 13 C-13 35 -10 55 -17 74 Q-10 68 -6 63 Q0 64 4 66 C5 40 14 31 8 21Z', m[1], P.ink, 0);
      cut('M-19 15 C-24 34 -27 55 -37 65 C-30 50 -30 26 -19 15Z M1 30 Q-4 45 -4 61 L-9 66 Q-5 42 1 30Z', m[2], P.ink, 0);
      line('M-46 71 Q-37 68 -33 64 M-35 73 Q-28 70 -25 65 M-17 74 -10 69 M0 64 Q5 65 9 67', m[4], 0.65);
      hatching('M-28 24Q-32 30 -34 36 M-29 29Q-33 36 -35 42 M-30 35Q-34 42 -37 48 M-31 40Q-35 48 -39 55 M-33 46Q-37 54 -42 62 M-35 53 -44 66 M-26 54 -30 62 M-27 60 -31 67 M-13 43 -17 50 M-14 48 -19 57 M-15 55 -21 64 M-17 62 -22 69 M3 38 -1 44 M3 43 -2 51 M2 48 -3 57 M1 55 -3 62', P.parchment, 0.64);
    });

    // Keep the torso art in its original coordinates while turning around the waist.
    g.save();
    g.translate(0, WAIST + rise);
    g.rotate(lean);
    g.translate(0, -WAIST);
    cut('M-17 -35 Q-30 -34 -31 -25 Q-29 -12 -24 8 L-20 18 -11 25 10 23 21 12 18 -19 7 -33Z', m[1], m[3]);
    cut('M-18 -34 Q-31 -32 -34 -25 Q-26 -16 -15 -15 Q-7 -15 -1 -24 L19 -17 23 -24 Q9 -41 -18 -34Z', m[2]);
    cut('M-32 -25 Q-23 -29 -13 -27 L-3 -23 Q-10 -16 -15 -17 Q-25 -17 -32 -25Z', m[3], P.ink, 0);
    cut('M-8 -13 7 -20 Q14 -20 20 -16 L20 -4 Q15 8 7 17 L-1 12Z', m[0], m[2]);
    line('M-31 -25 Q-21 -19 -12 -20 L-4 -25 M-14 -12 Q-15 1 -7 17 M13 -15 Q12 2 3 13', m[3], 0.7);
    hatching('M-27 -27 -23 -22 M-23 -27 -19 -21 M-19 -27 -15 -21 M-24 -13 -20 -9 M-24 -9 -19 -5 M-23 -5 -18 -1 M-22 -1 -17 3 M-21 3 -16 7 M12 -11 17 -14 M11 -7 17 -11 M10 -3 16 -7', P.ink, 0.84);
    cut('M-23 5 Q-6 8 19 8 L17 16 Q0 17 -22 14Z', P.black, P.brass);
    line('M-21 8 Q-13 9 -12 9 M-3 10 16 10 M-20 12 -12 13', m[3], 0.64);
    layer(-8, 11, 0, () => seal(P.stamp));
    cut('M-22 14 -14 15 -13 30 -17 35 -23 28Z', P.stamp, P.ink);
    line('M-20 18 -18 28', P.cord, 0.7);

    // Keep one distinct eye slit so the armored profile reads at battle scale.
    layer(0, -34 + o.guard * 3, head, () => {
      cut('M-25 8 C-29 -2 -27 -14 -20 -21 Q-11 -31 4 -28 C12 -27 18 -23 21 -14 Q23 -7 18 1 L23 8 Q12 18 -5 10 Q-13 16 -21 12Z', m[0], m[3]);
      cut('M-25 4 C-26 -11 -20 -22 -8 -25 Q5 -30 15 -21 Q1 -25 -10 -17 C-16 -12 -21 -3 -18 11Z', m[2], P.ink, 0);
      cut('M-18 5 Q-18 -12 -6 -18 Q6 -24 16 -18 Q22 -10 17 0 L10 12 Q-1 14 -9 7 L-12 12Z', P.ink);
      line('M-18 9 C-21 -2 -15 -14 -8 -18 Q5 -25 16 -18 M-8 9 Q-2 13 6 13', P.brass, 0.8);
      cut('M-8 -12 Q0 -18 10 -16 L15 -13 15 -8 19 -4 16 -1 14 5 8 10 1 9 -7 3Z',
        o.flash > 0.48 ? P.parchment : m[2], m[3]);
      cut('M-7 -11 Q0 -16 10 -15 L14 -12 11 -10 2 -10 -4 -7Z M11 -7 15 -8 18 -4 15 -2 12 -3Z', m[3], P.ink, 0);
      cut('M-5 -7 2 -10 12 -11 15 -9 11 -6 2 -5Z', P.ink, P.ink, 0);
      line('M5 -7.4 10 -8.4', o.dim < 0.4 ? P.parchment : m[1], 1.05);
      cut('M-6 -3 1 -2 6 2 14 -1 13 5 8 9 1 8 -6 2Z', m[1], P.ink, 0);
      cut('M0 -2 6 0 13 -3 15 -1 9 4 5 5Z', m[3], P.ink, 0);
      line('M-3 -13 Q3 -16 9 -15 M15 -7 17 -4 M7 7 11 4', m[4], 0.65);
      hatching('M-24 -2 -21 -6 M-24 2 -21 -2 M-24 6 -21 2 M-22 9 -20 6 M-20 -13 -16 -18 M-17 -15 -12 -21 M-12 -17 -6 -23 M-7 -19 -2 -24 M-4 0 -1 3 M-2 0 2 4 M0 1 4 5', P.ink, 0.82);
    });

    drawLimb(sword, m, 0.86, true);
    layer(sword.tip.x, sword.tip.y, swing, () => {
      cut('M-4 1 -5 -33 Q-4 -40 1 -51 Q6 -43 8 -36 L7 -1Z', P.brass, P.ink, 1.5);
      cut('M1 -49 Q5 -42 7 -36 L5 -3 1 -4Z', o.dim > 0.4 ? m[3] : P.parchment, P.ink, 0);
      line('M0 -7 0 -35 1 -44 M-2 -11 -2 -30', m[0], 0.75);
      hatching('M2 -7 5 -11 M2 -10 5 -14 M2 -13 5 -17 M2 -28 5 -32', P.paper[0], 0.7);
      cut('M-11 -7 Q-7 -4 -3 -5 L5 -5 Q10 -5 13 -8 L12 -2 Q8 1 5 0 L6 9 1 13 -3 9 -2 0 Q-9 1 -11 -3Z', m[4]);
      line('M-8 -4 -4 -3 M6 -3 10 -4', P.parchment, 0.75);
      cut('M-6 1 Q0 -1 6 0 L10 5 5 11 -4 9 -8 6Z', m[0], m[2]);
      line('M-5 2Q-1 0 4 1 M-5 5 3 4 M-3 7 4 6', m[3], 0.65);
    });

    drawLimb(shield, m, 0.98);
    layer(shield.tip.x, shield.tip.y, bookTilt, () => book(o.guard));
    g.restore();
  }, r.scale, r.scale);
}

const ART = {
  shard: { body: 'shard', material: P.paper, mark: 0, reach: 94, origin: [39, -7], float: 4 },
  examiner: { body: 'scribe', material: P.sage, mark: 0, reach: 72, origin: scribeStaffOrigin, float: 0 },
  inquisitor: { body: 'scribe', material: P.bronze, mark: 1, reach: 95, origin: scribeStaffOrigin, float: 0 },
  grub: { body: 'grub', material: P.paper, mark: 0, reach: 108, origin: [48, 9], float: 0 },
  devourer: { body: 'grub', material: P.bronze, mark: 1, reach: 103, origin: [49, 9], float: 0 },
  moth: { body: 'moth', material: P.sage, mark: 0, reach: 114, origin: [22, -12], float: 6 },
  tide: { body: 'shard', material: P.jade, mark: 1, reach: 94, origin: [43, -8], float: 5 },
  lethe: { body: 'moth', material: P.steel, mark: 1, reach: 87, origin: [24, -10], float: 5 },
  cataloguer: { body: 'catalogue', material: P.bronze, mark: 0, reach: 70, origin: [45, -7], float: 0 },
  imprinter: { body: 'press', material: P.steel, mark: 0, reach: 87, origin: [47, 5], float: 0 },
  bound: { body: 'press', material: P.plum, mark: 1, reach: 78, origin: [51, 5], float: 0 },
  oblivion: { body: 'void', material: P.steel, mark: 0, reach: 86, origin: [29, -6], float: 3 },
  indexkite: { body: 'indexkite', material: P.paper, mark: 0, reach: 116, origin: [51, -8], float: 7 },
  puncher: { body: 'puncher', material: P.jade, mark: 0, reach: 77, origin: [48, 5], float: 0 },
  bellwarden: { body: 'bellwarden', material: P.bronze, mark: 0, reach: 75, origin: [45, 12], float: 0 },
  shelfspider: { body: 'shelfspider', material: P.sage, mark: 0, reach: 107, origin: [45, 8], float: 0 },
  moldcap: { body: 'moldcap', material: P.sage, mark: 0, reach: 90, origin: [41, -15], float: 0 },
  shelfmantis: { body: 'shelfmantis', material: P.jade, mark: 0, reach: 94,
    origin: (o: CreaturePose) => mantisArm(o.lunge, o.guard, idle(o), 1).tip, float: 0 },
  inkroller: { body: 'inkroller', material: P.steel, mark: 0, reach: 107, origin: [42, 14], float: 0 },
  typeblock: { body: 'typeblock', material: P.steel, mark: 0, reach: 94, origin: [39, -7], float: 0 },
  typeswarm: { body: 'typeswarm', material: P.steel, mark: 0, reach: 89, origin: [49, -13], float: 6 },
  rotary: { body: 'rotary', material: P.steel, mark: 0, reach: 76, origin: [46, -4], float: 0 },
  waxcrab: { body: 'waxcrab', material: P.plum, mark: 0, reach: 96, origin: [53, -5], float: 0 },
  gluepot: { body: 'gluepot', material: P.bronze, mark: 0, reach: 86, origin: [49, -10], float: 0 },
  needlejack: { body: 'needlejack', material: P.bronze, mark: 0, reach: 95, origin: [54, -14], float: 2 },
  seamcutter: { body: 'seamcutter', material: P.bronze, mark: 0, reach: 88, origin: [54, -11], float: 0 },
  lockbox: { body: 'lockbox', material: P.plum, mark: 0, reach: 85, origin: [45, -3], float: 3 },
  redactor: { body: 'redactor', material: P.plum, mark: 0, reach: 93, origin: [46, -6], float: 5 },
  sandkeeper: { body: 'sandkeeper', material: P.steel, mark: 0, reach: 80, origin: [43, 1], float: 2 },
} as const satisfies Record<ArtKey, { body: string; material: Material; mark: number; reach: number;
  origin: readonly [number, number] | ((o: CreaturePose) => Point); float: number }>;

export function enemyWeapon(o: EnemyPose): Point {
  const a = ART[o.art];
  const attack = clamp01(o.lunge);
  const local = typeof a.origin === 'function'
    ? a.origin(o)
    : { x: a.origin[0] + attack * 7, y: a.origin[1] - attack * 5 };
  return world(rig(o, -1, a.reach, a.float), local);
}

function shard(m: Material, tide: boolean, attack: number, guard: number, lit: boolean, w: Cycle) {
  layer(0, 7, -0.14 - attack * 0.2 + w(2.2) * 0.12, () => {
    cut('M-48 29 Q-35 0 -22 -32 L4 -52 Q19 -49 32 -42 L49 -18 42 14 Q20 39 -10 51 L-7 34 -21 38 -25 31Z', m[0], m[2]);
    cut('M-43 24 Q-27 -6 -14 -26 L14 -45 32 -38 Q31 5 6 25 L-1 27 -6 36 -16 40 -9 22 -22 31 -27 27Z', m[2], m[3]);
    cut('M-39 20 Q-26 0 -10 -9 L23 -36 Q19 -19 13 -8 L2 2 -1 11 -7 12 -7 19 -13 19 -16 24 -28 29 -25 19Z', m[3], m[2], 0.7);
    cut('M25 -9 43 -21 40 6 Q22 26 9 36 L-9 45 Q10 21 25 -9Z', m[1], m[2]);
    line('M-39 19 Q-31 16 -24 12 M-23 10 -17 4 M-15 2 -5 -5 M-29 17 -19 10 M-17 9 -13 7 M-12 5 -5 1 M-10 10 -4 5 M-6 32 Q14 23 27 5 M-5 38 Q12 30 24 17 M5 37 Q22 26 37 10', m[0], 0.9);
    hatching('M-36 16 -29 8 M-32 16 -25 7 M-29 16 -22 7 M-17 20 -11 14 M-13 19 -8 14 M2 32 5 26 M6 30 10 21 M9 27 14 17 M13 24 18 13 M18 20 23 10 M22 16 28 6 M27 12 33 1', P.ink, 0.72);
  });
  layer(21 - guard * 16 + w(2.2, -0.7) * 2.6, -11 + attack * 5 + w(2.2, -1) * 3,
    (1 - guard) * (0.2 + attack * 0.35) + w(2.2, -1) * 0.16, () => {
    cut('M-19 -23 Q-6 -31 10 -31 L26 -18 25 5 9 21 Q-9 20 -15 18 L-28 5Z', m[1], m[3]);
    cut('M-17 -19 Q-3 -26 10 -28 L22 -16 15 -9 5 -8 -1 -1 -12 -3 -20 1Z', m[3]);
    cut('M-24 4 -14 5 -9 10 -2 9 6 15 15 15 9 19 Q-13 18 -24 4Z', m[2], P.ink, 0);
    cut('M-6 -2 Q3 -9 15 -10 L23 -4 Q18 2 11 5 L1 2Z', P.ink);
    line('M7 -3 16 -5', lit ? P.parchment : m[4], 1.6);
    line('M-16 -15 -11 -19 -4 -21 M-13 -12 -7 -16 M-12 12 -7 14 M-4 14 1 17 M12 15 20 8', m[2], 0.75);
    hatching('M-19 -15 -13 -20 M-18 -11 -14 -15 M-19 -6 -14 -10 M-16 -7 -11 -11 M-1 -19 4 -25 M2 -19 7 -25 M5 -19 10 -24 M16 11 19 4 M18 10 22 3', m[0], 0.8);
  });
  if (tide) {
    layer(w(2.2, -1.8) * 6, w(2.2, -2.2) * 4, w(2.2, -1.4) * 0.14, () => {
      cut('M-48 37 -34 32 -12 52 7 46 -6 59 -28 53Z M-44 -11 -42 -27 -21 -43 -28 -28Z', m[1], m[3]);
      line('M-36 46 -22 52 -11 52 M-43 -18 -31 -32', P.ward);
    });
  } else {
    layer(-28, -31 + w(2.2, -1.6) * 5, w(2.2, -1.2) * 0.24,
      () => cut('M-8 12 -5 -5 7 -12 4 2Z', m[2], m[3]));
    layer(31, 34 + w(2.2, -2.3) * 5, w(2.2, -2) * 0.21,
      () => cut('M-11 -3 12 -13 1 8 -9 13Z', m[2], m[3]));
  }
}

function scribeStaff(attack: number, guard: number, w: Cycle) {
  const rise = w(1.65) * 2.5;
  // Keep the staff on the outside of the mask as it pivots from upright to a thrust.
  const arm = bend({ x: 18, y: -22 + rise }, {
    x: 36 + attack * 10 - guard * 6 + w(1.65, -0.7) * 2.6,
    y: -8 - attack * 11 - guard * 7 + rise,
  }, 16, 16, 1);
  const angle = 0.18 + attack * 1.1 + guard * 0.18 + w(1.65, -1.1) * 0.1;
  return { rise, arm, angle };
}

function scribeStaffOrigin(o: CreaturePose): Point {
  const { arm, angle } = scribeStaff(clamp01(o.lunge), o.guard, idle(o));
  // The inset of the staff head is centered at (2, -39) in the grip's frame.
  return {
    x: arm.tip.x + 2 * Math.cos(angle) + 39 * Math.sin(angle),
    y: arm.tip.y + 2 * Math.sin(angle) - 39 * Math.cos(angle),
  };
}

function scribe(m: Material, elite: boolean, attack: number, guard: number, lit: boolean, w: Cycle) {
  const { rise, arm: staff, angle } = scribeStaff(attack, guard, w);
  g.save();
  g.translate(0, 48);
  g.scale(1, 1 - rise / 70);
  g.translate(0, -48);
  cut('M-20 -30 C-33 -23 -42 -11 -43 15 Q-45 38 -55 49 Q-43 49 -34 44 L-26 53 Q-16 51 -12 44 Q-2 45 7 50 L16 40 Q24 41 32 43 Q24 28 24 16 L19 -28Z', m[0], m[2]);
  cut('M-28 -13 C-36 3 -36 33 -49 45 L-30 40 C-21 31 -20 2 -10 -15Z M5 -16 21 -10 Q21 17 27 40 L18 33 9 40 Q12 13 5 -16Z', m[1], P.ink, 0);
  cut('M-19 -6 C-27 8 -25 27 -33 39 Q-27 34 -23 22 Q-22 5 -14 -2Z M-13 41 Q-6 15 -5 4 Q-3 21 -8 44Z', m[2], P.ink, 0);
  line('M-31 -6 Q-36 26 -44 41 M-17 5 Q-19 29 -23 37 M17 13 Q17 25 20 33 M-12 27 -17 43 M0 30 Q1 39 5 43 M-39 45 -34 42 M20 38 28 41', m[3], 0.7);
  hatching('M-32 -2 -38 5 M-32 3 -38 11 M-33 9 -39 17 M-34 15 -40 23 M-35 21 -42 30 M-36 27 -44 37 M-39 33 -46 42 M-23 27 -28 34 M-23 32 -30 42 M-12 29 -17 37 M-12 34 -18 43 M15 21 23 26 M15 25 24 31 M16 30 25 35', P.parchment, 0.62);
  cut('M-20 -36 Q-35 -32 -43 -23 Q-36 -15 -24 -9 Q-7 -9 3 -12 L29 -22 Q25 -28 17 -34Z', m[2], m[3]);
  line('M-40 -23 Q-32 -17 -23 -13 Q-6 -13 1 -16 L24 -23', m[0], 0.85);
  line('M-36 -22 -33 -23 M-31 -19 -27 -20 M-26 -16 -22 -18 M-20 -15 -16 -17 M-13 -16 -9 -18 M-6 -17 -4 -19 M14 -20 17 -23 M19 -22 22 -25', m[3], 0.7);
  g.restore();
  layer(5 - guard * 4, -27 + guard * 5 + rise, attack * 0.13 + w(1.15, -0.6) * 0.1, () => {
    cut('M-24 -3 C-32 -15 -26 -33 -15 -40 Q-8 -48 6 -41 Q21 -37 22 -27 Q27 -5 14 10 L1 15 Q-16 11 -24 -3Z', m[0], m[3]);
    cut('M-23 -5 C-30 -19 -21 -38 -8 -40 Q2 -43 13 -35 Q0 -37 -9 -31 Q-19 -21 -18 -1Z', m[2], P.ink, 0);
    if (elite) {
      cut('M-23 -26 -19 -43 -12 -39 -8 -54 2 -43 12 -49 17 -32 Q2 -38 -9 -29Z', P.brass);
      line('M-18 -37 -16 -32 M-7 -48 -5 -35 M9 -44 12 -36 M-19 -30 Q0 -38 14 -34', P.parchment, 0.7);
    }
    cut('M-10 -23 Q1 -29 7 -30 L20 -23 Q23 -18 21 -12 L17 -2 8 6 -1 1 -3 -8 -12 -14Z', lit ? P.parchment : m[3]);
    cut('M-10 -16 -2 -10 4 -10 9 5 2 2 -3 -8Z', m[2], P.ink, 0);
    cut('M-8 -19 Q8 -21 16 -23 L21 -17 14 -12 Q2 -11 -8 -19Z', P.ink);
    line('M9 -16 16 -18', lit ? P.parchment : m[4], 1.4);
    line('M2 -24 9 -26 15 -24 M14 -10 13 -5 16 -5 M9 -2 13 -3 M8 1 11 0', m[0], 0.8);
    hatching('M-23 -13 -20 -17 M-23 -9 -20 -13 M-22 -5 -19 -9 M-20 -2 -18 -5 M-18 -26 -14 -31 M-15 -27 -9 -34 M-12 -29 -5 -36', P.ink, 0.76);
  });
  drawLimb(staff, m, 0.81);
  layer(staff.tip.x, staff.tip.y, angle, () => {
    cut('M-4 27 -3 -41 2 -42 5 27 1 34Z', P.brass);
    cut('M-9 -39 -4 -49 7 -49 13 -42 10 -30 -1 -28 -9 -33Z', elite ? m[3] : m[2]);
    cut('M-5 -39 0 -45 9 -43 7 -35 1 -32Z', m[0], m[4], 0.9);
    line('M-2 -39 1 -42 6 -41 M-2 -28 -1 -9 M1 8 2 26', m[3], 0.85);
    cut('M-7 -5 8 -6 10 1 3 7 -7 6 -10 2Z', m[1], m[3]);
    line('M-6 -2 5 -3 M-6 1 6 0 M-5 4 4 3', m[3], 0.65);
  });
}

function grub(m: Material, giant: boolean, attack: number, guard: number, lit: boolean, w: Cycle) {
  for (let i = 4; i >= 0; i--) {
    const pulse = w(2.8, -i * 0.9);
    const step = w(3.5, -i * 1.4);
    layer(26 - i * 17 + attack * (5 - i) * 1.4 + pulse * 2,
      10 + i * i * 0.76 - attack * i * 2 - guard * i * 2 + pulse * 3.5,
      -0.1 - i * 0.15 + guard * 0.3 + pulse * 0.12, () => {
      for (const side of [-1, 1]) {
        const leg = bend({ x: side * 10, y: 11 }, { x: side * 12 + step * 4, y: 27 - pulse * 3 }, 10, 10, side);
        drawLimb(leg, m, 0.48, side < 0);
      }
      cut('M-17 6 Q-26 -10 -17 -22 Q-7 -34 7 -26 Q24 -20 20 -3 Q17 13 2 22 Q-11 23 -17 6Z', m[1], m[3]);
      cut('M-18 -10 Q-20 -20 -10 -24 Q2 -29 13 -18 Q16 -14 17 -8 Q7 -15 -3 -13 Q-11 -12 -14 -5Z', m[2]);
      cut('M-17 -14 Q-16 -23 -6 -25 Q5 -26 11 -19 Q-6 -24 -17 -14Z', m[3], P.ink, 0);
      cut('M-12 7 Q2 11 15 -4 Q13 12 2 18 Q-7 20 -12 7Z', m[0], P.ink, 0);
      line('M-12 0 Q-9 -6 1 -8 M-10 5 Q-4 0 6 -2 M-6 10 Q2 8 10 2 M-3 15 Q6 13 12 7', m[2], 0.85);
      hatching('M-17 -11 -12 -20 M-14 -14 -9 -23 M-11 -16 -6 -24 M-8 -17 -3 -24 M4 -16 7 -20 M7 -15 10 -18 M10 -13 13 -16 M8 9 15 2 M7 13 15 6 M6 17 13 12', P.ink, 0.78);
    }, 1 - i * 0.095, 1 - i * 0.095);
  }
  layer(38 + attack * 7 - guard * 21 + w(2.8, 0.45) * 2.5,
    -5 - attack * 4 + guard * 9 + w(2.8, 0.45) * 3.5, guard * 0.7 + w(2.8, 0.45) * 0.1, () => {
    cut('M-20 -10 Q-17 -26 -5 -27 Q17 -29 25 -14 Q32 -2 26 11 Q20 24 0 22 Q-19 19 -20 -10Z', m[2], m[3]);
    cut('M-20 -9 Q-17 -24 -4 -24 Q12 -26 20 -17 Q1 -23 -13 -9 L-17 1Z', m[3], P.ink, 0);
    cut('M-8 16 Q2 10 4 1 L13 12 24 12 Q18 22 3 21Z', m[1], P.ink, 0);
    cut('M2 -12 Q10 -18 18 -15 Q27 -10 29 4 Q24 13 17 14 L6 12 1 2Z', m[0]);
    line('M-15 1 Q-10 -8 -3 -10 M-14 6 Q-10 0 -4 -2 M-11 11 -6 7 M3 17 Q13 19 20 15', m[3], 0.72);
    hatching('M-15 -13 -10 -19 M-13 -14 -7 -21 M-10 -15 -3 -22 M-7 -17 1 -24 M-3 -17 4 -23 M-17 6 -13 1 M-16 10 -12 5 M-15 13 -11 9', m[0], 0.75);
    for (const side of [-1, 1]) {
      layer(18, side * 5, side * (attack * 0.5 + (w(3.5, 0.2) + 1) * 0.115), () => {
        cut('M0 -4 Q10 -9 19 -5 L23 -1 Q14 -2 11 3 L5 5Z', m[3]);
        line('M4 -3 Q13 -6 19 -3 M5 1 9 0', P.parchment, 0.75);
      }, 1, side);
    }
    line('M9 -9 13 -12 17 -10', lit ? P.parchment : m[4], 2.5);
    if (giant) cut('M-12 -15 -21 -37 -10 -33 -5 -48 5 -34 16 -38 14 -22 4 -25Z', P.brass);
  });
}

function moth(m: Material, river: boolean, attack: number, guard: number, lit: boolean, w: Cycle) {
  const wing = w(6.8) * 0.19 + guard * 0.72 - attack * 0.39;
  for (const side of [-1, 1]) {
    layer(-6 + side * 4, -8, side * wing, () => {
      cut('M2 -5 C-12 -38 -42 -66 -60 -58 Q-73 -52 -62 -42 Q-56 -35 -62 -26 Q-59 -21 -50 -19 Q-48 -7 -27 -4 L-17 11Z', m[1], m[3]);
      cut('M-60 -53 Q-49 -55 -36 -45 Q-17 -31 -9 -13 Q-26 -24 -36 -24 Q-49 -24 -48 -32 Q-49 -37 -57 -41Z', m[2]);
      cut('M-60 -53 Q-48 -55 -31 -42 Q-45 -50 -54 -49 L-52 -42 Q-58 -45 -60 -53Z', m[3], P.ink, 0);
      line('M-57 -49 Q-28 -44 -12 -13 M-49 -38 Q-37 -37 -29 -31 M-45 -29 Q-37 -31 -31 -29 M-36 -43 Q-36 -37 -33 -35 M-28 -38 -26 -30 M-24 -31 -19 -23', m[0], 0.8);
      layer(-36, -21, 0.4, () => {
        cut('M-10 0 Q-8 -7 0 -8 Q7 -7 10 -1 Q7 7 0 8 Q-7 7 -10 0Z', m[0], m[3], 0.9);
        cut('M-6 0 Q-3 -5 1 -5 Q5 -4 6 0 Q4 4 0 5 Q-4 4 -6 0Z', m[4]);
        line('M-3 1 -1 -2 M0 0 3 -2', P.ink, 0.9);
      });
      // The smaller wing follows the forewing with a delay instead of hinging as a single slab.
      layer(-12, 1, w(6.8, -1.25) * 0.21 + guard * 0.14, () => {
        g.translate(12, -1);
        cut('M-17 2 Q-34 -17 -48 -14 Q-55 -12 -50 -4 Q-44 1 -53 7 Q-57 14 -47 19 Q-43 25 -34 23 Q-33 29 -29 31 Q-20 27 -12 19Z', m[2], m[3]);
        cut('M-47 -7 Q-32 -10 -18 9 Q-35 2 -49 8 Q-43 1 -47 -7Z M-48 16 Q-37 12 -28 18 Q-40 17 -42 22Z', m[3], P.ink, 0);
        line('M-50 9 Q-35 3 -20 10 M-43 16 Q-34 12 -24 15 M-35 17 -33 23 M-27 17 -28 26', m[0], 0.8);
        hatching('M-47 11 -50 15 M-43 10 -47 17 M-39 10 -43 16 M-34 9 -37 14 M-31 10 -33 14 M-30 21 -31 26 M-25 18 -26 25', P.ink, 0.77);
        if (river) cut('M-26 24 -38 38 -46 55 -36 49 -18 30 -12 18Z', m[1], m[3]);
      });
    }, side * (0.88 + w(6.8, -0.35) * 0.12), 1);
  }
  cut('M-12 -9 Q-7 -20 3 -18 Q24 -15 17 11 Q15 25 3 35 Q-13 32 -17 12 Q-18 1 -12 -9Z', m[0], m[3]);
  cut('M-9 10 0 13 12 8 9 16 0 22 -9 19Z M-6 24 0 26 7 23 1 32Z', m[2]);
  hatching('M-13 11 -9 14 M-13 14 -9 17 M-11 20 -6 22 M-9 23 -6 26 M-3 15 0 18 M2 15 4 17 M5 14 8 15', m[3], 0.73);
  layer(10 + attack * 12, -10, -attack * 0.25 + w(3.4, -0.55) * 0.1, () => {
    cut('M-14 -8 Q-12 -20 0 -21 Q16 -21 20 -9 Q21 2 12 7 L5 11 Q-10 9 -14 -8Z', m[2], m[3]);
    line('M-5 -18 Q-10 -32 -18 -37 M7 -19 Q10 -30 20 -33 M-16 -34 -21 -35 M-14 -31 -18 -31 M14 -29 15 -33 M16 -31 19 -35', m[3]);
    cut('M-5 -9 Q1 -16 12 -12 Q17 -7 13 -4 Q6 3 -4 -3Z', P.ink);
    line('M3 -7 11 -9', lit ? P.parchment : m[4], 1.5);
    line('M-10 -7 Q-11 -15 -3 -17 M-8 -1 -4 3 M-5 2 0 6 M8 6 15 1', m[3], 0.78);
  });
}

function catalogue(m: Material, attack: number, guard: number, lit: boolean, w: Cycle) {
  for (const side of [-1, 1]) {
    layer(side * (39 - attack * 7), 39, side * (0.05 - attack * 0.35 + guard * 0.1), () => {
      cut('M-12 -3 12 -4 16 9 11 17 17 22 -17 22 -20 17 -14 7Z', m[1], m[3]);
      line('M-15 16H10 M-11 8H11 M-6 1H9', m[3], 0.6);
    }, side, 1);
  }
  cut('M-52 -36 -47 -49 -34 -49 -34 -57 -15 -57 -15 -63 14 -63 14 -57 32 -57 32 -49 45 -49 52 -37 49 33 38 48 -41 48 -52 34Z', m[0], m[3]);
  cut('M-51 -34 -40 -40 -41 34 -52 32Z M40 -38 51 -33 49 33 40 36Z', m[1], m[3], 0.8);
  hatching('M-48 -28 -44 -32 M-49 -18 -43 -23 M-49 -8 -43 -13 M-49 2 -43 -3 M-49 12 -44 7 M-50 22 -44 17 M42 -25 48 -20 M43 -13 49 -8 M43 0 49 5 M42 13 48 18 M42 25 47 29', m[4], 0.65);
  cut('M-55 34 -38 32 38 32 54 34 56 46 42 50 -42 50 -56 46Z', m[1], m[3]);
  line('M-46 -36H46 M-40 -43H40 M-48 43H48 M-24 -54H24', m[4]);
  for (const x of [-46, 46]) for (const y of [-32, 30]) layer(x, y, 0, rivet);
  for (const side of [-1, 1]) {
    for (let row = 0; row < 4; row++) {
      const creep = Math.max(0, w(2.7, -row * 0.9 + side)) ** 2 * 5;
      layer(side * (25 - guard * 8 + creep) + (side > 0 ? attack * (row + 1) * 5 : 0), -27 + row * 15, side * (0.02 + attack * 0.08), () => {
        cut('M-18 -6 18 -6 18 6 15 8 -18 7Z', row % 2 ? m[1] : m[2], m[3], 0.85);
        cut('M-8 -3 Q0 -5 8 -3 V3 Q0 5 -8 3Z', P.parchment, P.ink, 0.75);
        line('M-5 -1H3 M-3 1H5', P.stamp, 0.65);
        line('M-16 -4H-9 M9 -4H16 M-16 5H15', m[0], 0.7);
        hatching('M-15 -2H-8 M-15 1H-10 M-14 4H-8 M9 -1H16 M11 2H15 M9 4H16', m[3], 0.7);
      });
    }
  }
  layer(0, -42, attack * 0.16, () => {
    cut('M-15 0 -7 -10 7 -10 15 0 7 10 -7 10Z', m[3]);
    cut('M-9 0 0 -5 9 0 0 5Z', P.ink);
    line('M-3 0H3', lit ? P.parchment : m[4], 1.8);
  });
}

function press(m: Material, bound: boolean, attack: number, guard: number, lit: boolean, w: Cycle) {
  cut('M-57 27 -45 -9 -32 -24 28 -24 45 -8 54 28 43 42 -43 42Z', m[0], m[3]);
  for (const side of [-1, 1]) {
    layer(side * (33 + attack * 7 - guard * 8), 23, side * (attack * 0.28 - guard * 0.25 + w(2.9, side) * 0.08), () => {
      cut('M-11 -14 13 -15 19 -2 8 15 17 22 17 27 -14 28 -17 21 -10 10 -16 -2Z', m[1], m[3]);
      line('M-12 23H12 M-8 12 8 11 M-11 3 13 2', m[2]);
      layer(0, -2, 0, () => seal(m[3]));
    });
  }
  if (bound) {
    cut('M-51 4 -51 -28 -36 -48 -13 -55 6 -44 30 -54 49 -38 54 -10 44 9 18 13 -3 22 -24 10Z', m[2], m[3]);
    cut('M-50 -30 -31 -41 -10 -39 4 -26 24 -45 43 -45 53 -29 49 -22 24 -26 4 -11 -20 -23 -46 -19Z', m[3]);
    line('M-42 -27 -23 -30 -6 -24 M12 -23 27 -34 45 -33 M-39 -19 -24 -21 M24 -25 42 -27', m[1]);
    hatching('M-44 -31 -34 -34 -22 -34 M-35 -25 -25 -27 -17 -26 M-32 -23 -19 -23 -12 -20 M20 -24 28 -30 42 -30 M23 -21 29 -25 43 -26 M-7 6 -4 11 M-4 2 0 10 M34 3 37 8', P.ink, 0.55);
    cut('M-38 -39 -26 -48 11 8 0 19Z M23 -51 34 -45 41 11 31 15Z', m[0], P.brass);
    line('M-33 -41 -24 -34 M-18 -25 -12 -19 M-6 -9 -1 -2 M3 4 7 10 M28 -44 30 -37 M31 -28 33 -21 M34 -11 35 -4 M36 3 37 9', P.brass, 0.75);
  } else {
    cut('M-44 8 -44 -35 -34 -43 33 -43 44 -34 44 8 35 17 -35 17Z', m[1], m[3]);
    cut('M-53 -43 -41 -51 42 -51 53 -43 42 -33 -41 -33Z', m[2], m[3]);
    line('M-37 -46H37 M-37 -31V10 M37 -31V10', P.brass, 1.6);
    cut('M-33 -26H32 V8 H-33Z', m[0], m[2], 0.8);
    line('M-29 -21H29 M-28 4H28 M-29 7H29', m[2], 1);
    for (const x of [-43, 43]) layer(x, -43, 0, rivet);
    hatching('M-35 -45 -30 -38 M-30 -45 -25 -38 M-25 -45 -20 -38 M-20 -45 -15 -38 M20 -45 25 -38 M25 -45 30 -38 M30 -45 35 -38 M-35 -12 -24 -19 M-35 -7 -24 -14 M-35 -2 -24 -9 M27 -5 35 -11 M27 0 34 -5 M26 5 34 0', m[3], 0.55);
    layer(5 + attack * 9, -15 + attack * 21 - guard * 7 + Math.max(0, w(2.9)) ** 2 * 7, attack * 0.2, () => {
      cut('M-8 -43 6 -43 6 -18 19 -11 19 -3 -20 -3 -20 -11 -8 -18Z', m[3]);
      line('M-4 -41V-19 M-4 -36H2 M-4 -30H2 M-4 -24H2 M-15 -7H15 M-11 -11H10', m[0]);
    });
  }
  layer(30 + attack * 14 - guard * 14, 1 + guard * 4, attack * 0.36, () => {
    cut('M-11 -12 16 -10 23 -3 21 8 4 14 -13 6Z', m[0], m[3]);
    line('M-4 0 13 1 18 -2', lit ? P.parchment : m[4], 2.8);
    line('M-6 6 4 9 14 6', m[2]);
    layer(4, -7, 0, rivet);
  });
}

function oblivion(m: Material, attack: number, guard: number, lit: boolean, w: Cycle) {
  cut('M-55 29 C-49 7 -45 -17 -29 -33 Q-19 -64 3 -65 Q24 -61 29 -35 L30 -25 Q48 -19 52 10 Q58 36 54 50 L38 45 Q31 53 20 55 L8 48 Q1 54 -9 58 L-22 46 Q-36 53 -49 55Z', m[0], m[3]);
  cut('M-53 44 C-44 18 -47 2 -29 -18 Q-18 -27 -12 -43 Q-15 -17 -22 6 Q-26 30 -30 40Z M51 46 Q43 28 39 3 Q32 -10 22 -14 Q26 6 23 18 Q29 32 31 44Z', m[1], m[2]);
  cut('M-47 41 Q-42 20 -37 5 Q-35 -5 -24 -16 Q-35 4 -34 22 L-37 38Z M38 9 Q40 24 46 37 L41 36 Q35 20 38 9Z', m[2], P.ink, 0);
  cut('M-23 -24 C-32 -52 -13 -61 2 -62 Q17 -56 23 -35 Q26 -13 9 1 Q-5 10 -16 -8Z', m[2], m[3]);
  cut('M-23 -28 C-26 -45 -16 -56 1 -59 Q12 -56 17 -45 Q9 -51 0 -49 Q-14 -47 -17 -31 L-14 -16Z', m[3], P.ink, 0);
  cut('M-16 -26 Q-19 -45 0 -51 Q14 -51 20 -33 Q25 -22 13 -12 L4 -7 Q-9 -8 -16 -26Z', P.ink);
  cut('M-14 -29 Q-10 -17 3 -19 L9 -14 Q3 -9 -3 -12 Q-13 -19 -14 -29Z', m[0], P.ink, 0);
  line('M-17 -14 Q-7 4 6 1 Q16 -3 21 -14 M-23 -37 Q-23 -49 -13 -54 M-46 44 -38 41 M-18 46 -10 52 M23 50 36 44', m[3], 0.85);
  hatching('M-47 26 -37 12 M-46 31 -38 19 M-46 37 -39 26 M-43 40 -37 31 M-36 33 -29 23 M-36 38 -29 31 M-32 20 -23 7 M-31 24 -24 15 M-28 22 -20 12 M34 22 39 31 M34 28 41 39 M21 23 30 39 M-19 -48 -14 -53 M-16 -46 -10 -54 M-13 -46 -6 -54 M-10 -47 -2 -55 M-19 -19 -13 -11 M-16 -14 -10 -5 M-12 -9 -6 -2 M-7 -5 -2 0 M14 -7 20 -15', m[3], 0.62);
  line('M-8 -26 Q-2 -32 5 -28 M11 -22 15 -24', lit ? P.parchment : m[4], 1.8);
  for (const side of [-1, 1]) {
    const drift = w(1.5, side * 0.85);
    const arm = bend({ x: side * 18, y: -13 },
      { x: side * (22 + attack * 12 - guard * 13 + drift * 4), y: 12 + drift * 4.8 }, 16, 16, -side);
    drawLimb(arm, m, 0.95, side < 0);
    layer(arm.tip.x, arm.tip.y, side * (0.34 + attack * 0.55 - guard * 0.64 + drift * 0.17), () => {
      cut('M-13 -11 Q1 -18 19 -12 L28 -3 27 13 14 22 3 18 -3 19 0 16 -10 18Z', m[3]);
      cut('M-7 -8 Q6 -13 14 -7 L21 1 17 14 7 15 -3 10Z', m[1]);
      cut('M-3 -7 Q3 -9 12 -5 L17 1 14 12 8 12 3 8Z', m[0], P.ink, 0);
      line('M0 -5 Q9 -6 14 2 M0 0 Q8 0 11 7 M-6 11 -2 14 M22 2 24 6 23 11 M-8 -12 1 -14 11 -13 M10 18 14 20 23 14', m[0], 0.85);
      hatching('M-9 -7 -7 -3 M-9 -3 -6 1 M-8 1 -5 5 M-7 5 -4 9 M17 -10 20 -6 M20 -9 23 -4 M23 -7 26 -3 M21 12 25 8 M18 15 24 11', m[0], 0.8);
    }, side, 1);
  }
}

function ward(o: CreaturePose, r: Rig) {
  // Leave room for the forward silhouettes of jaws and blades, which vary by rig.
  const p = o.guard;
  if (p <= 0) return;
  layer(r.x, r.y, r.angle, () => {
    g.globalAlpha *= Math.min(1, p * 2);
    for (const i of [-1, 0, 1]) {
      layer(76 - p * 10 - Math.abs(i) * 8, i * (28 + (1 - p) * 13), i * (0.51 - p * 0.29), () => {
        cut('M-5 -14 1 -18 8 -10 8 10 1 18 -5 14 -8 0Z', P.wardDark, P.ward);
        line('M3 -13 5 -8V9 L2 14 M-5 -2H1', P.ward, 0.9);
      });
    }
  }, r.scale * r.facing, r.scale);
}

function indexkite(m: Material, a: number, d: number, w: Cycle) {
  layer(-24, 8, w(4) * 0.18, () => {
    line('M4 0Q-34 1 -22 25T-47 46', P.brass, 1.5);
    cut('M-19 16 -33 16 -27 26 -30 34 -16 32 -22 24Z M-37 34 -49 35 -45 41 -44 50 -33 47 -39 41Z', P.stamp);
  });
  for (const side of [-1, 1]) {
    layer(0, 0, side * (a * 0.13 - d * 0.81 + w(3.2, side * 0.5) * 0.1), () => {
      cut('M-37 0 -11 -43 9 -43 9 -36 52 0 6 -6Z', m[3], P.brass);
      cut('M-36 -1 -10 -41 -6 -34 6 -6Z M-4 -37 9 -36 48 -2 Q16 -16 -4 -37Z', m[2], P.ink, 0);
      line('M-32 -2 6 -6 -8 -34 44 -4 M-21 -14 -10 -16 M-18 -20 -12 -21 M5 -31 17 -21 M7 -24 24 -15', m[1], 1.1);
      hatching('M-19 -7 -8 -11 M-17 -4 -5 -9 M18 -13 24 -9 M23 -13 29 -8', P.ink, 0.62);
    }, 1, side);
  }
  cut('M-40 0 3 -9 52 0 4 9Z', m[0], m[2]);
  layer(16, 0, 0, () => seal(P.stamp));
}

function puncher(m: Material, a: number, d: number, lit: boolean, w: Cycle) {
  cut('M-45 23 -15 11 42 14 50 23 40 37 -31 40 -47 34Z', m[0], m[2]);
  cut('M-42 24 -10 17 46 21 37 29 -32 32Z', m[2], m[3]);
  line('M-38 34 35 31 M-34 38V44 H-18 L-14 37 M27 35V43 H39 L43 31', m[3], 2);
  layer(-36, 20, -0.12 - a * 0.38 + d * 0.29 + w(2.55) * 0.095, () => {
    cut('M-6 3 -10 -18 -2 -40 16 -45 70 -31 90 -18 90 -8 72 -5 18 -13 10 2Z', m[1], m[2]);
    cut('M-2 -35 16 -40 68 -27 82 -19 73 -16 21 -26 7 -23Z', m[2], m[3]);
    cut('M20 -37 65 -27 72 -23 20 -32 5 -32Z', m[3], P.ink, 0);
    cut('M47 -17 55 -15 55 0 49 5 46 1Z M68 -12 76 -11 76 4 69 8 66 4Z', P.brass);
    line('M21 -22 44 -17 M26 -19 43 -15 M77 -13 86 -16 M77 -9 86 -12', m[0], 0.95);
    layer(8, -30, 0, rivet);
    line('M6 -13 17 -12', lit ? P.parchment : m[4], 3);
    hatching('M21 -21 26 -16 M28 -20 33 -15 M35 -19 40 -14 M42 -18 47 -13', P.parchment);
  });
  layer(-35, 20, 0, () => seal(P.brass));
}

function bellwarden(m: Material, a: number, d: number, lit: boolean, w: Cycle) {
  cut('M-33 -2 -48 26 -50 43 -37 47 -30 29 -20 22 19 27 30 45 47 44 44 29 29 -3Z', m[0], m[2]);
  cut('M-30 4 -37 30 -32 37 -25 22Z M20 15 29 33 40 39 35 26Z', m[1], m[3]);
  layer(0, -44, -a * 0.48 + d * 0.15 + w(2.1) * 0.115, () => {
    cut('M-7 8 -10 -3 -5 -10 5 -10 12 -3 8 8Z', m[2], m[3]);
    layer(2, 55, a * 0.25 + w(2.1, -1.1) * 0.48, () => {
      cut('M-6 1 4 0 10 12 3 19 -8 16 -13 9Z', m[2], m[3]);
    });
    cut('M-19 54 C-18 37 -23 18 -8 10 Q6 2 20 13 C33 21 26 39 40 52 L40 61 Q9 75 -34 61 L-34 55Z', m[2], m[3]);
    cut('M-17 48 C-13 36 -19 21 -7 14 Q0 10 8 12 Q-6 16 -6 33 Q-6 42 -2 51 L-26 56Z', m[3], P.ink, 0);
    cut('M24 18 Q31 33 34 43 L39 51 23 55 Q27 45 24 18Z', m[1], P.ink, 0);
    cut('M-35 54 Q0 61 40 52 L40 62 Q4 74 -35 63Z', m[1], m[3]);
    cut('M2 29 Q12 27 23 24 L22 35 Q16 41 7 42 L-6 37Z', m[0], m[1]);
    line('M6 35 19 30', lit ? P.parchment : m[4], 2);
    line('M-31 59 Q2 68 36 57 M-28 63 Q3 71 36 61 M-11 17 Q-16 25 -14 33 M-23 50 Q-10 52 -2 50', m[3], 0.85);
    hatching('M12 16 18 13 M10 21 22 16 M16 22 25 19 M25 39 33 48 M21 42 28 49 M16 44 23 51 M-16 34 -12 28 M-17 39 -12 32 M-18 44 -13 37 M-20 48 -14 41 M-21 52 -16 47', P.ink, 0.75);
    layer(3, -1, 0, rivet);
  }, 1 + d * 0.1, 1 - d * 0.12);
}

function shelfspider(m: Material, a: number, d: number, lit: boolean, w: Cycle) {
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const lift = w(3.75, -i * 1.25 + side * 1.4);
      const fan = i - 1.5;
      const leg = bend({ x: -34 + i * 14, y: 2 + side * 6 }, {
        x: -28 + fan * (30 - d * 7) + a * 12 + side * 5 + lift * 2.5,
        y: (side < 0 ? 34 : 49) - d * 7 - Math.max(0, lift) ** 2 * 6 - Math.abs(fan) * 3,
      }, 26, 33, fan < 0 ? 1 : -1);
      drawLimb(leg, m, side < 0 ? 0.46 : 0.58, side < 0);
    }
  }
  cut('M-52 -4 -42 -30 -13 -37 7 -21 9 8 -12 25 -42 19Z', m[1], m[3]);
  cut('M-47 -6 -38 -24 -15 -32 -5 -19 -22 -17 -36 12Z', m[2]);
  line('M-24 -25 -36 -1 -36 13 M-17 -28 -31 1 -31 14 M-4 -19 -17 6 -20 14', m[3], 0.8);
  line('M-44 -11 Q-41 -20 -34 -23 M-45 -3 Q-42 -13 -36 -17 M-32 15 Q-23 21 -13 20 M-25 13 Q-17 16 -10 14', m[0], 1);
  hatching('M-38 -22 -35 -25 M-39 -19 -32 -25 M-39 -15 -31 -22 M-34 -7 -29 -11 M-33 -2 -27 -8 M-30 3 -24 -3 M-27 8 -22 2 M-24 12 -19 6', P.ink, 0.7);
  layer(13 + a * 10 - d * 10, 0, d * 0.15, () => {
    cut('M-10 -14 13 -17 25 -6 23 10 11 18 -7 12Z', m[0], m[2]);
    line('M11 -6h5 M19 -3h3 M9 1h4', lit ? P.parchment : m[4], 2.2);
    cut('M20 2 38 -4 33 7 24 12Z M18 10 33 19 27 24 14 16Z', m[3]);
  });
}

function moldcap(m: Material, a: number, d: number, lit: boolean, w: Cycle) {
  cut('M-16 -14 19 -12 15 13 20 31 35 38 23 45 5 41 -8 47 -35 43 -39 35 -22 30 -12 7Z', m[1], m[3]);
  line('M-5 11 -10 28 -27 38 M2 18 -3 32 -6 43 M12 19 15 33 27 40 M-9 6 -5 5 M5 5 11 3', lit ? P.parchment : m[3], 1.2);
  layer(0, -13 + d * 15 - a * 7 + w(2.1) * 3.4, -a * 0.23 + w(1.32) * 0.12, () => {
    cut('M-52 5 Q-42 -35 -10 -41 Q21 -48 34 -22 L51 -2 48 7 Q-7 24 -52 5Z', m[2], m[3]);
    cut('M-46 -4 Q-37 -32 -11 -39 Q10 -46 25 -31 Q-1 -39 -20 -25 Q-29 -19 -30 -11Z', m[3], P.ink, 0);
    cut('M-51 4 Q-13 -9 29 -5 L49 -2 45 8 Q-10 27 -51 7Z', m[0], m[3]);
    line('M-44 6 -12 11 M-34 3 -9 12 M-22 1 -5 13 M-11 0 0 12 M4 -1 8 11 M16 0 14 10 M28 0 21 9 M42 2 27 7', m[3], 0.8);
    cut('M-28 -18 -22 -27 -12 -27 -9 -20 -17 -16Z M3 -33 13 -32 17 -27 8 -26Z M22 -16 32 -13 31 -8 25 -9Z', m[3]);
    cut('M-36 -13q-2 -4 2 -4q4 1 2 3Z M-4 -30q-1 -3 2 -3q3 2 0 4Z M-5 -21q-1 -3 4 -3q3 2 0 4Z M13 -15q-3 -4 2 -5q5 2 3 4Z M33 -7q-2 -4 2 -4l3 4Z', m[1], P.ink, 0);
    hatching('M-39 -9 -29 -19 M-34 -8 -26 -16 M-24 -8 -18 -13 M-8 -8 1 -18 M-2 -10 5 -18 M34 -9 37 -13', P.ink, 0.64);
  }, 1 + d * 0.13);
}

function mantisArm(lunge: number, guard: number, w: Cycle, side: -1 | 1) {
  const a = clamp01(lunge), wind = Math.max(0, -lunge), near = side > 0;
  // The face stays above the elbow's highest point; guarding folds the blade inward below it.
  const root = { x: near ? 2 : 1, y: near ? -9 : -18 };
  const angle = (near ? -0.22 : -0.27) + a * 0.15 + wind * 0.95 + guard * 0.44 + w(2.35, side) * 0.075;
  const length = near ? 32 : 27;
  const elbow = { x: root.x + Math.cos(angle) * length, y: root.y + Math.sin(angle) * length };
  const blade = (near ? 1.68 : 1.2) - a * (near ? 1.73 : 0.66) + wind * 0.65 + guard * 0.41 + w(2.35, side - 0.9) * 0.10;
  const tip = { x: elbow.x + Math.cos(blade) * 31 + Math.sin(blade) * 2, y: elbow.y + Math.sin(blade) * 31 - Math.cos(blade) * 2 };
  return { root, angle, length, elbow, blade, tip };
}

function drawMantisArm(arm: ReturnType<typeof mantisArm>, m: Material, near: boolean) {
  const fill = near ? m[2] : m[1];
  layer(arm.root.x, arm.root.y, arm.angle, () => {
    cut('M-3 -5 Q11 -8 26 -4 L30 -1 28 4 13 5 -4 3Z', fill, m[3]);
    line('M2 -4 Q14 -6 25 -2 M7 2 20 2', m[near ? 3 : 2], 0.8);
  }, arm.length / 28, 1);
  layer(arm.elbow.x, arm.elbow.y, arm.blade, () => {
    cut('M-5 -3 Q4 -9 15 -8 Q27 -8 31 -2 L25 1 23 6 20 3 17 7 14 4 11 7 8 3 5 5 -4 4Z', fill, m[3]);
    cut('M0 -3 Q13 -10 25 -4 Q14 -5 6 0Z', m[near ? 3 : 2], P.ink, 0);
    rivet();
  });
}

function shelfmantis(m: Material, lunge: number, d: number, lit: boolean, w: Cycle) {
  const a = clamp01(lunge);
  const walk = (near: boolean) => {
    for (const rear of [true, false]) {
      const step = w(2.7, (rear ? 1.5 : -0.8) + (near ? 0.7 : -0.8));
      const root = { x: rear ? -23 : -9, y: near ? 9 : 4 };
      const foot = { x: (rear ? (near ? -45 : -58) : (near ? 24 : 8)) + step * 3 + a * 4,
        y: (near ? 48 : 38) - Math.max(0, step) * 3 - d * 2 };
      drawLimb(bend(root, foot, 22, 30, rear ? 1 : -1), m, near ? 0.47 : 0.37, !near);
    }
  };
  walk(false);
  drawMantisArm(mantisArm(lunge, d, w, -1), m, false);
  layer(-22, 8, 0.17 + w(1.9, -1) * 0.09 - a * 0.11, () => {
    cut('M12 -10 Q-7 -17 -27 -7 Q-39 0 -42 17 Q-27 24 -4 17 Q9 13 15 2Z', m[1], m[3]);
    cut('M9 -10 Q-8 -15 -27 -6 Q-36 1 -38 12 Q-25 7 -9 8 Q4 6 12 0Z', m[2], P.ink, 0);
    line('M-33 6 Q-21 -2 1 -7 M-34 13 Q-22 12 -15 14 M-24 15l4 4 M-16 14l4 4 M-8 12l3 4', m[3], 0.9);
  });
  walk(true);
  cut('M-24 10 Q-18 -7 -12 -13 Q-3 -22 1 -38 L11 -36 Q10 -24 5 -14 Q14 -4 3 10 Q-9 21 -24 10Z', m[2], m[3]);
  cut('M-20 8 Q-10 -10 -4 -17 Q2 -25 4 -35 L7 -34 Q6 -18 0 -9 Q-8 -7 -11 11Z', m[3], P.ink, 0);
  line('M-18 7 Q-10 5 -4 0 M-13 12 -6 10 M-4 -11 2 -14', m[0], 0.95);
  drawMantisArm(mantisArm(lunge, d, w, 1), m, true);

  layer(8, -42 + d * 1.8, w(1.6, -0.4) * 0.10 + a * 0.10, () => {
    layer(-4, -11, w(3, 0.5) * 0.18, () => line('M0 1 Q-2 -11 -13 -20', m[4], 1.4));
    layer(8, -13, w(3, -1) * 0.20, () => line('M0 1 Q2 -12 10 -22', m[4], 1.4));
    cut('M-13 -8 Q-9 -16 3 -15 Q12 -17 17 -8 Q18 -2 13 1 L11 6 5 10 -1 7 -4 3 Q-13 1 -13 -8Z', m[2], m[3]);
    cut('M-10 -9 Q-8 -14 -2 -11 Q4 -8 2 -3 Q-3 0 -8 -3Z', m[0], m[3], 0.8);
    cut('M7 -12 Q13 -15 16 -8 Q17 -4 13 -3 Q8 -2 6 -6Z', m[0], m[3], 0.8);
    line('M-5 -9 -2 -7 M11 -10 13 -8', lit ? P.parchment : m[4], 2);
    line('M3 -4 5 1 9 2 M3 5 6 7 10 4', m[3], 0.9);
  });
}

function wheel(m: Material, turn: number) {
  layer(0, 0, turn, () => {
    cut('M-6 -21 -3 -25 4 -25 8 -20 15 -18 21 -19 25 -12 22 -6 23 2 27 7 24 14 17 15 12 21 11 26 2 28 -3 23 -11 21 -17 23 -23 17 -21 10 -24 3 -28 0 -26 -8 -20 -11 -16 -17 -14 -22Z', m[1], m[3]);
    cut('M-16 0a16 16 0 1 0 32 0a16 16 0 1 0 -32 0Z', m[0], m[2]);
    line('M-19 0a19 19 0 0 1 27 -17 M19 1a19 19 0 0 1 -25 17 M-20 -13l4 -4 M16 15l-3 4 M21 -6l2 2 M-5 22h4', m[3], 0.9);
    line('M0 -15V15 M-13 -7 13 7 M-13 7 13 -7', m[2], 3.5);
    seal(P.brass);
  });
}

function inkroller(m: Material, a: number, d: number, t: number, lit: boolean) {
  layer(-2, 15 - d * 7, -a * 2.4 - Math.sin(t * 2) * 0.06, () => {
    cut('M-46 -23 -6 -35 27 -25 40 -4 34 25 8 39 -39 34 -52 14 -54 -6Z', m[1], m[3]);
    cut('M-46 -23 -6 -35 14 -23 -43 -9 -54 -6Z M-51 16 -5 14 15 30 8 39 -39 34Z', m[0], m[2]);
    line('M-46 -14 -7 -27 M-49 -7 -4 -20 M-46 26 -7 27 M-40 31 -5 33', m[2], 1.1);
    cut('M-51 0 Q-24 0 2 -7 L-1 3 Q-24 11 -53 9Z', m[2], P.ink, 0);
    hatching('M-49 8 -41 1 M-44 8 -35 1 M-39 8 -29 0 M-34 8 -23 0 M-29 6 -17 -1 M-24 6 -12 -2 M-19 5 -8 -3 M-14 5 -4 -4', P.ink, 0.8);
    layer(20, 4, 0, () => wheel(m, 0));
  });
  layer(12 + a * 7, -19 + d * 13, -d * 0.65, () => {
    cut('M-37 2 -13 -35 20 -37 38 -18 40 -4 23 1 8 -17 -8 -13 -18 6Z', m[1], m[3]);
    cut('M14 -29 28 -24 34 -15 25 -12 15 -17Z', P.ink);
    line('M21 -20 28 -18 M-21 -10 -8 -25 7 -28', lit ? P.parchment : m[4], 1.1);
  });
}

function typeblock(m: Material, a: number, d: number, lit: boolean, w: Cycle) {
  const rock = w(2.7) * 0.055 - d * 0.14 + a * 0.32;
  for (const side of [-1, 1]) {
    layer(side * 25, 24, side * (d * 0.23 - a * 0.20 + w(2.7) * 0.065), () => {
      cut('M-9 -8 H7 L9 10 15 16 12 22 -16 22 -17 17 -10 11Z', m[0], m[2]);
      line('M-13 17 H11 M-7 7 H5 M-6 3 H4', m[3], 0.8);
    });
  }
  layer(0, d * 7 + w(2.7) * 2 - a * 4, rock, () => {
    cut('M-49 -29 -25 -43 11 -52 40 -38 45 25 21 42 -42 34Z', m[0], m[2]);
    cut('M-49 -29 -25 -43 11 -52 40 -38 18 -24Z', m[2], m[3]);
    cut('M-49 -29 18 -24 21 42 -42 34Z', m[1], m[2]);
    cut('M18 -24 40 -38 45 25 21 42Z', m[2], m[3]);
    line('M-41 -25 13 -20 16 35 -38 28Z M23 -20 36 -29 M24 -15 37 -24 M35 29 41 25 M35 33 41 29', m[3], 0.75);
    const letter = 'M-29 18 -27 11 -20 11 -18 2 -26 0 -30 -9 -25 -17 -3 -15 3 -11 0 -5 -6 -7 -4 18 1 19 0 24 -17 22 -17 16 -11 17 -11 4 -15 4 -21 20Z M-22 -9 -21 -4 -12 -3 -13 -10Z';
    // The rig mirrors the entire portrait, so the type prints a reversed letter on screen.
    layer(-29, 0, 0, () => {
      layer(-1, 1.9, 0, () => cut(letter, P.ink, P.ink, 0));
      cut(letter, lit ? P.parchment : m[3], m[0], 0.9);
    }, -1, 1);
    cut('M24 -6 37 -15 39 -7 26 3Z', m[0]);
    line('M28 -4 35 -9', lit ? P.parchment : m[4], 1.5);
  });
}

function typeswarm(m: Material, a: number, d: number, t: number, lit: boolean) {
  const tiles = [
    [-34, 7, -0.26, 'M-6 5H7 M-5 4V-11H6 M-5 -3H3'],
    [-20, -31, 0.19, 'M-7 -11H7 M0 -11V6 M-4 6H5'],
    [-3, 27, 0.02, 'M-7 6 0 -11 7 6 M-4 1H4'],
    [12, -14, -0.12, 'M-6 6V-11H3L7 -7 4 -3H-6 M1 -3 7 6'],
    [41, 6, 0.32, 'M-5 6V-11H4L7 -6 3 -1H-5'],
  ] as const;
  tiles.forEach(([x, y, tilt, glyph], i) => {
    layer(x * (1 - d * 0.16) + a * (i * 6 - 4), y * (1 - d * 0.12) + Math.sin(t * 3 + i) * 3, tilt + a * 0.3 - tilt * d, () => {
      cut('M-14 -14 11 -17 18 -11 17 13 9 18 -14 13 -18 6 -18 -9Z', m[0], m[2]);
      cut('M-13 -13 10 -16 14 -9 11 12 -12 11 -16 5Z', m[2], m[3]);
      cut('M-12 -10 9 -13 11 -9 9 9 -11 8 -13 4Z', m[1], m[0], 0.75);
      layer(-0.7, -1.1, 0, () => line(glyph, m[3], 2.1));
      line(glyph, lit ? P.parchment : i === 3 ? m[4] : m[0], 2);
      line('M-9 9H7 M-14 -8l3 -3 M12 14l4 -4', m[1], 0.85);
    });
  });
}

function rotary(m: Material, a: number, d: number, t: number, lit: boolean) {
  cut('M-47 16 -29 6 35 12 48 24 44 38 -46 41 -56 31Z', m[0], m[2]);
  line('M-49 30 40 28 M-43 37V44 H-29 L-27 38 M22 38V44 H35 L39 37', m[3], 1.8);
  layer(-26, 4, -t * 0.55 - a * 1.8, () => wheel(m, 0), 1.15, 1.15);
  cut('M-23 25 -21 -26 -12 -38 26 -40 43 -24 45 24 28 33Z', m[1], m[3]);
  cut('M-18 -23 -8 -33 24 -35 34 -26 32 -16 -18 -12Z', m[2], m[3]);
  cut('M-13 -23 -6 -29 23 -31 30 -25 28 -19 -12 -17Z', m[0], m[3], 0.8);
  line('M-12 -22 0 -23 M7 -23 14 -23 M20 -24h6', lit ? P.parchment : m[4], 1.8);
  layer(-18, 23, 0, rivet);
  layer(10 + a * 15 - d * 9, 7, 0, () => {
    cut('M-28 -17 27 -21 36 -15 35 14 26 20 -28 18 -36 11 -36 -10Z', m[0], m[3]);
    cut('M-32 -10 28 -14 32 -7 -33 -3Z M-33 5 31 3 31 11 -31 14Z', m[2], m[1]);
    line('M-27 -8 20 -11 M-28 10 18 7', m[3], 1.15);
    hatching('M-26 -6 -17 -10 M-22 -6 -13 -10 M-18 -6 -9 -10 M-14 -6 -5 -10 M-10 -6 -1 -10 M-6 -7 3 -11 M-2 -7 7 -11 M2 -7 11 -11 M6 -7 15 -11 M-26 12 -18 8 M-22 12 -14 8 M-18 12 -10 8 M-14 11 -6 7 M-10 11 -2 7 M-6 11 2 7 M-2 11 6 7 M2 10 10 6', P.ink, 0.86);
    layer(30, -1, t * 0.8 + a * 2.1, () => wheel(m, 0), 0.51, 0.72);
  });
  layer(10, -9 + d * 14, 0, () => cut('M-28 -8 32 -11 35 -5 29 2 -29 6 -35 1Z', m[1], m[3]));
}

function waxcrab(m: Material, a: number, d: number, lit: boolean, w: Cycle) {
  for (const side of [-1, 1]) for (let i = 0; i < 3; i++) {
    const step = w(3.15, i * 0.95 + side);
    const leg = bend({ x: side * (8 + i * 6), y: 12 },
      { x: side * (19 + i * 8 - d * 7 + step * 3), y: 42 - i * 4 - Math.max(0, step) * 5 }, 17, 18, -side);
    drawLimb(leg, m, 0.56, side < 0);
  }
  cut('M-39 9 Q-41 -5 -26 -11 Q-21 -12 -21 -21 Q-16 -31 1 -31 L10 -27 Q27 -34 38 -15 Q39 -8 35 -2 Q36 5 42 12 Q39 21 27 24 L15 20 Q6 30 -2 28 L-19 22 Q-30 29 -35 20Z', m[2], m[3]);
  cut('M-24 -9 Q-23 -20 -12 -22 L2 -24 10 -21 Q25 -28 29 -10 Q27 5 19 12 Q7 17 -2 19 L-20 12Z', m[1], m[3]);
  cut('M-35 8 Q-36 -1 -27 -6 L-29 4 Q-28 9 -30 13Z M-18 -23 Q-17 -27 -7 -28 Q-1 -31 4 -28 Q-1 -25 -7 -26Z M18 -24 Q28 -28 34 -18 Q30 -14 27 -20Z M25 18 Q29 10 36 9 Q37 15 30 19Z', m[3], P.ink, 0);
  layer(-1, -4, -0.15, () => { seal(P.stamp); }, 2.1, 2.1);
  line('M-27 -14 -22 -18 M-30 12l7 3 M12 20l8 -3 M33 7l-2 8', m[3], 1.05);
  for (const side of [-1, 1]) {
    const pulse = w(2.25, side * 0.9);
    const arm = bend({ x: 19 - (side + 1) * 2, y: side * 10 },
      { x: 31 + a * 11 - d * 16 - (side + 1) * 4, y: side * (24 + pulse * 3) }, 15, 15, -side);
    const fill = side < 0 ? m[1] : m[2];
    drawLimb(arm, m, 0.78, side < 0);
    layer(arm.tip.x, arm.tip.y, side * (0.36 - a * 0.43 + d * 0.95 + pulse * 0.1), () => {
      cut('M-17 3 Q-8 -16 5 -17 Q27 -20 34 -6 Q25 -6 15 -8 L10 1 Q8 16 1 14 L-11 13Z', fill, m[3]);
      cut('M-11 1 Q-4 -14 13 -15 Q4 -10 2 -5 Q-3 0 -11 1Z', m[3], P.ink, 0);
      line('M-7 6 Q0 9 4 11 M4 -11 Q14 -15 23 -11', lit ? P.parchment : m[3], 0.9);
      layer(6, 8, pulse * 0.19 - a * 0.21 - d * 0.12, () => {
        cut('M-7 -3 Q1 -9 6 -6 L15 -2 Q20 -3 25 -6 Q27 6 7 12 Q0 10 -5 6Z', fill, m[3]);
        line('M1 5 Q15 9 22 1', m[3], 0.9);
        rivet();
      });
    });
  }
}

function gluepot(m: Material, a: number, d: number, lit: boolean, w: Cycle) {
  for (const side of [-1, 1]) {
    layer(side * 26, 26, side * (a * 0.16 + d * 0.13 + w(2.3) * 0.045), () => {
      cut('M-11 -8 9 -8 8 8 14 15 13 20 -15 20 -16 15 -10 8Z', m[0], m[2]);
      line('M-12 16 H10 M-7 4 H5', m[3], 0.8);
    });
  }
  layer(0, 10, -a * 0.19 + w(2.3) * 0.04, () => {
    cut('M-38 -29 Q-42 -40 -35 -49 L-38 -63 -23 -66 -19 -49 Q-9 -46 -8 -33 L-10 -18 -36 -12Z', m[0], m[3]);
    cut('M-41 -63 -21 -67 -18 -62 -39 -58Z', m[2], P.brass);
    line('M-34 -56 -31 -45 Q-35 -39 -32 -31 M-29 -55 -26 -45', m[2], 1.2);
    cut('M-43 -24 Q-42 -45 -7 -46 Q25 -49 38 -26 L43 -8 Q48 13 31 25 Q2 36 -32 23 Q-46 17 -45 -4Z', m[1], m[3]);
    cut('M-41 -22 Q-37 -43 -9 -43 Q9 -44 23 -38 Q-15 -39 -24 -21 Q-28 -11 -28 9 Q-42 4 -41 -22Z', m[2], P.ink, 0);
    cut('M-32 8 Q-31 -14 -14 -18 Q7 -22 17 1 L16 15 Q-2 25 -31 16Z', m[0], P.brass);
    cut('M-26 9 Q-24 -11 -12 -13 Q3 -16 12 1 L11 11 Q-6 20 -25 14Z', P.stamp);
    cut('M-23 11 Q-19 -4 -15 -7 Q-16 2 -11 2 L-5 -9 Q3 -5 3 1 L10 4 8 10 Q-7 17 -22 13Z', lit ? P.parchment : P.cord, P.ink, 0);
    line('M-17 -12 -17 15 M-7 -14 -7 16 M3 -10 3 14 M-35 20 Q-1 33 32 20 M-40 -27 Q-19 -36 8 -34', P.ink, 1.25);
    layer(-33, 19, 0, rivet);
    layer(25, 19, 0, rivet);
    layer(28, -21, -a * 0.31 + d * 0.12 + w(2.3, -0.9) * 0.10, () => {
      cut('M-5 -9 14 -7 Q19 -7 23 -16 L31 -16 31 -9 Q28 8 15 10 L-5 11Z', m[2], m[3]);
      cut('M20 -14 30 -17 33 -13 24 -9Z', m[0], P.brass, 0.85);
      line('M7 6 Q23 7 28 -7 M-3 -5 3 -5', m[3], 0.9);
      rivet();
    });
  });
}

function needlejack(m: Material, a: number, d: number, lit: boolean, w: Cycle) {
  line('M-9 -55 -49 -36 -31 23 M-9 -55 23 -40 13 3', P.brass, 1.1);
  cut('M-47 -43 -42 -48 30 -58 38 -55 31 -51 -44 -38Z', m[2], m[3]);
  cut('M-24 14 -10 15 -14 35 -8 43 -13 48 -35 48 -26 36Z M3 14 15 13 18 35 30 40 31 46 9 47 2 38Z', m[0], m[2]);
  cut('M-20 -16 16 -17 23 5 14 30 -6 31 -24 20 -30 0Z', m[1], m[3]);
  cut('M-26 -1 -18 -12 13 -13 15 -5 -14 0 -14 24 -22 19Z', m[2], P.ink, 0);
  line('M-16 -2 -12 23 M-20 4h8 M-19 10h9 M-18 16h9 M6 7 13 8 M5 15 14 16 M4 22 11 23', m[3], 1.05);
  layer(-1 - d * 6, -28 + d * 12 + w(2.6) * 3, -a * 0.26 + w(2.6, -0.75) * 0.12, () => {
    cut('M-18 -3 -15 -15 -5 -20 12 -19 23 -8 20 5 12 12 -2 9 -12 10Z', m[2], m[3]);
    layer(8, -4, 0.2, () => seal(lit ? P.parchment : m[0]));
    line('M5 7 16 4 M8 2l2 6 M12 1l2 5', m[0], 0.85);
  });
  layer(19 + a * 15 - d * 14, -6, -0.46 + a * 0.39 - d * 0.86 + w(2.6, -1) * 0.15, () => {
    line('M-17 5 Q-11 26 15 23 T11 -1', P.cord, 1.2);
    cut('M-13 4 8 -1 43 -3 12 5 2 10 -10 10Z', P.brass, m[3]);
    line('M-8 6 1 4 M9 1 37 -2', m[0], 0.9);
    line('M-12 8 -8 9 -4 7', P.parchment, 0.7);
  });
}

function seamcutter(m: Material, a: number, d: number, lit: boolean, w: Cycle) {
  cut('M-20 7 -32 20 -50 41 -42 44 -21 27 -11 12Z M-10 10 2 25 32 41 42 40 42 34 14 12 6 4Z', m[1], m[3]);
  for (const side of [-1, 1]) {
    layer(-4 + a * 10 - d * 7, -6, side * (0.65 - a * 0.51 - d * 0.56 - Math.max(0, w(3.1)) ** 2 * 0.24), () => {
      cut('M-3 -7 -22 -12 -34 -25 -48 -24 -60 -15 -60 1 -48 10 -35 6 -21 1 -1 6Z M-50 -14Q-42 -21 -35 -13T-37 0Q-49 5 -54 -3Z', m[2], m[3]);
      cut('M-5 -6 17 -7 51 -3 67 1 43 6 11 9 -6 5Z', m[3], m[1]);
      cut('M1 5 Q30 1 64 1 L43 6 11 9Z', m[2], P.ink, 0);
      line('M5 3 42 1 59 1 M-55 -14 -45 -20 M-53 3 -44 5', lit ? P.parchment : P.brass, 0.9);
      hatching('M-19 -9 -14 -5 M-15 -8 -11 -4 M-11 -8 -7 -4 M7 -2 12 -5 M11 -1 16 -5 M15 -2 20 -5 M19 -2 24 -4', m[0], 0.8);
    });
  }
  layer(-4 + a * 10 - d * 7, -6, d * 0.7, rivet, 2.6, 2.6);
}

function lockbox(m: Material, a: number, d: number, lit: boolean, w: Cycle) {
  cut('M-46 -13 -36 -24 30 -22 43 -10 40 31 22 42 -39 38 -48 22Z', m[1], m[3]);
  cut('M-37 -11 36 -10 30 27 24 32 -34 30Z', m[0], m[2]);
  cut('M-30 -10 34 -10 29 9 22 16 -29 13Z', P.ink);
  cut('M-25 -8 -18 0 -12 -8 M7 -8 15 0 21 -8 M-13 13 -7 6 -1 14 M17 13 23 5 26 10', m[3]);
  layer(-39, -15, -a * 0.55 + d * 0.17 - Math.max(0, w(2.2)) ** 2 * 0.13, () => {
    cut('M-8 8 -8 -12 3 -30 62 -34 80 -24 87 -6 75 6 4 13Z', m[1], m[3]);
    cut('M-2 -14 8 -24 60 -28 72 -20 76 -8 66 -3 -3 4Z', m[2], m[3]);
    line('M6 -15 63 -21 70 -12 62 -9 4 -4Z', m[1], 1.3);
    line('M10 -17 22 -22 M17 -17 29 -22 M24 -18 36 -23 M40 -19 52 -24', m[3], 0.7);
    line('M3 -22 10 -28 17 -28 M-2 -2 6 0 18 -2 M59 -28 67 -29 75 -24 M68 1 78 -3 81 -10', P.brass, 0.85);
    for (const [x, y] of [[0, -16], [12, 4], [70, 0], [74, -18]]) layer(x, y, 0, rivet);
    layer(43, -14, 0, () => seal(lit ? P.parchment : P.stamp), 1.5, 1.5);
  });
  for (let i = 0; i < 7; i++) {
    const slack = w(2.2, -i * 0.42);
    layer(-41 + i * 12, 24 - i * 5 - d * 8 + a * 8 + slack * 2.7, -0.6 + (i % 2) * 0.6 + slack * 0.13, () => {
      cut('M-8 -4 H5 L8 -1 V3 L5 5 H-5 L-8 2Z M-4 -1 H4 V2 H-4Z', P.brass);
    });
  }
  layer(2, 17 - d * 8 + a * 8 + w(2.2, -1.5) * 2.7, w(2.2, -1.5) * 0.13, () => {
    cut('M-9 -1 -9 -11Q0 -23 9 -11V-1 M-11 0 10 0 13 6 10 16 -9 16 -13 8Z', m[1], P.brass);
    line('M-8 3H8 L10 7 8 13H-8 M-6 -2V-9Q0 -17 6 -9V-2', P.brass, 0.85);
    cut('M0 4Q4 4 2 8L3 11H-3L-2 8Q-4 4 0 4Z', P.ink, P.brass, 0.8);
  });
}

function redactor(m: Material, a: number, d: number, lit: boolean, w: Cycle) {
  layer(-2, 25, w(2.75, -1.2) * 0.2 - a * 0.28, () => {
    cut('M-4 -2 3 -1 Q0 14 7 25 L-1 22 -6 28 Q-13 12 -4 -2Z', P.stamp);
    line('M-3 4 Q-5 14 -2 19', P.cord, 0.8);
  });
  layer(-7, -3, -0.13 - d * 0.07 + w(2.75) * 0.07, () => {
    cut('M0 -29 Q-22 -50 -52 -41 L-57 28 Q-28 24 -7 40 L3 36Z', m[0], m[2]);
    cut('M-2 -24 Q-26 -42 -50 -37 L-52 23 Q-21 21 -3 34Z', m[2], m[3]);
    cut('M-2 -26 Q-26 -43 -49 -39 L-50 17 Q-24 15 -3 31Z', m[3], m[2], 0.9);
    line('M-47 20 Q-21 18 -6 31 M-49 23 Q-23 21 -7 34 M-43 -30 Q-25 -33 -10 -22 M-44 10 Q-23 7 -11 16 M-36 16 Q-25 14 -12 21', m[0], 0.85);
    cut('M-45 -24 Q-25 -27 -10 -15 L-10 -4 Q-28 -14 -46 -11Z', P.ink);
    cut('M-35 -18 Q-27 -23 -19 -15 Q-25 -9 -35 -18Z', lit ? P.parchment : m[4], P.ink, 0);
    cut('M-46 -5 Q-30 -7 -16 0 L-16 6 Q-31 0 -46 2Z', P.ink, P.ink, 0);
    line('M-28 -18 -26 -14', P.ink, 1.3);
  });
  // The page on the attacking side fans out from the spine without crossing the eye.
  layer(-6, -3, 0.13 + a * 0.38 - d * 0.15 + w(2.75, -0.8) * 0.11, () => {
    cut('M-3 -28 Q22 -48 52 -38 L58 26 Q27 25 1 39 L-4 33Z', m[0], m[2]);
    cut('M-1 -25 Q23 -44 49 -36 L54 20 Q24 20 0 34Z', m[2], m[3]);
    cut('M0 -27 Q24 -46 48 -38 L52 14 Q24 14 0 31Z', m[3], m[2], 0.9);
    line('M5 -23 Q22 -34 40 -33 M7 -17 Q19 -25 32 -27 M8 11 Q25 1 43 3 M8 18 Q21 10 37 9 M5 31 Q26 20 49 18 M5 34 Q26 23 51 21', m[0], 0.85);
    cut('M5 -9 Q27 -22 45 -20 L45 -12 Q23 -13 5 0Z M15 1 Q27 -6 46 -6 L47 1 Q28 1 15 7Z', P.ink, P.ink, 0);
  }, 1 + a * 0.12 - d * 0.54, 1);
  cut('M-12 -29 Q-7 -32 -2 -29 L-1 30 Q-4 37 -12 34Z', m[1], m[2], 0.85);
  line('M-8 -25 -7 30 M-12 -18 -4 -18 M-11 19 -5 19', m[3], 0.8);
}

function sandkeeper(m: Material, a: number, d: number, lit: boolean, w: Cycle) {
  cut('M-33 -25 -48 -9 -50 21 -58 47 -32 42 -24 49 -11 39 3 47 16 37 34 44 29 16 31 -13 13 -29Z', m[0], m[2]);
  cut('M-41 -7 -43 22 -51 43 -37 36 -28 5 -20 -10Z M17 -15 22 23 29 38 16 33 13 13Z', m[1], m[2]);
  hatching('M-40 -1 -46 16 M-40 8 -47 26 M-39 15 -47 33 M-33 24 -41 39 M19 20 25 34 M17 25 21 34', m[3]);
  layer(a * 12 - d * 6, -6 + d * 7, -0.12 - a * 0.83 + d * 0.32 + w(1.85) * 0.13, () => {
    cut('M-24 -47 24 -47 30 -41 24 -34 -24 -34 -30 -40Z M-24 34 24 34 30 41 24 47 -24 47 -30 41Z', m[2], P.brass);
    cut('M-20 -35H20 Q21 -15 5 -5 Q0 0 6 6 Q22 17 20 35 H-20 Q-21 15 -5 5 Q0 0 -6 -6 Q-22 -17 -20 -35Z', m[1], m[3]);
    cut('M-16 -32 Q-15 -13 -5 -7 Q-10 -17 -9 -32Z M17 32 Q18 17 6 9 Q12 19 11 33Z', m[2], P.ink, 0);
    cut('M-16 -23 Q-8 -26 0 -22 T16 -23 Q13 -12 1 -6 Q-12 -12 -16 -23Z M-16 31 Q-9 25 1 19 Q10 25 16 31Z', P.brass);
    line('M1 -8V19 M-16 -31 Q-17 -23 -13 -17 M15 31 Q18 24 14 19', lit ? P.parchment : m[3], 1.15);
    hatching('M-13 -22 -8 -16 M-9 -22 -4 -15 M-5 -21 0 -14 M-7 29 -2 24 M-2 29 2 25 M3 29 6 27', P.paper[0], 0.79);
    cut('M-30 -33 -24 -33 -24 34 -30 34Z M24 -33 30 -33 30 34 24 34Z', m[2], P.brass);
    line('M-25 -43H24 M-25 43H24', m[3]);
    for (const x of [-23, 23]) for (const y of [-40, 40]) layer(x, y, 0, rivet);
  });
}

export function drawEnemy(o: EnemyPose) {
  const a = ART[o.art];
  const m = o.hue === undefined || o.boss ? a.material : o.hue >= 280 ? P.plum : o.hue >= 90 ? P.sage : P.bronze;
  const r = rig(o, -1, a.reach, a.float);
  const attack = clamp01(o.lunge);
  const lit = o.flash > 0.38;
  const w = idle(o);
  // A wide creature can still reach into the ward's space, so draw its silhouette on top.
  ward(o, r);
  layer(r.x, r.y, r.angle, () => {
    switch (a.body) {
      case 'shard': shard(m, a.mark === 1, attack, o.guard, lit, w); break;
      case 'scribe': scribe(m, a.mark === 1, attack, o.guard, lit, w); break;
      case 'grub': grub(m, a.mark === 1, attack, o.guard, lit, w); break;
      case 'moth': moth(m, a.mark === 1, attack, o.guard, lit, w); break;
      case 'catalogue': catalogue(m, attack, o.guard, lit, w); break;
      case 'press': press(m, a.mark === 1, attack, o.guard, lit, w); break;
      case 'void': oblivion(m, attack, o.guard, lit, w); break;
      case 'indexkite': indexkite(m, attack, o.guard, w); break;
      case 'puncher': puncher(m, attack, o.guard, lit, w); break;
      case 'bellwarden': bellwarden(m, attack, o.guard, lit, w); break;
      case 'shelfspider': shelfspider(m, attack, o.guard, lit, w); break;
      case 'moldcap': moldcap(m, attack, o.guard, lit, w); break;
      case 'shelfmantis': shelfmantis(m, o.lunge, o.guard, lit, w); break;
      case 'inkroller': inkroller(m, attack, o.guard, o.t, lit); break;
      case 'typeblock': typeblock(m, attack, o.guard, lit, w); break;
      case 'typeswarm': typeswarm(m, attack, o.guard, o.t, lit); break;
      case 'rotary': rotary(m, attack, o.guard, o.t, lit); break;
      case 'waxcrab': waxcrab(m, attack, o.guard, lit, w); break;
      case 'gluepot': gluepot(m, attack, o.guard, lit, w); break;
      case 'needlejack': needlejack(m, attack, o.guard, lit, w); break;
      case 'seamcutter': seamcutter(m, attack, o.guard, lit, w); break;
      case 'lockbox': lockbox(m, attack, o.guard, lit, w); break;
      case 'redactor': redactor(m, attack, o.guard, lit, w); break;
      case 'sandkeeper': sandkeeper(m, attack, o.guard, lit, w); break;
    }
  }, r.scale * r.facing, r.scale);
}
