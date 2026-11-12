import type {
  FoeTpl, MissRule, ModeId, NodeType, PowerDef, PowerId, StageDef, StagePlan,
} from './types';

/** 每一幕 20 层，五幕共 100 层。 */
export const STAGE_ROWS = 20;

/** 五幕各自一套物种与招式表，共用一个 hue；第一幕不教机制，只教一张牌 = 一道题。 */
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

/** 示例课程表：五幕对应五章。`library/stage.ts` 按这张表从来源题库切出本幕的 BANK。 */
export const CURRICULUM: StagePlan[] = [
  { stage: 1, topic: '基础动词', title: '第 1 章 · 基础动词' },
  { stage: 2, topic: '生活名词', title: '第 2 章 · 生活名词' },
  { stage: 3, topic: '形容词与副词', title: '第 3 章 · 形容词与副词' },
  { stage: 4, topic: '学术高频', title: '第 4 章 · 学术高频' },
  { stage: 5, topic: '抽象概念', title: '第 5 章 · 抽象概念' },
];

/** 第 `stage` 幕对应的章节；越界夹到最后一章。 */
export const planFor = (stage: number): StagePlan =>
  CURRICULUM[Math.max(0, Math.min(CURRICULUM.length - 1, stage - 1))];

/**
 * 敌人表：按幕分组，一幕内「小怪 → 精英 → Boss」；moves 是循环表，下一步可见。
 */
