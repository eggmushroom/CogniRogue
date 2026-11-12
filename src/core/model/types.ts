/** 领域模型。这一层不认识 canvas，也不认识 DOM。 */

/** 题的认知层级，来自题库里的 `? 理解:` 前缀；目前只存不用。 */
export type QLevel = 'recall' | 'understand' | 'transfer';

/** 答错价码：三种模式共用；差异只来自开局带的增益。 */
export interface MissRule {
  /** 答错时稳固度乘数 */
  stabDrop: number;
  /** 答对时稳固度系数 */
  stabGain: number;
}


export interface Question {
  /** 稳定题号：按「主题 + 规范化题干」生成，不能退回数组下标。 */
  qid: string;
  /** 这道题属于哪一章。题和卡解耦之后，统计只认它，不认卡上的 topic。 */
  topic: string;
  q: string;
  options: string[];
  answer: number;
  explain: string;
  /** 见 QLevel。可选：旧题库与 JSON 题库都没有这个字段。 */
  level?: QLevel;
}

/** 每次出题打乱选项后的视图；题面、判定、反馈必须读同一份。 */
export interface QView {
  options: string[];
  answer: number;
}

/**
 * 题库：按主题分组的题目，加一份格式诊断。
 *
 * `issues` 非空时 `loadQuestionBank` 整体拒绝：写题人得知道自己哪一行错了。
 * 主题不存在时该章回退到全部题目，所以题库只限制格式，不限制主题。
 */
export interface QuestionBank {
  name: string;
  byTopic: Record<string, Question[]>;
  /** 格式问题（带行号与题目标识）。空数组 = 格式合格。 */
  issues?: string[];
}

/** 一幕对应的课程章节：阶段是 20 层的容器，topic 才是这一段学什么。 */
export interface StagePlan {
  stage: number;
  /** 必须能对上题库里的 `## 主题`，否则这一章抽不到题。 */
  topic: string;
  title: string;
}

/** 某一章当前的题库。运行时只认它，不认卡牌上的 topic。 */
export interface StageBank {
  v: 1;
  plan: StagePlan;
  bank: QuestionBank;
}

/** 一章的摘要，给结算页和下一章生成用；不放完整题面。 */
export interface StageDigest {
  stage: number;
  topic: string;
  ok: number;
  bad: number;
  /** 当前章节的正确率，只用于结算页；不是 FSRS 稳固度。 */
  mastery: number;
  /** 错得最多的题，按 bad 降序；给下一章生成时做重点。 */
  weak: { qid: string; ok: number; bad: number }[];
}

/**
 * 卡牌身份，管规则不管数值：要不要答题、能不能被获取。
 * 与 `CardType`（类别）、`topic`（知识归属）是三条独立的轴。
 */
export type CardKind = 'knowledge' | 'junk' | 'basic';

/** 卡牌类别：攻击 / 防御 / 技能。按效果自动归类，见 `cardType()`。 */
export type CardType = 'attack' | 'defense' | 'skill';

/** 等级 = 这张牌要答对几次才免答：C 0 / B 1 / A 2 / S 3（跟费用走），每场清零。 */
export type CardGrade = 'C' | 'B' | 'A' | 'S';

/** 效果原型：`strike` 是基准，洞察破防、巩固堆挡、内化回血、串联分段、专注抽牌。 */
export type Eff = 'strike' | 'pierce' | 'guard' | 'drain' | 'chain' | 'focus';

/** 单卡签名改动：覆盖效果原型的一部分参数，让同原型的卡数值不一样。 */
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
  /** 打出后自己失去的生命，不是费用；结算走 `loseHp`。 */
  selfHp?: number;
}

/** 出牌费用：0–3，或 `'x'` 表示花光剩余行动力并按点数结算。不写 = 1。 */
export type CardCost = 0 | 1 | 2 | 3 | 'x';

/** 增益：整局生效，不抽、不花行动力、不占牌位；只由精英和幕 Boss 掉落。 */
export type ModeId = 'study' | 'review' | 'test';

export type PowerId =
  | 'librarycard' | 'hourglass' | 'index' | 'binder' | 'mirrorcard' | 'lamp' | 'marker'
  | 'paperweight' | 'dogear' | 'bookmark' | 'sticky' | 'syllabus' | 'eraser'
  // 答错相关 + 学习向
  | 'slipcase' | 'scratch' | 'loupe' | 'margin' | 'corner' | 'mend'
  // 按作用域补齐
  | 'press' | 'code' | 'nightlight' | 'board' | 'tab' | 'stamp' | 'tea'
  | 'shelf' | 'polish' | 'gluepot' | 'seal' | 'clip' | 'whistle' | 'felt'
  | 'brush' | 'ledger' | 'atlas' | 'wish' | 'spine' | 'exlibris' | 'slim' | 'resin'
  // 局内节奏：回合结束、第 3 张、洗牌、第一张 0 费 / 攻击牌
  | 'feather' | 'ink' | 'archive' | 'pulse' | 'varnish' | 'seed';

