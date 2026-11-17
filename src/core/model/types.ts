/** 领域模型。这一层不认识 canvas，也不认识 DOM。 */

export interface Question {
  /** 稳定题号：按「主题 + 概念」生成，不能退回数组下标。 */
  qid: string;
  /** 这道题属于哪一章。题和卡解耦之后，统计只认它。 */
  topic: string;
  /**
   * 概念主键：同一个知识点换一种问法，仍然指回同一道题。
   *
   * 题号按它派生，所以重新生成题干不会让**学习历史**对不上号 ——
   * 这是「按错题重生成」那条闭环的前提。不写就回落到题干本身，
   * 于是老题库的题号一个都不变。
   */
  concept?: string;
  q: string;
  options: string[];
  answer: number;
  explain: string;
  /**
   * 选项语义依赖自己的位置（「以上都对」）。由题库 DSL 的 `! 固定顺序`
   * 显式声明，解析期校验；出题视图只读这个标记，不猜选项文案。
   */
  noShuffle?: boolean;
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
  issues: string[];
}

/** 一章的答题摘要：结算页按它算每章正确率。 */
export interface StageDigest {
  ok: number;
  bad: number;
  /** 当前章节的正确率（0..1），只用于结算页。 */
  mastery: number;
}

/**
 * 卡牌身份，管规则不管数值：能不能答题、能不能被获取。
 * 与 `CardType`（类别）是两条独立的轴。
 */
export type CardKind = 'knowledge' | 'junk' | 'basic';

/** 卡牌类别：攻击 / 防御 / 技能。按效果自动归类，见 `cardType()`。 */
export type CardType = 'attack' | 'defense' | 'skill';

/** 效果原型：`strike` 是基准，洞察破防、巩固堆挡、内化回血、串联分段、专注抽牌。 */
export type Eff = 'strike' | 'pierce' | 'guard' | 'drain' | 'chain' | 'focus';

/**
 * 单卡签名改动：只改"这张牌怎么花出去"，不改伤害与格挡的大小。
 * 数值本身写在卡表的 `atk` / `blk` 上 —— 这里再留一个倍率，就等于给同一张牌
 * 留了两套数，卡面写 7 打出来 9 的时候没人知道该改哪一处。
 */
