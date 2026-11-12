/** 领域模型。这一层不认识 canvas，也不认识 DOM。 */

/**
 * 一道题的认知层级。题库里 `? 理解:` / `? 迁移:` 这类前缀由解析层写进来，
 * 没写就是 undefined（老包不用改）。目前只存不用：留给「出题梯度」和
 * 「按难度分档的答错代价」这条线，重构阶段不改变任何规则。
 */
export type QLevel = 'recall' | 'understand' | 'transfer';

/**
 * 唯一的一套「答错价码」。
 *
 * 原来这里是三种模式（学习 / 复习 / 测试），各改一遍答错补多少格挡、补不补抽、
 * 牌去哪、稳固度怎么变。规则本身没问题，问题是**它挡在每一局前面**：
 * 玩家得先回答"我今天是来学还是来测"才能开始玩，而"这一局偏严还是偏松"
 * 本该是构筑造成的结果，不是开局菜单选出来的。
 *
 * 现在只有一套规则。差异交给开局模式带的初始增益（学习 2 / 复习 1 / 测试 0），
 * 增益不进牌组，也不改答错价码。
 */
export interface MissRule {
  /** 答错时稳固度乘数 */
  stabDrop: number;
  /** 答对时稳固度系数 */
  stabGain: number;
}


export interface Question {
  /**
   * 稳定题号。由解析层按「主题 + 规范化题干」生成。
   *
   * 题号不能再用数组下标：阶段一换题库，下标指向的就是另一道题，
   * `qSeen` / 答题日志 / 错因记忆都会串。题干改了题号就变 —— 那本来就是另一道题。
   */
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
 * `byTopic` 只是**分组**：主题名任意、可以重复，也可以一个都不写
 * （未分组的题进 `未分类`）。课程表按主题把来源题库切成每一幕的 BANK；
 * 某一章的主题不存在时回退到全部题目 —— 所以题库不限制主题，只限制格式。
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
 * 课程的一章。阶段（Stage）是塔里的 20 层容器，章节（topic）才是这一段学什么；
 * 两者分开，换科目时只换课程表，不动地图、敌人和卡池。
 */
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

/**
 * 一章结束时给 agent 的摘要。只放「这一章发生了什么」，
 * 不放完整题面/选项 —— 记忆文档要能被压缩、被审阅，而不是变成第二份题库。
 */
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
 * 卡牌身份 —— 管的是规则，不是数值：要不要答题、进不进记忆调度、
 * 打出之后飞向弃牌堆还是飞回抽牌堆。与 `Eff`（数值怎么花）、`topic`（知识归属）
 * 是三条互相独立的轴，不要混用。
 *
 * 增益**不是牌**了（见 `PowerId`），所以这一层只剩三种：要答题的知识卡、
 * 永远打得出但很弱的基础牌、以及敌人塞进来、不出题的杂念。
 * 以前这里还有一个 `'power'`：那是"增益是牌"那一版的产物，连同它的卡面、
 * 飞行槽和"每场重新打一遍"一起删掉了。
 */
export type CardKind = 'knowledge' | 'junk' | 'basic';

/**
 * 卡牌的**类别**：攻击 / 防御 / 技能。
 *
 * 这是和 `CardKind`（身份）不同的一条轴：
 *   - 身份回答"这张牌要不要答题、能不能被获取"（基础牌 / 知识卡 / 杂念）；
 *   - 类别回答"它在这一局里干什么"（打伤害 / 堆格挡 / 换节奏）。
 *
 * 知识卡按效果自动归类（见 `cards/kinds.ts` 的 `cardType()`）：
 * 猛击·洞察·串联·内化 = 攻击，巩固 = 防御，专注 = 技能。
 */
export type CardType = 'attack' | 'defense' | 'skill';

/**
 * 卡牌等级：这张牌愿意为它的数值付几次答题。
 *
 * C（0 费）不用答，B（1 费）答对 1 次，A（2 费）2 次，S（3 费 / X 费）3 次。
 * 等级不是稀有度，是"这一场你要为这张牌背几次"——它跟着费用走，见 `cards/grade.ts`。
 * 计数**每场战斗清零**：一场里攒够次数，这张牌这一场剩下的时间就免答。
 */
export type CardGrade = 'C' | 'B' | 'A' | 'S';

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
  /**
   * 打出后自己失去多少生命。它不是费用，费用栏只写行动力；
   * 卡面单独写一行「失去 X 生命」，结算也走同一条 `loseHp`。
   */
  selfHp?: number;
}

