/** 领域模型。这一层不认识 canvas，也不认识 DOM。 */

/**
 * 一道题的认知层级。题库里 `? 理解:` / `? 迁移:` 这类前缀由解析层写进来，
 * 没写就是 undefined（老包不用改）。目前只存不用：留给「出题梯度」和
 * 「按难度分档的答错代价」这条线，重构阶段不改变任何规则。
 */
export type QLevel = 'recall' | 'understand' | 'transfer';

export interface Question {
  q: string;
  options: string[];
  answer: number;
  explain: string;
  /** 见 QLevel。可选：旧题库与 JSON 题库都没有这个字段。 */
  level?: QLevel;
}

/**
 * 一次出题的「本次视图」。题库里答案是固定的，直接在屏幕上照着摆，
 * 玩家几局之后记住的就会是「这题选 A」而不是知识点本身 —— 内置包实测
 * A 占了一大半。所以每次点开牌都由 `library/question.ts` 重新排一次选项，
 * 正确答案的位置跟着一起变，并把这份视图挂在 Panel 上：
 * 题面、判定、反馈面板、键盘数字键必须读同一份，否则会「点对了却算错」。
 */
export interface QView {
  options: string[];
  answer: number;
}

/**
 * 题库 —— md 文件解析出来的全部内容，也是外部唯一能替换的东西。
 *
 * `byTopic` 只是**可选的分组提示**：主题名任意、可以重复，也可以一个都不写
 * （未分组的题进 `未分类`）。点开一张牌时优先从该卡主题的题池抽题，
 * 该池没题就回退到全部题目 —— 所以题库不限制主题，只限制格式。
 *
 * `issues` 是解析层收集的格式诊断。有任何一条，`loadQuestionBank` 就整体拒绝，
 * 而不是静默丢掉那些题：写题人得知道自己哪一行写错了。
 */
export interface QuestionBank {
  name: string;
  byTopic: Record<string, Question[]>;
  /** 格式问题（带行号与题目标识）。空数组 = 格式合格。 */
  issues?: string[];
}

/**
 * 卡牌身份 —— 管的是规则，不是数值：要不要答题、进不进记忆调度、
 * 打出之后飞向弃牌堆还是增益槽。与 `Eff`（数值怎么花）、`topic`（知识归属）
 * 是三条互相独立的轴，不要混用。
 *
 * 以前这一层没有字段，靠 `card.junk` / `card.power` 两个可选标记在十来处
 * 各自推导；现在统一由 `cards/kinds.ts` 的 `cardKind()` 判定。
 */
export type CardKind = 'knowledge' | 'power' | 'junk';

/**
 * 卡牌效果。`strike` 是基准，其余五种各偏一门：
 * 洞察破防、巩固堆挡、内化回血、串联分段、专注抽牌。
 */
export type Eff = 'strike' | 'pierce' | 'guard' | 'drain' | 'chain' | 'focus';

/**
 * 一张卡的**签名改动**：覆盖效果原型的一部分参数，让同名原型的两张卡打起来不一样。
 * 杀戮尖塔的「打击」和「重刃」都是攻击，但数值与形状各是各的 —— 这里用同样的思路：
 * `eff` 决定卡的性格（破防/堆挡/回血/分段/抽牌），`mods` 决定这一张的独有脾气。
 * 不写任何字段就完全等于原型默认值；内置卡牌库只给少数卡签名，多数卡随原型。
 */
export interface EffMods {
  /** 覆盖原型的攻击倍率 */
  atkMul?: number;
  /** 覆盖原型的格挡倍率 */
  blkMul?: number;
  /** 覆盖结算段数（串联默认 2 段，签名卡可以打 3 段） */
  times?: number;
  /** 覆盖回血比例（内化默认 0.5） */
  heal?: number;
  /** 覆盖抽牌数（专注默认 1） */
  draw?: number;
}

/**
 * 增益（power）。它曾经是"遗物"——挂在界面右上角的一排小圆点，永远生效、不可交互。
 *
 * 现在它是一张牌：进牌组、抽到手、花 1 点行动力打出去，本场战斗剩下的时间里一直亮着。
 * 这么改的理由不是换皮：遗物是白给的，牌是要抽、要花行动力、要占牌位的 ——
 * 于是"这一回合我是继续答题，还是先把灯点上"变成了一个真实的取舍，
 * 而牌组里塞多少张增益牌（= 稀释多少知识卡）也成了构筑决定。
 */
export type PowerId = 'log' | 'hourglass' | 'index' | 'binder' | 'mirrorcard' | 'lamp' | 'marker';

export interface PowerDef {
  id: PowerId;
  /** 卡面左上角的一个字 */
  icon: string;
  name: string;
  /** 完整描述：日志、悬停提示、结算页用 */
  desc: string;
  /** 卡面上的效果句，两行以内 */
  card: string;
  color: string;
}

