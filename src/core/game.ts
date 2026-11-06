import { parseAny } from './content';
import { EFFS, resolveEff } from './effects';
import { BAL, FOES, NODE_META, POWERS, POWER_BY_ID } from './data';
import type {
  CardDef, CardInst, Eff, EventDef, Foe, MapNode, MemEntry, NodeType, Pack, PowerDef, PowerId,
  Question,
} from './types';
import { clamp, pick, shuffle } from './util';

/* ────────────────────────────────────────────────────────────
   逻辑层刻意不认识 canvas / DOM。表现层通过 onFx 订阅"发生了什么"，
   自己决定怎么演。好处是同一套规则能跑无头模拟（tools/sim.ts）。
   ──────────────────────────────────────────────────────────── */

export type GameEvent =
  | { t: 'dmg'; n: number; absorbed: number; eff?: Eff; seq?: number }
  | { t: 'blk'; n: number }
  /** 玩家自己受伤（事件选项扣血）。敌人打的那一下不走这里，见 enemyAct。 */
  | { t: 'hurt'; n: number }
  | { t: 'heal'; n: number }
  /**
   * 敌人这一回合做了什么。
   *
   * 刻意把"动作"而不是"结果"作为事件：以前只有掉血才发 hurt，于是格挡全挡下、
   * 举盾、塞杂念、变强、观察期全都是静默的 —— 玩家只能从日志里倒推敌人动过。
   * 现在每个分支都发一次，表现层按 k 编排身体动作和飞行物。
   */
  | {
      t: 'enemyAct';
      k: 'atk' | 'def' | 'jam' | 'buff' | 'calm';
      /** 主数值：伤害 / 护甲 / 杂念张数 / 攻击加成 */
      n: number;
      /** 攻击段数，多段要分几次飞出去 */
      times?: number;
      /** 实际掉血；0 表示被格挡全挡下，表现层要演"撞在盾上"而不是"挨了一下" */
      taken?: number;
      absorbed?: number;
    }
  /** 打出一张增益牌：表现层让它飞向顶栏的增益槽，而不是弃牌堆 */
  | { t: 'power'; id: PowerId }
  /** 答错：这一手打出去了，但没到 —— 表现层让它半路散掉 */
  | { t: 'fizzle'; eff?: Eff }
  | { t: 'kill' }
  | { t: 'clear' }
  | { t: 'shake'; power: number };

type FxListener = (e: GameEvent) => void;
const fxListeners: FxListener[] = [];
export function onFx(l: FxListener) {
  fxListeners.push(l);
}
function emit(e: GameEvent) {
  for (const l of fxListeners) l(e);
}

/* ── 知识包 / 记忆 ────────────────────────────────────────── */

/** 由宿主（浏览器入口 / 无头模拟）注入，core 自己不碰文件系统。 */
export let PACK: Pack = { name: '未命名知识包', cards: [] };

const LS_KEY = 'cognirogue.v1';

function loadMem(): Record<string, MemEntry> {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? '{}') as Record<string, MemEntry>;
  } catch {
    return {};
  }
}
function saveMem() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(MEM));
  } catch {
    /* 隐私模式下写不进去，不影响这一局 */
  }
}

export let MEM: Record<string, MemEntry> = loadMem();

export function memOf(id: string): MemEntry {
  if (!MEM[id]) MEM[id] = { stab: 1, due: 0, reps: 0, lapses: 0, ok: 0, bad: 0 };
  return MEM[id];
}

export const topics = () => [...new Set(PACK.cards.map((c) => c.topic))];

export function loadPack(text: string): { ok: boolean; msg: string } {
  try {
    const p = parseAny(text);
    if (!p.cards.length) return { ok: false, msg: '没有解析出任何卡片。检查 ### 与 A) 的写法。' };
    PACK = p;
    return { ok: true, msg: `载入「${p.name}」：${p.cards.length} 张卡 / ${topics().length} 个主题` };
  } catch (err) {
    return { ok: false, msg: '解析失败：' + (err as Error).message };
  }
}

export function resetMemory() {
  MEM = {};
  saveMem();
}

/* ── 状态 ────────────────────────────────────────────────── */

export interface Feedback {
  idx: number;
  /** 这一手问的是题库里的第几道 */
  qi: number;
  choice: number;
  right: boolean;
  quick: boolean;
  /** 总伤害（分段结算后相加） */
  dmg: number;
  absorbed: number;
  blk: number;
  /** 这一手触发的是哪种效果 */
  eff: Eff;
  /** 每段伤害，串联会是两段 */
  hits: number[];
  /** 内化回的血 */
  heal: number;
  /** 专注抽的牌 */
  draw: number;
  apNote: string;
  explain: string;
  question: string;
  options: string[];
  answer: number;
  topic: string;
}

export interface ReportRow { t: string; ok: number; bad: number; mast: number }

export interface ReportData {
  win: boolean;
  floor: number;
  runOk: number;
  runBad: number;
  floors: number;
  deckSize: number;
  /** 结算时牌组里有几种卡种 */
  kinds: number;
  mastery: number;
  rows: ReportRow[];
  /** 免答出牌次数：这一局有多少输出是"已经会了"直接兑现的 */
  frees: number;
  /** 本局一共解锁过多少种卡 */
  unlocks: number;
  /** 学习期 / 复习期各答错了几次 —— 同一个错误，两种价码 */
  learnMiss: number;
  reviewMiss: number;
  /** 牌组里的增益牌（名字），没有就是空数组 */
  powers: string[];
  verdict: string;
}

export type Panel =
  | { k: 'none' }
  | { k: 'question'; idx: number; qi: number }
  | { k: 'feedback'; fb: Feedback }
  | { k: 'reward'; cards: CardDef[] }
  | { k: 'power'; pool: CardDef[] }
  | { k: 'rest' }
  | { k: 'cardpick'; mode: 'up' | 'rm' }
  | { k: 'event'; ev: EventDef }
  | { k: 'deck' }
  | { k: 'pile'; kind: 'draw' | 'discard' }
  | { k: 'help' }
  | { k: 'pack'; msg: string; ok: boolean }
  | { k: 'report'; data: ReportData };

export interface LogLine { msg: string; kind: '' | 'hi' | 'bad' | 'turn' }

