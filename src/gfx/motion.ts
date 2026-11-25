import { captureFrame, g, renderLayer, VH, VW } from './canvas';
import { clamp01, easeOut } from './geom';
import { C } from './theme';
import { inputScope } from '../input';

const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
export const reduceMotion = () => preference.matches;
const SCENE_MS = 220;
const SHEET_OUT_MS = 55;
const SHEET_IN_MS = 135;
const RETURN_MS = 140;
const SHEET_LIFT = 12;
const ACCORDION_TIME = 0.2;
const QUESTION_IN = 0.38;
const QUESTION_OUT = 0.28;

export interface QuestionMotion {
  progress: number;
  ready: boolean;
  returning?: number;
}

/** 位移、尺寸和转角从同一个进度取值，翻到侧面时就换成题面。 */
export function questionEntry(age: number): QuestionMotion {
  const p = clamp01(age / QUESTION_IN);
  return { progress: easeOut(p), ready: p >= 1 };
}

export function questionReturn(age: number, from: number): QuestionMotion {
  const p = clamp01(age / (QUESTION_OUT * from));
  const returning = easeOut(p);
  return { progress: from * (1 - returning), ready: p >= 1, returning };
}

type Route = { screen: string; sheet: string };
type TransitionKind = 'scene' | 'sheet' | 'return';
let previous: Route | undefined;
let transition: { kind: TransitionKind; started: number } | undefined;
let elapsed = 0;
let snapshot: CanvasRenderingContext2D | null = null;
let sheetBuffer: CanvasRenderingContext2D | null = null;

function layerBuffer() {
  const canvas = document.createElement('canvas');
  canvas.width = VW;
  canvas.height = VH;
  return canvas.getContext('2d');
}

/** 必须在清屏前调用；快速切换时直接从当前可见画面续接。 */
export function beginTransition(screen: string, sheet: string, now: number, enabled: boolean): boolean {
  if (!enabled || reduceMotion()) {
    previous = transition = undefined;
    return true;
  }
  if (previous && (screen !== previous.screen || sheet !== previous.sheet)) {
    snapshot ??= layerBuffer();
    if (snapshot) {
      captureFrame(snapshot);
      transition = { kind: screen !== previous.screen ? 'scene' : sheet ? 'sheet' : 'return', started: now };
    }
  }
  previous = { screen, sheet };
  if (!transition) return true;
  elapsed = now - transition.started;
  const { kind } = transition;
  const duration = kind === 'scene' ? SCENE_MS : kind === 'sheet' ? SHEET_OUT_MS + SHEET_IN_MS : RETURN_MS;
  if (elapsed >= duration) transition = undefined;
  // 新页面占主导后才交还输入，不等尾部缓动结束。
  return elapsed >= (kind === 'scene' ? 140 : kind === 'sheet' ? 95 : 65);
}

function drawSnapshot(alpha: number) {
  if (!snapshot || alpha <= 0) return;
  g.save();
  g.globalAlpha = alpha;
  g.drawImage(snapshot.canvas, 0, 0, VW, VH);
  g.restore();
}

export function drawTransition(draw: () => void) {
  if (transition?.kind === 'sheet') {
    // 同一个书架背景上先收掉旧字，再带入新面板，避免两屏文字重影。
    if (elapsed < SHEET_OUT_MS) {
      drawSnapshot(1 - easeOut(elapsed / SHEET_OUT_MS));
      return;
    }
    sheetBuffer ??= layerBuffer();
    if (!sheetBuffer) { draw(); return; }
    const alpha = easeOut(clamp01((elapsed - SHEET_OUT_MS) / SHEET_IN_MS));
    const y = SHEET_LIFT * (1 - alpha);
    renderLayer(sheetBuffer, () => inputScope(0, y, true, draw));
    g.save();
    g.globalAlpha = alpha;
    g.drawImage(sheetBuffer.canvas, 0, y, VW, VH);
    g.restore();
    return;
  }

  draw();
  if (transition?.kind === 'scene') {
    // 通过墨色换景，地图节点不和战场人物直接叠在一起。
    const half = SCENE_MS / 2;
    const phase = elapsed / half;
    g.fillStyle = C.void;
    if (phase < 1) {
      g.fillRect(0, 0, VW, VH);
      drawSnapshot(1 - easeOut(phase));
    } else {
      g.save();
      g.globalAlpha = 1 - easeOut(phase - 1);
      g.fillRect(0, 0, VW, VH);
      g.restore();
    }
  } else if (transition?.kind === 'return') {
    drawSnapshot(1 - easeOut(elapsed / RETURN_MS));
  }
}

/** 旧行和新行同时过渡；反向点击从当前高度续接。 */
export class AccordionMotion {
  private rows = new Map<string, { from: number; to: number; started: number }>();

  update(open: string | undefined, t: number) {
    if (reduceMotion()) {
      this.rows.clear();
      if (open !== undefined) this.rows.set(open, { from: 1, to: 1, started: t });
      return new Map(open === undefined ? [] : [[open, 1]]);
    }
    if (open !== undefined && !this.rows.has(open)) this.rows.set(open, { from: 0, to: 1, started: t });
    const progress = new Map<string, number>();
    for (const [key, row] of this.rows) {
      const target = Number(open === key);
      const p = row.from + (row.to - row.from) * easeOut(clamp01((t - row.started) / ACCORDION_TIME));
      if (p === 0 && target === 0) this.rows.delete(key);
      else {
        if (row.to !== target) this.rows.set(key, { from: p, to: target, started: t });
        progress.set(key, p);
      }
    }
    return progress;
  }
}

const DURATION = 0.18;
/** 两侧抽屉共用同一条进退曲线，反向操作从当前位置开始。 */
export class DrawerMotion {
  private progress = 0;
  private from = 0;
  private target = 0;
  private elapsed = DURATION;

  visible(open: boolean) { return open || (!reduceMotion() && this.progress > 0); }

  reset() {
    this.progress = this.from = this.target = 0;
    this.elapsed = DURATION;
  }

  draw(open: boolean, dt: number, direction: number, draw: () => void) {
    if (this.target !== Number(open)) {
      this.from = this.progress;
      this.target = Number(open);
      this.elapsed = 0;
    }
    this.elapsed = Math.min(DURATION, this.elapsed + dt);
    this.progress = preference.matches ? this.target
      : this.from + (this.target - this.from) * easeOut(this.elapsed / DURATION);
    if (this.progress <= 0) return;
    const alpha = this.progress;
    const x = direction * 20 * (1 - alpha);
    g.save();
    g.translate(x, 0);
    g.globalAlpha *= alpha;
    inputScope(x, 0, open, draw);
    g.restore();
  }
}
