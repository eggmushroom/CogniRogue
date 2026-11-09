import { G } from '../infra/state';
import { saveRun } from './save';

/**
 * journey/nodes —— 一个节点结束后的收尾。
 *
 * 单独成一个文件是为了让 rewards / events / run 都能用它，而不需要
 * 互相 import：奖励选完、事件选完、复习点用完，收尾动作是同一个。
 */
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
  // 走完一个节点就存一次：100 层的一局接近一小时，断点只能落在节点之间
  saveRun();
}