/**
 * 增益多久兑现一次：`always` 常驻（由 `rulesOf` 折成数字）、`fight` 每场一次、
 * `stage` 每幕一次、`run` 整局一次、`instant` 拾取即结算。
 *
 * stagecheck 会检查声明 `always` 的增益是否真的进了 `rulesOf`，否则构建失败。
 */
export type PowerScope = 'always' | 'fight' | 'stage' | 'run' | 'instant';

export interface PowerDef {
  id: PowerId;
  /** 徽记里的一个字 */
  icon: string;
  name: string;
  /** 完整描述：日志、悬停提示、结算页用 */
  desc: string;
  /** 徽记面上的效果句，两行以内 */
  card: string;
  color: string;
  /** 多久兑现一次。见 `PowerScope` */
  scope: PowerScope;
}

/**
 * 联动：数值由前几张牌留下的战场状态换算，也能给下一张留下加成。
 * 读抽牌数 / 格挡、本场打出次数、或给下一张留倍率。
 * 展示与结算都走 `liveStatOf`，卡面数字和实际伤害必须同源。
 */
export interface CardLink {
  /** 攻击底数从哪个战场状态换算；不写就用卡面 atk */
  atkFrom?: 'drawn' | 'block';
  /** 每单位状态换算多少攻击底数，默认 1 */
  per?: number;
  /** 状态为 0 时的保底攻击底数，默认 0 */
  floor?: number;
  /** 本场每打出过一次这张牌，它自己下次多多少攻击底数 */
  grow?: number;
  /** 打出后给下一张牌留下的伤害倍率，默认 1 */
  nextMul?: number;
  /** 打出后给下一张牌留下的固定攻击底数加数 */
  nextAdd?: number;
  /** 卡面右下角的一句短说明：数值从哪来 */
  note: string;
}

/** 一张知识卡：只有卡面，没有题；题目在点开时从当前阶段的 BANK 抽。 */
export interface CardDef {
  /** 稳定短键（`c00`…），与当前题库内容无关；存档/记忆只认它 */
  id: string;
  /** 卡牌的分类标签，**不参与抽题**，只用于牌组排序和展示。 */
  topic: string;
  /** 牌名：游戏化的名字，刻意不等于知识点名，不泄露答案。 */
  name: string;
  /** 效果底数：伤害与格挡的基数，实际值由 effect 折算 */
  atk: number;
  blk: number;
  /**
   * 打出这张牌要付的行动力。不写 = 1。
   * 答错不扣行动力，但这一手作废并消耗本场一道新题。
   */
  cost?: CardCost;
  /** 这张卡怎么把上面的数字花出去 */
  eff: Eff;
  /** 这张卡相对效果原型的签名改动；不写就是原型默认 */
  mods?: EffMods;
  /** 会不会和别的手牌发生**机制**联动；不写就是一张数值恒定的牌 */
  link?: CardLink;
  junk?: boolean;
  /** 身份。工厂与解析层写入；旧 JSON 包没写时由 cardKind() 回落推导。 */
  kind?: CardKind;
  /** 类别（攻击/防御/技能）。不写就按 kind + eff 自动推导，见 cardType()。 */
  type?: CardType;
}

export interface Pack {
  name: string;
  cards: CardDef[];
}

/**
 * 一张牌的身份：牌组、手牌、抽牌堆、弃牌堆里存的都只有 id。
 * 精炼过的那一张换成带 `+` 后缀的 id，所以同名副本可以各自不同。
 */
export type CardId = string;

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

/**
 * 敌人机制，每条只改一件玩家已经会做的决定：
 *   reviewer 一回合没答对就多挨 3 点 · pierce 无视一半格挡 · leech 你答错它回血
 *   oblivion 抓你错得最多的主题 · lethe 你每错一次它 +1 攻 · thorns 打它被反伤
 *   bulwark 你答错它叠格挡 · fog 每回合少抽 1 张 · siphon 打中你扣下回合行动力
 *   haste 每回合 +1 攻
 */
export type Mech =
  | 'reviewer' | 'pierce' | 'oblivion' | 'leech' | 'lethe'
  | 'thorns' | 'bulwark' | 'fog' | 'siphon' | 'haste';