export interface GameState {
  screen: 'title' | 'map' | 'battle' | 'report';
  panel: Panel;
  log: LogLine[];
  deck: CardInst[];
  /**
   * 本场战斗已经打出去的增益牌。跨场清空 —— 增益牌每场都要重新抽、重新付 1 点行动力，
   * 这正是它和旧"遗物"（整局白给）最本质的区别。
   */
  powers: PowerId[];
  hp: number;
  maxHp: number;
  block: number;
  ap: number;
  apMax: number;
  turn: number;
  enemy: Foe | null;
  draw: CardInst[];
  discard: CardInst[];
  hand: CardInst[];
  map: MapNode[][];
  pos: { r: number; i: number } | null;
  node: MapNode | null;
  seen: Record<string, boolean>;
  topicAtk: Record<string, number>;
  /**
   * 本场战斗里已经解锁的卡种（key 是 card id，不是牌组里的那一张）。
   * 上锁 → 必须答对一次才能用；解锁 → 同种的所有副本都可以免答直接打出。
   * 每场战斗重来一次，精炼过的卡（up）开局就是解锁状态。
   */
  unlocked: Record<string, boolean>;
  /** 本回合已经试过并且答错的卡种：这一回合内不能再答（防止看答案后用副本重答） */
  failedTurn: Record<string, boolean>;
  /**
   * 本场已经作废的卡种 —— 复习期答错的那几张。
   *
   * 和 `failedTurn` 是两档惩罚：failedTurn 只锁一个回合（学习期答错，下回合再来），
   * 这一档锁整场（复习期答错 = 这一次你没记住）。作废的牌仍然能快攻，不然手牌会堵死。
   */
  forgotten: Record<string, boolean>;
  /**
   * 本场战斗里每个卡种已经问过的题号。题库通常有 2–5 道，问完之前不重复 ——
   * 同一个知识点被从不同角度问，才谈得上"记住"，而不是背下一道题的答案。
   */
  qSeen: Record<string, number[]>;
  topicWrong: Record<string, number>;
  okThisTurn: number;
  topOk: number;
  cardsPlayed: number;
  binderUsed: boolean;
  /** 本局免答出牌次数 / 解锁次数。只给结算页用，不参与任何结算 */
  frees: number;
  unlocks: number;
  runOk: number;
  runBad: number;
  floors: number;
  /** 这一局答错了几次、其中多少次是在复习期答错的。结算页用它解释"哪一类错更贵" */
  learnMiss: number;
  reviewMiss: number;
  pending: null | 'clear' | 'win' | 'dead';
  busy: boolean;
}

export const G: GameState = {
  screen: 'title', panel: { k: 'none' }, log: [], deck: [], powers: [],
  hp: BAL.baseHp, maxHp: BAL.baseHp, block: 0, ap: BAL.baseAp, apMax: BAL.baseAp,
  turn: 1, enemy: null, draw: [], discard: [], hand: [],
  map: [], pos: null, node: null, seen: {}, topicAtk: {},
  unlocked: {}, failedTurn: {}, qSeen: {}, forgotten: {},
  topicWrong: {}, okThisTurn: 0, topOk: 0,
  cardsPlayed: 0, binderUsed: false, frees: 0, unlocks: 0,
  runOk: 0, runBad: 0, floors: 0, learnMiss: 0, reviewMiss: 0,
  pending: null, busy: false,
};

const JUNK: CardDef = {
  id: '__junk', topic: '杂念', name: '杂念', q: '', atk: 0, blk: 0, eff: 'strike', junk: true, qs: [],
};

/**
 * 增益牌走和知识卡完全相同的通道：同样的牌组、同样的手牌、同样的 defOf。
 * 区别只有两处 —— 它不出题（`qs` 为空），以及打出之后本场一直亮着（进 G.powers 而不是弃牌堆）。
 * 把"遗物"做成牌，最省事的做法就是让它在数据结构上也真的是牌。
 */
export const powerCardId = (id: PowerId) => 'pow:' + id;

const POWER_CARD: Record<string, CardDef> = Object.fromEntries(
  POWERS.map((p): [string, CardDef] => [powerCardId(p.id), {
    id: powerCardId(p.id), topic: '增益', name: p.name, q: '',
    atk: 0, blk: 0, eff: 'strike', qs: [], power: p.id,
  }]),
);

export const defOf = (ent: CardInst | null | undefined): CardDef => {
  if (!ent) return JUNK;
  if (ent.junk) return JUNK;
  return PACK.cards.find((c) => c.id === ent.id) ?? POWER_CARD[ent.id] ?? JUNK;
};

export const powerCardOf = (id: PowerId): CardDef => POWER_CARD[powerCardId(id)];
export const powerOf = (c: CardDef | null | undefined): PowerDef | null =>
  c && c.power ? POWER_BY_ID[c.power] : null;

/** 本场是否已经打出过这种增益牌。 */
export const hasPower = (id: PowerId) => G.powers.includes(id);
export const powerById = (id: string): PowerDef | null => POWER_BY_ID[id] ?? null;

/** 牌组里有哪些增益牌（去重）。地图页和结算页要显示"这一局带了什么进场"。 */
export function deckPowers(): PowerDef[] {
  const seen: Record<string, boolean> = {};
  G.deck.forEach((e) => { seen[e.id] = true; });
  return Object.keys(seen)
    .map((id) => POWER_CARD[id]?.power)
    .filter((p): p is PowerId => !!p)
    .map((p) => POWER_BY_ID[p]);
}

export function statOf(ent: CardInst) {
  const d = defOf(ent);
  const up = ent.up ? 3 : 0;
  return {
    atk: (d.atk || 0) + up + (G.topicAtk[d.topic] || 0),
    blk: (d.blk || 0) + up,
  };
}

export function log(msg: string, kind: LogLine['kind'] = '') {
  G.log.push({ msg, kind });
  if (G.log.length > 60) G.log.shift();
}

/* ── 地图 ────────────────────────────────────────────────── */

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

export function availableNodes(): string[] {
  if (!G.map.length) return [];
  if (!G.pos) return G.map[0].map((nd) => nd.key);
  const nd = G.map[G.pos.r][G.pos.i];
  return (nd.next || []).map((j) => `${G.pos!.r + 1}:${j}`);
}

/* ── 开一局 ──────────────────────────────────────────────── */

export function startRun() {
  for (const id in MEM) MEM[id].due -= 1;
  saveMem();

  /**
   * 起始牌组：**逾期该复习的先上，然后是没碰过的新卡，最后是还没到期的**。
   *
   * 这里以前只按 `due` 升序取前 10 —— 新卡的 due 一直是 0 并随局数一起递减，
   * 于是永远排在学过的卡前面，结果就成了"掌握得越好的卡越不会再出现"，
   * 和"该复习的必须出现"正好相反。复习期那档惩罚要能生效，这个分桶必须先修对。
   */
  const bucket = (c: (typeof PACK.cards)[number]) => {
    const m = memOf(c.id);
    if (m.ok === 0 && m.bad === 0) return 1; // 从没碰过：等逾期卡排完再上
    return m.due <= 0 ? 0 : 2;              // 0 逾期 / 2 还没到期
  };
  const sorted = PACK.cards.slice().sort(
    (a, b) => bucket(a) - bucket(b) || memOf(a.id).due - memOf(b.id).due,
  );
  const deck = sorted.slice(0, Math.min(10, sorted.length)).map((c) => ({ id: c.id, up: 0 }));

  Object.assign(G, {
    screen: 'map', panel: { k: 'none' }, log: [], deck,
    draw: [], discard: [], hand: [],
    map: genMap(), pos: null, seen: {}, node: null,
    hp: BAL.baseHp, maxHp: BAL.baseHp, block: 0,
    ap: BAL.baseAp, apMax: BAL.baseAp, turn: 1, enemy: null,
    powers: [], topicAtk: {}, unlocked: {}, failedTurn: {}, qSeen: {}, forgotten: {},
    topicWrong: {},
    okThisTurn: 0, topOk: 0, cardsPlayed: 0, binderUsed: false,
    frees: 0, unlocks: 0,
    runOk: 0, runBad: 0, floors: 0, learnMiss: 0, reviewMiss: 0, pending: null, busy: false,
  } satisfies Partial<GameState>);

  log('── 你走进记忆的档案馆 ──', 'turn');
}

