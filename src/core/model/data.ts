import type { FoeTpl, ModeDef, NodeType, PowerDef, RunMode, StageDef, StagePlan } from './types';

/**
 * 每一幕 20 层。100 层 = 5 × 20。
 *
 * 20 这个数不是凑的：一屏地图能舒服地显示 9 行，20 行刚好是"两次滚屏"的量，
 * 玩家在一幕里能记住"上面还有多少、Boss 在顶上"。再长，一幕就不像一段路，
 * 而像一条走廊。
 */
export const STAGE_ROWS = 20;

/**
 * 五幕。**每幕换一整套物种，不是把同一只怪加血。**
 *
 * 幕与幕之间有三层差别，从便宜到贵：
 *   1. 色相 —— 同一幕的立绘共用一个 hue，一眼看出"换地方了"；
 *   2. 招式表 —— 虫蛀区塞杂念、报刊区多段轻击、修复室先叠甲、禁书区抓你的错；
 *   3. 机制母题 —— 每一幕只教一种新打法（见各幕 mech），玩家一次只学一件事。
 *
 * 第一幕刻意什么机制都不教：那一幕只回答"这游戏怎么打"。
 */
export const STAGES: StageDef[] = [
  {
    i: 1, key: 'catalogue', name: '目录厅', sub: '明亮、整齐，纸还是新的',
    color: '#4fd6cf', hue: 0,
    mix: { fight: 0.38, event: 0.2, rest: 0.26, elite: 0.16 },
  },
  {
    i: 2, key: 'stacks', name: '虫蛀的借阅区', sub: '潮气、木屑，书脊里有东西在动',
    color: '#7fc26a', hue: 130,
    mix: { fight: 0.34, event: 0.22, rest: 0.28, elite: 0.16 },
  },
  {
    i: 3, key: 'periodicals', name: '报刊与副本', sub: '冷白的灯，铅字的味道，同一页在无限复制',
    color: '#6f9ee8', hue: 205,
    mix: { fight: 0.36, event: 0.16, rest: 0.28, elite: 0.2 },
  },
  {
    i: 4, key: 'bindery', name: '修复室', sub: '胶、线、皮革，还有一台从不熄火的熔炉',
    color: '#e08048', hue: 25,
    mix: { fight: 0.34, event: 0.14, rest: 0.28, elite: 0.24 },
  },
  {
    i: 5, key: 'forbidden', name: '禁书区', sub: '灯照不到的地方，书页自己在翻',
    color: '#a78bfa', hue: 320,
    mix: { fight: 0.32, event: 0.12, rest: 0.28, elite: 0.28 },
  },
];

export const stageOf = (i: number): StageDef => STAGES[Math.max(0, Math.min(STAGES.length - 1, i - 1))];

/**
 * 示例课程表：五幕对应五章。
 *
 * 阶段（Stage）是塔里的 20 层容器，章节（topic）才是这一段学什么；
 * `library/stage.ts` 按这张表，从**来源题库**里切出当前阶段的 BANK。
 * 换科目时只改这里（以及题库里的 `## 主题` 名），地图、敌人、卡池都不动。
 *
 * 内置题库现在是临时单词表（`packs/words.md`，400 题 / 5 章）；原来的 CS 三份 md
 * 仍留在 `packs/` 里，可以从标题页导入。
 */
export const CURRICULUM: StagePlan[] = [
  { stage: 1, topic: '基础动词', title: '第 1 章 · 基础动词' },
  { stage: 2, topic: '生活名词', title: '第 2 章 · 生活名词' },
  { stage: 3, topic: '形容词与副词', title: '第 3 章 · 形容词与副词' },
  { stage: 4, topic: '学术高频', title: '第 4 章 · 学术高频' },
  { stage: 5, topic: '抽象概念', title: '第 5 章 · 抽象概念' },
];

/** 第 `stage` 幕对应哪一章。越界时夹到最后一章，不让一局因为数据缺失开不起来。 */
export const planFor = (stage: number): StagePlan =>
  CURRICULUM[Math.max(0, Math.min(CURRICULUM.length - 1, stage - 1))];

/**
 * 敌人。招式是循环表，玩家能看见下一步要干什么 —— 这样"这回合该攻还是该守"
 * 才是一个能推理的决定，而不是掷骰子。
 *
 * 排版说明：按幕分段，一幕之内「小怪 → 精英 → Boss」。
 * 数值只做一件事 —— 逐幕抬高血线与伤害；**机制才是每一幕的身份**。
 */
