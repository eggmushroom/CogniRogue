/** 领域模型。这一层不认识 canvas，也不认识 DOM。 */

/**
 * 一道题的认知层级。题库里 `? 理解:` / `? 迁移:` 这类前缀由解析层写进来，
 * 没写就是 undefined（老包不用改）。目前只存不用：留给「出题梯度」和
 * 「按难度分档的答错代价」这条线，重构阶段不改变任何规则。
 */
export type QLevel = 'recall' | 'understand' | 'transfer';

/**
 * 一局的模式。**每局开始前由玩家选**，不随卡片进度自动切换。
 *
 * 三种模式只改「答错这一手要付多少钱」，不改卡面数值、不改题库、不改已经攒下的记忆。
 * 学习 = 允许犯错；复习 = 要求稳；测试 = 错了要付全价。
 */
export type RunMode = 'learn' | 'review' | 'test';

export interface ModeDef {
  key: RunMode;
  name: string;
  tag: string;
  color: string;
  /** 答错时按卡面格挡补偿的比例：1 = 全额，0.5 = 半额，0 = 不补 */
  missBlock: number;
  /** 答错时稳固度乘数 */
  stabDrop: number;
  /** 答对时稳固度增益系数：1 = 原来的 ×1.8/+1 */
  stabGain: number;
  /** 答错后这张牌去哪 */
  missDest: 'draw' | 'discard';
  /** 答错后这个卡种本场是否作废（测试模式） */
  forget: boolean;
  /** 卡面下沿那句"这一手值多少" */
  cardLabel: string;
  /** 答题面板底部那句提醒 */
  hint: string;
}


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
export type CardKind = 'knowledge' | 'power' | 'junk' | 'basic';

/**
 * 卡牌的**类别**：攻击 / 防御 / 技能 / 能力。
 *
 * 这是和 `CardKind`（身份）不同的一条轴：
 *   - 身份回答"这张牌要不要答题、能不能被获取"（基础牌 / 知识卡 / 增益 / 杂念）；
 *   - 类别回答"它在这一局里干什么"（打伤害 / 堆格挡 / 改节奏 / 本场持续）。
 *
 * 知识卡按效果自动归类（见 `cards/kinds.ts` 的 `cardType()`）：
 * 猛击·洞察·串联·内化 = 攻击，巩固 = 防御，专注 = 技能，增益牌 = 能力。
 */
export type CardType = 'attack' | 'defense' | 'skill' | 'power';

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
 * 出牌费用。0–3 点，或者 `'x'` —— 花光这一回合剩下的**全部**行动力，
 * 效果按花掉的点数结算（花 3 点就打 3 次）。写法跟杀戮尖塔一样。
 *
 * 不写 = 1 点：这一版之前 83 张牌清一色 1 点，省略字段就等于原价，
 * 旧卡表和旧存档都不必改。
 */
export type CardCost = 0 | 1 | 2 | 3 | 'x';

/**
 * 增益（power）。它曾经是"遗物"——挂在界面右上角的一排小圆点，永远生效、不可交互。
 *
 * 现在它是一张牌：进牌组、抽到手、花行动力打出去，本场战斗剩下的时间里一直亮着。
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
  /** 打出它要付几点行动力。增益牌不答题，所以这笔钱不退。 */
  cost: CardCost;
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
  /** 效果底数：伤害与格挡的基数，实际值由 effect 折算 */
  atk: number;
  blk: number;
  /**
   * 打出这张牌要付的行动力。不写 = 1。
   *
   * 这个数现在同时是**两件事**的价格：上手要付得起（不够打不出去），押错了要赔
   * （答错一分不退）。所以高费牌是"一次答题换一大笔输出"的高赔率赌注，
   * 低费牌是"稳着打"的小注。
   */
  cost?: CardCost;
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
  /** 类别（攻击/防御/技能/能力）。不写就按 kind + eff 自动推导，见 cardType()。 */
  type?: CardType;
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
  /** 这一局玩的模式 —— 结算页要写清楚"刚才那局是按哪档结算的" */
  mode: RunMode;
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
  /** 牌组里的增益牌（名字），没有就是空数组 */
  powers: string[];
  verdict: string;
}

export type Panel =
  | { k: 'none' }
  /** 开局前选模式：学习 / 复习 / 测试 */
  | { k: 'mode' }
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
  /** 这一局开始前选定的模式；整局不变，换模式必须重开一局 */
  mode: RunMode;
  panel: Panel;
  log: LogLine[];
  deck: CardInst[];
  /**
   * 本场战斗已经打出去的增益牌。跨场清空 —— 增益牌每场都要重新抽、重新付费用，
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
   * 本场已经作废的卡种 —— 测试模式答错的那几张。
   *
   * 和 `failedTurn` 是两档惩罚：failedTurn 只锁一个回合（看看答案还能再试），
   * 这一档锁整场（测试模式答错 = 这一次没通过）。作废的牌既不能答题、也打不出去，只能等这一场结束。
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
  /**
   * 本回合答对了「本局错得最多的主题」—— 存主题名，不是计数。
   *
   * 遗忘 Boss 的 -3 是"这一回合"的，所以每回合清零；存主题而不是布尔，
   * 是因为 topTopic() 可能在同一回合里被新的错误改写，结算时要重新对一次。
   */
  topOkTopic: string | null;
  cardsPlayed: number;
  binderUsed: boolean;
  /** 本局免答出牌次数 / 解锁次数。只给结算页用，不参与任何结算 */
  frees: number;
  unlocks: number;
  runOk: number;
  runBad: number;
  floors: number;
  pending: null | 'clear' | 'win' | 'dead';
  busy: boolean;
}