/* ── 节点 ────────────────────────────────────────────────── */

export function enterNode(key: string) {
  if (G.busy || G.screen !== 'map' || G.panel.k !== 'none') return;
  if (!availableNodes().includes(key)) return;
  const [r, i] = key.split(':').map(Number);
  const nd = G.map[r][i];
  G.node = nd;
  G.seen[key] = true;
  if (nd.type === 'rest') { G.panel = { k: 'rest' }; return; }
  if (nd.type === 'event') { G.panel = { k: 'event', ev: pick(EVENTS) }; return; }
  startBattle(nd);
}

function makeFoe(tpl: (typeof FOES)[number], type: NodeType, r: number): Foe {
  const k = type === 'boss' ? 1 : type === 'elite' ? 1 + r * 0.055 : 1 + r * 0.075;
  const hp = Math.round(tpl.hp * k * BAL.hp);
  return {
    ...tpl,
    maxHp: hp,
    hp,
    dmg: Math.round(tpl.dmg * k * BAL.dmg),
    block: 0,
    mv: 0,
    buff: 0,
  };
}

/* ── 解锁 ────────────────────────────────────────────────── */

/** 卡种是否已解锁。key 是 card id：同种的多张牌共享一个锁。 */
export const isUnlocked = (id: string) => !!G.unlocked[id];

/**
 * 这张卡在不在「复习期」—— 看的是记忆稳固度，不是"做过几遍"。
 *
 * 稳固度会掉（答错一次 ×0.4），所以一张卡只能靠"连续答对"爬进复习期，
 * 再错一次就自己退回学习期。惩罚因此是自限的：同一张牌不会一直坑你。
 *
 * 刻意不做成全局模式开关：一副牌里永远同时有学过的和没学过的，惩罚按卡算，
 * 才谈得上"按学习阶段分档"；否则要么整局太软，要么整局太硬，而且"复习模式"
 * 配一副全新牌组本身就没有意义。
 */
export function isReview(id: string): boolean {
  return memOf(id).stab >= BAL.reviewStab;
}

/** 学习期 / 复习期。表现层拿它决定卡面下沿写哪一句规则。 */
export const phaseOf = (id: string): 'learn' | 'review' => (isReview(id) ? 'review' : 'learn');

/**
 * 记忆条的归一化。
 *
 * 用 `stab / (stab + 2×门槛)` 而不是线性除：这样复习期的门槛**正好落在 1/3**，
 * 而且越往上越平 —— 稳固度能长到 60，线性归一的话十几点就顶到 100%，
 * 一张"刚学会"的牌和一张"滚瓜烂熟"的牌看上去一模一样。
 */
export const memRatio = (id: string) => {
  const s = Math.max(0, memOf(id).stab);
  return s / (s + BAL.reviewStab * 2);
};

/** 这一场这个卡种是不是已经因为复习期答错而作废。 */
export const isForgotten = (id: string) => !!G.forgotten[id];

/** 牌组里有多少"卡种"、其中多少个这场已经解锁 —— 画在顶栏上。 */
export function unlockStats() {
  // 增益牌没有锁，不该进分母：否则拿了三张增益牌，顶栏就变成"永远差三种解锁"
  const ids = new Set(G.deck.filter((e) => !POWER_CARD[e.id]).map((e) => e.id));
  let n = 0;
  ids.forEach((id) => { if (G.unlocked[id]) n += 1; });
  return { n, total: ids.size };
}

/** 这张牌这回合还能不能答题（没解锁、没作废、且这回合没答错过）。 */
export function canAsk(ent: CardInst | null | undefined): boolean {
  if (!ent) return false;
  const card = defOf(ent);
  if (!card || card.junk || !card.qs.length) return false;
  if (G.unlocked[card.id]) return false;
  if (G.forgotten[card.id]) return false;
  return !G.failedTurn[card.id];
}

export function startBattle(nd: MapNode) {
  const pool = FOES.filter((f) => f.type === nd.type);
  const e = makeFoe(pick(pool.length ? pool : FOES), nd.type, nd.r);

  G.screen = 'battle';
  G.enemy = e;
  G.panel = { k: 'none' };
  G.pending = null;
  G.busy = false;
  G.turn = 1;
  G.topOk = 0;
  G.okThisTurn = 0;
  G.cardsPlayed = 0;
  G.binderUsed = false;
  G.draw = shuffle(G.deck);
  G.discard = [];
  G.hand = [];

  // 全部上锁，只有精炼过的卡例外 —— 精炼 = 这个知识已经证明过，开局就能用
  G.unlocked = {};
  G.failedTurn = {};
  G.forgotten = {};
  G.qSeen = {};
  G.deck.forEach((ent) => { if (ent.up) G.unlocked[ent.id] = true; });

  // 增益牌每场都要重新打一遍。这一行就是"遗物 → 牌"的整个差别所在。
  G.powers = [];
  // 沙漏会抬高行动力上限，那是"本场"的上限 —— 不清回去，第二场就会凭空多 1 点
  G.apMax = BAL.baseAp;

  G.block = BAL.startBlock;

  log(`── ${e.name} 出现了 ──`, 'turn');
  const pre = unlockStats().n;
  if (pre) log(`${pre} 张精炼过的卡开局即可使用`, 'hi');
  else log('所有卡都是锁着的 —— 答对才能解锁', 'turn');
  if (G.block) log(`开局 ${G.block} 点格挡`, 'hi');
  startTurn();
}

export function startTurn() {
  // 沙漏已经在 playPower 里把 apMax 抬高了，这里不再额外加 ——
  // 上限和当前值必须是同一个数，否则能量球会显示成 4 / 3。
  G.ap = G.apMax;
  // 长明灯：格挡不跨回合，所以它每回合都得重新点一次 —— 3 点是"打不空"的下限
  G.block = hasPower('lamp') ? BAL.lampBlock : 0;
  G.okThisTurn = 0;
  G.cardsPlayed = 0;
  G.binderUsed = false;
  // 答错锁的是"这一回合"，新回合重新给机会
  G.failedTurn = {};
  // 杂念不进入弃牌堆：它是虚无的，回合结束就散
  G.hand.forEach((c) => { if (!c.junk) G.discard.push(c); });
  G.hand = [];
  drawTo(BAL.handSize + (hasPower('index') ? 1 : 0));
  log(`回合 ${G.turn} 开始`, 'turn');
}

export function drawTo(n: number) {
  while (G.hand.length < n) {
    if (!G.draw.length) {
      if (!G.discard.length) break;
      G.draw = shuffle(G.discard);
      G.discard = [];
      log('弃牌堆重新洗入牌堆', 'turn');
    }
    G.hand.push(G.draw.pop()!);
  }
}