export const FOES: FoeTpl[] = [
  /* ── 第一幕 · 目录厅：无机制 ── */
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

  /* ── 第二幕 · 虫蛀的借阅区：母题是你的牌堆（塞杂念、少抽牌） ── */
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

  /* ── 第三幕 · 报刊与副本：母题是重复（多段、复印、反伤） ── */
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

  /* ── 第四幕 · 修复室：母题是甲与时间（叠甲、每回合变强） ── */
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

  /* ── 第五幕 · 禁书区：母题是你的错误（往最弱处打、偷资源） ── */
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
 * 增益（power）：整局生效的印记，不进牌组。scope 取 `PowerScope`（always / fight / stage / run / instant）。
 */
export const POWERS: PowerDef[] = [
  {
    id: 'librarycard', icon: '借', name: '借书证', color: '#9dbf9a',
    scope: 'always',
    card: '每次答对，退回 1 点行动力',
    desc: '这本来是全局规则，现在变成一张要捡的牌。没有它，答对只让这一手不白打，'
      + '不会让你多打一张；有它，1 费牌答对才仍然等于免费。',
  },
  {
    id: 'hourglass', icon: '时', name: '沙漏', color: '#e8b64c',
    scope: 'always',
    card: '每场战斗的第一回合，行动力 +1',
    desc: '只在开局那一刻把时间摊平：先手多一次出手机会。'
      + '一局会捡到十来个增益，所以每一个都得小 —— 它给的是"最紧的那一回合"，不是每回合。',
  },
  {
    id: 'index', icon: '索', name: '索引卡', color: '#6f9ee8',
    scope: 'always',
    card: '手牌少于 3 张时，每回合多抽 2 张',
    desc: '不是板书的弱化版：它只在你快打空时把下一回合的抽牌翻倍，'
      + '手里还攥着三四张牌的时候它不响 —— 那样才有"打空"和"留着"之间的取舍。',
  },
  {
    id: 'binder', icon: '订', name: '装订线', color: '#4fd6cf',
    scope: 'fight',
    card: '每场战斗第一次答错，伤害和格挡按一半结算',
    desc: '答错不再扣行动力、也不再锁牌，代价落在"本场少一道新题"上。'
      + '它改的是另一半：错了也留下半份伤害和格挡，那道新题不至于白掉。',
  },
  {
    id: 'mirrorcard', icon: '镜', name: '双面镜', color: '#a78bfa',
    scope: 'always',
    card: '每回合第一次答对，抽 1 张',
    desc: '想起来的越多，看见的越多。它不花行动力、也不占牌位 —— '
      + '白拿的东西必须小份，所以它只给一张。',
  },
  {
    id: 'lamp', icon: '灯', name: '长明灯', color: '#e8c86c',
    scope: 'always',
    card: '每回合开始获得 1 点格挡',
    desc: '灯亮着，就不再完全空手挨打。它买的是"这一回合可以先去答题，不必先花一张牌去挡"。',
  },
  {
    id: 'marker', icon: '笔', name: '荧光笔', color: '#d06fa8',
    scope: 'fight',
    card: '每场战斗第一次答对，退回的行动力 +1',
    desc: '答对一手只退 1 点，它让这一场的**第一**次答对退 2 点 —— '
      + '买的是"先答对哪一张"，不是答对本身。一场一次，所以它不会自己滚起来。',
  },
  {
    id: 'paperweight', icon: '镇', name: '镇纸', color: '#8fb0c8',
    scope: 'always',
    card: '每场战斗开局多 2 点格挡',
    desc: '第一回合手里全是没答过的牌，几乎叠不出挡 —— 它把那一回合的窟窿先垫一点。',
  },
  {
    id: 'dogear', icon: '折', name: '折角', color: '#d8a24c',
    scope: 'always',
    card: '每场战斗第一回合多抽 2 张',
    desc: '开局的一次性爆发：第一回合多两张，先把手牌铺开。'
      + '板书是每回合的持续量，折角只买开场 —— 短战斗里它更值，长战斗里板书会追上来。',
  },
  {
    id: 'bookmark', icon: '签', name: '书签', color: '#7fc4a8',
    scope: 'fight',
    card: '每场战斗第一次答对，获得 2 点格挡',
    desc: '把"这一场的第一下就答对"变成一次看得见的防御收益：答对了，书签替你夹住这一页。'
      + '双面镜给的是每回合的抽牌，书签给的是开场的一次格挡，两条线不互相顶替。',
  },
  {
    id: 'eraser', icon: '擦', name: '橡皮', color: '#d98b8b',
    scope: 'fight',
    card: '每场战斗第一次答错，补 3 点格挡',
    desc: '错的那一下先垫住 —— 它不救那一手，只让那一下不那么疼。一场一次，所以它不会替谁把伤害全吃掉。',
  },
  {
    id: 'syllabus', icon: '课', name: '课表', color: '#9aa7d8',
    scope: 'always',
    card: '每回合第一次打出基础牌，获得 1 点格挡',
    desc: '它只认基础牌，不认题：不答题、只打基础牌也能吃到。'
      + '课表排的是这一回合先打哪张基础牌，而不是这一场要被问多少道题 ——'
      + '题库换掉、题目用完，它都照常生效。',
  },
  {
    id: 'sticky', icon: '贴', name: '便签', color: '#e6d05a',
    scope: 'always',
    card: '战后选卡从三张变四张',
    desc: '不直接改战斗数值：四选一比三选一更可能凑出同一主题的堆法。',
  },
  /* ── 第二批：拆答错线（书套 / 草稿纸 / 放大镜），另补答对与硬仗 ── */
  {
    id: 'slipcase', icon: '套', name: '书套', color: '#b58fb8',
    scope: 'fight',
    card: '每场战斗第一次答错，稳固度不降',
    desc: '稳固度决定这道题下次什么时候再来。它不让这一手生效，只把"错一次就往后排"这条'
      + '惩罚抹掉一次 —— 一场错好几道的时候，只有第一道被记成"还没学会"。'
      + '一场一次：每道都给，等于把整局的错题曲线抹平。',
  },
  {
    id: 'scratch', icon: '稿', name: '草稿纸', color: '#c8b08f',
    scope: 'fight',
    card: '每场战斗第一次答错，补抽 1 张',
    desc: '答错的那张牌要离开手牌。规则刻意**不补抽** —— 手牌真的少一张，错的代价才'
      + '摸得着；这也就意味着低正确率的人会在两回合内打空手牌，那时他不是"答不对"，'
      + '是"没牌可答"。它只填第一个窟窿，一场一次。',
  },
  {
    id: 'loupe', icon: '镜', name: '放大镜', color: '#6fc4d8',
    scope: 'fight',
    card: '每场战斗第一次答题，去掉一个错误选项',
    desc: '把四选一变成三选一，答对概率从 25% 抬到 33%。它不给你答案，只让你少看一个'
      + '看错的选项 —— 和"多抽一张"是两条不同的线：一条买信息，一条买概率。一场一次。',
  },
  {
    id: 'margin', icon: '注', name: '批注', color: '#e08a5c',
    scope: 'fight',
    card: '每场战斗第一次答对，稳固度额外 +2',
    desc: '答对一次就是一次检索练习，稳固度本来就会涨（`MISS_RULE.stabGain`）。'
      + '它让这一场的**第一道**答对涨得更实在 —— 一场一次，因为稳固度决定的是'
      + '"下次什么时候见到这道题"，每回合都给会把整章的记忆曲线拉平。',
  },
  {
    id: 'corner', icon: '角', name: '护角', color: '#9d8fb8',
    scope: 'always',
    card: '精英 / 首领战开局多 4 点格挡',
    desc: '只在硬仗里生效：普通战斗它一点用没有，精英和幕首领才给。'
      + '长明灯、镇纸、橡皮都是"每场都给"，这一张把额度集中到真正会打死你的那几场 ——'
      + '于是"要不要带它"变成一个判断，而不是无脑拿。',
  },
  {
    id: 'mend', icon: '胶', name: '修书胶', color: '#c49a6c',
    scope: 'always',
    card: '复习点回复量 +18%',
    desc: '复习点回血按上限的 62% 算，它加到 80%。整局的血量上限不动，'
      + '改的是"能不能把这一路的损耗补回来" —— 它只在节点之间生效，'
      + '所以一条命可以走得更远，但一场也不会打得更轻松。',
  },

  /* ── 常驻：每张牌、每一击 ── */
  {
    id: 'press', icon: '压', name: '压书石', color: '#a89078',
    scope: 'always',
    card: '每张牌的伤害 +1',
    desc: '它不挑牌：基础斩击也吃，S 级大招也吃。加的是**每一下**，所以它随'
      + '"一回合打几张"放大 —— 便宜的小牌被它抬得最多，这就把"多打几张"'
      + '从凑数变成了策略。',
  },
  {
    id: 'code', icon: '规', name: '校规', color: '#8fa8c0',
    scope: 'always',
    card: '每张牌的格挡 +1',
    desc: '和压书石一对：一个加攻，一个加防。格挡只在**这张牌本来就有格挡**时加 ——'
      + '纯攻杀牌不凭空长甲，否则"答错也能挡一下"这条判断会失效。',
  },
  {
    id: 'nightlight', icon: '夜', name: '夜灯', color: '#c8b46c',
    scope: 'always',
    card: '每次受到攻击，伤害 -1',
    desc: '它挡的不是"一整下"，是"每一下"。多段攻击因此被削得更多，'
      + '而单发重击几乎不受影响 —— 这正好和"叠甲挡大怪"互为补充。',
  },
  {
    id: 'board', icon: '板', name: '板书', color: '#7f9e88',
    scope: 'always',
    card: '每回合多抽 1 张',
    desc: '无条件、每回合。它是这一批里最贵的一张，因为它同时抬高了"这一回合能打几张"'
      + '和"看见关键牌的概率"——两件事都变强，所以它没有任何附加条件，只有数量上的 1。',
  },
  {
    id: 'tab', icon: '页', name: '索引贴', color: '#c8a0b8',
    scope: 'always',
    card: '回合结束时保留 2 点格挡',
    desc: '格挡本来不跨回合，这是唯一的例外。2 点是刻意的：够挡住一次小攻击的零头，'
      + '不够让你整回合不打防牌。它把"这一回合多叠一点"变成一个有利可图的选择。',
  },
  {
    id: 'stamp', icon: '印', name: '藏书印', color: '#b08c6c',
    scope: 'always',
    card: '每击杀一个敌人，回复 3 点生命',
    desc: '整局唯一一条"打得快就活得久"的线。一场只有一次击杀，所以它一场最多回 3 点 ——'
      + '放到七十场的尺度上，它是一条能把损耗补回来的缓坡，而不是一口血包。',
  },
  {
    id: 'tea', icon: '茶', name: '茶', color: '#c0a878',
    scope: 'always',
    card: '过幕时最大生命额外 +10',
    desc: '过幕本来就回满血、上限 +14（`BAL.stageMaxHp`）。它在那个台阶上再加 10 ——'
      + '后面的幕伤害更高，血量上限得跟着走，否则第四幕开头永远是残血进新地图。',
  },
  {
    id: 'shelf', icon: '挡', name: '书挡', color: '#8c9ea8',
    scope: 'always',
    card: '同一种卡的上限 +1',
    desc: '奖励池、事件、起手都受"每种最多 3 张"约束。它抬到 4 ——'
      + '于是"把一套牌堆厚"第一次变成一个真的能选的方向，而不只是碰运气。',
  },
  {
    id: 'polish', icon: '亮', name: '抛光布', color: '#c8c09a',
    scope: 'instant',
    card: '精炼一张牌的加成 +2',
    desc: '精炼本来是攻/挡底数各 +3，它变成 +5。它不直接给你牌，'
      + '而是让**以后每一次精炼**都更值钱 —— 一张典型的"越早拿到越强"的牌。',
  },

  /* ── 每场一次：答对 / 答错之外的时机 ── */
  {
    id: 'gluepot', icon: '壶', name: '胶水壶', color: '#a8b090',
    scope: 'fight',
    card: '每场战斗第一次答错，那张牌回手牌',
    desc: '规则是"答错这张牌就进弃牌堆，这一场要等洗牌才回来"。它第一次破例：'
      + '牌回到手里，下一回合还能打它。补的是**牌位**，不是那一手的结算。',
  },
  {
    id: 'seal', icon: '蜡', name: '封蜡', color: '#b87878',
    scope: 'fight',
    card: '每场战斗第一次受到攻击，伤害减半',
    desc: '第一回合手里全是生牌，最容易叠不出甲。它挡在那一击上 —— 一场一次，'
      + '而且只减半：落下半份伤害，才读得出"这一下本来会更疼"。',
  },
  {
    id: 'clip', icon: '针', name: '回形针', color: '#9aa8b8',
    scope: 'fight',
    card: '每场战斗第一次打出 3 费及以上的牌，退回 2 点行动力',
    desc: '3 费牌一次吃掉整回合的行动力，答对也只退 1 点。它让那一手接近不花钱 ——'
      + '买的是"这一场我可以先打一次大的"，不是"以后大牌都便宜"。',
  },
  {
    id: 'whistle', icon: '哨', name: '口哨', color: '#c8b880',
    scope: 'fight',
    card: '每场战斗第一回合，敌人的第一次攻击落空',
    desc: '只挡第一回合的第一次攻击，不是让敌人整回合不动：如果敌人首动是加 buff'
      + '或塞牌，这一下不会触发。它不给你格挡、不给你行动力，只把最疼的那一下'
      + '变成一段准备时间 —— 那正好是生牌最多、最该先摸清手牌的时候。',
  },
  {
    id: 'felt', icon: '毡', name: '毡垫', color: '#a09a88',
    scope: 'fight',
    card: '每场战斗第一次洗牌时，清掉弃牌堆里的 2 张杂念',
    desc: '杂念不进弃牌堆（回合结束就散），所以它清的是**敌人塞进来的**那些。'
      + '一次洗牌清掉 2 张，等于把"被塞牌"这条机制的第一次兑现抹掉。',
  },
  {
    id: 'brush', icon: '毫', name: '毛笔', color: '#b89070',
    scope: 'fight',
    card: '每场战斗第一次答对，这张牌额外结算一次',
    desc: '不是翻倍伤害，是**再走一遍效果**：该打两段的打四段，该回血的回两次。'
      + '和装订线正好一对 —— 那条线管"答错也留一半"，这条管"答对多一点"。',
  },

  /* ── 每幕一次 ── */
  {
    id: 'ledger', icon: '账', name: '账本', color: '#a89478',
    scope: 'stage',
    card: '每幕第一次战后奖励多一个选项，并让选中的牌直接精炼',
    desc: '一幕二十层，第一次战后奖励从三选一变四选一，选中的那张不用再去复习点'
      + '花一次精炼。它只改**第一次**那一下 —— 开幕那几张牌决定这一路往哪堆，'
      + '多一个选项、再加一次精炼，才配得上"账本"这个名字。',
  },
  {
    id: 'atlas', icon: '图', name: '地图册', color: '#8898a8',
    scope: 'stage',
    card: '每幕第一次复习，额外回复 15 点生命',
    desc: '复习点按上限的 62% 回血（修书胶再加）。这一张在**幕内第一次**复习时'
      + '多给 15 点 —— 那一口血通常正好卡在"能不能撑到幕末 Boss"上。',
  },

  /* ── 整局一次 ── */
  {
    id: 'wish', icon: '愿', name: '许愿条', color: '#d8b8d0',
    scope: 'run',
    card: '整局一次：致死时以 35% 生命活下来',
    desc: '整局只有一次。它不改变任何一手的结算，只改变**这一局什么时候结束** ——'
      + '在一局七十来场的长跑里，它买到的是"再试一次"，而不是"这一场不会输"。',
  },

  /* ── 拾取即结算：不挂时机，直接改这一局的底盘 ── */
  {
    id: 'spine', icon: '脊', name: '书脊', color: '#a08c78',
    scope: 'instant',
    card: '最大生命 +18，并立即回复 18 点',
    desc: '它是唯一一张"捡到就变厚"的牌。18 点大约是一场普通战斗的量 ——'
      + '不是加一条血条，是让下一幕的伤害曲线多一格缓冲。',
  },
  {
    id: 'exlibris', icon: '票', name: '藏书票', color: '#c8a888',
    scope: 'instant',
    card: '立即获得 2 张随机知识卡',
    desc: '不抽、不选，直接进牌组。两张是一副十张牌的五分之一 ——'
      + '够把牌组往某个方向推一把，又不足以把抽牌概率搅乱。',
  },
  {
    id: 'slim', icon: '刀', name: '裁纸刀', color: '#a8b0b8',
    scope: 'instant',
    card: '立即移除 2 张基础牌',
    desc: '基础牌是地板：数值低、不答题。它削掉两张，牌组变薄，'
      + '每回合五张里有更多知识卡 —— 代价是你也更容易抽到"够不着"的牌。',
  },
  {
    id: 'resin', icon: '脂', name: '树脂', color: '#b8a070',
    scope: 'instant',
    card: '所有基础牌立即精炼',
    desc: '不是"下一次精炼免费"，是**现在**把八张基础牌全变成 +3 版本。'
      + '拿到得越早越值：它抬的是地板的厚度，而不是天花板。',
  },

  /* ── 第四批：挂在局内动作顺序上（结束回合、打第几张、洗牌、先打哪种牌） ── */
  {
    id: 'feather', icon: '羽', name: '羽毛', color: '#d8c8a8',
    scope: 'always',
    card: '回合结束时若没有格挡，获得 2 点格挡',
    desc: '它奖励"这一回合先做别的事，最后再挡"：把最后一点行动力留给攻击，'
      + '而不是习惯性先叠甲。2 点只够挡一次小攻击，但足够把"空过"变成一个选择。',
  },
  {
    id: 'ink', icon: '墨', name: '墨水瓶', color: '#7f8fa8',
    scope: 'always',
    card: '每回合第 3 张牌打出时，抽 1 张',
    desc: '它把"这回合还能不能继续"从费用问题变成顺序问题：'
      + '前两张打便宜的，第三张就能把下一张摸上来。每回合只数一次，免得它自己滚成抽牌机。',
  },
  {
    id: 'archive', icon: '档', name: '档案盒', color: '#a89a78',
    scope: 'always',
    card: '每次洗牌，获得 2 点格挡',
    desc: '洗牌本来是"这一轮没牌了"的低谷。它把低谷垫一下，让薄牌组在第二轮循环时'
      + '不至于完全没有防御；同时也让"把牌打空"不再只是纯亏。',
  },
  {
    id: 'pulse', icon: '拍', name: '节拍器', color: '#d08a6c',
    scope: 'fight',
    card: '每场战斗第一次一回合打出 3 张牌，退回 1 点行动力',
    desc: '它不是每回合都给：一场只认第一次三连。奖励的是"这一回合已经铺开了"，'
      + '而不是"以后每回合都该三连"；拿到这一点的时机，正好是手牌最顺的那一下。',
  },
  {
    id: 'varnish', icon: '油', name: '亮油', color: '#c8b878',
    scope: 'fight',
    card: '每场战斗第一次打出 0 费牌，抽 1 张',
    desc: '0 费牌本来是"不花行动力但也不赚节奏"。它让第一张 0 费牌把下一张带出来，'
      + '于是"先打 0 费还是先打大牌"第一次有了顺序上的差别。一场一次。',
  },
  {
    id: 'seed', icon: '种', name: '种纸', color: '#8fb08a',
    scope: 'fight',
    card: '每场战斗第一次打出攻击牌，获得 2 点格挡',
    desc: '第一张攻击牌通常出现在"还没叠甲"的时候。它让先手攻击不再等于裸奔，'
      + '但只补一次 —— 之后仍然要靠防御牌。和书签不同：书签认答对，它只认攻击。',
  },
];

export const POWER_BY_ID = Object.fromEntries(POWERS.map((p) => [p.id, p])) as Record<string, PowerDef>;

/** 答错 / 答对时稳固度的倍率。 */
export const MISS_RULE: MissRule = {
  stabDrop: 0.35,
  stabGain: 1.15,
};

export interface ModeDef {
  id: ModeId;
  icon: string;
  name: string;
  color: string;
  desc: string;
  /** 开局直接进 `G.powers` 的增益。 */
  powers: PowerId[];
}

/**
 * 三个模式只差初始增益：学习 = 借书证 + 课表，复习 = 借书证，测试 = 无（退款与防御都靠捡）。
 */
export const MODES: ModeDef[] = [
  {
    id: 'study', icon: '学', name: '学习', color: '#8fc8b0',
    desc: '两个初始能力：借书证 + 课表。答对退 1 点，每回合第一张基础牌补 1 点格挡。',
    powers: ['librarycard', 'syllabus'],
  },
  {
    id: 'review', icon: '复', name: '复习', color: '#e8c86c',
    desc: '一个初始能力：只带借书证。答对退 1 点，但没有额外防御。',
    powers: ['librarycard'],
  },
  {
    id: 'test', icon: '测', name: '测试', color: '#d98b8b',
    desc: '没有初始能力：退款和防御都要靠路上捡。基础牌仍然随时可打。',
    powers: [],
  },
];

export const MODE_BY_ID = Object.fromEntries(
  MODES.map((m) => [m.id, m]),
) as Record<ModeId, ModeDef>;

/**
 * 全局强度旋钮：数值调整集中在这里。
 *
 * **只动血量、不动伤害**：伤害管"挡不挡得住"，血量管"打不打得完"。
 */
export const BAL = {
  /**
   * hp = 敌人血量倍率，dmg = 伤害倍率，baseHp = 玩家初始血量，baseAp = 每回合行动力。
   */
  hp: 0.55, dmg: 1.24, baseHp: 70, baseAp: 3,
  /** 精英 / Boss 的额外血量倍率，普通战斗不吃这一档。 */
  hpType: 1.10,
  /**
   * 层号强度曲线，自变量是全局层号 f（1..100）：hp = 1 + floor × √((f-1)/99)，dmg = 1 + all × (f-1)/99。
   */
  growth: { floor: 0.8, all: 0.2 },
  /** 借书证给的答对退款，一手最多 1 点；没有借书证时为 0。 */
  refund: 1,
  /** 双面镜的规则：答对后抽几张、每回合最多几次；基础状态不生效。 */
  answerDraw: 1, answerDrawCap: 1,
  /** 每回合抽牌数，三种模式共用。 */
  drawPerTurn: 5,
  /** 长明灯每回合给的格挡 */
  lampBlock: 1,
  /** 第一批增益的数值（镇纸 / 折角 / 书签 / 橡皮）。 */
  paperweightBlock: 2, dogearDraw: 2, bookmarkBlock: 2, eraserBlock: 3,
  /** 第二批「一场只响一次」的数值。 */
  /** 批注：答对时稳固度额外加多少（`MISS_RULE.stabGain` 之外） */
  marginStab: 2,
  /** 草稿纸：每场第一次答错补抽几张 */
  scratchDraw: 1,
  /** 护角：精英 / BOSS 战开局额外格挡 */
  cornerBlock: 4,
  /** 修书胶：复习点回复量**额外**加的生命百分比（叠在 `restPct` 上） */
  mendRest: 0.18,
  /** 课表：每回合第一次打出基础牌补几点格挡 */
  syllabusBlock: 1,
  /** 便签：战后选卡多给几个选项 */
  stickyChoice: 1,
  /* ── 第三批：数值按"多久响一次"分级（常驻 1 点，每场一次 2–3 点） ── */

  /** 压书石：每张牌伤害 +几点（常驻，所以只能是 1） */
  pressAtk: 1,
  /** 校规：每张牌格挡 +几点 */
  codeBlk: 1,
  /** 夜灯：每次挨打少受几点（最低 0） */
  nightCut: 1,
  /** 板书：每回合额外抽几张 */
  boardDraw: 1,
  /** 索引卡：手牌少于 3 张时额外抽几张 */
  indexDraw: 2,
  /** 索引贴：回合结束保留几点格挡到下一回合 */
  tabCarry: 2,
  /** 藏书印：每击杀一个敌人回复几点 */
  stampHeal: 3,
  /** 茶：过幕时最大生命额外加几点（叠在 `stageMaxHp` 上） */
  teaMaxHp: 10,
  /** 书挡：同种卡上限 +几 */
  shelfCopies: 1,
  /** 抛光布：精炼一次额外加几点攻/挡 */
  polishUp: 2,
  /** 胶水壶 / 封蜡 / 回形针 / 毛笔：一场一次的四个数 */
  sealCut: 0.5,
  clipRefund: 2,
  feltJunk: 2,
  brushRepeat: 1,
  /** 第四批：节奏型增益的数值 */
  featherBlock: 2,
  inkDraw: 1,
  archiveBlock: 2,
  pulseRefund: 1,
  varnishDraw: 1,
  seedBlock: 2,
  /** 账本：每幕第一次战后奖励多给几张 */
  ledgerPicks: 1,
  /** 地图册：每幕第一次复习额外回多少 */
  atlasHeal: 15,
  /** 许愿条：整局一次免死，活下来时按上限的百分之几 */
  wishPct: 0.35,
  /** 书脊 / 藏书票 / 裁纸刀：拾取即结算的三个数 */
  spineHp: 18,
  exlibrisCards: 2,
  slimRemove: 2,
  /** 战后奖励的底数选项数，便签在这个数上加 `stickyChoice`。 */
  rewardPicks: 3,
  /** 行动力的硬上限（所有行动力写入都经 `infra/write.ts`）。 */
  apCap: 10,
  /** 每场战斗开局白送的格挡。 */
  startBlock: 4,
  /** 第一回合敌人不出攻击；默认关，留作试验开关。 */
  calmFirstTurn: false,
  /** 同一种卡最多几张。 */
  maxCopies: 3,
  /** 过幕时最大生命 +多少，并回满血。 */
  stageMaxHp: 14,
  /** 复习点回复最大生命的比例。 */
  restPct: 0.62,
  /** 各机制的量；怪身上写了 `mechV` 就用它自己的，没写读这里。 */
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
