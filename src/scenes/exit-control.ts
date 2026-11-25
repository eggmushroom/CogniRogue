import { drawArtIcon } from '../gfx/art/icons';
import { C } from '../gfx/theme';
import { panel } from '../gfx/ui';
import { hover, onClick } from '../input';

export interface ExitAction {
  kind: 'back' | 'close';
  side?: 'left';
  run: () => void;
}

// Navigation polish informed by Unslop by Damir Sokolovsky (CC BY 4.0).
export function drawExitControl(left: number, top: number, width: number, exit: ExitAction | null, r = 3) {
  if (!exit) return;
  const back = exit.kind === 'back';
  const w = back ? 40 : 32;
  const x = back || exit.side === 'left' ? left + 16 : left + width - 16 - w;
  const y = top + 16;
  const lit = hover(x, y, w, w);
  const color = lit ? C.ink : C.ink2;
  panel(x, y, w, w, { radius: r, fill: lit ? C.panelHi : C.bg, stroke: lit ? C.gold : C.line });
  drawArtIcon(back ? 'back' : 'close', x + w / 2, y + w / 2, back ? 20 : 18, color);
  onClick(x, y, w, w, exit.run, back ? '返回' : '×');
}