function drawCards(n: number) {
  let got = 0;
  while (n-- > 0) {
    if (!G.draw.length) {
      if (!G.discard.length) break;
      G.draw = shuffle(G.discard);
      G.discard = [];
    }
    G.hand.push(G.draw.pop()!);
    got += 1;
  }
  return got;
}

export function topTopic(): string | null {
  let best: string | null = null;
  let n = 0;
  for (const t in G.topicWrong) if (G.topicWrong[t] > n) { n = G.topicWrong[t]; best = t; }
  return best;
}

/* ── 出牌 ────────────────────────────────────────────────── */

/**
 * 从这张卡的题库里挑一道。优先问本场还没问过的 —— 一个知识点有三道题，
 * 第一次蒙对和三次都答对，含金量不一样。
 */
function pickQi(card: CardDef): number {
  const n = card.qs.length;
  if (n <= 1) return 0;
  const seen = G.qSeen[card.id] || [];
  const fresh: number[] = [];
  for (let i = 0; i < n; i++) if (seen.indexOf(i) < 0) fresh.push(i);
  const pool = fresh.length ? fresh : Array.from({ length: n }, (_, i) => i);
  return pool[Math.floor(Math.random() * pool.length)];
}

/** 点一张锁着的牌 = 出题。押注没了，所以点下去没有中间那一步。 */
export function askCard(idx: number) {
  if (G.busy || G.panel.k !== 'none' || G.ap <= 0) return;
  const ent = G.hand[idx];
  if (!ent) return;
  const card = defOf(ent);
  if (!card || card.junk || !card.qs.length) return;
  // 已解锁的卡不出题，走 playUnlocked；这回合答错过、或整场已作废的卡种也不能再答
  if (G.unlocked[card.id] || G.failedTurn[card.id] || G.forgotten[card.id]) return;
  const qi = pickQi(card);
  // 题号在"点开"这一下就记下，不等答完。否则玩家可以点开看一眼、Esc 关掉、再点开换一道，
  // 等于免费挑题 —— 和押注时代"读完三档再挑最好答的那道"是同一个漏洞。
  G.qSeen[card.id] = (G.qSeen[card.id] || []).concat([qi]);
  G.panel = { k: 'question', idx, qi };
}

export function cancelPanel() {
  if (G.panel.k === 'question' || G.panel.k === 'deck' || G.panel.k === 'pile'
      || G.panel.k === 'help' || G.panel.k === 'pack') {
    G.panel = { k: 'none' };
  }
}

function damageEnemy(raw: number, pierce = false) {
  const e = G.enemy!;
  let n = raw;
  let absorbed = 0;
  // 洞察绕过格挡：连"被吸收"这件事都不会发生，敌人那层防御直接不参与结算
  if (!pierce && e.block > 0) { absorbed = Math.min(e.block, n); e.block -= absorbed; n -= absorbed; }
  e.hp -= n;
  return { dealt: n, absorbed };
}

function checkPending() {
  if (!G.enemy) return;
  if (G.enemy.hp <= 0) G.pending = G.node && G.node.type === 'boss' ? 'win' : 'clear';
  else if (G.hp <= 0) G.pending = 'dead';
}

/**
 * 一张卡真正打出去的那一下。mult 是倍率（未解锁的答题出牌传 1，
 * 已解锁的免答出牌传 BAL.freeMult）。答题、免答、快攻三条路都从这里走，
 * 数值才不会出现"卡面和结算对不上"。
 */
function strikeWith(ent: CardInst, mult: number) {
  const card = defOf(ent);
  const st = statOf(ent);
  const out = resolveEff(card.eff, st.atk, st.blk, mult);
  const parts: { d: number; a: number }[] = [];
  let dmg = 0;
  let absorbed = 0;
  for (const hit of out.hits) {
    const r = damageEnemy(hit, out.pierce);
    dmg += r.dealt;
    absorbed += r.absorbed;
    parts.push({ d: r.dealt, a: r.absorbed });
  }
  if (out.blk) G.block += out.blk;
  let heal = 0;
  let drawn = 0;
  if (out.healRatio > 0) {
    heal = Math.max(1, Math.round(dmg * out.healRatio));
    G.hp = Math.min(G.maxHp, G.hp + heal);
  }
  if (out.draw > 0) drawn = drawCards(out.draw);
  return { out, dmg, absorbed, blk: out.blk, heal, drawn, parts };
}