/** 一幕：100 层分五幕，每幕 20 层，有自己的色相与机制母题。 */
export interface StageDef {
  /** 1..5 */
  i: number;
  key: string;
  /** 幕名，画在地图标题与战斗顶栏 */
  name: string;
  /** 一句话的场地描述，地图左栏用 */
  sub: string;
  /** 本幕主色：地图高光、幕名、节点底色都从这里取 */
  color: string;
  /** 立绘色相偏移；同一幕的怪共用一个色相 */
  hue: number;
  /** 幕内每层（除去首行与末两行）的节点权重 */
  mix: { fight: number; event: number; rest: number; elite: number };
}

/**
 * 敌人立绘。全部是"纯黑底 + 发光主体"的 jpg，screen 混合后黑即透明；
 * 同一立绘换 hue 就是一个新怪：但新机制值得配新皮，别全靠调色。
 */
export type ArtKey =
  | 'shard' | 'examiner' | 'oblivion'   // 初代三件套
  | 'moth' | 'grub' | 'inquisitor' | 'tide' | 'lethe'
  // 幕 Boss 的专属立绘
  | 'cataloguer' | 'devourer' | 'imprinter' | 'bound';

export interface FoeTpl {
  key: string;
  name: string;
  type: 'fight' | 'elite' | 'boss';
  art: ArtKey;
  /** 属于第几幕（1..5）。同一种怪只在一幕里出现 —— 换幕就换一整套物种。 */
  stage: number;
  tag: string;
  hp: number;
  dmg: number;
  moves: Move[];
  mech?: Mech;
  /**
   * 机制的量。不写就用 `BAL.mech` 的默认值；同一条机制在不同幕可以有不同强度。
   */
  mechV?: number;
  hue?: number;
}

export interface Foe extends FoeTpl {
  maxHp: number;
  hp: number;
  block: number;
  mv: number;
}