export const FOES: FoeTpl[] = [
  /* ── 第一幕 · 目录厅 ────────────────────────────────────────
     这一幕没有机制。它只回答一个问题：一张牌 = 一道题，答对才打得出去。 */
  {
    key: 'shard', name: '记忆的碎片', type: 'fight', art: 'shard', stage: 1, tag: '普通',
    hp: 50, dmg: 7, moves: [{ k: 'atk', m: 1 }],
  },
  {
    key: 'examiner', name: '复习官', type: 'fight', art: 'examiner', stage: 1, tag: '普通',
    hp: 58, dmg: 8, moves: [{ k: 'atk', m: 1 }], mech: 'reviewer',
  },
  {
    key: 'grub', name: '书蛀', type: 'fight', art: 'grub', stage: 1, tag: '普通',
    hp: 56, dmg: 7, moves: [{ k: 'atk', m: 0.75 }, { k: 'atk', m: 1 }], mech: 'leech',
  },
  {
    key: 'drift', name: '走神', type: 'fight', art: 'moth', stage: 1, tag: '普通',
    hp: 46, dmg: 6, moves: [{ k: 'jam', n: 1 }, { k: 'jam', n: 1 }, { k: 'atk', m: 1 }],
  },
  {
    key: 'inquisitor', name: '主考官', type: 'elite', art: 'inquisitor', stage: 1, tag: '精英',
    hp: 96, dmg: 11,
    moves: [{ k: 'atk', m: 1.25 }, { k: 'def', v: 14 }, { k: 'atk', m: 0.7, times: 2 }],
    mech: 'reviewer',
  },
  {
    key: 'rereader', name: '复读者', type: 'elite', art: 'examiner', stage: 1, tag: '精英',
    hp: 88, dmg: 9,
    moves: [{ k: 'atk', m: 1.1 }, { k: 'atk', m: 0.5, times: 3 }, { k: 'jam', n: 2 }],
  },
  {
    key: 'cataloguer', name: '编目者', type: 'boss', art: 'cataloguer', stage: 1, tag: 'BOSS',
    hp: 112, dmg: 12,
    moves: [{ k: 'atk', m: 1 }, { k: 'jam', n: 2 }, { k: 'atk', m: 1.3 }],
    mech: 'reviewer',
  },

  /* ── 第二幕 · 虫蛀的借阅区 ──────────────────────────────────
     母题：**你的牌堆**。塞杂念、少抽牌 —— 它不跟你打，它让你没牌可打。 */
  {
    key: 'bookmoth', name: '蠹蛾', type: 'fight', art: 'moth', stage: 2, tag: '普通',
    hp: 66, dmg: 8, moves: [{ k: 'jam', n: 1 }, { k: 'atk', m: 1 }], mech: 'fog',
  },
  {
    key: 'damp', name: '湿页', type: 'fight', art: 'shard', stage: 2, tag: '普通',
    hp: 72, dmg: 8, moves: [{ k: 'def', v: 12 }, { k: 'atk', m: 1.1 }],
  },
  {
    key: 'grubqueen', name: '书蛀母', type: 'fight', art: 'grub', stage: 2, tag: '普通',
    hp: 78, dmg: 9, moves: [{ k: 'atk', m: 0.8 }, { k: 'atk', m: 1 }], mech: 'leech',
  },
  {
    key: 'stitchworm', name: '线虫', type: 'fight', art: 'grub', stage: 2, tag: '普通', hue: 100,
    hp: 70, dmg: 8, moves: [{ k: 'atk', m: 0.55, times: 2 }, { k: 'atk', m: 1 }],
  },
  {
    key: 'wormking', name: '蠹王', type: 'elite', art: 'grub', stage: 2, tag: '精英', hue: 150,
    hp: 120, dmg: 11,
    moves: [{ k: 'jam', n: 1 }, { k: 'atk', m: 1.2 }, { k: 'atk', m: 0.6, times: 2 }],
    mech: 'fog',
  },
  {
    key: 'copyist', name: '抄书吏', type: 'elite', art: 'examiner', stage: 2, tag: '精英', hue: 130,
    hp: 112, dmg: 10,
    moves: [{ k: 'atk', m: 1.15 }, { k: 'def', v: 14 }], mech: 'bulwark', mechV: 8,
  },
  {
    key: 'devourer', name: '饕餮书虫', type: 'boss', art: 'devourer', stage: 2, tag: 'BOSS', hue: 110,
    hp: 150, dmg: 12,
    moves: [{ k: 'atk', m: 1 }, { k: 'jam', n: 2 }, { k: 'atk', m: 0.65, times: 2 }],
    mech: 'leech',
  },

  /* ── 第三幕 · 报刊与副本 ────────────────────────────────────
     母题：**重复**。多段、复印、反伤 —— 一刀切不动，得一次打穿。 */
  {
    key: 'ghostprint', name: '影印', type: 'fight', art: 'shard', stage: 3, tag: '普通', hue: 205,
    hp: 78, dmg: 9, moves: [{ k: 'atk', m: 0.5, times: 3 }], mech: 'thorns', mechV: 1,
  },
  {
    key: 'typeblock', name: '铅字块', type: 'fight', art: 'shard', stage: 3, tag: '普通', hue: 220,
    hp: 92, dmg: 9, moves: [{ k: 'def', v: 14 }, { k: 'atk', m: 1.1 }],
  },
  {
    key: 'compositor', name: '排字工', type: 'fight', art: 'examiner', stage: 3, tag: '普通', hue: 205,
    hp: 84, dmg: 10, moves: [{ k: 'atk', m: 1 }, { k: 'jam', n: 2 }], mech: 'pierce',
  },
  {
    key: 'carbon', name: '复写纸', type: 'fight', art: 'moth', stage: 3, tag: '普通', hue: 205,
    hp: 76, dmg: 9, moves: [{ k: 'atk', m: 1.1 }, { k: 'atk', m: 1.1 }],
  },
  {
    key: 'duplex', name: '双面印刷机', type: 'elite', art: 'examiner', stage: 3, tag: '精英', hue: 210,
    hp: 135, dmg: 11,
    moves: [{ k: 'atk', m: 0.55, times: 3 }, { k: 'def', v: 16 }], mech: 'thorns', mechV: 3,
  },
  {
    key: 'stereotype', name: '铅版巨人', type: 'elite', art: 'inquisitor', stage: 3, tag: '精英', hue: 205,
    hp: 145, dmg: 12,
    moves: [{ k: 'atk', m: 1.25 }, { k: 'buff', v: 2 }], mech: 'haste',
  },
  {
    key: 'imprinter', name: '压印之主', type: 'boss', art: 'imprinter', stage: 3, tag: 'BOSS', hue: 195,
    hp: 178, dmg: 13,
    moves: [{ k: 'atk', m: 1 }, { k: 'atk', m: 0.55, times: 3 }, { k: 'def', v: 18 }],
    mech: 'thorns', mechV: 3,
  },

  /* ── 第四幕 · 修复室 ────────────────────────────────────────
     母题：**甲与时间**。先叠甲、每回合变强 —— 它不急着杀你，它在等你打不动。 */
  {
    key: 'gluebeast', name: '胶合兽', type: 'fight', art: 'grub', stage: 4, tag: '普通', hue: 20,
    hp: 96, dmg: 10, moves: [{ k: 'atk', m: 1 }, { k: 'def', v: 16 }],
  },
  {
    key: 'stitchdoll', name: '缝线傀儡', type: 'fight', art: 'moth', stage: 4, tag: '普通', hue: 25,
    hp: 102, dmg: 10, moves: [{ k: 'atk', m: 0.6, times: 2 }, { k: 'buff', v: 2 }], mech: 'haste',
  },
  {
    key: 'leathercover', name: '皮革封面', type: 'fight', art: 'shard', stage: 4, tag: '普通', hue: 25,
    hp: 112, dmg: 10, moves: [{ k: 'def', v: 18 }, { k: 'atk', m: 1.2 }], mech: 'bulwark', mechV: 10,
  },
  {
    key: 'gluepot', name: '熔胶炉', type: 'fight', art: 'oblivion', stage: 4, tag: '普通', hue: 30,
    hp: 90, dmg: 11, moves: [{ k: 'atk', m: 1.2 }, { k: 'atk', m: 1.2 }],
  },
  {
    key: 'binder', name: '装订师', type: 'elite', art: 'examiner', stage: 4, tag: '精英', hue: 25,
    hp: 150, dmg: 12,
    moves: [{ k: 'atk', m: 1.2 }, { k: 'def', v: 18 }, { k: 'atk', m: 0.6, times: 2 }],
    mech: 'bulwark', mechV: 12,
  },
  {
    key: 'press', name: '压书机', type: 'elite', art: 'inquisitor', stage: 4, tag: '精英', hue: 20,
    hp: 160, dmg: 13,
    moves: [{ k: 'atk', m: 1.3 }, { k: 'buff', v: 3 }], mech: 'haste',
  },
  {
    key: 'bound', name: '装订之兽', type: 'boss', art: 'bound', stage: 4, tag: 'BOSS', hue: 25,
    hp: 205, dmg: 14,
    moves: [{ k: 'atk', m: 1 }, { k: 'def', v: 20 }, { k: 'atk', m: 0.65, times: 2 }],
    mech: 'bulwark', mechV: 14,
  },

  /* ── 第五幕 · 禁书区 ────────────────────────────────────────
     母题：**你的错误**。它知道你哪块最弱，而且每次都往那儿打。 */
  {
    key: 'whisperer', name: '低语者', type: 'fight', art: 'examiner', stage: 5, tag: '普通', hue: 320,
    hp: 110, dmg: 11, moves: [{ k: 'jam', n: 2 }, { k: 'atk', m: 1.15 }], mech: 'siphon',
  },
  {
    key: 'blankleaf', name: '空页', type: 'fight', art: 'shard', stage: 5, tag: '普通', hue: 320,
    hp: 118, dmg: 11, moves: [{ k: 'atk', m: 1.05 }, { k: 'def', v: 20 }],
  },
  {
    key: 'ashencopy', name: '灰烬的抄本', type: 'fight', art: 'grub', stage: 5, tag: '普通', hue: 300,
    hp: 105, dmg: 11, moves: [{ k: 'atk', m: 0.6, times: 3 }], mech: 'pierce',
  },
  {
    key: 'fgotten', name: '遗忘的读者', type: 'fight', art: 'moth', stage: 5, tag: '普通', hue: 320,
    hp: 100, dmg: 11,
    moves: [{ k: 'atk', m: 1 }, { k: 'jam', n: 2 }, { k: 'atk', m: 1 }], mech: 'lethe',
  },
  {
    key: 'silencer', name: '缄默者', type: 'elite', art: 'inquisitor', stage: 5, tag: '精英', hue: 320,
    hp: 165, dmg: 13,
    moves: [{ k: 'atk', m: 1.15 }, { k: 'atk', m: 0.7, times: 2 }], mech: 'siphon',
  },
  {
    key: 'lethe', name: '忘川', type: 'elite', art: 'lethe', stage: 5, tag: '精英',
    hp: 175, dmg: 13,
    moves: [{ k: 'atk', m: 1 }, { k: 'jam', n: 2 }, { k: 'atk', m: 0.65, times: 2 }, { k: 'buff', v: 2 }],
    mech: 'lethe',
  },
  {
    key: 'oblivion', name: '遗忘', type: 'boss', art: 'oblivion', stage: 5, tag: 'BOSS',
    hp: 260, dmg: 15,
    moves: [{ k: 'atk', m: 1 }, { k: 'atk', m: 0.6, times: 2 }, { k: 'buff', v: 2 }],
    mech: 'oblivion',
  },
];

