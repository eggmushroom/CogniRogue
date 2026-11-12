import { G, resetTurnState } from '../infra/state';
import { readStore, writeStore } from '../infra/storage';
import { BAL, MODE_BY_ID, NODE_META, POWER_BY_ID, STAGES, STAGE_ROWS } from '../model/data';
import { floorOf } from '../map';
import { baseIdOf, isKnownCardId } from '../cards/registry';
import { LEGACY_CARD_IDS } from '../cards/legacy';
import { enterStage } from '../library/stage';
import type { MapNode, ModeId, PowerId } from '../model/types';

/** 一局的断点：只在节点之间存，只存白名单字段，版本号不对就当没有。 */
const KEY = 'cognirogue.run.v7';

interface Snapshot {
  v: 7;
  stage: number;
  /** 开局模式；开局能力另存在 powers 里 */
  mode: ModeId | null;
  hp: number;
  maxHp: number;
  /** 牌组存 card id，精炼过的那张带 + 后缀 */
  deck: string[];
  /** 整局生效的增益，必须跟断点走 */
  powers: string[];
  map: MapNode[][];
  pos: { r: number; i: number } | null;
  seen: Record<string, boolean>;
  topicWrong: Record<string, number>;
  floors: number;
  runOk: number;
  runBad: number;
  answerDraws: number;
  /** 用过的「每幕一次」「整局一次」；不存则读档后可再用。每场一次的不存 */
  onceStage: string[];
  onceRun: string[];
  /** 抛光布的精炼加成，不存会让读档后精炼掉级 */
  upGrade: number;
}

/** 首页摘要缓存。null 表示算过但没有存档，undefined 表示还没算过 */
let infoCache: SaveInfo | null | undefined;

export type SaveInfo = { stage: number; stageName: string; floor: number; hp: number; maxHp: number };

/** 记账表压成 id 串 */
function usedIds(table: Partial<Record<PowerId, boolean>>): PowerId[] {
  return (Object.keys(table) as PowerId[]).filter((id) => table[id]);
}

/** id 串还原成记账表，未知 id 剔掉 */
function usedTable(ids: string[]): Partial<Record<PowerId, boolean>> {
  const out: Partial<Record<PowerId, boolean>> = {};
  ids.forEach((id) => { if (POWER_BY_ID[id]) out[id as PowerId] = true; });
  return out;
}

/** 每走完一个节点存一次 */
export function saveRun() {  if (G.screen !== 'map' || !G.map.length || G.panel.k !== 'none' || G.pending) return;
  const snap: Snapshot = {
    v: 7,
    stage: G.stage,
    mode: G.mode,
    hp: G.hp,
    maxHp: G.maxHp,
    deck: G.deck,
    powers: G.powers,
    map: G.map,
    pos: G.pos,
    seen: G.seen,
    topicWrong: G.topicWrong,
    floors: G.floors,
    runOk: G.runOk,
    runBad: G.runBad,
    answerDraws: G.answerDraws,
    onceStage: usedIds(G.onceStage),
    onceRun: usedIds(G.onceRun),
    upGrade: G.upGrade,
  };
  writeStore(KEY, JSON.stringify(snap));
  infoCache = undefined;
}

export function clearRun() {
  writeStore(KEY, '');
  infoCache = undefined;
}

/** 首页用：有存档返回摘要，否则 null */
export function runSaveInfo(): SaveInfo | null {
  if (infoCache === undefined) {
    // 首页每帧都读它，这里再兜一层：坏存档最多是没有继续按钮，不会让标题画面停住。
    try { infoCache = computeInfo(); } catch { infoCache = null; }
  }
  return infoCache;
}

function computeInfo(): SaveInfo | null {
  const s = readSnapshot();
  if (!s) return null;
  const stage = STAGES[s.stage - 1];
  if (!stage) return null;
  const r = s.pos ? s.pos.r : 0;
  return {
    stage: s.stage,
    stageName: stage.name,
    // 层号统一走 floorOf，别在这里重写公式
    floor: floorOf(s.stage, r),
    hp: s.hp,
    maxHp: s.maxHp,
  };
}

