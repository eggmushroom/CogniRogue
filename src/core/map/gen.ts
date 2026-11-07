import type { MapNode, NodeType } from '../model/types';
import { G } from '../infra/state';
import { shuffle } from '../infra/util';

/**
 * map —— 八层分支地图工具包。
 *
 * 只负责生成拓扑和回答「现在能往哪走」。节点类型的图标 / 颜色在
 * model/data.ts 的 NODE_META，怎么画是 scenes/map.ts 的事。
 */
export const MAP_ROWS = 8;

export function genMap(): MapNode[][] {
  const rows: MapNode[][] = [[{ col: 1, type: 'fight' } as MapNode]];
  for (let r = 1; r < MAP_ROWS - 1; r++) {
    const n = r === 1 ? 2 : Math.random() < 0.5 ? 3 : 2;
    const cols = shuffle([0, 1, 2]).slice(0, n).sort((a, b) => a - b);
    rows.push(cols.map((c) => {
      let type: NodeType;
      if (r === MAP_ROWS - 2) type = 'rest';
      else if (r === 1) type = Math.random() < 0.55 ? 'fight' : 'event';
      else {
        const x = Math.random();
        type = x < 0.46 ? 'fight' : x < 0.66 ? 'event' : x < 0.84 ? 'rest' : 'elite';
      }
      return { col: c, type } as MapNode;
    }));
  }
  rows.push([{ col: 1, type: 'boss' } as MapNode]);

  for (let r = 0; r < MAP_ROWS - 1; r++) {
    const a = rows[r];
    const b = rows[r + 1];
    a.forEach((x) => {
      const s = b
        .map((y, j) => ({ j, d: Math.abs(y.col - x.col) }))
        .sort((p, q) => p.d - q.d || p.j - q.j);
      x.next = [s[0].j];
      if (s[1] && s[1].d <= 1 && Math.random() < 0.5) x.next.push(s[1].j);
    });
    b.forEach((y, j) => {
      if (a.some((x) => x.next.includes(j))) return;
      let bi = 0;
      let bd = 9;
      a.forEach((x, i) => {
        const d = Math.abs(x.col - y.col);
        if (d < bd) { bd = d; bi = i; }
      });
      a[bi].next.push(j);
    });
  }

  rows.forEach((rr, r) => rr.forEach((nd, i) => { nd.r = r; nd.i = i; nd.key = `${r}:${i}`; }));
  return rows;
}

/** 当前能点的节点 key。没有坐标时是第一层，之后是上一个节点的 next。 */
export function availableNodes(): string[] {
  if (!G.map.length) return [];
  if (!G.pos) return G.map[0].map((nd) => nd.key);
  const nd = G.map[G.pos.r][G.pos.i];
  return (nd.next || []).map((j) => `${G.pos!.r + 1}:${j}`);
}