/**
 * 增益牌。它们原来是"遗物"——挂在界面右上角、白给、永远生效。
 *
 * 转成牌之后，每一张都要求你为它付一次钱：抽到手上、花行动力、占掉一个手牌位。
 * 换来的是本场战斗剩下的时间里持续生效。所以这套东西现在和知识卡是同一个货币体系，
 * 不再是"局外成长"。
 *
 * 它们的费用**不会退**：增益牌不答题，也就没有"答对"这回事。所以一张 2 费的
 * 沙漏是实打实的一回合节奏投资，值不值由这一场打多久决定。
 *
 * 每种只有一张（`openBossReward` 会排除已拥有的），所以不需要处理同名叠加。
 *
 * ## 它们必须对着**现行的**机制说话
 *
 * 这一版把答错的代价从"扣行动力 + 锁牌"改成了"这一场少一道新题"（见
 * `combat/questions.ts`），于是有好几张牌的描述当场失效：
 *
 *   装订线  原写"第一次答错不花行动力" —— 答错本来就不扣行动力，这句话恒真，等于没有效果
 *   荧光笔  原写"第一次答对抽 1 张"   —— 和双面镜逐字相同，两张牌是同一张
 *   长明灯  描述里写"答错锁卡的那几回合尤其要紧" —— 锁卡这条规则已经删了
 *
 * 重排之后每张牌只碰一条**现行**规则，六张互不重叠：
 *
 *   沙漏    行动力上限         → 节奏（每回合多一次出手）
 *   索引卡  每回合抽牌数       → 信息（多看见一张）
 *   长明灯  每回合开局格挡     → 防御（不必为了挡而放弃答题）
 *   双面镜  答对后抽牌         → 答题 → 信息
 *   荧光笔  答对退回的行动力   → 答题 → 节奏（和双面镜分开，一个给牌一个给行动力）
 *   装订线  答错时那一手       → 答错的补偿（对着"代价落在题池上"这条新规则）
 */