export function answer(choice: number) {
  if (G.panel.k !== 'question' || G.busy) return;
  const { idx, qi } = G.panel;
  const ent = G.hand[idx];
  if (!ent) return;
  const card = defOf(ent);
  const t: Question = card.qs[qi];
  // 键盘数字键会直接打进来，越界的选项不算答错 —— 手滑按到 9 不该扣行动力
  if (!Number.isInteger(choice) || choice < 0 || choice >= t.options.length) return;
  const right = choice === t.answer;
  const m = memOf(card.id);
  const st = statOf(ent);

  let dmg = 0;
  let blkGain = 0;
  let absorbed = 0;
  let heal = 0;
  let drawn = 0;
  let hits: number[] = [];
  let parts: { d: number; a: number }[] = [];
  let apNote = '';
  /** 答错的牌退回抽牌堆而不是进弃牌堆（学习期） */
  let backToDraw = false;

  if (right) {
    const r = strikeWith(ent, 1);
    hits = r.out.hits;
    dmg = r.dmg;
    absorbed = r.absorbed;
    blkGain = r.blk;
    heal = r.heal;
    drawn = r.drawn;
    parts = r.parts;
    if (drawn) apNote = join(apNote, `专注：抽 ${drawn} 张。`);

    // 答对就是解锁：之后这个卡种的所有副本都可以免答打出（×BAL.freeMult）
    if (!G.unlocked[card.id]) {
      G.unlocked[card.id] = true;
      G.unlocks += 1;
      apNote = join(apNote, `「${card.topic}」已解锁，本场免答可用。`);
    }

    G.okThisTurn += 1;
    G.runOk += 1;
    if (card.topic === topTopic()) G.topOk += 1;
    m.reps += 1;
    m.ok += 1;
    m.stab = Math.min(60, Math.max(m.stab * 1.8, m.stab + 1));
    m.due = Math.round(m.stab);
    // 荧光笔：本回合第一道答对才给牌。答对本来就是目标，所以它不给"额外奖励"，
    // 它奖励的是"这一回合你先答对了什么"这个顺序。
    if (hasPower('marker') && G.okThisTurn === 1 && drawCards(1)) {
      drawn += 1;
      apNote = join(apNote, '荧光笔：本回合第一道答对，抽 1 张。');
    }
  } else {
    // 答错的代价按这张卡的学习阶段分档 —— 学习期犯错是学费，复习期犯错是遗忘。
    // 两条都不碰血量：扣血会让人不敢碰不会的知识，正好和目的相反。
    const review = isReview(card.id);
    G.failedTurn[card.id] = true;
    blkGain = Math.max(2, Math.round(st.blk * BAL.missBlock));
    G.block += blkGain;
    apNote = join(apNote, `答错也挡住了 ${blkGain} 点。`);

    if (review) {
      // 复习期：这张牌进弃牌堆，这一场它不再自动回来 —— 想再见它得等洗牌。
      // 稳固度掉得比学习期更狠（见下），所以"忘了"这件事会跟着它回到调度里。
      G.reviewMiss += 1;
      if (BAL.reviewStrict) {
        G.forgotten[card.id] = true;
        apNote = join(apNote, '这张卡你在复习期答错：这一场它作废了，只能快攻。');
      } else {
        apNote = join(apNote, '这张卡你复习过：它进了弃牌堆，这一场不会再自动回来。');
      }
    } else {
      // 学习期：牌不进弃牌堆，回抽牌堆 —— 下一回合你一定会再抽到它。
      // 惩罚只剩"这一手作废"，不没收工具：还在学的东西，该让你再试一次。
      G.learnMiss += 1;
      if (BAL.learnForgive) {
        backToDraw = true;
        apNote = join(apNote, '这张卡还在学习期：牌回到牌堆，下一回合会再抽到它。');
      } else {
        apNote = join(apNote, '这张卡还在学习期 —— 这一手就当学费。');
      }
    }

    G.topicWrong[card.topic] = (G.topicWrong[card.topic] || 0) + 1;
    G.runBad += 1;
    m.lapses += 1;
    m.bad += 1;
    // 复习期答错掉得更狠 —— "忘了"这件事最终落在复习负担上：稳固度掉得更多、
    // 到期更早，下一局它会更靠前地排进起手牌组。惩罚不靠扣血来警告，靠日程。
    m.stab = Math.max(1, m.stab * (review ? 0.25 : 0.4));
    m.due = review ? 0 : 1;
    if (hasPower('log')) {
      const cur = G.topicAtk[card.topic] || 0;
      if (cur < 6) { G.topicAtk[card.topic] = cur + BAL.logAtk; apNote = join(apNote, `错题本：「${card.topic}」攻击 +1。`); }
    }
  }

  // 节奏结算：一张牌 1 点。答对把这一手退回来 —— 行动力买的不是"出牌次数"，
  // 而是"犯错次数"：会的人这一回合能把整把手牌打完，不会的人打三张就没油了。
  G.ap -= 1;
  G.cardsPlayed += 1;
  if (right && BAL.refundRight) {
    G.ap += 1;
    // 这条不进日志，进反馈面板：它是这一版唯一的经济规则，玩家得看得到
    apNote = join(apNote, '答对了，这一手不花行动力。');
  }

  // 装订线：每回合第一次答错把这一手退回来。答错的代价是"这回合少一张牌"，
  // 而不是"这回合什么都没发生" —— 这张牌买的就是一次容错。
  if (!right && hasPower('binder') && !G.binderUsed) {
    G.binderUsed = true;
    G.ap += 1;
    apNote = join(apNote, '装订线：这次答错不花行动力。');
  }
  G.ap = clamp(G.ap, 0, 10);

  G.busy = true;
  // 学习期答错的牌回抽牌堆（push 到尾部 = 下一张抽到的就是它）；其余都进弃牌堆
  if (backToDraw) G.draw.push(ent);
  else G.discard.push(ent);
  G.hand.splice(idx, 1);
  saveMem();

  const effName = EFFS[card.eff].name;
  const shape = hits.length > 1 ? `${hits.join('+')} 伤害` : `${dmg} 伤害`;
  log(
    `「${effName}·${card.topic}」${right ? '答对' : '答错'}` +
      (right
        ? `，${shape}${absorbed ? `（${absorbed} 被挡）` : ''}` +
          (blkGain ? `，${blkGain} 格挡` : '') +
          (heal ? `，回 ${heal}` : '') +
          (drawn ? `，抽 ${drawn}` : '')
        : `，效果作废，${blkGain} 格挡${backToDraw ? '，牌回牌堆' : G.forgotten[card.id] ? '，本场作废' : ''}`),
    right ? 'hi' : 'bad',
  );

  checkPending();

  // 串联是两下，光刃和飘字都要分两次落地，否则玩家读不出"打了两段"。
  // 第一下同步发出：表现层要靠它在本帧就知道"这一手打出去了"，
  // 反馈面板才会等演出演完再弹出来（见 main.ts 的 panelHold）。
  if (right) {
    parts.forEach((p, i) => {
      const fire = () => emit({ t: 'dmg', n: p.d, absorbed: p.a, eff: card.eff, seq: i });
      if (i === 0) fire(); else setTimeout(fire, i * 150);
    });
  } else {
    // 答错不是"什么都没发生"：抬手、甩出去、半路散掉。
    // 这一步只能由逻辑层发起（只有它知道答错了），怎么演交给表现层。
    emit({ t: 'fizzle', eff: card.eff });
  }
  const base = parts.length * 150;
  // 答错时格挡补偿稍晚一点出场：先让玩家看见"焰灭了"，再看见"但还是挡住了 3 点"。
  // 两个数字同时冒出来，会读成"答错也有收益"，把失败感冲掉。
  if (blkGain) setTimeout(() => emit({ t: 'blk', n: blkGain }), base + (right ? 60 : 220));
  if (heal) setTimeout(() => emit({ t: 'heal', n: heal }), base + 60);

  G.panel = {
    k: 'feedback',
    fb: {
      idx, qi, choice, right, quick: false,
      dmg, absorbed, blk: blkGain, eff: card.eff, hits, heal, draw: drawn, apNote,
      explain: t.explain, question: t.q, options: t.options, answer: t.answer,
      topic: card.topic,
    },
  };
}

/**
 * 已解锁的卡种直接打出去：不出题、不写记忆、伤害按 BAL.freeMult 放大。
 *
 * 这是"答对了之后这场战斗里它就归你"的那一半。没有反馈面板 —— 收割阶段
 * 要快，一下接一下，中间不能再插一个要按的框。
 */
export function playUnlocked(idx: number) {
  if (G.busy || G.panel.k !== 'none' || G.ap <= 0) return;
  const ent = G.hand[idx];
  if (!ent) return;
  const card = defOf(ent);
  if (!card || card.junk || !G.unlocked[card.id]) return;

  const r = strikeWith(ent, BAL.freeMult);
  G.ap -= 1;
  G.cardsPlayed += 1;
  G.frees += 1;
  G.ap = clamp(G.ap, 0, 10);

  G.discard.push(ent);
  G.hand.splice(idx, 1);
  checkPending();

  const shape = r.out.hits.length > 1 ? `${r.out.hits.join('+')} 伤害` : `${r.dmg} 伤害`;
  log(
    `「${EFFS[card.eff].name}·${card.topic}」免答 ×${BAL.freeMult} —— ${shape}` +
      (r.blk ? `，${r.blk} 格挡` : '') +
      (r.heal ? `，回 ${r.heal}` : '') +
      (r.drawn ? `，抽 ${r.drawn}` : ''),
    'hi',
  );

  r.parts.forEach((p, i) => {
    const fire = () => emit({ t: 'dmg', n: p.d, absorbed: p.a, eff: card.eff, seq: i });
    if (i === 0) fire(); else setTimeout(fire, i * 150);
  });
  if (r.blk) setTimeout(() => emit({ t: 'blk', n: r.blk }), 60);
  if (r.heal) setTimeout(() => emit({ t: 'heal', n: r.heal }), 60);

  // 没有反馈面板兜底，得自己锁一小会儿输入：不然连点会误花第二点行动力，
  // 而且这一下还没演完就接了下一手。顺带把击杀后的推进接上。
  G.busy = true;
  setTimeout(() => {
    G.busy = false;
    if (G.pending === 'clear') openReward();
    else if (G.pending === 'win') endRun(true);
    else if (G.pending === 'dead') endRun(false);
  }, 240);
}