export function resumeRun(): boolean {
  const s = readSnapshot();
  if (!s) return false;
  Object.assign(G, {
    screen: 'map', mode: s.mode, stage: s.stage, stageTopic: '', panel: { k: 'none' }, log: [],
    deck: s.deck, map: s.map, pos: s.pos, seen: s.seen, node: null,
    hp: s.hp, maxHp: s.maxHp, block: 0,
    ap: BAL.baseAp, apMax: BAL.baseAp, turn: 1, enemy: null,
    draw: [], discard: [], hand: [], powers: s.powers,
    topicWrong: s.topicWrong, qPicked: {}, qLeft: [], charge: {}, answers: [],
    answerDraws: s.answerDraws, syllabusTurn: 0, onceUsed: {},
    onceStage: usedTable(s.onceStage),
    onceRun: usedTable(s.onceRun),
    carryBlock: 0, upGrade: s.upGrade,
    apDown: 0, drawCut: 0,
    runOk: s.runOk, runBad: s.runBad, floors: s.floors,
    pending: null, pendingCost: 0, busy: false,
  });
  enterStage(s.stage);
  resetTurnState();
  return true;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isBoolRecord(v: unknown): v is Record<string, boolean> {
  return isRecord(v) && Object.values(v).every((x) => typeof x === 'boolean');
}

function isNonNegRecord(v: unknown): v is Record<string, number> {
  return isRecord(v) && Object.values(v).every((x) => isNum(x) && x >= 0);
}

/** 牌组里的一项是非空字符串 id，精炼的带 + 后缀 */
function isCardId(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function isMapNode(v: unknown): v is MapNode {
  if (!isRecord(v)) return false;
  return Number.isInteger(v.r) && Number.isInteger(v.i) && Number.isInteger(v.col)
    && typeof v.key === 'string'
    && typeof v.type === 'string' && Object.prototype.hasOwnProperty.call(NODE_META, v.type)
    // boss 行没有 next，缺字段不算坏档
    && (v.next === undefined
      || (Array.isArray(v.next) && v.next.every((n) => Number.isInteger(n))));
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
  // stage=2.5 这类值会让 STAGES[stage-1].name 抛异常，首页每帧渲染失败
  if (!isRecord(s) || s.v !== 7) return null;
  if (!Number.isInteger(s.stage) || s.stage < 1 || s.stage > STAGES.length) return null;
  if (s.mode !== null && !(typeof s.mode === 'string' && !!MODE_BY_ID[s.mode as ModeId])) return null;
  if (!isNum(s.hp) || !isNum(s.maxHp) || s.hp <= 0 || s.maxHp <= 0 || s.hp > s.maxHp) return null;
  if (!Array.isArray(s.map) || s.map.length !== STAGE_ROWS) return null;
  // key 与数组位置对不上能过形状校验，但点下去取到 undefined
  if (!s.map.every((row, r) => Array.isArray(row)
    && row.length > 0 && row.length <= 3
    && row.every((nd, i) => isMapNode(nd)
      && nd.r === r && nd.i === i && nd.key === `${r}:${i}`
      && (nd.col as number) >= 0 && (nd.col as number) <= 2))) return null;
  // 入口与 Boss 各行只有一个节点，坏档在这里没有可点的下一步
  if (s.map[0].length !== 1 || s.map[0][0].type !== 'fight') return null;
  if (s.map[STAGE_ROWS - 1].length !== 1 || s.map[STAGE_ROWS - 1][0].type !== 'boss') return null;
  // next 越界能过节点校验，drawMap 读 G.map[r+1][99] 会抛异常
  for (let r = 0; r < s.map.length - 1; r++) {
    for (const nd of s.map[r]) {
      if (!Array.isArray(nd.next)) return null;
      for (const j of nd.next) {
        if (!s.map[r + 1][j]) return null;
      }
    }
  }
  if (!Array.isArray(s.deck) || !s.deck.length) return null;
  if (!s.deck.every(isCardId)) return null;
  // 旧题库 id 迁移要在剥 + 后缀之前做
  s.deck = s.deck.map((id) => {
    const up = id.endsWith('+');
    const base = up ? id.slice(0, -1) : id;
    const mapped = LEGACY_CARD_IDS[base] ?? base;
    return up ? mapped + '+' : mapped;
  });
  s.deck = s.deck.filter((id) => baseIdOf(id) !== 'pow:log');
  if (!s.deck.length || !s.deck.every((id) => isKnownCardId(id))) return null;
  // 增益只能是认识的 id 且不重复
  if (!Array.isArray(s.powers)) return null;
  if (!s.powers.every((id) => typeof id === 'string' && !!POWER_BY_ID[id])) return null;
  if (new Set(s.powers).size !== s.powers.length) return null;
  if (!isBoolRecord(s.seen) || !isNonNegRecord(s.topicWrong)) return null;
  // 不认识的 id 直接判坏档，静默忽略会让那张牌读档后再可用
  for (const key of ['onceStage', 'onceRun'] as const) {
    const v = s[key];
    if (!Array.isArray(v)) return null;
    if (!v.every((id) => typeof id === 'string' && !!POWER_BY_ID[id])) return null;
  }
  if (!isNum(s.upGrade) || s.upGrade < 0 || s.upGrade > 10) return null;
  for (const key of ['floors', 'runOk', 'runBad', 'answerDraws'] as const) {
    const v = s[key];
    if (!isNum(v) || v < 0) return null;
  }
  if (s.pos !== null) {
    if (!isRecord(s.pos) || !Number.isInteger(s.pos.r) || !Number.isInteger(s.pos.i)) return null;
    if (s.pos.r < 0 || s.pos.r >= STAGE_ROWS) return null;
    if (s.pos.i < 0 || s.pos.i >= s.map[s.pos.r].length) return null;
  }
  return s;
}