/**
 * 一张知识卡：**只有卡面，没有题**。
 *
 * 卡面由内置的 `cards/catalog.ts` 提供，外部题库（md）碰不到它；
 * 题目在点开牌那一刻才按 `topic` 去 `library/bank` 的题池里抽。
 * 以前 `qs` 挂在卡上，等于把题库和卡牌库焊成一个对象 —— 换题库就会换掉
 * 整副牌，连 card id（当时由题干生成）都跟着失效。
 */
export interface CardDef {
  /** 稳定 id，由内置卡牌库给定，与当前题库内容无关 */
  id: string;
  topic: string;
  /**
   * 牌名：杀戮尖塔式的游戏名（如「折半之刃」「三度缔约」），印在卡面大字上。
   * 牌名刻意**不等于**知识点名 —— 它可以呼应主题，但不泄露任何一道题的答案。
   */
  name: string;
  /** 这张牌背后的知识点短名。不上手牌卡面，只在牌组/画廊里作小字副标题。 */
  kp?: string;
  /** 效果底数：伤害与格挡的基数，实际值由 effect 折算 */
  atk: number;
  blk: number;
  /** 这张卡怎么把上面的数字花出去 */
  eff: Eff;
  /** 这张卡相对效果原型的签名改动；不写就是原型默认 */
  mods?: EffMods;
  /**
   * 有值就是一张增益牌：它不出题，打出后本场持续生效。
   * 增益牌不进解锁统计、不参与记忆调度，也不吃"答对退款"。
   */
  power?: PowerId;
  junk?: boolean;
  /** 身份。工厂与解析层写入；旧 JSON 包没写时由 cardKind() 回落推导。 */
  kind?: CardKind;
}

export interface Pack {
  name: string;
  cards: CardDef[];
}

/** 牌组里的是实例：指向定义，记录是否精炼。 */
export interface CardInst {
  id: string;
  up: number;
  junk?: boolean;
}

export type MoveKind = 'atk' | 'def' | 'jam' | 'buff';

export interface Move {
  k: MoveKind;
  /** 攻击倍率 */
  m?: number;
  /** 格挡值 / buff 值 */
  v?: number;
  /** 杂念张数 */
  n?: number;
  /** 多段 */
  times?: number;
}

export type Mech = 'reviewer' | 'pierce' | 'oblivion' | 'leech' | 'lethe';

/**
 * 敌人立绘。全部是"纯黑底 + 发光主体"的 jpg，screen 混合后黑即透明；
 * 同一立绘换 hue 就是一个新怪 —— 但新机制值得配新皮，别全靠调色。
 */
export type ArtKey =
  | 'shard' | 'examiner' | 'oblivion'   // 初代三件套
  | 'moth' | 'grub' | 'inquisitor' | 'tide' | 'lethe';

export interface FoeTpl {
  key: string;
  name: string;
  type: 'fight' | 'elite' | 'boss';
  art: ArtKey;
  tag: string;
  hp: number;
  dmg: number;
  moves: Move[];
  mech?: Mech;
  hue?: number;
  hint: string;
}

export interface Foe extends FoeTpl {
  maxHp: number;
  hp: number;
  block: number;
  mv: number;
  buff: number;
}

export interface EventOpt {
  t: string;
  sub: string;
  run: () => string;
}

export interface EventDef {
  id: string;
  title: string;
  text: string;
  opts: EventOpt[];
}

export type NodeType = 'fight' | 'elite' | 'rest' | 'event' | 'boss';

export interface MapNode {
  r: number;
  i: number;
  key: string;
  col: number;
  type: NodeType;
  next: number[];
}

/** 复习调度里一条卡的记忆状态（FSRS-lite：稳定度 + 到期间隔，单位"局"）。 */
export interface MemEntry {
  stab: number;
  due: number;
  reps: number;
  lapses: number;
  ok: number;
  bad: number;
}

/* ────────────────────────────────────────────────────────────
   运行状态的类型。只描述形状，不持有实例 —— 唯一的可变状态对象
   在 `infra/state.ts`，所有工具包都通过它读写同一份 G。
   ──────────────────────────────────────────────────────────── */

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
  /** `q` 是点开那一刻从题池抽出的题目快照：答题期间题库换不掉这一手 */
  | { k: 'question'; idx: number; qi: number; topic: string; q: Question; view: QView }
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
  screen: 'title' | 'map' | 'battle' | 'report' | 'atlas';
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
   * 本场战斗里每份题池已经问过的题号。key 是 `poolFor()` 返回的键：
   * 命中主题池时是主题名，回退到全部题目时是 `GLOBAL_QKEY`。
   * 问完之前不重复，同一个知识点会被从不同角度问到，而不是背下一道题的答案。
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
