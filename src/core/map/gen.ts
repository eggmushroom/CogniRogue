import type { MapNode, NodeType } from '../model/types';
import { STAGES, STAGE_ROWS, stageOf } from '../model/data';
import { G } from '../infra/state';
import { shuffle, pick, roll } from '../infra/util';

/**
 * 一幕的分支地图与层号换算。一局 100 层，但地图一次只装 20 行，过幕换图。
 * 只负责拓扑和可达性；节点颜色在 `NODE_META`，图标在 `gfx/art/icons`，
 * 怎么画在 `scenes/map.ts`。
 */
export const MAP_ROWS = STAGE_ROWS;
/** 全流程层数。UI 上的「第 37 / 100 层」用的就是它 */
export const FLOOR_MAX = STAGE_ROWS * STAGES.length;

/**
 * 每行的槽位数 —— 这一版最重要的一个数。
 *
 * 3 列装不下岔路：一行只有 2–3 个节点、连线又只允许跨一列时，走法必然退化成
 * 「三条竖线」，每层的选择只是「沿哪根竖线往上」。加到 5 列、每行只占 1–4 个
 * 槽位之后，同一批节点会横向漂移、分叉、再合流，玩家真的要判断「走哪边」。
 *
 * 槽位比节点多也是关键：节点只占 5 列里的一部分，行与行的列集合不一样，
 * 才有"这条路往左拐、那条往右拐"的形状。
 */
export const MAP_COLS = 5;

/** 全局层号（1..100）：第 3 幕第 0 行 = 41 层 */
export const floorOf = (stage: number, r: number) => (stage - 1) * STAGE_ROWS + r + 1;

/** 当前所在层。还没进节点时算这一幕的入口层。 */
export function curFloor(): number {
  const r = G.node ? G.node.r : G.pos ? G.pos.r : 0;
  return floorOf(G.stage, r);
}

/**
 * 一行放几个节点。多数 2–3，少数 4（密集岔口）或 1（独木桥）。
 *
 * 1 不是凑数的：整行只有一个节点时，玩家没得选，只能走它 —— 地图上要
 * 有这种「收窄」，后面的分叉才显得是分叉，而不是一直摊着的三车道。
 */
function rowSize(r: number): number {
  if (r === 1) return 2;
  // 整数份数：10 份独木桥、34 份双列、40 份三列、16 份四岔。
  const x = roll();
  if (x <= 10) return 1;
  if (x <= 44) return 2;
  if (x <= 84) return 3;
  return 4;
}

/**
 * 抽一行节点的列。
 *
 * 硬约束是**每个列都得贴着上一行**（存在 p，|c−p| ≤ 1），不是"至少有一对
 * 搭得上"。差别在连线上：只要求"一对"时，剩下的节点只能靠补边连到很远
 * 的父节点，跨两列的长斜线在 92px 行距里几乎是水平的一条，几行下来就是
 * 蜘蛛网。要求"每个都贴着"之后，任何一条边最多跨一列，图形自己就稳了。
 *
 * 抽不到就重抽；真抽不到（n 超过上一行的覆盖能力）时以上一行各列为中心
 * 铺开，宁可少放几个 —— 少一个节点，好过多一条横贯的假路。
 */
function rowCols(n: number, prev: number[]): number[] {
  const all = Array.from({ length: MAP_COLS }, (_, i) => i);
  const near = (c: number) => prev.some((p) => Math.abs(c - p) <= 1);
  for (let k = 0; k < 32; k++) {
    const cols = shuffle(all).slice(0, n).sort((a, b) => a - b);
    if (cols.every(near)) return cols;
  }
  const out: number[] = [];
  for (const p of shuffle(prev)) {
    for (const c of [p, p - 1, p + 1]) {
      if (c >= 0 && c < MAP_COLS && !out.includes(c) && out.length < n) out.push(c);
    }
    if (out.length >= n) break;
  }
  return out.sort((a, b) => a - b);
}

/**
 * 一行全是同一种类型时，「选哪条」等于「选哪列」—— 这不是选择，是换了个位置。
 * 把最后一个降级成事件或复习点，让同一行的几个选项真的不一样。
 *
 * 只处理整行都是普通战斗的情况：精英、复习、事件成排出现是有意义的
 * （那是一整条富路），不该被"打散"。
 */
function diversify(row: MapNode[], allowRest: boolean) {
  if (row.length < 2 || !row.every((nd) => nd.type === 'fight')) return;
  row[row.length - 1].type = allowRest && roll() <= 50 ? 'rest' : 'event';
}

/**
 * 生成一幕地图。固定三行：入口战斗（0）、复习点（18）、Boss（19）；
 * 中间 17 行按本幕 `mix` 抽类型。精英不在前 5 行，复习点不连着出。
 */