export const POWERS: PowerDef[] = [
  {
    id: 'hourglass', icon: '时', name: '沙漏', cost: 1, color: '#e8b64c',
    card: '每回合行动力 +1',
    desc: '把时间摊平：这一手先把自己赚回来，之后每一回合都多一次出手机会。',
  },
  {
    id: 'index', icon: '索', name: '索引卡', cost: 2, color: '#6f9ee8',
    card: '每回合多抽 1 张牌',
    desc: '手上多一张牌，就多一道能答的题。牌组越厚它越值钱。',
  },
  {
    id: 'binder', icon: '订', name: '装订线', cost: 1, color: '#4fd6cf',
    card: '每回合第一次答错，那一手按一半结算',
    desc: '答错不再扣行动力、也不再锁牌，代价落在"本场少一道新题"上。'
      + '这张牌改的是另一半：错了也留下半份输出，那道新题不至于白掉。',
  },
  {
    id: 'mirrorcard', icon: '镜', name: '双面镜', cost: 0, color: '#a78bfa',
    card: '本场每回合第一次答对，抽 1 张',
    desc: '想起来的越多，看见的越多。它不要钱，只占一张牌位 —— 而牌组里多一张，'
      + '就意味着少一张能答题的知识卡。',
  },
  {
    id: 'lamp', icon: '灯', name: '长明灯', cost: 1, color: '#e8c86c',
    card: '每回合开始获得 3 点格挡',
    desc: '灯亮着，就不再完全空手挨打。它买的是"这一回合可以先去答题，不必先花一张牌去挡"。',
  },
  {
    id: 'marker', icon: '笔', name: '荧光笔', cost: 1, color: '#d06fa8',
    card: '本场每回合第一次答对，退回的行动力 +1',
    desc: '答对一手只退 1 点，这张牌让每回合的**第一**次答对退 2 点 —— '
      + '它买的是"先答对哪一张"这个顺序，不是答对本身。',
  },
];

