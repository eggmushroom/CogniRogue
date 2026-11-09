import type { FoeTpl, ModeDef, NodeType, PowerDef, RunMode, StageDef } from './types';

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
    hint: '它就是来消耗你手牌的。答对就好，别想太多。',
  },
  {
    key: 'examiner', name: '复习官', type: 'fight', art: 'examiner', stage: 1, tag: '普通',
    hp: 58, dmg: 8, moves: [{ k: 'atk', m: 1 }], mech: 'reviewer',
    hint: '一回合内没有真正答对任何一张卡，它额外打你 3 点 —— 不答题就没有输出。',
  },
  {
    key: 'grub', name: '书蛀', type: 'fight', art: 'grub', stage: 1, tag: '普通',
    hp: 56, dmg: 7, moves: [{ k: 'atk', m: 0.75 }, { k: 'atk', m: 1 }], mech: 'leech',
    hint: '你每答错一次，它就啃食这次失误回 4 血。别喂它。',
  },
  {
    key: 'drift', name: '走神', type: 'fight', art: 'moth', stage: 1, tag: '普通',
    hp: 46, dmg: 6, moves: [{ k: 'jam', n: 1 }, { k: 'jam', n: 1 }, { k: 'atk', m: 1 }],
    hint: '一群纸作的飞蛾。它不急着咬你——它在把你的牌堆一点点搅浑。',
  },
  {
    key: 'inquisitor', name: '主考官', type: 'elite', art: 'inquisitor', stage: 1, tag: '精英',
    hp: 96, dmg: 11,
    moves: [{ k: 'atk', m: 1.25 }, { k: 'def', v: 14 }, { k: 'atk', m: 0.7, times: 2 }],
    mech: 'reviewer',
    hint: '复习官的上司。赏罚都更重——一回合没认真答对，它会加倍记恨。',
  },
  {
    key: 'rereader', name: '复读者', type: 'elite', art: 'examiner', stage: 1, tag: '精英',
    hp: 88, dmg: 9,
    moves: [{ k: 'atk', m: 1.1 }, { k: 'atk', m: 0.5, times: 3 }, { k: 'jam', n: 2 }],
    hint: '同一段话读三遍。三段轻击每一段都要挡，漏一段就是一整套。',
  },
  {
    key: 'cataloguer', name: '编目者', type: 'boss', art: 'cataloguer', stage: 1, tag: 'BOSS',
    hp: 112, dmg: 12,
    moves: [{ k: 'atk', m: 1 }, { k: 'jam', n: 2 }, { k: 'atk', m: 1.3 }],
    mech: 'reviewer',
    hint: '它把你这一局学过的东西一条条编上号。一回合不答题，它就把你归档。',
  },

  /* ── 第二幕 · 虫蛀的借阅区 ──────────────────────────────────
     母题：**你的牌堆**。塞杂念、少抽牌 —— 它不跟你打，它让你没牌可打。 */
  {
    key: 'bookmoth', name: '蠹蛾', type: 'fight', art: 'moth', stage: 2, tag: '普通',
    hp: 66, dmg: 8, moves: [{ k: 'jam', n: 1 }, { k: 'atk', m: 1 }], mech: 'fog',
    hint: '它翅膀上的粉让你的视野少一格：本场每回合少抽 1 张。牌组越薄越不怕它。',
  },
  {
    key: 'damp', name: '湿页', type: 'fight', art: 'shard', stage: 2, tag: '普通',
    hp: 72, dmg: 8, moves: [{ k: 'def', v: 12 }, { k: 'atk', m: 1.1 }],
    hint: '吸饱水的纸又厚又软：先垒墙再拍你。举盾那回合是它最脆的时候。',
  },
  {
    key: 'grubqueen', name: '书蛀母', type: 'fight', art: 'grub', stage: 2, tag: '普通',
    hp: 78, dmg: 9, moves: [{ k: 'atk', m: 0.8 }, { k: 'atk', m: 1 }], mech: 'leech',
    hint: '你每答错一次，它回 4 血。在虫蛀区，错是要被吃掉的。',
  },
  {
    key: 'stitchworm', name: '线虫', type: 'fight', art: 'grub', stage: 2, tag: '普通', hue: 100,
    hp: 70, dmg: 8, moves: [{ k: 'atk', m: 0.55, times: 2 }, { k: 'atk', m: 1 }],
    hint: '它把自己缝进书脊里，一抽就是两段。',
  },
  {
    key: 'wormking', name: '蠹王', type: 'elite', art: 'grub', stage: 2, tag: '精英', hue: 150,
    hp: 120, dmg: 11,
    moves: [{ k: 'jam', n: 1 }, { k: 'atk', m: 1.2 }, { k: 'atk', m: 0.6, times: 2 }],
    mech: 'fog',
    hint: '它坐着不动，让整个借阅区的纸屑往你手里飞：少抽一张，还要挨打。',
  },
  {
    key: 'copyist', name: '抄书吏', type: 'elite', art: 'examiner', stage: 2, tag: '精英', hue: 130,
    hp: 112, dmg: 10,
    moves: [{ k: 'atk', m: 1.15 }, { k: 'def', v: 14 }], mech: 'bulwark', mechV: 8,
    hint: '你答错一次，它就多抄一页、多一层甲。错得越多，它越厚。',
  },
  {
    key: 'devourer', name: '饕餮书虫', type: 'boss', art: 'devourer', stage: 2, tag: 'BOSS', hue: 110,
    hp: 150, dmg: 12,
    moves: [{ k: 'atk', m: 1 }, { k: 'jam', n: 2 }, { k: 'atk', m: 0.65, times: 2 }],
    mech: 'leech',
    hint: '它吃你的错。每一次答错都是给它上菜 —— 这一场要的不是快，是不出错。',
  },

  /* ── 第三幕 · 报刊与副本 ────────────────────────────────────
     母题：**重复**。多段、复印、反伤 —— 一刀切不动，得一次打穿。 */
  {
    key: 'ghostprint', name: '影印', type: 'fight', art: 'shard', stage: 3, tag: '普通', hue: 205,
    hp: 78, dmg: 9, moves: [{ k: 'atk', m: 0.5, times: 3 }], mech: 'thorns', mechV: 1,
    hint: '每打它一次，你自己被反伤 2 点。三段轻击最怕这种皮 —— 用重刀。',
  },
  {
    key: 'typeblock', name: '铅字块', type: 'fight', art: 'shard', stage: 3, tag: '普通', hue: 220,
    hp: 92, dmg: 9, moves: [{ k: 'def', v: 14 }, { k: 'atk', m: 1.1 }],
    hint: '一整块实心铅。它举盾的时候别硬砸。',
  },
  {
    key: 'compositor', name: '排字工', type: 'fight', art: 'examiner', stage: 3, tag: '普通', hue: 205,
    hp: 84, dmg: 10, moves: [{ k: 'atk', m: 1 }, { k: 'jam', n: 2 }], mech: 'pierce',
    hint: '它的攻击无视一半格挡，还顺手往你牌堆里排两条乱码。',
  },
  {
    key: 'carbon', name: '复写纸', type: 'fight', art: 'moth', stage: 3, tag: '普通', hue: 205,
    hp: 76, dmg: 9, moves: [{ k: 'atk', m: 1.1 }, { k: 'atk', m: 1.1 }],
    hint: '你打它一次，它印出两张同样的脸。一轮两下，都是实的。',
  },
  {
    key: 'duplex', name: '双面印刷机', type: 'elite', art: 'examiner', stage: 3, tag: '精英', hue: 210,
    hp: 135, dmg: 11,
    moves: [{ k: 'atk', m: 0.55, times: 3 }, { k: 'def', v: 16 }], mech: 'thorns', mechV: 3,
    hint: '两面都在印。反伤 + 三段攻击：这一场它逼你把伤害集中在一击里。',
  },
  {
    key: 'stereotype', name: '铅版巨人', type: 'elite', art: 'inquisitor', stage: 3, tag: '精英', hue: 205,
    hp: 145, dmg: 12,
    moves: [{ k: 'atk', m: 1.25 }, { k: 'buff', v: 2 }], mech: 'haste',
    hint: '它每回合都更重一点。拖下去只有一种结局 —— 越早打完越好。',
  },
  {
    key: 'imprinter', name: '压印之主', type: 'boss', art: 'imprinter', stage: 3, tag: 'BOSS', hue: 195,
    hp: 178, dmg: 13,
    moves: [{ k: 'atk', m: 1 }, { k: 'atk', m: 0.55, times: 3 }, { k: 'def', v: 18 }],
    mech: 'thorns', mechV: 3,
    hint: '它把你的每一击都压回你身上。这一场只有重刀算数，薄刀是在给自己放血。',
  },

  /* ── 第四幕 · 修复室 ────────────────────────────────────────
     母题：**甲与时间**。先叠甲、每回合变强 —— 它不急着杀你，它在等你打不动。 */
  {
    key: 'gluebeast', name: '胶合兽', type: 'fight', art: 'grub', stage: 4, tag: '普通', hue: 20,
    hp: 96, dmg: 10, moves: [{ k: 'atk', m: 1 }, { k: 'def', v: 16 }],
    hint: '一坨没干透的胶。打完记得它下一手是糊自己一身。',
  },
  {
    key: 'stitchdoll', name: '缝线傀儡', type: 'fight', art: 'moth', stage: 4, tag: '普通', hue: 25,
    hp: 102, dmg: 10, moves: [{ k: 'atk', m: 0.6, times: 2 }, { k: 'buff', v: 2 }], mech: 'haste',
    hint: '它每回合给自己加一道线，攻击跟着涨。拖不得。',
  },
  {
    key: 'leathercover', name: '皮革封面', type: 'fight', art: 'shard', stage: 4, tag: '普通', hue: 25,
    hp: 112, dmg: 10, moves: [{ k: 'def', v: 18 }, { k: 'atk', m: 1.2 }], mech: 'bulwark', mechV: 10,
    hint: '你答错一次，它就多一层皮革。错一次，这一场就厚一截。',
  },
  {
    key: 'gluepot', name: '熔胶炉', type: 'fight', art: 'oblivion', stage: 4, tag: '普通', hue: 30,
    hp: 90, dmg: 11, moves: [{ k: 'atk', m: 1.2 }, { k: 'atk', m: 1.2 }],
    hint: '两口滚烫的胶，一次一口。没有花招，就是疼。',
  },
  {
    key: 'binder', name: '装订师', type: 'elite', art: 'examiner', stage: 4, tag: '精英', hue: 25,
    hp: 150, dmg: 12,
    moves: [{ k: 'atk', m: 1.2 }, { k: 'def', v: 18 }, { k: 'atk', m: 0.6, times: 2 }],
    mech: 'bulwark', mechV: 12,
    hint: '他一边装订一边收拾你。答错会让他把你的手也订进去。',
  },
  {
    key: 'press', name: '压书机', type: 'elite', art: 'inquisitor', stage: 4, tag: '精英', hue: 20,
    hp: 160, dmg: 13,
    moves: [{ k: 'atk', m: 1.3 }, { k: 'buff', v: 3 }], mech: 'haste',
    hint: '每压一次，它就更紧一分。这一场是赛跑。',
  },
  {
    key: 'bound', name: '装订之兽', type: 'boss', art: 'bound', stage: 4, tag: 'BOSS', hue: 25,
    hp: 205, dmg: 14,
    moves: [{ k: 'atk', m: 1 }, { k: 'def', v: 20 }, { k: 'atk', m: 0.65, times: 2 }],
    mech: 'bulwark', mechV: 14,
    hint: '它把你这一路的错误缝成一本厚书，然后拿它当盾。这一场你得先把它拆开。',
  },

  /* ── 第五幕 · 禁书区 ────────────────────────────────────────
     母题：**你的错误**。它知道你哪块最弱，而且每次都往那儿打。 */
  {
    key: 'whisperer', name: '低语者', type: 'fight', art: 'examiner', stage: 5, tag: '普通', hue: 320,
    hp: 110, dmg: 11, moves: [{ k: 'jam', n: 2 }, { k: 'atk', m: 1.15 }], mech: 'siphon',
    hint: '它打中你一次，你下回合就少 1 点行动力。挡不住，节奏会一路塌下去。',
  },
  {
    key: 'blankleaf', name: '空页', type: 'fight', art: 'shard', stage: 5, tag: '普通', hue: 320,
    hp: 118, dmg: 11, moves: [{ k: 'atk', m: 1.05 }, { k: 'def', v: 20 }],
    hint: '什么都没写的一页 —— 你答不出它，它也不会答你。',
  },
  {
    key: 'ashencopy', name: '灰烬的抄本', type: 'fight', art: 'grub', stage: 5, tag: '普通', hue: 300,
    hp: 105, dmg: 11, moves: [{ k: 'atk', m: 0.6, times: 3 }], mech: 'pierce',
    hint: '三段，每一段都穿透一半格挡。守不住的那种守。',
  },
  {
    key: 'fgotten', name: '遗忘的读者', type: 'fight', art: 'moth', stage: 5, tag: '普通', hue: 320,
    hp: 100, dmg: 11,
    moves: [{ k: 'atk', m: 1 }, { k: 'jam', n: 2 }, { k: 'atk', m: 1 }], mech: 'lethe',
    hint: '你每错一次，它永久 +1 攻。在禁书区，错误是会长大的。',
  },
  {
    key: 'silencer', name: '缄默者', type: 'elite', art: 'inquisitor', stage: 5, tag: '精英', hue: 320,
    hp: 165, dmg: 13,
    moves: [{ k: 'atk', m: 1.15 }, { k: 'atk', m: 0.7, times: 2 }], mech: 'siphon',
    hint: '它不让你说话，也不让你出牌：每一次命中都抽走你下回合的行动力。',
  },
  {
    key: 'lethe', name: '忘川', type: 'elite', art: 'lethe', stage: 5, tag: '精英',
    hp: 175, dmg: 13,
    moves: [{ k: 'atk', m: 1 }, { k: 'jam', n: 2 }, { k: 'atk', m: 0.65, times: 2 }, { k: 'buff', v: 2 }],
    mech: 'lethe',
    hint: '你的每一次答错都会让它永久 +1 攻——它是遗忘本身，喂不得。',
  },
  {
    key: 'oblivion', name: '遗忘', type: 'boss', art: 'oblivion', stage: 5, tag: 'BOSS',
    hp: 260, dmg: 15,
    moves: [{ k: 'atk', m: 1 }, { k: 'atk', m: 0.6, times: 2 }, { k: 'buff', v: 2 }],
    mech: 'oblivion',
    hint: '本局你错得最多的主题，对它伤害 +4；但你在该主题上答对，它本回合 -3。',
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
 * 每种只有一张（`openPowerReward` 会排除已拥有的），所以不需要处理同名叠加。
 */
export const POWERS: PowerDef[] = [
  {
    id: 'log', icon: '记', name: '错题本', cost: 1, color: '#e08048',
    card: '答错时该主题攻击 +1（最多 +6）',
    desc: '答错变成投资：这一场里反复错同一个主题，反而在那一块越打越重。',
  },
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
    card: '每回合第一次答错不花行动力',
    desc: '一次容错。答错仍然作废、仍然进弃牌堆，只是不让你连节奏一起输掉。',
  },
  {
    id: 'mirrorcard', icon: '镜', name: '双面镜', cost: 0, color: '#a78bfa',
    card: '本场答对后抽 1 张（每回合一次）',
    desc: '它让你看见刚想到的那件事的另一面。一次性效果，所以不要钱，只占一张牌位。',
  },
  {
    id: 'lamp', icon: '灯', name: '长明灯', cost: 1, color: '#e8c86c',
    card: '每回合开始获得 3 点格挡',
    desc: '灯亮着，就不再完全空手挨打。答错锁卡的那几回合尤其要紧。',
  },
  {
    id: 'marker', icon: '笔', name: '荧光笔', cost: 1, color: '#d06fa8',
    card: '每回合第一次答对抽 1 张',
    desc: '它奖励的不是"答对"，是"这一回合你先答对了什么"这个顺序。',
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
 * 三种模式只在三件事上不同：答错补多少格挡、牌去哪、稳固度怎么变。
 * 卡面数值、题库、敌人都不动 —— 换模式不该让同一张牌变成另一张牌。
 */
export const MODES: Record<RunMode, ModeDef> = {
  learn: {
    key: 'learn', name: '学习', tag: '还在学，允许错', color: '#4fd6cf',
    // 答错补 60% 格挡（原来是全额）。100 层之后，"全额补偿"会变成一台永动机：
    // 答错不仅不亏，还白得一层甲，于是错得越多越难死 —— 技巧曲线在长局里会反转。
    // 学习模式的宽恕本来就有两处（牌回抽牌堆、稳固度掉得最少），第三处不必给满。
    missBlock: 0.6, stabDrop: 0.6, stabGain: 1,
    missDest: 'draw',
    cardLabel: '学习 · 答错会回来',
    hint: '答对退回 1 点行动力；答错这一手作废，牌回牌堆、下回合一定再回来，还按卡面格挡全额挡一下。',
  },
  review: {
    key: 'review', name: '复习', tag: '学过，要求稳', color: '#e8b64c',
    missBlock: 0.5, stabDrop: 0.35, stabGain: 1.15,
    missDest: 'discard',
    cardLabel: '复习 · 答错等洗牌',
    hint: '答对退回 1 点行动力；答错这一手作废，牌进弃牌堆、要等洗牌才回来，还按格挡的一半挡一下。',
  },
  test: {
    key: 'test', name: '测试', tag: '检验，错不起', color: '#d9534f',
    missBlock: 0, stabDrop: 0.15, stabGain: 1.35,
    missDest: 'discard',
    cardLabel: '测试 · 答错没有补偿',
    hint: '答对退回 1 点行动力；答错这一手作废，牌进弃牌堆，而且没有任何格挡补偿。',
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
   */
  hp: 1.18, dmg: 1.24, baseHp: 70, baseAp: 3,
  /**
   * 答对退回几点行动力。**一手最多退 1 点，不是全退**。
   *
   * 这一条是费用体系的地基：1 费牌答对等于免费（和引入费用之前一模一样），
   * 2 费净花 1 点、3 费净花 2 点。如果改成全退，费用就只剩"押错赔多少"这一层，
   * 高费牌会变成"同样免费、输出三倍"的纯优化 —— 一回合打一张 3 费比打三张 1 费
   * 永远更好，牌组会一路收敛到最贵的那几张，构筑就没了。
   *
   * 行动力因此同时买两样东西：犯错的机会，和一次打得更重的机会。
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
   * 答错时补抽几张、每回合最多补几次。
   *
   * 它不是"错误的奖励"，是**防止手牌枯竭**：答错的那张牌会离开手牌（进弃牌堆或回牌堆），
   * 不补的话，一个 55% 正确率的人会在两回合内把手牌打空 —— 那时他不是"答不对"，
   * 是"没牌可答"，两种体验差得很远。代价仍然落在"这一手没打出来"，不落在"整回合报废"。
   *
   * 这条是曲线形状的关键：它只补贴答错的人，所以低水平拿到的最多。
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
  /** 错题本每次答错给该主题加的攻击（上限 6） */
  logAtk: 1,
  /**
   * 记忆稳固度到这个数，一张卡算「已经掌握」。
   *
   * 它现在只做两件事：测试模式优先抽这些卡（见 library/memory 的 startDeck），
   * 以及记忆条按 `stab / (stab + 2×门槛)` 归一（门槛正好落在条子的 1/3）。
   * 答错惩罚已经交给 `MODES`，不再由这张卡的稳固度决定。
   *
   * 数值 4 ≈ 连续答对三次（1 → 2 → 3.6 → 6.5）。
   */
  reviewStab: 4,
  /**
   * 每场战斗开局白送的格挡。解锁期的头两回合几乎叠不出挡，
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
   * 这些数都在"一次决定"的量级上：反伤 2 点让你少打薄刀，格挡 8 点让你
   * 不敢答错，行动力 1 点是半张牌。不要把它们调成"一击必杀"的规模 ——
   * 机制是换打法的提示，不是随机死亡。
   */
  mech: { thorns: 1, bulwark: 8, siphon: 1, haste: 1, leech: 4, reviewer: 3 },
};

export const NODE_META: Record<NodeType, { k: string; g: string; color: string }> = {
  fight: { k: '战斗', g: '⚔', color: '#c9744a' },
  elite: { k: '精英', g: '☠', color: '#d9534f' },
  rest: { k: '复习', g: '✦', color: '#4fd6cf' },
  event: { k: '事件', g: '?', color: '#a78bfa' },
  boss: { k: '首领', g: '✺', color: '#e8b64c' },
};