export interface EffMods {
  /** 覆盖结算段数（串联默认 2 段，签名卡可以打 3 段） */
  times?: number;
  /** 每段命中回复几点生命（整数，不按伤害比例） */
  healPer?: number;
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
  /**
   * 卡面那句 `card` 装不下的**边界**：每场一次、只对基础牌、划掉的不含正确答案。
   * 没有边界就不写 —— 复述 `card` 只会给"再补一句理由"留位置，而掉落面板上
   * 那三行字一旦开始解释设计，就成了作者在自言自语。
   */
  desc?: string;
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
  /** 攻击底数从哪个战场状态换算；不写就用卡面 atk。换算是 1:1，没有系数 */
  atkFrom?: 'drawn' | 'block';
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

/**
 * 精炼（升级）一张卡时，**除了底数之外**还要改什么。
 *
 * 早先精炼只做一件事：攻、挡各 +3。结果是所有卡的相对收益由「原值多大」决定 ——
 * 0 费牌 +200%，3 费牌 +15%，于是"挑哪张精炼"永远只有一个答案。
 * 现在每张卡可以声明自己该长在哪：抽牌牌多抽、联动牌多长、自伤牌少流、
 * 贵牌降费。没写的字段走默认（见 `registry.ts::applyUp`）。
 *
 * 只有加减，没有倍率 —— 与「数值只用整数」同一条规矩。
 * 每一项都是**增量**，正数变强、负数变便宜，`npm run cards` 会断言净效果必须为正。
 */
export interface CardUp {
  /** 底数额外加几点（默认 `UP_GAIN`）。纯防御牌可以只加格挡：`{ atk: 0 }`。 */
  atk?: number;
  blk?: number;
  /** 每段命中多回几点血（内化牌） */
  healPer?: number;
  /** 多抽几张（专注牌） */
  draw?: number;
  /** 自伤少几点；写成负数就是变强 */
  selfHp?: number;
  /** 多打几段（串联牌）。段数翻倍是乘法级的收益，所以只有它按段数加 */
  times?: number;
  /** 费用降几点（最低 0）。降费本身就是这张牌的升级方向，不再额外加底数 */
  cost?: number;
  /** 联动牌的「每打出一次长多少」多加几点（`link.grow`） */
  grow?: number;
  /** 下一张的倍率加多少（`link.nextMul`） */
  nextMul?: number;
}

/** 一张知识卡：只有卡面，没有题；题目在点开时从当前阶段的 BANK 抽。 */
export interface CardDef {
  /**
   * 稳定短键（`c00`…），与当前题库内容无关；存档/记忆只认它。
   * **这是定义 id，不是副本身份**：同名的多份副本共用它，副本由所在数组的
   * 下标区分；精炼过的那一份额外带 `+`（`c05+` 仍查回这张 `c05`）。
   */
  id: string;
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
  /**
   * 本场要答对几次才免答；0 表示不问。
   * 隐藏属性：只写在卡牌数据里，不上卡面，也不在奖励 / 牌组 / 帮助页显示。
   * 它不从费用推导 —— 费用管这一回合的形状，答题要求管这一场的学习量。
   */
  ask: number;
  /** 这张卡怎么把上面的数字花出去 */
  eff: Eff;
  /** 这张卡相对效果原型的签名改动；不写就是原型默认 */
  mods?: EffMods;
  /** 会不会和别的手牌发生**机制**联动；不写就是一张数值恒定的牌 */
  link?: CardLink;
  /**
   * 精炼后额外改哪些字段。不写就走默认：攻、挡各 +`UP_GAIN`。
   * 写了就以写下的为准 —— 只写 `{ draw: 1 }` 的牌精炼后只多抽一张，不加攻挡。
   */
  up?: CardUp;
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
 * 卡牌**定义** id（`c05` / `base:strike`），不是副本 id。
 * 牌组、手牌、抽牌堆、弃牌堆都是 id 数组；同名的另一份就是数组里的另一项，
 * 这一项的下标才是副本身份。精炼过的那一份用 `+` 后缀区分；未精炼的同名副本
 * 共用同一个 id，也共用同一个 `G.charge` 免答计数（学的是同一个知识）。
 */
export type CardId = string;

export type MoveKind = 'atk' | 'def' | 'jam' | 'buff';

export interface Move {
  k: MoveKind;
  /**
   * 这一招每段的伤害 = 它自己的 `dmg` **加**这个数（不写 = 0）。
   * 早先这里是倍率（`m: 0.55`），于是"轻击"在第四幕打出的数比第一幕多一倍半；
   * 加减法让招式的轻重在整局里保持同一个差值。
   */
  add?: number;
  /** 格挡值 / buff 值 */
  v?: number;
  /** 杂念张数 */
  n?: number;
  /** 多段 */
  times?: number;
}

/**
 * 敌人机制，每条只改一件玩家已经会做的决定：
 *   reviewer 一回合没答对就多挨 3 点 · pierce 你的格挡先少 6 点 · leech 你答错它回血
 *   oblivion 抓你错得最多的主题 · lethe 你每错一次它 +1 攻 · thorns 打它被反伤
 *   bulwark 你答错它叠格挡 · fog 每回合少抽 1 张 · siphon 打中你扣下回合行动力
 *   haste 每回合 +1 攻
 *
 * 注释里的数字只是默认值；真正生效的量和玩家读到的那句话都由
 * `model/data.ts` 的 `mechAmt()` / `mechNote()` 给出，怪身上写了 `mechV` 就用它自己的。
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
  /** 幕内每层（除去首行与末两行）的节点权重；整数份数，四类加起来是 100 份 */
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
  /** 幕内每上一个强度台阶（5 层），血量加几点。见 `foe.ts` 的 `TIER`。 */
  hpStep: number;
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
  /**
   * 副标题**一律是函数**，渲染时求值。
   *
   * 早先是 `string | (() => string)`：默认写字符串，只有会随增益变的那条改函数。
   * 结果是渲染处要 `typeof` 分叉，而且新加选项时没人提醒该用哪种 —— 静态字符串
   * 会悄悄锁死拿到增益之前的数字。统一成函数，分叉和「记得用对」一起消失。
   *
   * 文案里的数值只能来自本文件的代价常量，不能写字面量：守卫
   * （`content/no-literal-hp`）会扫 `\d+ 点生命`。
   */
  sub: () => string;
  /**
   * 这个选项要付多少点生命。**付不起就不可选**，不是"能付多少付多少"。
   *
   * 事件扣血有下限 1（随机事件不该终结一局），于是它曾经造成一个洞：
   * 文案承诺「失去 8 点生命」，1 血时照样给卡、只扣 0 点 —— 付不起的代价
   * 变成了免费。声明在这里之后，`chooseEventOption()` 统一拦截，
   * 文案写多少就必须真的扣多少。
   *
   * 选牌后才付的那几个（`G.pendingCost`）也要声明，因为玩家是在**选之前**
   * 就该知道这一下付不付得起。
   */
  payHp?: number;
  /** 返回 null 表示这个选项没有被消费，面板留在原地让玩家重选 */
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
  /** 这一局拿到的增益 id；展示层按 id 查名字 / 颜色。 */
  powers: PowerId[];
  verdict: string;
}

/** 选牌面板取消后回到哪里；不写表示直接关闭（调试入口 / 没有来源）。 */
export type CardPickFrom = { k: 'rest' } | { k: 'event'; ev: EventDef };

/** 一个可编辑的单行字段：值和光标位置。表现层（`scenes/textfield.ts`）照这个形状画。 */
export interface EditField {
  value: string;
  caret: number;
}

/**
 * 设置面板里的模型参数编辑器。
 *
 * 它住在面板上而不是某个模块的局部变量里：`G` 是唯一真相，输入中的半截值也是状态 ——
 * 否则重绘时要么丢字，要么得另开一处"第二份真相"。
 */
export interface ModelForm {
  base: EditField;
  model: EditField;
  key: EditField;
  /** 焦点字段：0 接口地址 / 1 模型 / 2 密钥。 */
  field: number;
  /** 密钥是否明文。 */
  reveal: boolean;
}

export type Panel =
  | { k: 'none' }
  /** 开局选模式：学习 2 / 复习 1 / 测试 0 个初始增益，其余规则不变。 */
  | { k: 'boon' }
  /**
   * 开局选主题。`picks` 是**勾选顺序**，不是集合：先勾的先出题，
   * 所以顺序有语义，别改成排序后存。
   */
  | { k: 'topic'; mode: ModeId | null; picks: string[] }
  /** `q` 是点开那一刻抽到的题目快照，答题期间不随题库变。 */
  | { k: 'question'; idx: number; qid: string; topic: string; q: Question; view: QView }
  | { k: 'feedback'; fb: Feedback }
  | { k: 'reward'; cards: CardDef[]; ledger?: boolean }
  /**
   * 精英 / Boss 掉落；只有一个 id，没有"要不要拿"。
   *
   * `cards` 是这张增益当场塞进牌组的卡（藏书那种）：这一屏先讲增益本身，
   * 关掉之后再把那几张牌的牌面摆出来，否则玩家只知道「藏书 生效」。
   */
  | { k: 'powerdrop'; id: PowerId; cards?: CardId[] }
  /**
   * 白送进牌组的卡。
   *
   * 早先只把卡名塞进一句会飘走的提示里，玩家读完也不知道那张牌打出来是几点 ——
   * 名字不等于牌面。这一屏把卡本身摆出来，看过才回到节点。
   */
  | { k: 'cardget'; ids: CardId[]; note?: string }
  | { k: 'rest' }
  | { k: 'cardpick'; mode: 'up' | 'rm'; from?: CardPickFrom; pick?: number }
  | { k: 'event'; ev: EventDef }
  | { k: 'deck' }
  | { k: 'pile'; kind: 'draw' | 'discard' }
  | { k: 'help' }
  | { k: 'pack'; msg: string; ok: boolean }
| { k: 'settings'; msg: string; ok: boolean; form?: ModelForm }
  | { k: 'report'; data: ReportData };

export interface GameState {
  screen: 'title' | 'map' | 'battle' | 'report' | 'atlas';
  /** 开局模式，决定开局塞哪几个增益 */
  mode: ModeId | null;
  /** 当前幕（1..5）；地图只装这一幕的 20 行，层号由 `floorOf()` 换算成 1..100。 */
  stage: number;
  /** 这一幕对应哪一章，只决定 BANK 是哪一份，不影响卡面数值。 */
  stageTopic: string;
  panel: Panel;
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
  /**
   * 本局已经遇过的事件 id，只用于"先抽没见过的"。
   * 一局有十几二十个事件节点，四个模板轮着来，玩家会把事件当补给站；
   * 池子抽空之前不重复，事件才回到"这次会遇到什么"。
   */
  eventsSeen: string[];
  /** 本场每张知识卡已答对几次；攒够答题要求后直接打。**每场清零**。 */
  charge: Record<string, number>;
  /** 本场还没点开过的新题；用完不锁牌，`takeQuestion` 会改问被问得最少的题。 */
  qLeft: Question[];
  /** 本局每题被抽到几次；到 3 次不再进新题池。跨场保留，`startRun` 清。 */
  qPicked: Record<string, number>;
  /**
   * 这一局选中的主题，开局定死。幕不再绑定主题，整局共用一份临时题库。
   */
  topics: string[];
  /** 本局临时题库：题号队列，按主题连续排列。开局建一次，整局只消费不重建。 */
  runQueue: string[];
  /** 队列游标。它是**唯一的**消耗位置，抽题只许往前走。 */
  runCursor: number;
  /**
   * 本局已经答对过的题：答对即出局，这一局不再抽它，把位置让给还没学会的。
   * 局内每道题最多答对一次，所以它只增不减；`startRun` 清。
   */
  qSolved: Record<string, true>;
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
  /** 本章本局答对 / 答错；过幕清零、随断点存。结算页的“本章答题”只读它。 */
  stageOk: number;
  stageBad: number;
  floors: number;
  pending: null | 'clear' | 'win' | 'dead';
  /** 事件里"选完牌才付的血"，>0 表示有一笔待付。放 G 上是因为取消要跨层读写。 */
  pendingCost: number;
  /** 事件里"选完牌才回的血"，和 pendingCost 同一条结算路径；取消时一起丢掉。 */
  pendingHeal: number;
  busy: boolean;
}