/**
 * 出牌费用。0–3 点，或者 `'x'` —— 花光这一回合剩下的**全部**行动力，
 * 效果按花掉的点数结算（花 3 点就打 3 次）。写法跟杀戮尖塔一样。
 *
 * 不写 = 1 点：这一版之前 87 张牌清一色 1 点，省略字段就等于原价，
 * 旧卡表和旧存档都不必改。
 */
export type CardCost = 0 | 1 | 2 | 3 | 'x';

/**
 * 增益（power）。**它是整局生效的"印记"，不是牌。**
 *
 * 上一版把它做成了牌：进牌组、抽到手、花行动力打出去、本场结束就清空。
 * 于是它每场都要被重新抽到、重新付一遍费用，还占着一张知识卡的位置 ——
 * 玩家读出来的是"我拿了个增益，但我从来没见过它生效"。
 *
 * 现在反过来：只有精英和幕 Boss 掉，**拾取即生效、整局亮着**。
 * 它不抽、不付钱、不占牌位，所以也没有"要不要拿"这一步 —— 掉落不是成本，
 * 牌组厚度才是，而这条路现在完全不碰牌组。
 *
 * 池子有四十一个（`POWERS`）：一局大约会走过十几个精英 / Boss，池子必须够掉，
 * 否则后半程的精英会变成"打完什么也没有"。四十一个里大部分是小份加数，
 * 拿齐一整轮确实变强 —— 所以每一条的强度都按"总量除回来"重定过，
 * 而且它们按 `PowerScope` 分档：常驻的只有 1–2 点，一次性的才敢给 3–4 点。
 */
export type ModeId = 'study' | 'review' | 'test';

export type PowerId =
  | 'librarycard' | 'hourglass' | 'index' | 'binder' | 'mirrorcard' | 'lamp' | 'marker'
  | 'paperweight' | 'dogear' | 'bookmark' | 'sticky' | 'syllabus' | 'eraser'
  // ── 第二批：答错的四张「代价」牌 + 两张学习向 ──
  // 前十二张里只有装订线 / 橡皮两张在管"答错"，而答错正是这游戏唯一会被惩罚的动作。
  // 这四张把那条线拆成四个不同的松紧：不掉稳固度（书套）、补抽一张（草稿纸）、
  // 少一个干扰项（放大镜）、以及把复习点的回血拉高（修书胶）。
  | 'slipcase' | 'scratch' | 'loupe' | 'margin' | 'corner' | 'mend'
  // ── 第三批：从"每场第一次"里分流出去的二十二张 ──
  // 十八张的时候有一半牌都挂在"每场战斗第一次答对 / 答错"，一局捡到八九张，
  // 同一个瞬间会有两三张抢着响，玩家听不出是哪一张在起作用。
  // 这一批按**作用域**补齐四个方向，见 `PowerScope`：
  //   · 战场常驻（assault/rule/nightlight/board/tab/inscribe/tea/shelf/polish）
  //   · 每场一次（gluepot/seal/clip/whistle/felt/brush）
  //   · 每幕一次（ledger/atlas）
  //   · 整局一次（wish）
  //   · 拾取即结算（spine/exlibris/slim/resin）
  | 'press' | 'code' | 'nightlight' | 'board' | 'tab' | 'stamp' | 'tea'
  | 'shelf' | 'polish' | 'gluepot' | 'seal' | 'clip' | 'whistle' | 'felt'
  | 'brush' | 'ledger' | 'atlas' | 'wish' | 'spine' | 'exlibris' | 'slim' | 'resin'
  // ── 第四批：把“打牌的顺序/节奏”拆成新的触发点 ──
  // 前三批的触发点集中在“答对 / 答错 / 每回合开始 / 每场开始”，
  // 这一批补的是**局内节奏**：回合结束时、每第 3 张、洗牌时、第一张 0 费 / 攻击牌。
  | 'feather' | 'ink' | 'archive' | 'pulse' | 'varnish' | 'seed';