/**
 * 打出一张增益牌：花 1 点行动力，本场战斗剩下的时间里一直亮着。
 *
 * 它**不进弃牌堆**。洗回去的话，同一张牌每洗一次就能再打一次，
 * 一个"本场持续"的增益会变成无限叠加。所以它从手牌里直接消失，本场不再回到循环。
 * 这也是"每场都要重新打一遍"这条规则的物理实现 —— 跨场时 G.powers 被清空。
 */
export function playPower(idx: number) {
  if (G.busy || G.panel.k !== 'none' || G.ap <= 0) return;
  const ent = G.hand[idx];
  if (!ent) return;
  const card = defOf(ent);
  const p = powerOf(card);
  if (!p) return;
  if (hasPower(p.id)) return;

  G.ap -= 1;
  G.cardsPlayed += 1;
  G.powers.push(p.id);
  G.hand.splice(idx, 1);

  // 打出那一下要有一点即时回报，否则"花 1 点上一个以后才生效的东西"永远是最差的一手
  let note = '';
  let blk = 0;
  if (p.id === 'hourglass') {
    // 上限和当前值一起涨：这一手等于免费，之后每回合都多一次出手
    G.apMax += 1;
    G.ap += 1;
    note = '行动力上限 +1，这一手不花行动力。';
  } else if (p.id === 'index') {
    if (drawCards(1)) note = '抽 1 张。';
  } else if (p.id === 'lamp') {
    blk = BAL.lampBlock;
    G.block += blk;
    note = `获得 ${blk} 点格挡。`;
  } else if (p.id === 'mirrorcard') {
    const ids = [...new Set(G.deck.map((e) => e.id))]
      .filter((id) => !G.unlocked[id] && !POWER_CARD[id]);
    if (ids.length) {
      const id = pick(ids);
      G.unlocked[id] = true;
      G.unlocks += 1;
      note = `「${defOf({ id, up: 0 }).topic}」已解锁。`;
    }
  }
  G.ap = clamp(G.ap, 0, 10);

  log(`打出增益「${p.name}」—— ${p.card}${note ? ` ${note}` : ''}`, 'hi');
  if (blk) setTimeout(() => emit({ t: 'blk', n: blk }), 60);
  emit({ t: 'power', id: p.id });

  // 短锁一下输入：否则连点会把同一张牌所在的位置误判成下一张
  G.busy = true;
  setTimeout(() => { G.busy = false; }, 180);
}

const join = (a: string, b: string) => (a ? a + ' ' : '') + b;
export function quickPlay(idx: number) {
  if (G.busy || G.panel.k !== 'none' || G.ap <= 0) return;
  const ent = G.hand[idx];
  if (!ent) return;
  const card = defOf(ent);
  if (!card || card.junk || card.power) return;

  const dmg = Math.floor(statOf(ent).atk / 2);
  damageEnemy(dmg);
  // 快攻没有"答对"，所以拿不到那一手退款 —— 绕过去也要付钱，只是付得少
  G.ap -= 1;
  G.cardsPlayed += 1;
  G.ap = clamp(G.ap, 0, 10);
  G.busy = true;
  G.discard.push(ent);
  G.hand.splice(idx, 1);
  log(`快攻「${card.topic}」，${dmg} 点伤害（未计入复习）`, '');
  checkPending();
  emit({ t: 'dmg', n: dmg, absorbed: 0, eff: card.eff, seq: 0 });

  G.panel = {
    k: 'feedback',
    fb: {
      idx, qi: 0, choice: -1, right: false, quick: true,
      dmg, absorbed: 0, blk: 0, eff: 'strike', hits: [dmg], heal: 0, draw: 0, apNote: '',
      explain: '它明年还是这个强度——你只是绕过去了，没有变强。',
      question: '快攻', options: [], answer: -1, topic: card.topic,
    },
  };
}

/* ── 敌人回合 ────────────────────────────────────────────── */

export function moveOf(e: Foe) {
  const arr = e.moves && e.moves.length ? e.moves : [{ k: 'atk' as const, m: 1 }];
  return arr[(e.mv || 0) % arr.length];
}

/** 敌人下一步的意图，画在它头顶 —— 有了这个，"该攻该守"才是可推理的决定。 */
export function intentText(e: Foe): { icon: 'attack' | 'shield' | 'junk' | 'buff'; text: string } {
  const m = moveOf(e);
  if (m.k === 'atk') {
    const dmg = Math.round(e.dmg * (m.m ?? 1)) * (m.times ?? 1);
    return { icon: 'attack', text: `${dmg}${m.times ? `×${m.times}` : ''}` };
  }
  if (m.k === 'def') return { icon: 'shield', text: `+${m.v ?? 0}` };
  if (m.k === 'jam') return { icon: 'junk', text: `${m.n ?? 1} 杂念` };
  return { icon: 'buff', text: `攻击 +${m.v ?? 0}` };
}

export function endTurn() {
  if (G.panel.k !== 'none' || G.pending || !G.enemy || G.busy) return;
  const e = G.enemy;
  e.block = 0;
  const m = moveOf(e);

  if (m.k === 'atk' && G.turn === 1 && BAL.calmFirstTurn) {
    // 第一回合所有卡都锁着，玩家几乎叠不出格挡。给它留一个观察期，
    // 不然"解锁"这件事从第一回合起就是在拿血换。
    log(`${e.name} 还在观察你，这一回合没有出手`, 'hi');
    emit({ t: 'enemyAct', k: 'calm', n: 0 });
  } else if (m.k === 'atk') {
    let dmg = Math.round(e.dmg * (m.m ?? 1)) * (m.times ?? 1);
    if (e.mech === 'reviewer' && G.okThisTurn === 0) {
      dmg += 3;
      log('复习官：你这回合没有认真答对任何一张卡，+3', 'bad');
    }
    if (e.mech === 'oblivion') {
      const t = topTopic();
      if (t) {
        dmg += 4;
        if (G.topOk > 0) { dmg -= 3; log(`遗忘：你在「${t}」上答对了，它被削弱 -3`, 'hi'); }
        else log(`遗忘：你错得最多的主题是「${t}」，它抓住这点 +4`, 'bad');
      }
    }
    let guard = G.block;
    if (e.mech === 'pierce') { guard = Math.ceil(guard / 2); log(`${e.name}：穿透了一半格挡`, 'bad'); }
    const absorbed = Math.min(guard, dmg);
    const taken = dmg - absorbed;
    G.hp -= taken;
    log(
      `${e.name} 攻击 ${dmg}${m.times ? `（${m.times} 段）` : ''} 点` +
        (absorbed ? `，格挡吸收 ${absorbed}` : '') +
        (taken ? `，你受到 ${taken} 点伤害` : '，全部挡下'),
      taken ? 'bad' : 'hi',
    );
    emit({ t: 'enemyAct', k: 'atk', n: dmg, times: m.times ?? 1, taken, absorbed });
  } else if (m.k === 'def') {
    e.block += m.v ?? 0;
    log(`${e.name} 举起格挡，获得 ${m.v} 点护甲`, 'bad');
    emit({ t: 'enemyAct', k: 'def', n: m.v ?? 0 });
  } else if (m.k === 'jam') {
    for (let i = 0; i < (m.n ?? 1); i++) G.discard.push({ id: '__junk', up: 0, junk: true });
    log(`${e.name} 往你的弃牌堆塞了 ${m.n} 张杂念`, 'bad');
    emit({ t: 'enemyAct', k: 'jam', n: m.n ?? 1 });
  } else if (m.k === 'buff') {
    e.buff += m.v ?? 0;
    e.dmg += m.v ?? 0;
    log(`${e.name} 变得更清晰了，攻击 +${m.v}`, 'bad');
    emit({ t: 'enemyAct', k: 'buff', n: m.v ?? 0 });
  }

  e.mv = (e.mv || 0) + 1;
  checkPending();
  if (!G.pending) { G.turn += 1; startTurn(); }
  G.busy = false;

  if (G.pending === 'dead') setTimeout(() => { if (G.pending === 'dead') endRun(false); }, 700);
}