export function genStage(stage = G.stage): MapNode[][] {
  const def = stageOf(stage);
  const entry = Math.floor(MAP_COLS / 2);
  const rows: MapNode[][] = [[{ col: entry, type: 'fight' } as MapNode]];
  let cols = [entry];
  let lastRest = false;
  let elites = 0;

  for (let r = 1; r < MAP_ROWS - 1; r++) {
    // 一行能长出几个节点，取决于上一行铺得开不开：每个父节点左右各带一列。
    // 不设这个上限，rowCols 的"每个都贴着上一行"就永远抽不出来，
    // 只能落到补边那条路上 —— 而那正是长横线的来源。
    const cap = Math.min(MAP_COLS, rows[r - 1].length * 2);
    cols = rowCols(Math.min(rowSize(r), cap), cols);
    const rowRest = lastRest;
    const row = cols.map((c) => {
      let type: NodeType;
      if (r === MAP_ROWS - 2) type = 'rest';
      else if (r === 1) type = roll() <= 55 ? 'fight' : 'event';
      else type = rollType(r, def.mix, rowRest);
      if (type === 'elite') elites += 1;
      return { col: c, type } as MapNode;
    });
    if (r !== MAP_ROWS - 2) diversify(row, !rowRest);
    rows.push(row);
    if (!row.some((nd) => nd.type === 'rest')) lastRest = false;
    else lastRest = true;
  }
  // Boss 的列跟着复习点那一行走，不固定在中列：
  // 固定在中列时，最后一条边可能横跨两列 —— 那正是别处都在避免的长斜线
  // （`stagecheck` 的「每个节点都挨着上一行」会偶发红，就是这一行）。
  const gate = rows[rows.length - 1];
  const bossCol = gate.reduce(
    (best, nd) => (Math.abs(nd.col - entry) < Math.abs(best - entry) ? nd.col : best),
    gate[0].col,
  );
  rows.push([{ col: bossCol, type: 'boss' } as MapNode]);

  // 一幕里一只精英都没有会显得太平：精英是增益牌唯一的稳定来源。
  // 从第 6..14 行里挑一个能改成精英的节点。不能在随机位置直接改：
  // 挑到复习点时会静默失败，整幕仍然没有精英。
  if (def.mix.elite > 0 && !elites) {
    const candidates: MapNode[] = [];
    for (let r = 6; r <= MAP_ROWS - 6; r++) {
      for (const nd of rows[r]) {
        if (nd.type === 'fight' || nd.type === 'event') candidates.push(nd);
      }
    }
    if (candidates.length) pick(candidates).type = 'elite';
  }

  for (let r = 0; r < MAP_ROWS - 1; r++) {
    const a = rows[r];
    const b = rows[r + 1];
    a.forEach((x) => {
      const s = b
        .map((y, j) => ({ j, d: Math.abs(y.col - x.col) }))
        .sort((p, q) => p.d - q.d || p.j - q.j);
      x.next = [s[0].j];
      // 第二条边只在"横向还在一列之内"时开：既是岔路，也不至于变成蜘蛛网
      if (s[1] && s[1].d <= 1 && roll() <= 62) x.next.push(s[1].j);
    });
    b.forEach((y, j) => {
      if (a.some((x) => x.next.includes(j))) return;
      let bi = 0;
      let bd = MAP_COLS + 1;
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

/**
 * 按一幕的配比抽一个节点类型。前 5 行不出精英，上一行是复习点时不再出复习点。
 *
 * 配比是**整数份数**（38 / 20 / 26 / 16 份），抽签也画在整数上：四类各占几份，
 * 一目了然。比例形式（0.38）读起来像是"38% 的层"，其实只是权重，还得乘 100 才看得懂。
 */
function rollType(r: number, mix: { fight: number; event: number; rest: number; elite: number }, lastRest: boolean): NodeType {
  const elite = r < 5 ? 0 : mix.elite;
  const rest = lastRest ? 0 : mix.rest;
  const total = mix.fight + mix.event + rest + elite;
  let x = 1 + Math.floor(Math.random() * total);
  if ((x -= mix.fight) <= 0) return 'fight';
  if ((x -= mix.event) <= 0) return 'event';
  if ((x -= rest) <= 0) return 'rest';
  return elite > 0 ? 'elite' : 'fight';
}

/** 当前能点的节点 key。没有坐标时是第一层，之后是上一个节点的 next。 */
export function availableNodes(): string[] {
  if (!G.map.length) return [];
  if (!G.pos) return G.map[0].map((nd) => nd.key);
  const nd = G.map[G.pos.r][G.pos.i];
  return (nd.next || []).map((j) => `${G.pos!.r + 1}:${j}`);
}