export const POWER_BY_ID = Object.fromEntries(POWERS.map((p) => [p.id, p])) as Record<string, PowerDef>;

/**
 * 三种模式。**开局前由玩家选，整局不变** —— 不是按卡片进度自动切。
 *
 * 为什么是三种而不是按卡分档：卡片的稳固度只说明"这张卡你答对过几次"，
 * 说明不了"这一局你想干什么"。同一个人今天可能想第一次啃新题（学习），
 * 明天想把手里的东西过一遍（复习），后天想看看自己到底记住了没有（测试）。
 * 把选择权交回玩家，答错价码才是他自己选的，而不是调度器替他选的。
 *
 * 三种模式只在四件事上不同：答错补多少格挡、补不补抽、牌去哪、稳固度怎么变。
 * 卡面数值、题库、敌人都不动 —— 换模式不该让同一张牌变成另一张牌。
 *
 * 学习模式不是"更容易通关"的那个：它不补格挡、不补抽，只把答错的牌还给你。
 * 练习场负责让你见到错题，不负责让你通关；要通关去复习 / 测试。
 */
export const MODES: Record<RunMode, ModeDef> = {
  learn: {
    key: 'learn', name: '学习', tag: '还在学，允许错', color: '#4fd6cf',
    // 学习模式的宽恕只剩两处：牌回抽牌堆、稳固度掉得最少。
    // 不补格挡、不补抽 —— 它是练习场，不负责让你通关；要通关请去复习/测试。
    missBlock: 0, missDraw: false, stabDrop: 0.6, stabGain: 1,
    missDest: 'draw',
    cardLabel: '学习 · 答错会回来',
    hint: '答对退回 1 点行动力、攒一次免答；答错这一手作废，但不扣行动力 —— 代价是本场少一道新题。学习模式答错的牌会回牌堆，但不补格挡、不补抽：练习场不负责让你通关。',
  },
  review: {
    key: 'review', name: '复习', tag: '学过，要求稳', color: '#e8b64c',
    missBlock: 0.5, missDraw: true, stabDrop: 0.35, stabGain: 1.15,
    missDest: 'discard',
    cardLabel: '复习 · 答错等洗牌',
    hint: '答对退回 1 点行动力、攒一次免答；答错这一手作废，但不扣行动力 —— 代价是本场少一道新题。牌进弃牌堆、要等洗牌才回来，有格挡的牌按一半挡一下，答错补抽 1 张。',
  },
  test: {
    key: 'test', name: '测试', tag: '检验，错不起', color: '#d9534f',
    missBlock: 0, missDraw: true, stabDrop: 0.15, stabGain: 1.35,
    missDest: 'discard',
    cardLabel: '测试 · 答错没有补偿',
    hint: '答对退回 1 点行动力、攒一次免答；答错这一手作废，但不扣行动力 —— 代价是本场少一道新题。牌进弃牌堆，而且一格挡都不补（有格挡的牌也一样），答错补抽 1 张。',
  },
};