export interface EventOpt {
  t: string;
  sub: string;
  /** 返回日志文案；返回 null 表示这个选项没有被消费，面板留在原地让玩家重选 */
  run: () => string | null;
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

/** 一次答题的流水：只给统计、阶段摘要和导出用，不参与结算。 */
export interface AnswerRecord {
  qid: string;
  /** 这道题在来源题库里的主题（内容归属） */
  topic: string;
  /** 这一手是在哪一章问的；章节记忆和结算按它归档。 */
  stageTopic: string;
  stage: number;
  right: boolean;
  choice: number;
  answer: number;
  stem: string;
}

/* ── 运行状态：只描述形状，唯一的可变实例在 `infra/state.ts` ── */

export interface Feedback {
  idx: number;
  /** 这一手问的题号 */
  qid: string;
  choice: number;
  right: boolean;
  /** 总伤害（分段结算后相加） */
  dmg: number;
  absorbed: number;
  blk: number;
  /** 这一手触发的是哪种效果 */
  eff: Eff;
  /** 每段原始伤害（结算前），只用于分段演出；展示请读 `parts`。 */
  hits: number[];
  /** 每段实际伤害与被格挡吸收的量；多段攻击不能拿 `hits` 当总伤。 */
  parts: { d: number; a: number }[];
  /** 内化回的血 */
  heal: number;
  /** 专注抽的牌 */
  draw: number;
  apNote: string;
  /** 这一手的伤害里有多少来自前序出牌 / 联动。 */
  linkNote: string;
  explain: string;
  question: string;
  options: string[];
  answer: number;
  topic: string;
}

export interface ReportRow { t: string; ok: number; bad: number; mast: number }

export interface ReportData {
  win: boolean;
  /** 死在第几层（1..100）。Boss 处死掉记的是 Boss 那一层 */
  floor: number;
  /** 走到第几幕（1..5） */
  stage: number;
  /** 这一局最后一章的题目主题 */
  stageTopic: string;
  /** 最后一章本局的答题数 */
  stageOk: number;
  stageBad: number;
  /** 这一局的开局模式名 */
  mode: string;
  runOk: number;
  runBad: number;
  floors: number;
  deckSize: number;
  /** 结算时牌组里有几种卡种 */
  kinds: number;
  mastery: number;
  rows: ReportRow[];
  /** 这一局靠答对额外抽到的张数 */
  answerDraws: number;
  /** 这一局拿到的增益名字 */
  powers: string[];
  verdict: string;
}

export type Panel =
  | { k: 'none' }
  /** 开局选模式：学习 2 / 复习 1 / 测试 0 个初始增益，其余规则不变。 */
  | { k: 'boon' }
  /** `q` 是点开那一刻抽到的题目快照，答题期间不随题库变。 */
  | { k: 'question'; idx: number; qid: string; topic: string; q: Question; view: QView }
  | { k: 'feedback'; fb: Feedback }
  | { k: 'reward'; cards: CardDef[]; ledger?: boolean }
  /** 精英 / Boss 掉落；只有一个 id，没有"要不要拿"。 */
  | { k: 'powerdrop'; id: PowerId }
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
  /** 开局模式，决定开局塞哪几个增益 */
  mode: ModeId | null;
  /** 当前幕（1..5）；地图只装这一幕的 20 行，层号由 `floorOf()` 换算成 1..100。 */
  stage: number;
  /** 这一幕对应哪一章，只决定 BANK 是哪一份，不影响卡面数值。 */
  stageTopic: string;
  panel: Panel;
  log: LogLine[];
  /** 牌组：只有 id；精炼过的那一张带 `+` 后缀，所以精炼只作用于被挑中的那张。 */
  deck: CardId[];
  /** 这一局拿到的增益，跨战斗保留，新开一局才清。 */
  powers: PowerId[];
  hp: number;
  maxHp: number;
  block: number;
  ap: number;
  apMax: number;
  turn: number;
  enemy: Foe | null;
  /** 三个牌堆同样只放 id，表现层按 id 认飞行记录。 */
  draw: CardId[];
  discard: CardId[];
  hand: CardId[];
  map: MapNode[][];
  pos: { r: number; i: number } | null;
  node: MapNode | null;
  seen: Record<string, boolean>;
  /** 本场每张知识卡已答对几次；攒够等级要求后直接打。**每场清零**。 */
  charge: Record<string, number>;
  /** 本场还没点开过的新题；用完不锁牌，`takeQuestion` 会改问被问得最少的题。 */
  qLeft: Question[];
  /** 本局每题被抽到几次；到 3 次不再进新题池。跨场保留，`startRun` 清。 */
  qPicked: Record<string, number>;
  /** 本局答题流水（环形，最近 N 条）。阶段摘要与导出读它，不参与规则。 */
  answers: AnswerRecord[];
  topicWrong: Record<string, number>;
  okThisTurn: number;
  /** 本回合答对了「本局错得最多的主题」；存主题名，每回合清零。 */
  topOkTopic: string | null;
  /** 「一场一次」的增益，哪些这一场用掉了。读写只走 `onceThisFight`。 */
  onceUsed: Partial<Record<PowerId, boolean>>;
  /** 「一幕一次」的增益：账本 / 地图册。过幕清。 */
  onceStage: Partial<Record<PowerId, boolean>>;
  /** 「整局一次」的增益：许愿条。开局清。 */
  onceRun: Partial<Record<PowerId, boolean>>;
  /** 索引贴留下的格挡：`endTurn` 记，`startTurn` 兑现。 */
  carryBlock: number;
  /** 抛光布让精炼多给几点；`statOf` 读它。放 G 上是为了不反向依赖 `rulesOf`。 */
  upGrade: number;
  /** 荧光笔留给这一手的额外退款，只活一手。 */
  markerRefund: number;
  /** 课表这一回合是否已给过基础牌格挡；存回合号，`startBattle` 归零。 */
  syllabusTurn: number;
  /** 本局靠答对额外抽到的张数，只给结算页用 */
  answerDraws: number;
  /** 本回合靠答对抽了几张，受 `BAL.answerDrawCap` 限制，`startTurn` 清零 */
  answerDrawsThisTurn: number;
  /** 本回合实际抽到手的牌数（起手 / 专注 / 答对 / 补抽都算），`atkFrom:'drawn'` 读它。 */
  drawnThisTurn: number;
  /** 本回合真正生效的牌数（答错不计），墨水瓶 / 节拍器读它。 */
  cardsThisTurn: number;
  /** 本场每张牌打出过几次，按牌种记（剥掉 `+`）；`grow` 读它，`startBattle` 清。 */
  cardPlays: Record<string, number>;
  /** 上一张牌留给下一张的加成；只有真正打出去才消耗。 */
  nextBoost: { mul: number; add: number; from: string } | null;
  /** 下回合要扣的行动力（siphon），`startTurn` 结算并清零。 */
  apDown: number;
  /** 本场每回合少抽几张（fog）。`startBattle` 按怪物机制写入，跨场必须清零。 */
  drawCut: number;
  runOk: number;
  runBad: number;
  floors: number;
  pending: null | 'clear' | 'win' | 'dead';
  /** 事件里"选完牌才付的血"，>0 表示有一笔待付。放 G 上是因为取消要跨层读写。 */
  pendingCost: number;
  busy: boolean;
}
