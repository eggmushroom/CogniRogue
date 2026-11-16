import type {
  FoeTpl, ModeId, NodeType, PowerDef, PowerId, StageDef, StagePlan,
} from './types';

/** 每一幕 20 层，五幕共 100 层。 */
export const STAGE_ROWS = 20;

/** 五幕各自一套物种与招式表，共用一个 hue；第一幕不教机制，只教一张牌 = 一道题。 */
export const STAGES: StageDef[] = [
  {
    i: 1, key: 'catalogue', name: '目录厅', sub: '明亮、整齐，纸还是新的',
    color: '#4fd6cf', hue: 0,
    mix: { fight: 38, event: 20, rest: 26, elite: 16 },
  },
  {
    i: 2, key: 'stacks', name: '虫蛀的借阅区', sub: '潮气、木屑，书脊里有东西在动',
    color: '#7fc26a', hue: 130,
    mix: { fight: 34, event: 22, rest: 28, elite: 16 },
  },
  {
    i: 3, key: 'periodicals', name: '报刊与副本', sub: '冷白的灯，铅字的味道，同一页在无限复制',
    color: '#6f9ee8', hue: 205,
    mix: { fight: 36, event: 16, rest: 28, elite: 20 },
  },
  {
    i: 4, key: 'bindery', name: '修复室', sub: '胶、线、皮革，还有一台从不熄火的熔炉',
    color: '#e08048', hue: 25,
    mix: { fight: 34, event: 14, rest: 28, elite: 24 },
  },
  {
    i: 5, key: 'forbidden', name: '禁书区', sub: '灯照不到的地方，书页自己在翻',
    color: '#a78bfa', hue: 320,
    mix: { fight: 32, event: 12, rest: 28, elite: 28 },
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

  /* ── 第 1 幕 · 目录厅 ── */
  {
    key: 'shard', name: '记忆的碎片', type: 'fight', art: 'shard', stage: 1, tag: '普通', hp: 28, hpStep: 3, dmg: 9, moves: [{ k: 'atk' }],
  },
  {
    key: 'examiner', name: '复习官', type: 'fight', art: 'examiner', stage: 1, tag: '普通', hp: 32, hpStep: 4, dmg: 10, moves: [{ k: 'atk' }], mech: 'reviewer',
  },
  {
    key: 'grub', name: '书蛀', type: 'fight', art: 'grub', stage: 1, tag: '普通', hp: 31, hpStep: 4, dmg: 9, moves: [{ k: 'atk', add: -2 }, { k: 'atk' }], mech: 'leech',
  },
  {
    key: 'drift', name: '走神', type: 'fight', art: 'moth', stage: 1, tag: '普通', hp: 25, hpStep: 3, dmg: 7, moves: [{ k: 'jam', n: 1 }, { k: 'jam', n: 1 }, { k: 'atk' }],
  },
  {
    key: 'inquisitor', name: '主考官', type: 'elite', art: 'inquisitor', stage: 1, tag: '精英', hp: 58, hpStep: 7, dmg: 14, moves: [{ k: 'atk', add: 4 }, { k: 'def', v: 14 }, { k: 'atk', add: -4, times: 2 }], mech: 'reviewer',
  },
  {
    key: 'rereader', name: '复读者', type: 'elite', art: 'examiner', stage: 1, tag: '精英', hp: 53, hpStep: 6, dmg: 11, moves: [{ k: 'atk', add: 1 }, { k: 'atk', add: -5, times: 3 }, { k: 'jam', n: 2 }],
  },
  {
    key: 'cataloguer', name: '编目者', type: 'boss', art: 'cataloguer', stage: 1, tag: 'BOSS', hp: 68, hpStep: 8, dmg: 15, moves: [{ k: 'atk' }, { k: 'jam', n: 2 }, { k: 'atk', add: 5 }], mech: 'reviewer',
  },

  /* ── 第 2 幕 · 虫蛀的借阅区 ── */
  {
    key: 'bookmoth', name: '蠹蛾', type: 'fight', art: 'moth', stage: 2, tag: '普通', hp: 49, hpStep: 2, dmg: 10, moves: [{ k: 'jam', n: 1 }, { k: 'atk' }], mech: 'fog',
  },
  {
    key: 'damp', name: '湿页', type: 'fight', art: 'shard', stage: 2, tag: '普通', hp: 54, hpStep: 2, dmg: 10, moves: [{ k: 'def', v: 12 }, { k: 'atk', add: 1 }],
  },
  {
    key: 'grubqueen', name: '书蛀母', type: 'fight', art: 'grub', stage: 2, tag: '普通', hp: 58, hpStep: 2, dmg: 12, moves: [{ k: 'atk', add: -2 }, { k: 'atk' }], mech: 'leech',
  },
  {
    key: 'stitchworm', name: '线虫', type: 'fight', art: 'grub', stage: 2, tag: '普通', hp: 52, hpStep: 2, dmg: 10, moves: [{ k: 'atk', add: -4, times: 2 }, { k: 'atk' }], hue: 100,
  },
  {
    key: 'wormking', name: '蠹王', type: 'elite', art: 'grub', stage: 2, tag: '精英', hp: 99, hpStep: 3, dmg: 14, moves: [{ k: 'jam', n: 1 }, { k: 'atk', add: 3 }, { k: 'atk', add: -6, times: 2 }], mech: 'fog', hue: 150,
  },
  {
    key: 'copyist', name: '抄书吏', type: 'elite', art: 'examiner', stage: 2, tag: '精英', hp: 92, hpStep: 3, dmg: 13, moves: [{ k: 'atk', add: 2 }, { k: 'def', v: 14 }], mech: 'bulwark', mechV: 8, hue: 130,
  },
  {
    key: 'devourer', name: '饕餮书虫', type: 'boss', art: 'devourer', stage: 2, tag: 'BOSS', hp: 123, hpStep: 4, dmg: 15, moves: [{ k: 'atk' }, { k: 'jam', n: 2 }, { k: 'atk', add: -5, times: 2 }], mech: 'leech', hue: 110,
  },

  /* ── 第 3 幕 · 报刊与副本 ── */
  {
    key: 'ghostprint', name: '影印', type: 'fight', art: 'shard', stage: 3, tag: '普通', hp: 65, hpStep: 1, dmg: 12, moves: [{ k: 'atk', add: -6, times: 3 }], mech: 'thorns', mechV: 1, hue: 205,
  },
  {
    key: 'typeblock', name: '铅字块', type: 'fight', art: 'shard', stage: 3, tag: '普通', hp: 76, hpStep: 2, dmg: 12, moves: [{ k: 'def', v: 14 }, { k: 'atk', add: 1 }], hue: 220,
  },
  {
    key: 'compositor', name: '排字工', type: 'fight', art: 'examiner', stage: 3, tag: '普通', hp: 70, hpStep: 2, dmg: 13, moves: [{ k: 'atk' }, { k: 'jam', n: 2 }], mech: 'pierce', hue: 205,
  },
  {
    key: 'carbon', name: '复写纸', type: 'fight', art: 'moth', stage: 3, tag: '普通', hp: 63, hpStep: 2, dmg: 12, moves: [{ k: 'atk', add: 1 }, { k: 'atk', add: 1 }], hue: 205,
  },
  {
    key: 'duplex', name: '双面印刷机', type: 'elite', art: 'examiner', stage: 3, tag: '精英', hp: 123, hpStep: 3, dmg: 15, moves: [{ k: 'atk', add: -7, times: 3 }, { k: 'def', v: 16 }], mech: 'thorns', mechV: 3, hue: 210,
  },
  {
    key: 'stereotype', name: '铅版巨人', type: 'elite', art: 'inquisitor', stage: 3, tag: '精英', hp: 132, hpStep: 3, dmg: 16, moves: [{ k: 'atk', add: 4 }, { k: 'buff', v: 2 }], mech: 'haste', hue: 205,
  },
  {
    key: 'imprinter', name: '压印之主', type: 'boss', art: 'imprinter', stage: 3, tag: 'BOSS', hp: 162, hpStep: 4, dmg: 17, moves: [{ k: 'atk' }, { k: 'atk', add: -8, times: 3 }, { k: 'def', v: 18 }], mech: 'thorns', mechV: 3, hue: 195,
  },

  /* ── 第 4 幕 · 修复室 ── */
  {
    key: 'gluebeast', name: '胶合兽', type: 'fight', art: 'grub', stage: 4, tag: '普通', hp: 86, hpStep: 2, dmg: 14, moves: [{ k: 'atk' }, { k: 'def', v: 16 }], hue: 20,
  },
  {
    key: 'stitchdoll', name: '缝线傀儡', type: 'fight', art: 'moth', stage: 4, tag: '普通', hp: 91, hpStep: 2, dmg: 14, moves: [{ k: 'atk', add: -6, times: 2 }, { k: 'buff', v: 2 }], mech: 'haste', hue: 25,
  },
  {
    key: 'leathercover', name: '皮革封面', type: 'fight', art: 'shard', stage: 4, tag: '普通', hp: 100, hpStep: 2, dmg: 14, moves: [{ k: 'def', v: 18 }, { k: 'atk', add: 3 }], mech: 'bulwark', mechV: 10, hue: 25,
  },
  {
    key: 'gluepot', name: '熔胶炉', type: 'fight', art: 'oblivion', stage: 4, tag: '普通', hp: 80, hpStep: 2, dmg: 15, moves: [{ k: 'atk', add: 3 }, { k: 'atk', add: 3 }], hue: 30,
  },
  {
    key: 'binder', name: '装订师', type: 'elite', art: 'examiner', stage: 4, tag: '精英', hp: 147, hpStep: 3, dmg: 17, moves: [{ k: 'atk', add: 3 }, { k: 'def', v: 18 }, { k: 'atk', add: -7, times: 2 }], mech: 'bulwark', mechV: 12, hue: 25,
  },
  {
    key: 'press', name: '压书机', type: 'elite', art: 'inquisitor', stage: 4, tag: '精英', hp: 157, hpStep: 3, dmg: 18, moves: [{ k: 'atk', add: 5 }, { k: 'buff', v: 3 }], mech: 'haste', hue: 20,
  },
  {
    key: 'bound', name: '装订之兽', type: 'boss', art: 'bound', stage: 4, tag: 'BOSS', hp: 201, hpStep: 4, dmg: 19, moves: [{ k: 'atk' }, { k: 'def', v: 20 }, { k: 'atk', add: -7, times: 2 }], mech: 'bulwark', mechV: 14, hue: 25,
  },

  /* ── 第 5 幕 · 禁书区 ── */
  {
    key: 'whisperer', name: '低语者', type: 'fight', art: 'examiner', stage: 5, tag: '普通', hp: 104, hpStep: 2, dmg: 16, moves: [{ k: 'jam', n: 2 }, { k: 'atk', add: 2 }], mech: 'siphon', hue: 320,
  },
  {
    key: 'blankleaf', name: '空页', type: 'fight', art: 'shard', stage: 5, tag: '普通', hp: 112, hpStep: 2, dmg: 16, moves: [{ k: 'atk', add: 1 }, { k: 'def', v: 20 }], hue: 320,
  },
  {
    key: 'ashencopy', name: '灰烬的抄本', type: 'fight', art: 'grub', stage: 5, tag: '普通', hp: 99, hpStep: 2, dmg: 16, moves: [{ k: 'atk', add: -6, times: 3 }], mech: 'pierce', hue: 300,
  },
  {
    key: 'fgotten', name: '遗忘的读者', type: 'fight', art: 'moth', stage: 5, tag: '普通', hp: 95, hpStep: 1, dmg: 16, moves: [{ k: 'atk' }, { k: 'jam', n: 2 }, { k: 'atk' }], mech: 'lethe', hue: 320,
  },
  {
    key: 'silencer', name: '缄默者', type: 'elite', art: 'inquisitor', stage: 5, tag: '精英', hp: 172, hpStep: 3, dmg: 19, moves: [{ k: 'atk', add: 3 }, { k: 'atk', add: -6, times: 2 }], mech: 'siphon', hue: 320,
  },
  {
    key: 'lethe', name: '忘川', type: 'elite', art: 'lethe', stage: 5, tag: '精英', hp: 182, hpStep: 3, dmg: 19, moves: [{ k: 'atk' }, { k: 'jam', n: 2 }, { k: 'atk', add: -7, times: 2 }, { k: 'buff', v: 2 }], mech: 'lethe',
  },
  {
    key: 'oblivion', name: '遗忘', type: 'boss', art: 'oblivion', stage: 5, tag: 'BOSS', hp: 270, hpStep: 4, dmg: 22, moves: [{ k: 'atk' }, { k: 'atk', add: -9, times: 2 }, { k: 'buff', v: 2 }], mech: 'oblivion',
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
    desc: '没有它时，答对不退行动力。',
  },
  {
    id: 'hourglass', icon: '时', name: '沙漏', color: '#e8b64c',
    scope: 'always',
    card: '每场战斗的第一回合，行动力 +1',
  },
  {
    id: 'index', icon: '索', name: '索引卡', color: '#6f9ee8',
    scope: 'always',
    card: '手牌少于 3 张时，每回合多抽 2 张',
    desc: '打空之后，下一回合补回来。',
  },
  {
    id: 'binder', icon: '订', name: '装订线', color: '#4fd6cf',
    scope: 'fight',
    card: '每场第一次答错，伤害减「费用 × 2」，格挡减「费用 × 5」',
    // 削减不等于"这次不算答错"：退款、错题簿、弃牌照旧。
    desc: '这一手仍然算答错：不退行动力，牌照样进弃牌堆。',
  },
  {
    id: 'mirrorcard', icon: '镜', name: '双面镜', color: '#a78bfa',
    scope: 'always',
    card: '每回合第一次答对，抽 1 张',
    desc: '抽到的牌当回合就能打。',
  },
  {
    id: 'lamp', icon: '灯', name: '长明灯', color: '#e8c86c',
    scope: 'always',
    card: '每回合开始获得 1 点格挡',
    desc: '和卡牌给的格挡叠加。',
  },
  {
    id: 'marker', icon: '笔', name: '荧光笔', color: '#d06fa8',
    scope: 'fight',
    card: '每场战斗第一次答对，退回的行动力 +1',
    // 「退 2 点」只在有借书证时成立；测试开局没有借书证，那一场只退 1 点。
    desc: '没有借书证也能退 1 点。',
  },
  {
    id: 'paperweight', icon: '镇', name: '镇纸', color: '#8fb0c8',
    scope: 'always',
    card: '每场战斗开局多 2 点格挡',
  },
  {
    id: 'dogear', icon: '折', name: '折角', color: '#d8a24c',
    scope: 'always',
    card: '每场战斗第一回合多抽 2 张',
  },
  {
    id: 'bookmark', icon: '签', name: '书签', color: '#7fc4a8',
    scope: 'fight',
    card: '每场战斗第一次答对，获得 2 点格挡',
  },
  {
    id: 'eraser', icon: '擦', name: '橡皮', color: '#d98b8b',
    scope: 'fight',
    card: '每场战斗第一次答错，补 3 点格挡',
    // 「补的格挡挡不了这一下」会被读成"挡不了敌人这一下"—— 正好相反，
    // 这 3 点就是在敌人回合用的。救不回来的是已经作废的那一手。
    desc: '作废的这一手救不回来，这 3 点是给敌人回合的。',
  },
  {
    id: 'syllabus', icon: '课', name: '课表', color: '#9aa7d8',
    scope: 'always',
    card: '每回合第一次打出基础牌，获得 1 点格挡',
  },
  {
    id: 'sticky', icon: '贴', name: '便签', color: '#e6d05a',
    scope: 'always',
    card: '战后选卡从三张变四张',
    desc: '也可以跳过。',
  },
  /* ── 第二批：拆答错线（书套 / 草稿纸 / 放大镜），另补答对与硬仗 ── */
  {
    id: 'slipcase', icon: '套', name: '书套', color: '#b58fb8',
    scope: 'fight',
    card: '每场战斗第一次答错的那道题，不记进错题簿',
    desc: '「遗忘」按错题簿挑主题；这一题不算。',
  },
  {
    id: 'scratch', icon: '稿', name: '草稿纸', color: '#c8b08f',
    scope: 'fight',
    card: '每场战斗第一次答错，补抽 1 张',
  },
  {
    id: 'loupe', icon: '镜', name: '放大镜', color: '#6fc4d8',
    scope: 'fight',
    card: '每场战斗第一次答题，去掉一个错误选项',
    // 内置题库全是四选一，但导入的题库可以只有两个选项 —— 那种题不动它，
    // 名额也不消耗，留给第一道够删的题。
    desc: '划掉的是错误选项。两个选项的题跳过，名额留给下一道。',
  },
  {
    id: 'margin', icon: '注', name: '批注', color: '#e08a5c',
    scope: 'fight',
    card: '每场战斗第一次答对，这张牌多攒 1 次免答',
    desc: '和这次答对本身攒的那次一起算。',
  },
  {
    id: 'corner', icon: '角', name: '护角', color: '#9d8fb8',
    scope: 'always',
    card: '精英 / 首领战开局多 4 点格挡',
    desc: '和镇纸、开局那 4 点叠加。',
  },
  {
    id: 'mend', icon: '胶', name: '修书胶', color: '#c49a6c',
    scope: 'always',
    // 复习点是固定 45 点，这一张加到 55。是加 10 点，不是乘 1.18。
    card: '复习点多回 10 点生命',
  },

  /* ── 常驻：每张牌、每一击 ── */
  {
    id: 'press', icon: '压', name: '压书石', color: '#a89078',
    scope: 'always',
    card: '每张牌的伤害 +1',
    desc: '多段伤害的每一段都算，基础牌也算。',
  },
  {
    id: 'code', icon: '规', name: '校规', color: '#8fa8c0',
    scope: 'always',
    card: '每张牌的格挡 +1',
    desc: '纯攻击牌不加。',
  },
  {
    id: 'nightlight', icon: '夜', name: '夜灯', color: '#c8b46c',
    scope: 'always',
    card: '每次受到攻击，伤害 -1',
    // 原来写着"多段攻击的每一下都减"，代码从来只减一次 —— 一句补出来的解释
    // 编了一条不存在的规则。这里换成它真正装不下的边界：减伤发生在格挡之前。
    desc: '先减伤，再算格挡。',
  },
  {
    id: 'board', icon: '板', name: '板书', color: '#7f9e88',
    scope: 'always',
    card: '每回合多抽 1 张',
  },
  {
    id: 'tab', icon: '页', name: '索引贴', color: '#c8a0b8',
    scope: 'always',
    card: '回合结束时保留 2 点格挡',
    desc: '格挡只在这一处跨回合。',
  },
  {
    id: 'stamp', icon: '印', name: '藏书印', color: '#b08c6c',
    scope: 'always',
    // 一场只有一个敌人，"每击杀一个"是在承诺一件不会发生的事；而 desc 又写
    // "一场最多触发一次"，两句话互相否认。说清一次就够。
    card: '击杀敌人时，回复 3 点生命',
  },
  {
    id: 'tea', icon: '茶', name: '茶', color: '#c0a878',
    scope: 'always',
    card: '过幕时最大生命额外 +10',
    // 原来写「和过幕的 +14 叠加」—— 14 是 `BAL.stageMaxHp` 的手抄副本，改数值就骗人。
    // 真正装不下的是：过幕加完上限会回满，这 10 点不是账面数字。
    desc: '加上限的同时回满，这 10 点当场就是血。',
  },
  {
    id: 'shelf', icon: '挡', name: '书挡', color: '#8c9ea8',
    scope: 'always',
    // 上限只管知识卡：基础牌本来就有 4 张同名的，那是牌组底座不是收集品。
    card: '同一种知识卡的上限 +1',
  },
  {
    id: 'polish', icon: '亮', name: '抛光布', color: '#c8c09a',
    scope: 'instant',
    // card 原来写「精炼一张牌的加成 +2」，desc 写「之后每次精炼都多 +2」——
    // 一句像一次性的，一句像常驻的。代码是 `G.upGrade`，常驻。
    card: '之后每次精炼的加成 +2',
  },

  /* ── 每场一次：答对 / 答错之外的时机 ── */
  {
    id: 'gluepot', icon: '壶', name: '胶水壶', color: '#a8b090',
    scope: 'fight',
    card: '每场战斗第一次答错，那张牌留在手里',
    desc: '这一回合还能再打；回合结束进弃牌堆。',
  },
  {
    id: 'seal', icon: '蜡', name: '封蜡', color: '#b87878',
    scope: 'fight',
    card: '每场战斗第一次受到攻击，伤害 -8',
    desc: '多段攻击按这次的总伤害减 8，不是每段各减一次。',
  },
  {
    id: 'clip', icon: '针', name: '回形针', color: '#9aa8b8',
    scope: 'fight',
    card: '每场战斗第一次打出 3 费及以上的牌，退回 2 点行动力',
    // card 写「及以上」、desc 写「以上」，同一个门槛两种口径。留下真正装不下的那条。
    desc: '3 费也算。',
  },
  {
    id: 'whistle', icon: '哨', name: '口哨', color: '#c8b880',
    scope: 'fight',
    card: '每场战斗第一回合，敌人的第一次攻击落空',
    desc: '首动不是攻击则不触发。',
  },
  {
    id: 'felt', icon: '毡', name: '毡垫', color: '#a09a88',
    scope: 'fight',
    card: '每场战斗第一次洗牌时，清掉弃牌堆里的 2 张杂念',
    desc: '弃牌堆里没有杂念就不算用过。',
  },
  {
    id: 'brush', icon: '毫', name: '毛笔', color: '#b89070',
    scope: 'fight',
    card: '每场战斗第一次答对，这张牌额外结算一次',
  },

  /* ── 每幕一次 ── */
  {
    id: 'ledger', icon: '账', name: '账本', color: '#a89478',
    scope: 'stage',
    card: '每幕第一次战后奖励多一个选项，并让选中的牌直接精炼',
  },
  {
    id: 'atlas', icon: '图', name: '地图册', color: '#8898a8',
    scope: 'stage',
    card: '每幕第一次复习，额外回复 15 点生命',
    // 它和复习本身的回复合成一个总量再一次给出，不是"另给 15 点血"。
    desc: '和复习的回复算在一起，血满了剩下的就没了。',
  },

  /* ── 整局一次 ── */
  {
    id: 'wish', icon: '愿', name: '许愿条', color: '#d8b8d0',
    scope: 'run',
    card: '整局一次：致死时以 30 点生命活下来',
  },

  /* ── 拾取即结算：不挂时机，直接改这一局的底盘 ── */
  {
    id: 'spine', icon: '脊', name: '书脊', color: '#a08c78',
    scope: 'instant',
    card: '最大生命 +18，并立即回复 18 点',
  },
  {
    id: 'exlibris', icon: '票', name: '藏书票', color: '#c8a888',
    scope: 'instant',
    card: '立即获得 2 张随机知识卡',
    desc: '每种卡有上限，牌池挑不满时给到的会少于 2 张。',
  },
  {
    id: 'slim', icon: '刀', name: '裁纸刀', color: '#a8b0b8',
    scope: 'instant',
    card: '立即移除 2 张基础牌',
    desc: '牌组不会删到 5 张以下。',
  },
  {
    id: 'resin', icon: '脂', name: '树脂', color: '#b8a070',
    scope: 'instant',
    card: '所有基础牌立即精炼',
  },

  /* ── 第四批：挂在局内动作顺序上（结束回合、打第几张、洗牌、先打哪种牌） ── */
  {
    id: 'feather', icon: '羽', name: '羽毛', color: '#d8c8a8',
    scope: 'always',
    card: '回合结束时若没有格挡，获得 2 点格挡',
    // 玩家容易把「回合结束」读成"敌人已经打完了" —— 这 2 点是在敌人出招前补的。
    desc: '在敌人出招之前补上，挡得住这一下。',
  },
  {
    id: 'ink', icon: '墨', name: '墨水瓶', color: '#7f8fa8',
    scope: 'always',
    card: '每回合第 3 张牌打出时，抽 1 张',
    desc: '一回合只数一次。',
  },
  {
    id: 'archive', icon: '档', name: '档案盒', color: '#a89a78',
    scope: 'always',
    card: '每次洗牌，获得 2 点格挡',
  },
  {
    id: 'pulse', icon: '拍', name: '节拍器', color: '#d08a6c',
    scope: 'fight',
    card: '每场战斗第一次一回合打出 3 张牌，退回 1 点行动力',
  },
  {
    id: 'varnish', icon: '油', name: '亮油', color: '#c8b878',
    scope: 'fight',
    card: '每场战斗第一次打出 0 费牌，抽 1 张',
  },
  {
    id: 'seed', icon: '种', name: '种纸', color: '#8fb08a',
    scope: 'fight',
    card: '每场战斗第一次打出攻击牌，获得 2 点格挡',
  },
];

export const POWER_BY_ID = Object.fromEntries(POWERS.map((p) => [p.id, p])) as Record<string, PowerDef>;

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
    desc: '两个初始增益。答对退行动力，每回合第一张基础牌补格挡。',
    powers: ['librarycard', 'syllabus'],
  },
  {
    id: 'review', icon: '复', name: '复习', color: '#e8c86c',
    desc: '只带借书证。答对退行动力，没有额外防御。',
    powers: ['librarycard'],
  },
  {
    id: 'test', icon: '测', name: '测试', color: '#d98b8b',
    desc: '没有初始增益。答对不退行动力，也没有额外防御。',
    powers: [],
  },
];