/**
 * 一个增益的**作用域** —— 它多久兑现一次。
 *
 * 这不是分类学，是加牌时唯一要回答的问题：**"这个增益什么时候该响"**。
 * 五种作用域各自对应 `cards/powers.ts` 里的一条通道：
 *
 *   · `always`  常驻数值：`rulesOf()` 把它折成一个数字，结算层只读数字
 *   · `fight`   每场一次：`onceThisFight(id)`，调用即消耗
 *   · `stage`   每幕一次：`onceThisStage(id)`，过幕时清账
 *   · `run`     整局一次：`onceThisRun(id)`，开局时清账
 *   · `instant` 拾取即结算：`applyInstant(id)`，不需要记账
 *
 * 它同时是 `tools/stagecheck.ts` 的守门依据：一张牌如果声明了 `always`
 * 却没出现在 `rulesOf` 的任何一项里，构建就会失败 —— 这正好挡住
 * "加了一张牌，但忘了真的让它生效"这类静默 bug。
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
 * 一张卡的**联动规格**：它的数值不是印死的，而是由前几张牌留下的战场状态算出来；
 * 它自己也可能会给下一张牌留一笔账。
 *
 * 这是规则，不是演出：改动的是 `resolveEff` 拿到的攻击底数，所以伤害、回血、
 * 分段、反馈数字、卡面数字会一起变。四种形状各自对应一个可被验证的因果：
 *
 *   atkFrom:'drawn'  本回合每抽 1 张牌 → 攻击底数 +per  （抽牌卡喂它）
 *   atkFrom:'block'  当前每 1 点格挡 → 攻击底数 +per   （格挡卡喂它）
 *   grow             本场每打出过一次**这张牌** → 下次 +grow（自己喂自己）
 *   nextMul/nextAdd  打出后给**下一张真正生效的牌**留倍率/加数（它喂别人）
 *
 * 一律读 `combat/link.ts` 的 `liveStatOf`，展示与结算共用同一份结果，
 * 不会出现「卡面写 8、实际打 16」这种两张皮。
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

/**
 * 一张知识卡：**只有卡面，没有题**。
 *
 * 卡面由内置的 `cards/catalog.ts` 提供，外部题库（md）碰不到它；
 * 题目在点开牌那一刻才从**当前阶段的 BANK** 里抽 —— 和这张卡的 `topic` 无关。
 * 以前 `qs` 挂在卡上，等于把题库和卡牌库焊成一个对象 —— 换题库就会换掉
 * 整副牌，连 card id（当时由题干生成）都跟着失效。
 */
