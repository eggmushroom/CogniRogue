import { G } from '../infra/state';
import { readStore, writeStore } from '../infra/storage';
import { BAL, STAGES, STAGE_ROWS } from '../model/data';
import { floorOf } from '../map';
import type { CardInst, MapNode, RunMode } from '../model/types';

/**
 * journey/save —— 一局的断点。
 *
 * 100 层的一局接近一小时，**没有断点等于没有长局**：关掉标签页、浏览器崩一次，
 * 玩家丢掉的不是十分钟，是整座塔。所以这里只做一件事：每走完一个节点，
 * 把"地图 + 牌组 + 血 + 幕"存进 localStorage；首页给一个「继续」。
 *
 * 三条刻意的限制：
 *   1. **只在节点之间存**。战斗中途（手牌、敌人、行动力）不存 —— 恢复一场打了一半的
 *      战斗需要把整套演出状态也存下来，而收益只是"少打一场"。
 *   2. **只存白名单字段**。G 里有一半是这一帧的表现态（busy / panel / enemy），
 *      整份 dump 回去等于把旧帧的中间状态复活。
 *   3. **版本号不对就当没有**。宁可让玩家重开，也不要用一份结构对不上的存档
 *      把一个好好的界面弄崩。
 */
const KEY = 'cognirogue.run.v1';

interface Snapshot {
  v: 1;
  stage: number;
  mode: RunMode;
  hp: number;
  maxHp: number;
  deck: CardInst[];
  map: MapNode[][];
  pos: { r: number; i: number } | null;
  seen: Record<string, boolean>;
  topicAtk: Record<string, number>;
  topicWrong: Record<string, number>;
  floors: number;
  runOk: number;
  runBad: number;
  answerDraws: number;
}

/**
 * 首页摘要的缓存。`undefined` = 还没算过。
 *
 * 首页每帧都会调 `runSaveInfo()`，而它要读一整份 localStorage 再 JSON.parse
 * （地图 + 牌组 + 主题统计，几 KB）。一秒钟解析六十遍没必要 —— 摘要只在
 * **存档被写过或清掉**之后才可能变，所以这两个入口负责把缓存打回未算状态。
 */
let infoCache: SaveInfo | null | undefined;

export type SaveInfo = { stage: number; stageName: string; floor: number; hp: number; maxHp: number };

/** 每走完一个节点存一次。战斗中途、面板打开时不存。 */
export function saveRun() {
  if (G.screen !== 'map' || !G.map.length || G.panel.k !== 'none' || G.pending) return;
  const snap: Snapshot = {
    v: 1,
    stage: G.stage,
    mode: G.mode,
    hp: G.hp,
    maxHp: G.maxHp,
    deck: G.deck,
    map: G.map,
    pos: G.pos,
    seen: G.seen,
    topicAtk: G.topicAtk,
    topicWrong: G.topicWrong,
    floors: G.floors,
    runOk: G.runOk,
    runBad: G.runBad,
    answerDraws: G.answerDraws,
  };
  writeStore(KEY, JSON.stringify(snap));
  infoCache = undefined;
}

export function clearRun() {
  writeStore(KEY, '');
  infoCache = undefined;
}

/** 首页用：有存档就返回一句摘要，没有就 null。 */
export function runSaveInfo(): SaveInfo | null {
  if (infoCache === undefined) infoCache = computeInfo();
  return infoCache;
}

function computeInfo(): SaveInfo | null {
  const s = readSnapshot();
  if (!s) return null;
  const r = s.pos ? s.pos.r : 0;
  return {
    stage: s.stage,
    stageName: STAGES[s.stage - 1].name,
    // 层号算的是"已经走到的这一层"，所以用 map 里那一个 floorOf，
    // 而不是在这里再写一遍 (stage - 1) * STAGE_ROWS + r + 1 ——
    // 两份公式迟早会有一份忘了改。
    floor: floorOf(s.stage, r),
    hp: s.hp,
    maxHp: s.maxHp,
  };
}

export function resumeRun(): boolean {
  const s = readSnapshot();
  if (!s) return false;
  Object.assign(G, {
    screen: 'map', mode: s.mode, stage: s.stage, panel: { k: 'none' }, log: [],
    deck: s.deck, map: s.map, pos: s.pos, seen: s.seen, node: null,
    hp: s.hp, maxHp: s.maxHp, block: 0,
    ap: BAL.baseAp, apMax: BAL.baseAp, turn: 1, enemy: null,
    draw: [], discard: [], hand: [], powers: [],
    topicAtk: s.topicAtk, topicWrong: s.topicWrong, failedTurn: {}, qSeen: {},
    okThisTurn: 0, topOkTopic: null, cardsPlayed: 0, binderUsed: false,
    answerDraws: s.answerDraws, answerDrawsThisTurn: 0, missDrawsThisTurn: 0,
    apDown: 0, drawCut: 0,
    runOk: s.runOk, runBad: s.runBad, floors: s.floors,
    pending: null, busy: false,
  });
  return true;
}

function readSnapshot(): Snapshot | null {
  const raw = readStore(KEY);
  if (!raw) return null;
  let s: Snapshot;
  try {
    s = JSON.parse(raw) as Snapshot;
  } catch {
    return null;
  }
  // 结构对不上就当没有：一份坏存档不该让首页崩掉
  if (!s || s.v !== 1) return null;
  if (!(s.stage >= 1 && s.stage <= STAGES.length)) return null;
  if (!Array.isArray(s.map) || s.map.length !== STAGE_ROWS) return null;
  if (!Array.isArray(s.deck) || !s.deck.length) return null;
  if (!(s.hp > 0) || !(s.maxHp > 0)) return null;
  if (s.pos && !(s.map[s.pos.r] && s.map[s.pos.r][s.pos.i])) return null;
  return s;
}
