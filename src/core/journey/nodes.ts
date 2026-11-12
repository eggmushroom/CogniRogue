import { G } from '../infra/state';
import { saveRun } from './save';

/** 一个节点结束后的收尾：rewards / events / run 共用。 */
export function finishNode() {
  const nd = G.node;
  if (nd) G.pos = { r: nd.r, i: nd.i };
  G.floors = (G.floors || 0) + 1;
  G.screen = 'map';
  G.enemy = null;
  G.pending = null;
  G.busy = false;
  G.hand = [];
  G.draw = [];
  G.discard = [];
  G.panel = { k: 'none' };
  G.node = null;
  // 节点结束没有“选完牌才结算”的东西了；早退路径也不能把账留到下一层。
  G.pendingCost = 0;
  G.pendingHeal = 0;
  // 断点只能落在节点之间
  saveRun();
}