export interface CardDef {
  /** 稳定短键（`c00`…），与当前题库内容无关；存档/记忆只认它 */
  id: string;
  /**
   * 卡牌的分类/展示标签，**不参与抽题**。抽题只看当前阶段的题库；
   * 同一张「折半之刃」卡在第三幕会抽到「形容词与副词」的词，这是设计不是错配。
   */
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
   * 这个数决定两件事：上手要付得起（不够打不出去），以及答对之后净花几点
   * （一手最多退 1 点）。答错**不扣行动力**，但这一手没打出来、还消耗本场一道新题。
   * 所以高费牌是"一次答题换一大笔输出"的大票，低费牌是"稳着打"的小注。
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
 * 一张牌的 id。**牌组、手牌、抽牌堆、弃牌堆里存的都只有它。**
 *
 * 以前这里存的是 `CardInst`（`{ id, up }`）—— 一个"实例"对象，精炼状态挂在实例上。
 * 那一层是多余且有害的：同名牌的两份副本是两个对象，于是"打出去的到底是哪一张"
 * 变成了一个只存在于内存里的区别，表现层的飞行单元要各自去认对象身份
 * （`Map<CardInst, ...>`），一旦对象被复制或重建，那张牌就"认不出来"了 ——
 * 基础斩击偶发失效就是这么来的。
 *
 * 现在：**id 就是全部身份**，牌库里存的就是 id 的集合。精炼**只作用于玩家挑中的那一张**，
 * 所以"哪一张被精炼过"必须是这张牌自己的属性：被精炼的那一张换一个 id（后缀 `+`，
 * 见 `cards/registry.ts`）。于是同名的两张可以一张 4 伤一张 7 伤，
 * 而牌堆里存的仍然只是字符串。
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
 * 敌人机制。**一条机制只改一件事**，而且改的是玩家已经会做的那个决定 ——
 * 这不是"给怪加个被动"，是"逼你换一种打法"。
 *
 *   reviewer  一回合没答对，额外打你 3 点      → 不许磨
 *   pierce    攻击无视一半格挡                 → 不许纯守
 *   leech     你答错，它回血                    → 错一次赔两次
 *   oblivion  抓住你错得最多的主题              → 补短板
 *   lethe     你每错一次，它永久 +1 攻          → 一次都不许错
 *   thorns    你每次打它，自己被反伤            → 少打薄刀，多打重刀
 *   bulwark   你答错，它叠格挡                  → 错了就再也打不动
 *   fog       本场每回合少抽 1 张               → 牌组要薄、要准
 *   siphon    它打中你，你下回合少 1 点行动力    → 挡不住就连锁崩
 *   haste     它每回合攻击 +1                   → 拖不得
 */
export type Mech =
  | 'reviewer' | 'pierce' | 'oblivion' | 'leech' | 'lethe'
  | 'thorns' | 'bulwark' | 'fog' | 'siphon' | 'haste';

/**
 * 一个「大阶段」（幕）。五幕 = 100 层，每幕 20 层，幕末一只 Boss。
 *
 * 为什么按幕分而不是一路线性加强：一局 100 层太长，玩家需要一个能记住的
 * 结构 —— "我在第三幕，这一带的怪都反伤"比"我在第 47 层"更像一句人话。
 * 每幕有自己的**色相**和**机制母题**：颜色告诉你换地方了，机制告诉你换打法了。
 */
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
  /** 立绘色相偏移。同一幕的怪共用一个色相，这是"风格"最省的那一层 */
  hue: number;
  /** 幕内每层（除去首行与末两行）的节点权重 */
  mix: { fight: number; event: number; rest: number; elite: number };
}

/**
 * 敌人立绘。全部是"纯黑底 + 发光主体"的 jpg，screen 混合后黑即透明；
 * 同一立绘换 hue 就是一个新怪 —— 但新机制值得配新皮，别全靠调色。
 */
export type ArtKey =
  | 'shard' | 'examiner' | 'oblivion'   // 初代三件套
  | 'moth' | 'grub' | 'inquisitor' | 'tide' | 'lethe'
  // 四幕 Boss 的专属立绘：幕末那只必须长得和别处不一样，
  // 否则"换了一层楼"这件事只能靠血量条察觉
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
   * 机制的量。不写就用 `BAL.mech` 里的默认值。
   * 同一条机制在不同幕可以有不同强度：Boss 的反伤比小怪重，这是最省的一档刻度。
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

/**
 * 一次答题的流水。只给统计 / 阶段摘要 / 导出用，不参与战斗结算。
 *
 * 存题号而不是题干：阶段一换题库，题干会变，题号才是"同一道题"的锚。
 * `stem` 截断保存，只为了让人读得懂摘要，不承担唯一性。
 */
export interface AnswerRecord {
  qid: string;
  /** 这道题在来源题库里的主题（内容归属） */
  topic: string;
  /** 这一手是在哪一章问的。章节记忆和结算按它归档；两者通常相同，回退题池时会不同。 */
  stageTopic: string;
  stage: number;
  right: boolean;
  choice: number;
  answer: number;
  stem: string;
}

/* ────────────────────────────────────────────────────────────
   运行状态的类型。只描述形状，不持有实例 —— 唯一的可变状态对象
   在 `infra/state.ts`，所有工具包都通过它读写同一份 G。
   ──────────────────────────────────────────────────────────── */

