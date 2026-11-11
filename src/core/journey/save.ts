import { G, resetTurnState } from '../infra/state';
import { readStore, writeStore } from '../infra/storage';
import { BAL, MODE_BY_ID, NODE_META, POWER_BY_ID, STAGES, STAGE_ROWS } from '../model/data';
import { floorOf } from '../map';
import { baseIdOf, isKnownCardId } from '../cards/registry';
import { LEGACY_CARD_IDS } from '../cards/legacy';
import { enterStage } from '../library/stage';
import type { MapNode, ModeId, PowerId } from '../model/types';

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
const KEY = 'cognirogue.run.v7';

interface Snapshot {
  v: 7;
  stage: number;
  /** 开局选的模式；它决定开局能力，但能力本身仍然存在 `powers` 里 */
  mode: ModeId | null;
  hp: number;
  maxHp: number;
  /**
   * 牌组：一串 card id。精炼过的那一张带 `+` 后缀（见 `cards/registry.ts`），
   * 所以"哪一张被精炼了"就写在 id 里，不需要第二份精炼表 —— 也不会再出现
   * 两张表对不上、读档后精炼凭空消失这种事。
   *
   * v4 起**不再可能包含增益**：增益不是牌，它在下面的 `powers` 里。
   */
  deck: string[];
  /**
   * 这一局已经拿到的增益（`PowerId`）。整局生效，所以它必须跟着断点走 ——
   * 丢掉它等于读档之后把这一局挣到的东西全忘了。
   */
  powers: string[];
  map: MapNode[][];
  pos: { r: number; i: number } | null;
  seen: Record<string, boolean>;
  topicWrong: Record<string, number>;
  floors: number;
  runOk: number;
  runBad: number;
  answerDraws: number;
  /**
   * 已经用掉的「每幕一次」/「整局一次」的牌（`PowerId` 列表）。
   *
   * 必须存 —— 否则读档之后「许愿条」会重新变成一张满的免死，
   * 「账本」也会在这一幕里再用一次。存数组而不是整张 `onceUsed` 表：
   * 这里只需要"哪些用过了"，形状越小越好校验。
   *
   * 「每场一次」那张表不存：战斗中途本来就不存档，进新场也必然要清。
   */
  onceStage: string[];
  onceRun: string[];
  /**
   * 抛光布写进 G 的精炼加成。它是**拾取即结算**的一张牌，不存的话
   * 读档之后精炼会从 +5 掉回 +3，而玩家手里那几张已经精炼过的牌不会变回去 ——
   * 一个只在"读档之后"出现的差额，最难查。
   */
  upGrade: number;
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

/** 把"哪些用过了"的记账表压成一串 id。写档时用。 */
function usedIds(table: Partial<Record<PowerId, boolean>>): PowerId[] {
  return (Object.keys(table) as PowerId[]).filter((id) => table[id]);
}

/** 把一串 id 还原成记账表。读档时用 —— 顺手把不认识的 id 剔掉。 */
function usedTable(ids: string[]): Partial<Record<PowerId, boolean>> {
  const out: Partial<Record<PowerId, boolean>> = {};
  ids.forEach((id) => { if (POWER_BY_ID[id]) out[id as PowerId] = true; });
  return out;
}

/** 每走完一个节点存一次。战斗中途、面板打开时不存。 */
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

/** 首页用：有存档就返回一句摘要，没有就 null。 */
export function runSaveInfo(): SaveInfo | null {
  if (infoCache === undefined) {
    // 存档校验已经尽量严，但首页每帧都读它 —— 这里再兜一层，保证
    // 任何读不懂的存档最多是"没有继续按钮"，而不是让标题画面停住。
    try { infoCache = computeInfo(); } catch { infoCache = null; }
  }
  return infoCache;
}

function computeInfo(): SaveInfo | null {
  const s = readSnapshot();
  if (!s) return null;
  const stage = STAGES[s.stage - 1];
  // 正常不会走到这里；留着是给"以后又忘了校验某个字段"留一条命。
  if (!stage) return null;
  const r = s.pos ? s.pos.r : 0;
  return {
    stage: s.stage,
    stageName: stage.name,
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
    screen: 'map', mode: s.mode, stage: s.stage, stageTopic: '', panel: { k: 'none' }, log: [],
    deck: s.deck, map: s.map, pos: s.pos, seen: s.seen, node: null,
    hp: s.hp, maxHp: s.maxHp, block: 0,
    ap: BAL.baseAp, apMax: BAL.baseAp, turn: 1, enemy: null,
    draw: [], discard: [], hand: [], powers: s.powers,
    topicWrong: s.topicWrong, qPicked: {}, qLeft: [], charge: {}, answers: [],
    answerDraws: s.answerDraws, qFresh: false, syllabusTurn: 0, onceUsed: {},
    onceStage: usedTable(s.onceStage),
    onceRun: usedTable(s.onceRun),
    carryBlock: 0, upGrade: s.upGrade,
    apDown: 0, drawCut: 0,
    runOk: s.runOk, runBad: s.runBad, floors: s.floors,
    pending: null, pendingCost: 0, busy: false,
  });
  // 断点只存阶段号；题库是按阶段从来源题库切出来的，恢复时重新切一次。
  enterStage(s.stage);
  resetTurnState();
  return true;
}

