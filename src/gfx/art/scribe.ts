import { g, roundRect } from '../canvas';
import { C, PRINT } from '../theme';
import { drawArtIcon } from './icons';

export type SpiritKind = number;

const INKS = [PRINT.jade[2], PRINT.steel[2], PRINT.paper[2], PRINT.sage[2], PRINT.plum[2], PRINT.bronze[2]];
const HIGHLIGHTS = [PRINT.jade[3], PRINT.steel[3], PRINT.paper[3], PRINT.sage[3], PRINT.plum[3], PRINT.bronze[3]];

/** Small cut-paper spirits; each job keeps its assigned silhouette and ink color. */
export function drawScribe(cx: number, cy: number, size: number, work: 'idle' | 'write' | 'bind', t: number, kind: SpiritKind = 0) {
  const variation = Math.abs(Math.trunc(kind)) % 24;
  const shape = variation % 6;
  const family = Math.floor(variation / 6);
  const phase = work === 'idle' ? 0 : t * (3.2 + variation * 0.035) + variation * 0.83;
  const swell = Math.sin(phase);
  const width = 9.5 + swell * 0.8;
  const top = -9 + swell * 1.5;

  g.save();
  g.translate(cx, cy);
  g.scale(size / 32, size / 32);
  g.lineWidth = 1.25;
  g.lineCap = 'round';
  g.lineJoin = 'round';

  if (work === 'bind') {
    const spread = (1 - Math.cos(phase)) * 1.5;
    g.strokeStyle = C.goldDim;
    g.beginPath();
    g.ellipse(0, 8, 11 + spread, 2 + spread / 2, 0, 0, Math.PI);
    g.stroke();
  }

  g.beginPath();
  if (shape === 0) {
    g.moveTo(-width, 4);
    g.bezierCurveTo(-width, 0, -5, top, 1, top);
    g.bezierCurveTo(6, top, width, -1, width, 4);
    g.bezierCurveTo(width, 9, -width, 9, -width, 4);
  } else if (shape === 1) {
    g.moveTo(-width, 5); g.quadraticCurveTo(-13, -1, -6, -5);
    g.quadraticCurveTo(-2, -14 + swell, 2, -8); g.quadraticCurveTo(11, -12, width, -1);
    g.quadraticCurveTo(14, 9, 0, 8); g.quadraticCurveTo(-13, 10, -width, 5);
  } else if (shape === 2) {
    g.moveTo(-13, 3); g.bezierCurveTo(-12, -4, -8, -7, -4, -6);
    g.bezierCurveTo(-1, -13, 7, -10, 8, -5); g.bezierCurveTo(15, -2, 13, 8, 4, 8);
    g.lineTo(-7, 8); g.quadraticCurveTo(-15, 7, -13, 3);
  } else if (shape === 3) {
    g.moveTo(-12, 7); g.lineTo(-10, -2); g.lineTo(-5, 1); g.lineTo(-1, -10 + swell);
    g.lineTo(3, -3); g.lineTo(10, -8); g.lineTo(12, 6); g.quadraticCurveTo(0, 11, -12, 7);
  } else if (shape === 4) {
    g.moveTo(-width, 4); g.quadraticCurveTo(-11, -9, -2, -8);
    g.quadraticCurveTo(8, -13 + swell, width, 1); g.quadraticCurveTo(11, 10, -3, 8);
    g.quadraticCurveTo(-12, 8, -width, 4);
  } else {
    g.moveTo(-12, 5); g.bezierCurveTo(-15, 0, -9, -8, -4, -6);
    g.bezierCurveTo(-2, -13, 5, -12, 5, -6); g.bezierCurveTo(13, -9, 16, 1, 11, 6);
    g.quadraticCurveTo(0, 11, -12, 5);
  }
  g.fillStyle = work === 'idle' ? INKS[shape] : HIGHLIGHTS[shape];
  g.fill();
  g.strokeStyle = PRINT.ink;
  g.stroke();

  // Four small cut-shape families combine with the six bodies: 24 stable looks.
  g.fillStyle = INKS[(shape + family + 1) % INKS.length];
  g.strokeStyle = PRINT.ink;
  g.beginPath();
  if (family === 0) {
    g.moveTo(-5, top + 2); g.lineTo(-3, top - 3); g.lineTo(0, top + 1);
    g.lineTo(3, top - 4); g.lineTo(6, top + 2); g.closePath();
  } else if (family === 1) {
    g.ellipse(-width - 1, 1, 2.4, 3.6, -0.4, 0, Math.PI * 2);
    g.moveTo(width + 1, -4); g.quadraticCurveTo(width + 8, -11, width + 7, -3);
    g.quadraticCurveTo(width + 6, 1, width + 1, 1); g.closePath();
  } else if (family === 2) {
    g.moveTo(-4, top + 2); g.quadraticCurveTo(-8, top - 9, -2, top - 7);
    g.quadraticCurveTo(1, top - 5, 1, top + 1); g.closePath();
    g.ellipse(width + 2, 3, 2, 3, 0.5, 0, Math.PI * 2);
  } else {
    g.moveTo(-width - 1, 1); g.quadraticCurveTo(-width - 8, -5, -width - 5, 3);
    g.quadraticCurveTo(-width - 3, 7, -width, 6); g.closePath();
    g.ellipse(3, top - 2, 2, 3, 0.3, 0, Math.PI * 2);
  }
  g.fill();
  g.stroke();

  // Short carved marks give the flat ink shape a print texture at both sizes.
  g.strokeStyle = PRINT.ink;
  g.beginPath();
  g.moveTo(-6, 3);
  g.lineTo(-4, 5);
  g.moveTo(-3, 4);
  g.lineTo(-1, 6);
  g.stroke();
  g.strokeStyle = PRINT.parchment;
  g.beginPath();
  g.moveTo(0, top + 2);
  g.quadraticCurveTo(-4, top + 2, -6, top + 5);
  g.stroke();

  g.fillStyle = PRINT.ink;
  const blink = work !== 'idle' && (t + variation * 0.37) % 3.2 > 3.04;
  for (const x of [0, 5]) {
    g.beginPath();
    g.ellipse(x, -1, 0.9, blink ? 0.45 : 1.3, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

export type ScribeAction = 'read' | 'draft' | 'review' | 'bind' | 'idle';

/** Put the activity prop in front of the spirit so the motion reads as a gesture. */
export function drawScribeAtWork(x: number, y: number, action: ScribeAction, t: number, kind: SpiritKind, motion: boolean) {
  const moving = motion && action !== 'idle';
  const sway = moving ? Math.sin(t * 5) : 0;
  drawScribe(x - 12 + sway * 5, y - 10 + sway * 3, 84, moving ? 'write' : 'idle', t, kind);
  g.save();
  g.translate(x + 13, y + 23);

  if (action === 'bind' || action === 'idle') {
    drawArtIcon('tasks', 0, moving ? sway * 3 : 0, 47, C.gold);
    g.restore();
    return;
  }

  g.rotate(-0.08);
  g.strokeStyle = PRINT.ink;
  g.lineWidth = 1.5;
  if (action === 'read') {
    // An open book with a leaf that moves across its spine.
    roundRect(-30, -17, 60, 36, 4);
    g.fillStyle = C.goldDim;
    g.fill();
    g.stroke();
    for (const side of [-1, 1]) {
      g.save();
      g.scale(side, 1);
      g.beginPath();
      g.moveTo(0, -14);
      g.quadraticCurveTo(13, -22, 27, -15);
      g.lineTo(27, 13);
      g.quadraticCurveTo(13, 7, 0, 15);
      g.closePath();
      g.fillStyle = C.ink2;
      g.fill();
      g.stroke();
      g.fillStyle = C.goldDim;
      for (let i = 0; i < 3; i++) g.fillRect(6, -7 + i * 5, 15 - i * 2, 1);
      g.restore();
    }
    if (moving) {
      const leaf = Math.cos(t * 4) * 24;
      g.beginPath();
      g.moveTo(0, -14);
      g.quadraticCurveTo(leaf * 0.55, -29, leaf, -16);
      g.lineTo(leaf, 10);
      g.quadraticCurveTo(leaf * 0.55, 1, 0, 15);
      g.closePath();
      g.fillStyle = C.gold;
      g.fill();
      g.stroke();
    }
  } else {
    roundRect(-23, -16, 46, 34, 3);
    g.fillStyle = C.ink2;
    g.fill();
    g.stroke();
    g.fillStyle = C.goldDim;
    g.fillRect(-15, -8, 22, 1.4);
    g.fillRect(-15, -1, 17, 1.4);
    if (action === 'draft') {
      const penX = moving ? sway * 11 : -1;
      g.fillRect(-15, 7, penX + 15, 1.4);
      g.translate(penX, 8);
      g.rotate(0.65);
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(-3, -6);
      g.lineTo(-3, -33);
      g.lineTo(3, -33);
      g.lineTo(3, -6);
      g.closePath();
      g.fillStyle = C.gold;
      g.fill();
      g.stroke();
    } else {
      const lift = moving ? Math.max(0, Math.sin(t * 4)) * 22 : 12;
      drawArtIcon('check', 10, 6, 17, C.redDim);
      g.translate(10, -lift);
      roundRect(-4, -20, 8, 15, 4);
      g.fillStyle = C.goldDim;
      g.fill();
      g.stroke();
      roundRect(-10, -8, 20, 8, 2);
      g.fillStyle = C.redDim;
      g.fill();
      g.stroke();
    }
  }
  g.restore();
}