export interface Feedback {
  idx: number;
  /** 这一手问的题号。统计、错因、阶段记忆都认它。 */
  qid: string;
  choice: number;
  right: boolean;
  /** 总伤害（分段结算后相加） */
  dmg: number;
  absorbed: number;
  blk: number;
  /** 这一手触发的是哪种效果 */
  eff: Eff;
  /** 每段原始伤害（结算前、未扣敌方格挡），只用于演出分段；展示请读 `parts` */
  hits: number[];
  /**
   * 每段实际伤害与它被格挡吸收的量。
   *
   * 多段攻击不能拿 `hits` 当"造成了多少"：`hits` 是结算前的值，
   * 敌人有格挡时 `hits` 相加会大于实际总伤。反馈面板必须读这一份。
   */
  parts: { d: number; a: number }[];
  /** 内化回的血 */
  heal: number;
  /** 专注抽的牌 */
  draw: number;
  apNote: string;
  /** 这一手的伤害里有多少来自前序出牌（把因果写进结算，而不是只报一个总数） */
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
  /** 这一局最后一章的题目主题。卡题解耦后，结算页要写清"这一章在问什么" */
  stageTopic: string;
  /** 最后一章本局的答题数（来自答题流水，不是卡牌记忆） */
  stageOk: number;
  stageBad: number;
  /** 这一局的开局模式名字 —— 结算页要写清楚"这局是怎么搭起来的" */
  mode: string;
  runOk: number;
  runBad: number;
  floors: number;
  deckSize: number;
  /** 结算时牌组里有几种卡种 */
  kinds: number;
  mastery: number;
  rows: ReportRow[];
  /** 这一局靠"答对"额外抽到的张数：知识变输出的那条线走的是信息，不是倍率 */
  answerDraws: number;
  /** 这一局获得的增益（名字），没有就是空数组 */
  powers: string[];
  verdict: string;
}