/* ── 面板推进 ────────────────────────────────────────────── */

export function dismissFeedback() {
  G.busy = false;
  G.panel = { k: 'none' };
  if (G.pending === 'clear') openReward();
  else if (G.pending === 'win') endRun(true);
  else if (G.pending === 'dead') endRun(false);
}

function rewardPool(n: number): CardDef[] {
  const copies: Record<string, number> = {};
  G.deck.forEach((e) => { copies[e.id] = (copies[e.id] || 0) + 1; });
  const fresh = PACK.cards.filter((c) => !copies[c.id]);
  const room = PACK.cards.filter((c) => (copies[c.id] || 0) < BAL.maxCopies);
  // 三张必须来自不同主题：构筑的乐趣是"这一局往哪个方向堆"，不是挑三张同主题的
  const pool = shuffle(fresh).concat(shuffle(room));
  const out: CardDef[] = [];
  const used: Record<string, number> = {};
  pool.forEach((c) => {
    if (out.length < n && !used[c.topic]) { used[c.topic] = 1; out.push(c); }
  });
  pool.forEach((c) => { if (out.length < n && !out.includes(c)) out.push(c); });
  return out;
}

function openReward() {
  G.panel = { k: 'reward', cards: rewardPool(3) };
}

export function takeCard(i: number) {
  if (G.panel.k !== 'reward') return;
  const c = G.panel.cards[i];
  if (!c) return;
  G.deck.push({ id: c.id, up: 0 });
  log(`「${c.topic}」加入牌组（${G.deck.length} 张）`, 'hi');
  afterReward();
}

export function skipReward() {
  if (G.panel.k !== 'reward') return;
  afterReward();
}

/**
 * 选完知识卡之后再决定要不要看增益牌。
 *
 * 精英必给；普通战斗按 BAL.powerDrop 掉 —— 一局五场战斗大概能见着一两次。
 * 不给这个概率的话，模拟里一局只有 0.4 张增益牌：机制写得再细，玩家整局都碰不到，
 * 那就等于没做。
 */
function afterReward() {
  const t = G.node?.type;
  if (t === 'elite') { openPowerReward(); return; }
  if (t === 'fight' && Math.random() < BAL.powerDrop) { openPowerReward(); return; }
  finishNode();
}

/**
 * 精英战后的奖励。原来是"选一件遗物，直接生效一辈子"，现在变成
 * "选一张增益牌塞进牌组"——你要抽到它、花 1 点行动力打出它，它才开始工作。
 *
 * 代价换来两件事：牌组会因此变厚（稀释知识卡，这是真实的构筑成本），
 * 以及每场战斗都要重新做一次"先答题还是先点灯"的决定。
 */
function openPowerReward() {
  const owned: Record<string, boolean> = {};
  G.deck.forEach((e) => { owned[e.id] = true; });
  const pool = shuffle(POWERS.filter((p) => !owned[powerCardId(p.id)])).slice(0, 3);
  if (!pool.length) { finishNode(); return; }
  G.panel = { k: 'power', pool: pool.map((p) => POWER_CARD[powerCardId(p.id)]) };
}

export function takePower(cardId: string) {
  if (G.panel.k !== 'power') return;
  if (!G.panel.pool.some((c) => c.id === cardId)) return;
  G.deck.push({ id: cardId, up: 0 });
  const p = powerById(cardId.replace('pow:', ''));
  log(`「${p?.name ?? '增益'}」加入牌组 —— 抽到它，花 1 点行动力打出，本场生效`, 'hi');
  finishNode();
}

/** 增益牌可以不要。牌组厚度是真实的成本，所以"不拿"必须是一个选项。 */
export function skipPower() {
  if (G.panel.k !== 'power') return;
  log('你没有拿走任何东西', '');
  finishNode();
}

function finishNode() {
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
}

/* ── 复习点 / 事件 ───────────────────────────────────────── */

export function restHeal() {
  const n = Math.round(G.maxHp * 0.32);
  G.hp = Math.min(G.maxHp, G.hp + n);
  log(`休息，回复 ${n} 点生命`, 'hi');
  emit({ t: 'heal', n });
  finishNode();
}

export function openCardPick(mode: 'up' | 'rm') {
  if (mode === 'rm' && G.deck.length <= 5) { log('牌组太薄，不能再删了', ''); return; }
  G.panel = { k: 'cardpick', mode };
}

export function upgradeCard(i: number) {
  const e = G.deck[i];
  if (!e) return;
  // 增益牌没有攻/挡可加，精炼它等于白点一次
  if (defOf(e).power) return;
  e.up = 1;
  log(`「${defOf(e).topic}」被精炼：攻 +3、挡 +3`, 'hi');
  finishNode();
}

export function forgetCard(i: number) {
  const d = defOf(G.deck[i]);
  if (!d) return;
  G.deck.splice(i, 1);
  log(`你永久放下了「${d.topic}」`, '');
  finishNode();
}

/** 事件里的"得到一个增益"：同样是塞一张牌进牌组，不是白给一个永久效果。 */
function grantRandomPower(): PowerDef | null {
  const owned: Record<string, boolean> = {};
  G.deck.forEach((e) => { owned[e.id] = true; });
  const pool = POWERS.filter((p) => !owned[powerCardId(p.id)]);
  if (!pool.length) return null;
  const p = pick(pool);
  G.deck.push({ id: powerCardId(p.id), up: 0 });
  return p;
}

function healBy(n: number) {
  G.hp = Math.min(G.maxHp, G.hp + n);
  emit({ t: 'heal', n });
}
function hurtBy(n: number) {
  G.hp = Math.max(1, G.hp - n);
  emit({ t: 'hurt', n });
}