export const MODE_KEYS: RunMode[] = ['learn', 'review', 'test'];

/**
 * 全局强度旋钮。所有数值调整都集中在这里，方便无头模拟复跑。
 *
 * 缓冲那一组（开局白送格挡 + 答错补格挡）是配套的：第一回合手里全是没答过的卡，
 * 答错难免，给一点垫子，不然"答错"会直接等于掉血。而"答对 → 输出"那条曲线
 * 现在由两处供给：退回 1 点行动力（多打一张）和答对抽牌（多看见一张），
 * 两条都在机制内，没有倍率层。
 *
 * 这里曾经还有一张 ECON 表（识记/理解/迁移三档的退还与赔付）。押注机制
 * 整个拿掉之后，出牌的节奏收支只剩「一张 1 点、答对退回」这一条，那张表连带
 * tierStat、switchTier、结算页的标定表一起删了 —— 缘由见 README「押注机制被删掉了」。
 */
export const BAL = {
  /**
   * 敌人血量 / 伤害倍率。
   *
   * hp 从 1.28 降到 1.18 是费用体系上线时补的：0–3 费之后，一回合打得出的张数
   * 不再只由手牌数决定（3 费牌净花 2 点），平均一回合少打大半张。
   * 不补这一档，熟练水平的胜率会掉十个百分点以上 —— 掉的不是难度，是"这一回合
   * 明明有牌却打不出去"的憋屈。详见 README「费用是怎么定的」。
   *
   * 1.18 → 0.34 是两组改动叠加之后补的：起手 10 张里 8 张不答题（每回合能答的题
   * 从 2–3 道掉到 1 道），以及"答错不扣行动力"之后知识卡不再被锁 —— 两件事
   * 都把一场的答题量压掉了，而敌人血线还是按旧牌组定的。
   *
   * 0.34 是旧曲线下 800 局扫描里四档拉得最开的一档（7 / 19 / 22 / 33）；
   * 0.36 是 7 / 18 / 22 / 31，0.40 是 5 / 16 / 23 / 23（熟练反超精通），
   * 0.45 以上则在熟练/精通之间挤成一条线。**只动血量，不动伤害**：
   * 伤害是"挡不挡得住"的线，血量是"打不打得完"的线。
   *
   * 换成开方曲线（`BAL.growth`）之后这个数必须重扫：曲线本身抬了 1.8 倍，
   * 当时（一场 2.0 回合、伤害 1.24）0.34 会变成塔顶 90 血的小怪，熟练档掉到 13%。
   * 那一轮 400 局扫描：
   * 0.26 → 13/15/23/22（不单调），0.20 → 17/22/30/33（单调，四档拉开），
   * 0.14 → 31/40/41/46（挤在一起），0.09 → 46/60/64/70（太松）。
   * —— 这一轮把回合数拉长之后，"0.34 太厚"这个结论不再成立，见下面那段。
   *
   * ── 试过"整体加厚"，结论是不行（记在这里省得下次重跑）──
   *
   * 起因是 `npm run sim` 新加的那行「免答」统计：0.20 血量下一局 6.3 次免答里只有
   * **0.1 次**来自 A/S —— 一场只有 2.0 回合，同一张牌最多被打出两次，A 勉强、S 不可能。
   * 那条线本来是控通关率用的，实际上一直是空的。
   *
   * 400 局（复习模式，35/55/72/88）扫下来：
   *
   *   0.28 / 1.24 → 2.5 回合，12/16/23/22（熟练反超精通）
   *   0.34 / 1.24 → 2.8 回合，12/18/20/16（反转）
   *   0.40 / 1.24 → 3.1 回合，10/11/14/13（挤成一条线）
   *   0.34 / 1.15 → 2.9 回合，21/19/23/26（缩到 3 个点，800 局 21/24/26/24）
   *
   * 多出来的回合是**纯消耗**：多挨的那几下没人能靠"答得准"免掉，于是技巧曲线被磨平。
   * 所以这一版不动这两条，改由 `hpType` 只给精英 / Boss 加厚 —— 让少数几场硬仗
   * 拖到 3 回合以上，普通战斗仍然是两回合结束。
   */
  hp: 0.20, dmg: 1.24, baseHp: 70, baseAp: 3,
  /**
   * 精英 / Boss 的额外血量倍率（普通战斗不吃这一档）。
   *
   * 为什么单独给它们一档：A/S 免答要在一场里答对同一张牌 2/3 次，而普通战斗
   * 实测只有 2.0 回合 —— 一张牌一场最多被打出两次，所以那条线一直是空的
   * （sim 的「免答」统计：6.3 次/局里只有 0.1 次来自 A/S）。
   *
   * **把所有怪一起加厚走不通**：血量 0.20→0.34 之后回合数确实到了 2.8，但
   * 多出来的回合是纯消耗，技巧曲线从 22/27/33/35 摊成 21/24/26/24（800 局）——
   * 会的人只是多挨几下，胜率不再随水平上升。精英 / Boss 单独加厚则是
   * "少数几场硬仗变长"，普通战斗仍然两回合结束，节奏不被整体拖慢。
   *
   * 1.7 是 400 局扫出来的（普通怪 2.0 回合不变，整体 2.3–2.4 回合）。
   */
  hpType: 1.7,
  /**
   * 层号带来的强度增长。**整座塔一条坡，不是五个台阶。**
   *
   * 以前敌人的强度只跟"幕内第几行"有关（`1 + r * 0.018`），于是塔越高这件事
   * 只由 5 个模板台阶体现：第 1 幕第 20 层和第 2 幕第 1 层之间断一次，
   * 台阶之间完全平。玩家在第 15 层和第 18 层遇到的小怪一样厚 —— 爬塔就没了分量。
   *
   * 现在是一条**连续、单调、前陡后缓**的曲线，以全局层号（1..100）为自变量：
   *
   *   hp  = 1 + `floor` × √((f-1)/99)     第 1 层 ×1.00，第 20 层 ×1.44，
   *                                        第 50 层 ×1.63，第 100 层 ×1.80
   *   dmg = 1 + `all`   × (f-1)/99          第 100 层 ×1.20
   *
   * **为什么血量用开方、不用线性**：这是"前期太顺"的正解。
   * 线性曲线在塔底几乎是平的（每层 +0.6%），于是开局那张大牌能一路推到第 20 层；
   * 而开方曲线在前 20 层就抬了 44%，同样一张大牌到第 15 层就不再是一击必杀。
   * 后段放缓则是因为玩家的成长也在放缓 —— 牌组厚度、精炼、上场增益牌，
   * 都是"越到后面每一点收益越难拿"。两边同形，一条曲线才撑得住 100 层。
   *
   * 换幕那一刻**没有台阶**：斜率跟着绝对层号连续变化，第 21 层只比第 20 层厚
   * 一点点。以前 `r`（幕内行号）每幕归零，换幕时血量曲线会断一次 —— 断口处
   * 反而变薄，爬塔的手感就没了。
   */
  growth: { floor: 0.8, all: 0.2 },
  /**
   * 答对退回几点行动力。**一手最多退 1 点，不是全退**。
   *
   * 这一条是费用体系的地基：1 费牌答对等于免费（和引入费用之前一模一样），
   * 2 费净花 1 点、3 费净花 2 点。如果改成全退，费用就只剩"打不打得出去"这一层，
   * 高费牌会变成"同样免费、输出三倍"的纯优化 —— 一回合打一张 3 费比打三张 1 费
   * 永远更好，牌组会一路收敛到最贵的那几张，构筑就没了。
   *
   * 行动力因此同时买两样东西：出手的机会，和一次打得更重的机会。
   * 这条仍是技巧曲线唯一还站得住的原因 —— 答对就退回，会的人一回合能把整把牌打完，
   * 不会的人打两张就没油了。改成全退或全不退，请先跑 `npm run sim`。
   */
  refund: 1,
  /**
   * 双面镜给的规则：答对后抽几张、每回合最多几次。**基础状态下不生效**。
   *
   * 它本来是作为常驻规则设计的（"知识变成力量"的第二条线，接替免答 ×1.5），
   * 但 800 局实测：每回合白抽一张会把熟练档从 55% 抬到 66%、精通档抬到 95%，
   * 顶格没有余量。降级成一张增益牌提供的规则之后，它就成了"这一场我选择多看见一点"
   * 的构筑决定，而不是人人都吃的隐形补强。
   */
  answerDraw: 1, answerDrawCap: 1,
  /**
   * 答错时补抽几张、每回合最多补几次。**只在复习 / 测试模式生效**（学习模式不补）。
   *
   * 它不是"错误的奖励"，是**防止手牌枯竭**：答错的那张牌会离开手牌（进弃牌堆或回牌堆），
   * 不补的话，一个 55% 正确率的人会在两回合内把手牌打空 —— 那时他不是"答不对"，
   * 是"没牌可答"，两种体验差得很远。代价仍然落在"这一手没打出来"，不落在"整回合报废"。
   *
   * 学习模式刻意不补：它是练习场，手牌少了就少了；要"错一手不是错一回合"的保障，
   * 去复习 / 测试。
   */
  missDraw: 1, missDrawCap: 2,
  /**
   * 每回合抽几张。**这是整局节奏的默认值**，三种模式共用。
   *
   * 为什么是 5 而不是 6：起手牌组只有 10 张，抽 6 = 每回合看见牌组的 60%，
   * 于是牌组构筑几乎没有意义 —— 你下一回合大概率还能摸到那张关键牌。
   * 抽 5 之后一回合看见一半，"这一回合先打哪张、下一回合还会不会回来"
   * 才真的变成一个决定。同时敌人强度收了一档（hp 1.45→1.35、dmg 1.6→1.5），
   * 曲线因此保持不变（详见 README「数值是怎么定的」）。
   */
  drawPerTurn: 5,
  /** 普通战斗掉落增益牌的概率。精英必掉，这里是「偶尔见着一次」的那一档 */
  powerDrop: 0.15,
  /** 长明灯每回合给的格挡 */
  lampBlock: 3,
  /**
   * 每场战斗开局白送的格挡。第一回合手里全是没答过的牌，几乎叠不出挡，
   * 给这么一点让"答错"不至于直接变成掉血。
   */
  startBlock: 4,
  /**
   * 第一回合敌人不出攻击。默认关 —— 实测每场白送一回合太肥，
   * 55% 水平玩家的胜率会从 13% 跳到 31%。留着这个开关是为了还能试。
   */
  calmFirstTurn: false,
  /**
   * 同一种卡最多几张。没有上限的话，堆同一种卡 = 主动减少要答的题，
   * 等于用更少的学习换更强的战斗 —— 正好反过来。
   */
  maxCopies: 3,
  /**
   * 过一幕（打死幕 Boss）之后：最大生命加多少、回多少血。
   *
   * 100 层不是"8 层 × 12.5"：一局跨 5 幕，血量必须有一个**检查点**，
   * 否则第四幕开头就一定是残血进新地图，后面全在补血。回到满血是把"这一幕
   * 结束了"讲清楚的最直接方式，加最大生命则是让后面几幕的伤害曲线有地方落脚。
   */
  stageMaxHp: 14,
  /**
   * 复习点（rest）回复最大生命的百分之几。
   *
   * 这个数是 100 层的**血量水龙头**：一局大约 50 场战斗，每场掉 6–10 点，
   * 一共要还 400–500 点血。原来 8 层时 0.32 就够（一局两三个复习点），
   * 现在 0.32 会让玩家在第三幕就把血用完。所以它跟着层级一起放大 ——
   * 见 README「一百层的血量账」。
   */
  restPct: 0.62,
  /**
   * 各机制的量。怪身上写了 `mechV` 就用它自己的，没写读这里。
   *
   * 这些数都在"一次决定"的量级上：反伤 1 点让你少打薄刀，格挡 8 点让你
   * 不敢答错，行动力 1 点是半张牌。不要把它们调成"一击必杀"的规模 ——
   * 机制是换打法的提示，不是随机死亡。
   */
  mech: {
    thorns: 1, bulwark: 8, siphon: 1, haste: 1, leech: 4,
    reviewer: 3, fog: 1, lethe: 1, oblivion: 4, oblivionReduce: 3,
  },
};

export const NODE_META: Record<NodeType, { k: string; g: string; color: string }> = {
  fight: { k: '战斗', g: '⚔', color: '#c9744a' },
  elite: { k: '精英', g: '☠', color: '#d9534f' },
  rest: { k: '复习', g: '✦', color: '#4fd6cf' },
  event: { k: '事件', g: '?', color: '#a78bfa' },
  boss: { k: '首领', g: '✺', color: '#e8b64c' },
};