export type Panel =
  | { k: 'none' }
  /**
   * 开局：选学习 / 复习 / 测试，分别带 2 / 1 / 0 个初始增益。
   *
   * 模式只决定开局能力数量，不改答错价码、不改卡面、不改题库。
   */
  | { k: 'boon' }
  /**
   * `q` 是点开那一刻从题池抽出的题目快照：答题期间题库换不掉这一手。
   */
  | { k: 'question'; idx: number; qid: string; topic: string; q: Question; view: QView }
  | { k: 'feedback'; fb: Feedback }
  | { k: 'reward'; cards: CardDef[]; ledger?: boolean }
  /**
   * 精英 / Boss 战后掉落的增益。**只有一个**（`id`），没有"要不要"的分支：
   * 掉落不是成本，玩家没有理由拒绝它。
   */
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
  /** 开局选的学习 / 复习 / 测试模式；它决定开局塞哪几个增益 */
  mode: ModeId | null;
  /**
   * 当前第几幕（1..5）。地图只装当前这一幕的 20 行 —— 100 层不画成一张图，
   * 否则一屏 100 个点，等于没有地图。层号用 `floorOf()` 换算成 1..100。
   */
  stage: number;
  /**
   * 这一幕对应哪一章。它只决定「这一阶段的 BANK 是什么」，不决定卡能打多少。
   * 卡和题解耦之后，`card.topic` 不再参与抽题。
   */
  stageTopic: string;
  panel: Panel;
  log: LogLine[];
  /**
   * 牌组 = 这张牌出现了几次。**只有 id**（见 `CardId` 的说明）。
   * 精炼过的那一张带 `+` 后缀，所以它和同名的另一张是两个不同的 id ——
   * 精炼因此只作用于玩家挑中的那一张，不需要额外的实例层。
   */
  deck: CardId[];
  /**
   * 这一局已经拿到的增益，**跨战斗保留**（新开一局才清空）。
   *
   * 拾取即生效，所以它读起来是"我这局多会了什么"，不是"这一场我打了什么"。
   * 战斗开始不再清空它 —— 那是"增益是牌"那一版的规则，和掉落即生效互斥。
   */
  powers: PowerId[];
  hp: number;
  maxHp: number;
  block: number;
  ap: number;
  apMax: number;
  turn: number;
  enemy: Foe | null;
  /**
   * 三个牌堆也只放 id。表现层曾用 `Map<CardInst, DrawFx>` 认"这张牌飞到哪了"，
   * 靠对象身份；换成 id 之后同名牌共用一条飞行记录，这恰好是想要的语义：
   * 两份基础斩击长得一模一样，玩家也从不区分它们。
   */
  draw: CardId[];
  discard: CardId[];
  hand: CardId[];
  map: MapNode[][];
  pos: { r: number; i: number } | null;
  node: MapNode | null;
  seen: Record<string, boolean>;
  /**
   * 本场每张知识卡已经答对几次（card id → 次数）。
   *
   * 攒到这张牌的等级要求（C 0 / B 1 / A 2 / S 3，见 `cards/grade.ts`）之后，
   * 这一场剩下的时间里它直接打、不再出题。**每场战斗清零**：
   * 跨场累计到第三幕就几乎全部免答，学习循环会空掉。
   */
  charge: Record<string, number>;
  /**
   * 本场还没点开过的**新题**（点开一张牌消耗一道，答错也消耗）。
   *
   * 每场战斗开始时按牌组算一次题量（`battleQuestionCount`），从当前章题库里
   * 只抽还没到本局 3 次上限的题。新题用完**不会锁牌**：`takeQuestion` 会从本章
   * 挑被问得最少的一道重复问，顶栏显示「题 复用」。这条兜底是刻意的 ——
   * 一章只有十几道题，硬锁会让"答错多的人"在长战斗里一张知识卡都打不出去。
   */
  qLeft: Question[];
  /**
   * 本**局**每道题被抽到过几次（qid → 次数）。到 `MAX_PICK_PER_RUN`（=3）就不再进
   * 本场的新题池；整章都问满之后，`takeQuestion` 会复用"被问得最少"的那些题，
   * 所以计数在复用路径上仍会继续涨。它跨场保留、到 `startRun` 才清。
   *
   * 它和章节记忆分开：记忆记对错，这里记曝光。
   * 上一版叫 `qSeen`、存"本场问过的题号数组"，语义是"本场内不重复"；
   * 换成"本局最多 3 次"之后，它必须跨场活着，也就从集合变成了计数。
   */
  qPicked: Record<string, number>;
  /** 本局答题流水（环形，最近 N 条）。阶段摘要与导出读它，不参与规则。 */
  answers: AnswerRecord[];
  topicWrong: Record<string, number>;
  okThisTurn: number;
  /**
   * 本回合答对了「本局错得最多的主题」—— 存主题名，不是计数。
   *
   * 遗忘 Boss 的 -3 是"这一回合"的，所以每回合清零；存主题而不是布尔，
   * 是因为 topTopic() 可能在同一回合里被新的错误改写，结算时要重新对一次。
   */
  topOkTopic: string | null;
  /**
   * 「一场一次」的增益，哪些这一场已经用掉了。
   *
   * 装订线 / 书签 / 橡皮 / 书套 / 批注 / 草稿纸 / 放大镜 / 荧光笔 / 胶水壶……
   * 分支各不相同，但形态是同一个：**这一场只兑现一次**。旧版给每张开一个
   * `xxxUsed` 布尔，于是加一张就要同时改三处（类型 / 初值 / 清零），漏一处
   * 就是"这个增益只在第一场响"的静默 bug。
   *
   * 现在只有一张表，键是 `PowerId`。读写只能走 `cards/powers.ts` 的
   * `onceThisFight(id)` —— 它把"有没有这个增益 + 用过没有 + 记账"合成一步，
   * 调用点不会漏记账。按 id 分槽，所以先触发的增益不会吃掉别的机会。
   *
   * **按场清，不按回合清**：这些增益整局常驻，一局四十来场，按回合给
   * 每一条都会变成一整条额外的血条。由 `startBattle` 调 `clearOnceUsed()`。
   */
  onceUsed: Partial<Record<PowerId, boolean>>;
  /**
   * 「一幕一次」的增益：账本 / 地图册。过幕时清（`clearStageOnce`）。
   *
   * 和 `onceUsed` 同一形状、同一套读写（`onceThisStage`），只是清的时机不同。
   * 分开两张表而不是在键上加前缀：前缀会渗进存档格式，而"这一场用没用过"
   * 和"这一幕用没用过"本来就是两个不同生命周期的东西。
   */
  onceStage: Partial<Record<PowerId, boolean>>;
  /** 「整局一次」的增益：许愿条。开局时清（`startRun`） */
  onceRun: Partial<Record<PowerId, boolean>>;
  /**
   * 索引贴留下的格挡：回合结束时保留几点到下一回合。
   *
   * 必须是 G 上的字段而不是就地读 `G.block` —— `startTurn` 会先 `setBlock`
   * 把格挡清掉，那时上一回合的账早就没了。`endTurn` 记，`startTurn` 兑现。
   */
  carryBlock: number;
  /**
   * 抛光布让精炼多给几点。`cards/registry.ts` 的 `statOf` 读它。
   *
   * 之所以是一个状态字段而不是 `rulesOf()` 的一项：`statOf` 在 cards 层最底层，
   * 而 `rulesOf` 依赖 `G.powers` 与 `BAL`，反过来 import 会成环。
   * 增益在拾取时把这一档写进 G，`statOf` 只读一个数 —— 依赖方向不倒。
   */
  upGrade: number;
  /**
   * 荧光笔留给这一手的额外退款点数。答对时由 `answer()` 记账、当场兑现，
   * 所以它只活一手；放在 G 上是因为退款结算在函数末尾，中间隔着一整段分支。
   */
  markerRefund: number;
  /**
   * 课表这一回合是否已经给过基础牌格挡。值是 `G.turn`，不是布尔：
   * 换回合直接比数字，不用额外清账；`startBattle` 归零，避免跨场沿用。
   */
  syllabusTurn: number;
  /** 本局靠"答对"额外抽到的张数。只给结算页用，不参与任何结算 */
  answerDraws: number;
  /** 本回合靠答对抽了几张，受 `BAL.answerDrawCap` 限制，`startTurn` 清零 */
  answerDrawsThisTurn: number;
  /**
   * 本回合**实际抽到手**的牌数：起手抽、专注抽、答对抽、补抽都算。
   * `atkFrom:'drawn'` 的卡读它，`startTurn` 清零。不是「还剩几张」，
   * 是「这一回合已经看过多少张」—— 抽得越多，那张卡越重。
   */
  drawnThisTurn: number;
  /**
   * 本回合真正生效的牌数（答错不计）。墨水瓶数第 3 张，节拍器看第一次三连；
   * 每回合由 `resetTurnState` 清零。
   */
  cardsThisTurn: number;
  /**
   * 本场每张卡打出过几次（card id → 次数）。`grow` 的卡读它，`startBattle` 清零。
   * 按**牌种**（剥掉精炼后缀）记：同名两张副本共用"这张牌被打了几次"。
   */
  cardPlays: Record<string, number>;
  /**
   * 上一张牌留给**下一张真正生效的牌**的加成。
   * 只有 `strikeWith` 真的执行才消耗：答错这一手作废，加成继续留着，
   * 不会白白蒸发。跨回合保留（玩家能在 HUD 上看见它），`startBattle` 清。
   */
  nextBoost: { mul: number; add: number; from: string } | null;
  /**
   * 下回合行动力要扣掉几点（siphon 的账）。敌人命中时记账，`startTurn` 结算并清零。
   * 它记在"下回合"而不是"这回合"，因为玩家挨打时这回合的行动力早就花完了 ——
   * 当场扣等于没扣，延迟一回合才真的疼，而且看得见（行动力球会少一格）。
   */
  apDown: number;
  /** 本场每回合少抽几张（fog）。`startBattle` 按怪的机制写入，跨场必须清回 0 */
  drawCut: number;
  runOk: number;
  runBad: number;
  floors: number;
  pending: null | 'clear' | 'win' | 'dead';
  /**
   * 事件里"选完牌才付的血"。>0 表示有一笔待付款项挂着。
   *
   * 它必须是 G 上的字段，而不是 journey/events.ts 里的模块变量：**取消**
   * 走的是 combat 层的 `cancelPanel`，那一层不认识 journey（依赖方向是
   * journey → combat，反过来会成环）。放在 G 上，两边读写的是同一份。
   */
  pendingCost: number;
  busy: boolean;
}