/** JSON 里的对象：排除 null 和数组。 */
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

/**
 * 牌组里的一项：一个非空字符串 id（精炼过的那一张带 `+` 后缀，它也是合法 id）。
 *
 * 名字里已经没有 "CardInst" 了 —— 牌组里不再有实例对象，`CardId` 就是全部。
 * v1/v2 存档里写的是 `{ id, up }`，那种结构在 `readSnapshot` 的版本闸门处
 * 就整份退回去了，不会走到这里。
 */
function isCardId(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function isMapNode(v: unknown): v is MapNode {
  if (!isRecord(v)) return false;
  return Number.isInteger(v.r) && Number.isInteger(v.i) && Number.isInteger(v.col)
    && typeof v.key === 'string'
    && typeof v.type === 'string' && Object.prototype.hasOwnProperty.call(NODE_META, v.type)
    // boss 行不参与连线，genStage 从来没给它写过 next —— 旧存档里这个字段
    // 就是缺的，不能因为"地图最后一行没有下一步"把整份存档判坏。
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
  // 结构对不上就当没有：一份坏存档不该让首页崩掉。
  // 这里逐项校验，而不是只看"看起来像" —— 一个 stage=2.5 就能让
  // `STAGES[stage-1].name` 抛异常，后果是首页每帧都渲染失败。
  if (!isRecord(s) || s.v !== 7) return null;
  if (!Number.isInteger(s.stage) || s.stage < 1 || s.stage > STAGES.length) return null;
  if (s.mode !== null && !(typeof s.mode === 'string' && !!MODE_BY_ID[s.mode as ModeId])) return null;
  if (!isNum(s.hp) || !isNum(s.maxHp) || s.hp <= 0 || s.maxHp <= 0 || s.hp > s.maxHp) return null;
  if (!Array.isArray(s.map) || s.map.length !== STAGE_ROWS) return null;
  // 节点坐标必须和它在数组里的位置对得上：`enterNode` 用 key 里的 r/i 去
  // `G.map[r][i]` 取节点，`drawMap` 又用 nd.r / nd.col 画位置。一份 key 指向
  // 别的格子的存档能过形状校验，但点下去取到的是 undefined。
  if (!s.map.every((row, r) => Array.isArray(row)
    && row.length > 0 && row.length <= 3
    && row.every((nd, i) => isMapNode(nd)
      && nd.r === r && nd.i === i && nd.key === `${r}:${i}`
      && (nd.col as number) >= 0 && (nd.col as number) <= 2))) return null;
  // 入口和 Boss 是两张固定卡：genStage 从不在这两行放第二个节点。
  // 坏存档在这两行塞别的类型，地图上没有可点的下一步。
  if (s.map[0].length !== 1 || s.map[0][0].type !== 'fight') return null;
  if (s.map[STAGE_ROWS - 1].length !== 1 || s.map[STAGE_ROWS - 1][0].type !== 'boss') return null;
  // 连线目标必须落在下一行里：一个 next:[99] 能通过节点形状校验，
  // 但 drawMap 读 G.map[r+1][99] 时会直接抛异常。
  for (let r = 0; r < s.map.length - 1; r++) {
    for (const nd of s.map[r]) {
      if (!Array.isArray(nd.next)) return null;
      for (const j of nd.next) {
        if (!s.map[r + 1][j]) return null;
      }
    }
  }
  // 牌组现在是一串 card id，精炼过的那一张带 `+` 后缀（见 `CardId`）。
  // 旧存档里的 `{ id, up }` 对象和 `upgraded` 表在换格式时已经整份作废
  // （抬了 KEY 的版本号），所以这里不需要兼容那一层 —— 存档本来就不追求向后兼容。
  if (!Array.isArray(s.deck) || !s.deck.length) return null;
  if (!s.deck.every(isCardId)) return null;
  // 旧题库时代的题干前缀 id → 稳定短键；迁移表还会被记忆文件用到，所以留着。
  // 迁移要在**剥后缀之前**做：老 id 是整串，`+` 只可能出现在我们自己的短键上。
  s.deck = s.deck.map((id) => {
    const up = id.endsWith('+');
    const base = up ? id.slice(0, -1) : id;
    const mapped = LEGACY_CARD_IDS[base] ?? base;
    return up ? mapped + '+' : mapped;
  });
  // 已经删掉的「错题本」：只去掉这一张，不因为一张卡丢掉整局。
  s.deck = s.deck.filter((id) => baseIdOf(id) !== 'pow:log');
  if (!s.deck.length || !s.deck.every((id) => isKnownCardId(id))) return null;
  // 增益：只能是认识的 id，而且不能重复（池子里每种一个）。
  if (!Array.isArray(s.powers)) return null;
  if (!s.powers.every((id) => typeof id === 'string' && !!POWER_BY_ID[id])) return null;
  if (new Set(s.powers).size !== s.powers.length) return null;
  if (!isBoolRecord(s.seen) || !isNonNegRecord(s.topicWrong)) return null;
  // 「每幕一次」/「整局一次」的账：只认认识的 PowerId。
  // 不认识的直接判坏档比静默忽略安全 —— 静默忽略会让那张牌在读档后重新可用。
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