export const MODE_BY_ID = Object.fromEntries(
  MODES.map((m) => [m.id, m]),
) as Record<ModeId, ModeDef>;

/**
 * 全局强度旋钮：数值调整集中在这里。
 *
 * **整个数值体系只有加、减、整数乘**。血量成长是"每上一个台阶 +N 点"，复习点是
 * "上限减 N 点"，免死是"以 N 点活下来"。没有百分比、没有倍率：一个数在卡面上
 * 怎么写，结算就怎么算。
 *
 * **只动血量、不动伤害**：伤害管"挡不挡得住"，血量管"打不打得完"。
 */
export const BAL = {
  /** 玩家初始血量、每回合行动力。 */
  baseHp: 70, baseAp: 3,
  /**
   * 敌人血量 / 伤害的整体偏移，只给 `npm run sim -- --hp=6` 这类平衡实验用；
   * 正式数值写在 `FOES` 里，默认 0 表示不加不减。
   */
  foeHpAdd: 0, foeDmgAdd: 0,
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
  /** 沙漏：第一回合多几点行动力。原来写死在 `rulesOf()` 里的 `+1`。 */
  hourglassAp: 1,
  /** 荧光笔：这一场第一次答对，在借书证之外多退几点。原来写死在 answer.ts。 */
  markerPlus: 1,
  /** 索引卡：「手牌少于几张」的阈值。原来写死在 `handLeft <= 2`。 */
  indexHand: 2,
  /** 墨水瓶 / 节拍器：第几张牌算数。原来两处各写死一个 3。 */
  inkAt: 3, pulseCards: 3,
  /** 第二批「一场只响一次」的数值。 */
  /** 批注：这一场第一次答对，这张牌额外多攒几次免答 */
  marginCharge: 1,
  /** 草稿纸：每场第一次答错补抽几张 */
  scratchDraw: 1,
  /** 护角：精英 / BOSS 战开局额外格挡 */
  cornerBlock: 4,
  /** 一场预抽几道题：牌组知识卡的答题要求总和每 `qOf` 次领 `qPer` 道，另加 `qPad` 道余量。 */
  qPer: 3, qOf: 5, qPad: 3,
  /** 修书胶：复习点回复量**额外**加几点（叠在 `restHp` 上，是加不是乘） */
  mendRest: 10,
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
  sealCut: 8,
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
  /** 许愿条：整局一次免死，活下来时留几点生命 */
  wishHp: 30,
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
  /**
   * 第一回合敌人不出攻击。默认关，`sim --set calm=1` 做平衡实验用。
   * 它和「口哨」是两套：开关只改结果，口哨按自己的条件结账 —— 打开这个开关时
   * 口哨照样会消费，不会因为短路变成一张白拿的牌。
   */
  calmFirstTurn: false,
  /** 同一种卡最多几张。 */
  maxCopies: 3,
  /** 过幕时最大生命 +多少，并回满血。 */
  stageMaxHp: 14,
  /** 复习点回复多少点生命（修书胶另加 `mendRest`）。固定点数，不跟最大生命走。 */
  restHp: 45,
  /** 装订线：答错时每段伤害减「费用 × 这个数」，格挡减「费用 × `binderBlkCut`」。 */
  binderAtkCut: 2, binderBlkCut: 5,
  /** 各机制的量；怪身上写了 `mechV` 就用它自己的，没写读这里。 */
  mech: {
    thorns: 1, bulwark: 8, siphon: 1, haste: 1, leech: 4,
    reviewer: 3, fog: 1, lethe: 1, oblivion: 4, oblivionReduce: 3, pierceBlock: 6,
  },
};

/**
 * 节点类型的名字与身份色。**图标不在这里**：节点图标是 `gfx/art/icons` 的
 * `skull / book / ask / crown / strike`，和卡面效果图标同一套 24×24 描边。
 * 这里原来还留着一个 emoji 字段（⚔☠✦?✺），从未被绘制过 —— 它只会让人以为
 * "改这里的字符就能换图标"，实际改了没有任何反应。
 */
export const NODE_META: Record<NodeType, { k: string; color: string }> = {
  fight: { k: '战斗', color: '#c9744a' },
  elite: { k: '精英', color: '#d9534f' },
  rest: { k: '复习', color: '#4fd6cf' },
  event: { k: '事件', color: '#a78bfa' },
  boss: { k: '首领', color: '#e8b64c' },
};