export const EVENTS: EventDef[] = [
  {
    id: 'index-cards', title: '散落的索引卡',
    text: '地上一摊被别人拆散的知识卡。墨迹还新，边缘被人反复捏过——这个人大概也在这里卡住过。',
    opts: [
      {
        t: '拾起来，收进自己的牌组', sub: '获得一张随机知识卡，已精炼（攻/挡 +3）',
        run: () => {
          const c = pick(PACK.cards);
          G.deck.push({ id: c.id, up: 1 });
          return `你把「${c.topic}」那张卡收进了牌组。`;
        },
      },
      {
        t: '按主题重新排好', sub: '回复 16 点生命——整理本身也是复习',
        run: () => { healBy(16); return '你按主题排好了它们，回了 16 点生命。'; },
      },
      { t: '绕过去', sub: '什么也不发生', run: () => '你没有碰它。' },
    ],
  },
  {
    id: 'notebook', title: '旧笔记本',
    text: '一本写着你名字的笔记本，翻开全是错的题。每一道旁边都标了当时的想法——大部分标错了。',
    opts: [
      {
        t: '一页一页看完', sub: '本局所有主题攻击 +2，但你会掉 12 点生命',
        run: () => {
          topics().forEach((t) => { G.topicAtk[t] = (G.topicAtk[t] || 0) + 2; });
          hurtBy(12);
          return '看完自己犯过的错，比做十道新题疼，但有用。';
        },
      },
      {
        t: '只翻你最近错的那几页', sub: '本局该主题攻击 +3',
        run: () => {
          const t = topTopic() || topics()[0];
          G.topicAtk[t] = (G.topicAtk[t] || 0) + 3;
          return `「${t}」的攻击 +3。`;
        },
      },
      { t: '合上，放回原处', sub: '什么也不发生', run: () => '你把它放了回去。' },
    ],
  },
  {
    id: 'keeper', title: '守夜人',
    text: '一个坐在灯下的人抬起头："想过去，留一样东西。"他没有说是什么东西。',
    opts: [
      {
        t: '把一张卡留下来', sub: '永久移除牌组里一张卡，回复 20 点生命',
        run: () => {
          if (G.deck.length > 5) {
            const i = Math.floor(Math.random() * G.deck.length);
            const d = defOf(G.deck[i]);
            G.deck.splice(i, 1);
            healBy(20);
            return `「${d.topic}」被留下了，你换回 20 点生命。`;
          }
          healBy(20);
          return '你的牌组太薄了，他只收下了 20 点生命。';
        },
      },
      {
        t: '给他 12 点生命', sub: '一张增益牌进牌组（要抽到、要打出才生效）',
        run: () => {
          hurtBy(12);
          const r = grantRandomPower();
          if (!r) { healBy(12); return '他已经没有东西可以给你了。'; }
          return `「${r.name}」进了你的牌组：${r.card}。抽到它，花 1 点行动力打出去。`;
        },
      },
      { t: '什么也不留，转身离开', sub: '什么也不发生', run: () => '他没有拦你。' },
    ],
  },
  {
    id: 'lamp-hall', title: '长明灯廊',
    text: '一整条廊道的灯都亮着，只有尽头那盏是灭的。你可以在这里坐一会儿，也可以去把那盏灯点上。',
    opts: [
      { t: '坐一会儿', sub: '回复 22 点生命', run: () => { healBy(22); return '你在灯下坐了一会儿，回了 22 点生命。'; } },
      {
        t: '去点那盏灭的灯', sub: '一张增益牌进牌组，但会掉 10 点生命',
        run: () => {
          hurtBy(10);
          const r = grantRandomPower();
          if (!r) return '灯亮了，什么也没发生。';
          return `灯亮了，牌组里多了一张「${r.name}」：${r.card}。`;
        },
      },
    ],
  },
];

export function chooseEventOption(i: number) {
  if (G.panel.k !== 'event') return;
  const msg = G.panel.ev.opts[i]?.run();
  if (msg) log(msg, 'hi');
  finishNode();
}

/* ── 结算 ────────────────────────────────────────────────── */

export function endRun(win: boolean) {
  saveMem();
  const rows: ReportRow[] = topics().map((t) => {
    const cs = PACK.cards.filter((c) => c.topic === t);
    const ok = cs.reduce((n, c) => n + memOf(c.id).ok, 0);
    const bad = cs.reduce((n, c) => n + memOf(c.id).bad, 0);
    const mast = cs.reduce((n, c) => n + clamp(memOf(c.id).stab / 25, 0, 1), 0) / cs.length;
    return { t, ok, bad, mast };
  });
  const total = rows.length ? rows.reduce((n, r) => n + r.mast, 0) / rows.length : 0;

  // 押注没了，结算页也就不再有"你押的档准不准"—— 现在只剩一个问题：
  // 这一局的伤害里，多少是你记住的，多少是你当时蒙对的那一下。
  const asks = G.runOk + G.runBad;
  const acc = asks ? G.runOk / asks : 0;
  const share = asks + G.frees ? G.frees / (asks + G.frees) : 0;
  let verdict: string;
  if (!asks) {
    verdict = '这一局你一道题都没答。战斗不是靠躲过去的 —— 下一局先点开一张牌。';
  } else if (acc >= 0.8) {
    verdict = `你答对了 ${Math.round(acc * 100)}%，${Math.round(share * 100)}% 的出牌是免答打出去的。`
      + '后半场你不是在赌，是在用记住的东西打仗 —— 这就是这套机制想要的状态。';
  } else if (acc >= 0.6) {
    verdict = `你答对了 ${Math.round(acc * 100)}%。这个区间是"半懂"：卡能解锁，但每场都要重新证明一次。`
      + '把错得最多的那个主题连着答两轮，比换一副更强的牌有用。';
  } else {
    verdict = `你答对了 ${Math.round(acc * 100)}%。牌面够强，题没记住 —— 这副牌现在是借来的。`
      + '先把牌组压薄，让同一张卡多被问几次。';
  }

  G.screen = 'report';
  G.panel = {
    k: 'report',
    data: {
      win,
      floor: G.node ? G.node.r + 1 : G.pos ? G.pos.r + 1 : 1,
      runOk: G.runOk, runBad: G.runBad, floors: G.floors, deckSize: G.deck.length,
      // 增益牌不算卡种：它没有题，混进来会把牌组的多样性说多
      kinds: new Set(G.deck.filter((e) => !POWER_CARD[e.id]).map((e) => e.id)).size,
      mastery: total, rows, frees: G.frees, unlocks: G.unlocks,
      learnMiss: G.learnMiss, reviewMiss: G.reviewMiss,
      verdict, powers: deckPowers().map((p) => p.name),
    },
  };
}

export function restart() {
  startRun();
}

export function backToTitle() {
  G.screen = 'title';
  G.panel = { k: 'none' };
  G.deck = [];
  G.powers = [];
  G.enemy = null;
  G.map = [];
  G.pos = null;
  G.log = [];
}

export { NODE_META, POWERS, FOES, BAL };
