import type { MapNode, NodeType } from '../model/types';
import { STAGES, STAGE_ROWS, stageOf } from '../model/data';
import { G } from '../infra/state';
import { shuffle } from '../infra/util';

/**
 * map —— 一幕的分支地图，以及 100 层的层号换算。
 *
 * **一局 100 层，但地图一次只装 20 层。** 这不是偷懒：把 100 行画在一屏里，
 * 每个点只有几个像素，地图就不再是"能提前规划的分支"，而是一张花纹。
 * 所以一幕一张图，过幕换图 —— 玩家记住的是"这一幕我怎么走上去"，不是 100 个点。
 *
 * 只负责生成拓扑和回答「现在能往哪走」。节点类型的图标 / 颜色在
 * model/data.ts 的 NODE_META，怎么画是 scenes/map.ts 的事。
 */
export const MAP_ROWS = STAGE_ROWS;
/** 全流程层数。UI 上的「第 37 / 100 层」用的就是它 */
export const FLOOR_MAX = STAGE_ROWS * STAGES.length;

/** 全局层号（1..100）：第 3 幕第 0 行 = 41 层 */
export const floorOf = (stage: number, r: number) => (stage - 1) * STAGE_ROWS + r + 1;

/** 当前所在层。还没进节点时算这一幕的入口层。 */
export function curFloor(): number {
  const r = G.node ? G.node.r : G.pos ? G.pos.r : 0;
  return floorOf(G.stage, r);
}

/** 全局层号 → 第几幕（1..100 → 1..5） */
export const stageOfFloor = (floor: number) => Math.min(STAGES.length, Math.floor((floor - 1) / STAGE_ROWS) + 1);

/**
 * 生成一幕的地图。
 *
 * 20 行里三行是固定的：入口（第 0 行，一场普通战斗）、幕末复习点（第 18 行）、
 * Boss（第 19 行）。中间 17 行按这一幕的 `mix` 抽类型 —— 所以第二幕事件多、
 * 第四幕精英多，是**配比**上的差异，不是随机数的差异。
 *
 * 另外两条硬约束：精英不出现在前 5 行（一开幕就撞精英只会让人重开），
 * 复习点不连着出（连着两点等于白送一管血）。
 */
export function genStage(stage = G.stage): MapNode[][] {
  const def = stageOf(stage);
  const rows: MapNode[][] = [[{ col: 1, type: 'fight' } as MapNode]];
  let lastRest = false;
  let elites = 0;

  for (let r = 1; r < MAP_ROWS - 1; r++) {
    const n = r === 1 ? 2 : Math.random() < 0.5 ? 3 : 2;
    const cols = shuffle([0, 1, 2]).slice(0, n).sort((a, b) => a - b);
    const rowRest = lastRest;
    rows.push(cols.map((c) => {
      let type: NodeType;
      if (r === MAP_ROWS - 2) type = 'rest';
      else if (r === 1) type = Math.random() < 0.55 ? 'fight' : 'event';
      else type = rollType(r, def.mix, rowRest);
      if (type === 'elite') elites += 1;
      if (type === 'rest') lastRest = true;
      return { col: c, type } as MapNode;
    }));
    if (!rows[r].some((nd) => nd.type === 'rest')) lastRest = false;
  }
  rows.push([{ col: 1, type: 'boss' } as MapNode]);

  // 一幕里一只精英都没有会显得太平 —— 精英是增益牌唯一的稳定来源。
  // 补在第 6..14 行里随机一行的随机节点上（那里已经过了开局，玩家有牌可打）。
  if (def.mix.elite > 0 && !elites) {
    const r = 6 + Math.floor(Math.random() * 9);
    const nd = rows[r][Math.floor(Math.random() * rows[r].length)];
    if (nd.type === 'fight' || nd.type === 'event') nd.type = 'elite';
  }

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

/** 按一幕的配比抽一个节点类型。前 5 行不出精英，上一行是复习点时不再出复习点。 */
function rollType(r: number, mix: { fight: number; event: number; rest: number; elite: number }, lastRest: boolean): NodeType {
  const elite = r < 5 ? 0 : mix.elite;
  const rest = lastRest ? 0 : mix.rest;
  const total = mix.fight + mix.event + rest + elite;
  let x = Math.random() * total;
  if ((x -= mix.fight) < 0) return 'fight';
  if ((x -= mix.event) < 0) return 'event';
  if ((x -= rest) < 0) return 'rest';
  return elite > 0 ? 'elite' : 'fight';
}

/** 当前能点的节点 key。没有坐标时是第一层，之后是上一个节点的 next。 */
export function availableNodes(): string[] {
  if (!G.map.length) return [];
  if (!G.pos) return G.map[0].map((nd) => nd.key);
  const nd = G.map[G.pos.r][G.pos.i];
  return (nd.next || []).map((j) => `${G.pos!.r + 1}:${j}`);
}
