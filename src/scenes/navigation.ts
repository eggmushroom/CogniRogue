import { cancelPanel } from '../core/combat';
import { G } from '../core/infra';
import { ackCardGet, cancelPreview } from '../core/journey';
import type { ExitAction } from './exit-control';
import { backInLibrary, cancelBankDeletion } from './packio';
import { closePlan } from './plangen';
import { closeModelForm } from './settings';
import { cancelQuestion } from './battle';

const back = (run: () => void): ExitAction => ({ kind: 'back', run });
const close = (run: () => void): ExitAction => ({ kind: 'close', run });

/** Header click and Escape resolve the same parent; a root panel has only a close action. */
export function panelExit(): ExitAction | null {
  const p = G.panel;
  switch (p.k) {
    case 'pack':
      if (p.deletion) return p.deletion.pending ? null : back(cancelBankDeletion);
      return p.page ? back(backInLibrary) : close(cancelPanel);
    case 'plan': return back(closePlan);
    case 'settings': return p.form ? back(closeModelForm) : close(cancelPanel);
    case 'help': {
      const parent = p.fromSettings;
      return parent ? back(() => { G.panel = { k: 'settings', ...parent }; }) : close(cancelPanel);
    }
    case 'topic': return back(cancelPanel);
    case 'cardpick':
      if (p.pick !== undefined) return back(cancelPreview);
      return p.from ? back(cancelPanel) : close(cancelPanel);
    case 'question': return close(cancelQuestion);
    case 'boon':
    case 'deck':
    case 'pile': return close(cancelPanel);
    case 'cardget': return close(ackCardGet);
    default: return null;
  }
}

export function leavePanel() {
  if (G.screen === 'atlas') { G.screen = 'title'; return; }
  panelExit()?.run();
}
