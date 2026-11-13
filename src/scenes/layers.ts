import { g, VH, VW } from '../gfx/canvas';
import { C } from '../gfx/theme';
import { drawBackdrop, drawMotes } from '../gfx/backdrop';
import { drawAtlas } from './atlas';
import { drawBattle } from './battle';
import { drawMap } from './map';
import { drawTitle } from './title';

/**
 * 分层绘制：组合根按「背景 / 世界 / 浮层」三层决定这一帧画到哪一层。
 *
 * 以前每块浮层都用一层很重的半透明黑把底下压住，遮罩被迫同时干两件事：
 * 营造氛围、挡住底层的白字和手牌。alpha 从 0.72 一路调到 0.9，
 * 标题大字、地图 HUD、幽灵手牌仍会在边框外透出来，而书架氛围也快被压没了。
 *
 * 现在每块浮层声明自己要看到多少底层世界：
 *   full      答题与判定 —— 战场、立绘、光刃都要看得见，沿用 dimQuestion 的渐变
 *   backdrop  其余浮层 —— 只画书架与浮尘，根本不生成会被透出来的文字和卡
 *
 * 遮罩因此退回单纯的氛围层（theme.ts 的 SCRIM），不再承担「挡字」的职责。
 * 顺带一个好处：被面板盖住的按钮不再注册热区，因为它们压根没被画出来。
 */

export type WorldLayer = 'full' | 'backdrop';

/** 只有答题 / 判定要留着战场；答对的 feedback 不画面板，但打击演出要在。 */
const FULL_PANELS = new Set(['question', 'feedback']);

export function worldLayer(panelKind: string): WorldLayer {
  if (panelKind === 'none' || FULL_PANELS.has(panelKind)) return 'full';
  return 'backdrop';
}

/** 背景层：所有屏幕共用的书架与浮尘。atlas 自带底色，不走这一层。 */
export function drawSceneBackdrop(screen: string, t: number) {
  if (screen === 'atlas') {
    g.fillStyle = C.void;
    g.fillRect(0, 0, VW, VH);
    return;
  }
  const dim = screen === 'title' ? 0.72 : screen === 'map' ? 0.66 : 0.58;
  drawBackdrop(t, dim);
  drawMotes(t);
}

export interface SceneHooks {
  openHelp(): void;
  openPack(): void;
}

/** 世界层：HUD / 节点 / 立绘 / 手牌，以及它们各自的点击热区。 */
export function drawSceneWorld(screen: string, t: number, dt: number, hooks: SceneHooks) {
  switch (screen) {
    case 'atlas': drawAtlas(t); return;
    case 'title': drawTitle(t, hooks.openHelp, hooks.openPack); return;
    case 'map': drawMap(t, dt); return;
    default: drawBattle(t, dt); return;
  }
}
