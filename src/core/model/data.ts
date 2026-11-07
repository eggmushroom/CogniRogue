import type { FoeTpl, NodeType, PowerDef } from './types';

/**
 * 敌人。招式是循环表，玩家能看见下一步要干什么 —— 这样"这回合该攻还是该守"
 * 才是一个能推理的决定，而不是掷骰子。
 */
export const FOES: FoeTpl[] = [
  {
    key: 'shard', name: '记忆的碎片', type: 'fight', art: 'shard', tag: '普通',
    hp: 56, dmg: 7, moves: [{ k: 'atk', m: 1 }],
    hint: '它就是来消耗你手牌的。答对就好，别想太多。',
  },
  {
    key: 'examiner', name: '复习官', type: 'fight', art: 'examiner', tag: '普通',
    hp: 62, dmg: 8, moves: [{ k: 'atk', m: 1 }], mech: 'reviewer',
    hint: '一回合内没有真正答对任何一张卡，它额外打你 3 点。快攻流在这里会被惩罚。',
  },
  {
    key: 'echo', name: '回声', type: 'fight', art: 'shard', hue: 130, tag: '普通',
    hp: 50, dmg: 7, moves: [{ k: 'atk', m: 1 }], mech: 'pierce',
    hint: '它的攻击无视一半格挡。堆格挡这一套对它不好使。',
  },
  {
    key: 'entropy', name: '熵', type: 'fight', art: 'examiner', hue: 320, tag: '普通',
    hp: 58, dmg: 8, moves: [{ k: 'jam', n: 1 }, { k: 'atk', m: 1 }],
    hint: '它会往你的弃牌堆里塞杂念——占手牌位、打不出去，回合结束才散。',
  },
  {
    key: 'drift', name: '走神', type: 'fight', art: 'moth', tag: '普通',
    hp: 46, dmg: 6, moves: [{ k: 'jam', n: 1 }, { k: 'jam', n: 1 }, { k: 'atk', m: 1 }],
    hint: '一群纸作的飞蛾。它不急着咬你——它在把你的牌堆一点点搅浑。',
  },
  {
    key: 'grub', name: '书蛀', type: 'fight', art: 'grub', tag: '普通',
    hp: 60, dmg: 7, moves: [{ k: 'atk', m: 0.75 }, { k: 'atk', m: 1 }], mech: 'leech',
    hint: '你每答错一次，它就啃食这次失误回 4 血。别喂它。',
  },
  {
    key: 'cram', name: '硬背石像', type: 'fight', art: 'shard', hue: 38, tag: '普通',
    hp: 72, dmg: 9, moves: [{ k: 'def', v: 11 }, { k: 'atk', m: 1.15 }],
    hint: '先把墙垒起来再出手。举盾那回合攒好火力，别把伤害拍在墙上。',
  },
  {
    key: 'mirage', name: '错觉蜃影', type: 'fight', art: 'examiner', hue: 265, tag: '普通',
    hp: 52, dmg: 7, moves: [{ k: 'atk', m: 1 }, { k: 'atk', m: 0.45, times: 3 }],
    hint: '三段轻击，每一段都不重——但漏掉一段就是一整套。数着它的段数防。',
  },
  {
    key: 'reviewer', name: '审视者', type: 'elite', art: 'examiner', tag: '精英',
    hp: 92, dmg: 11,
    moves: [{ k: 'atk', m: 1.3 }, { k: 'atk', m: 0.65, times: 2 }, { k: 'def', v: 12 }],
    hint: '它会格挡。想靠一回合爆发带走它，得先把那层挡住。',
  },
  {
    key: 'mirror', name: '镜像', type: 'elite', art: 'shard', hue: 205, tag: '精英',
    hp: 88, dmg: 10,
    moves: [{ k: 'atk', m: 1.2 }, { k: 'jam', n: 2 }, { k: 'atk', m: 0.7, times: 2 }],
    mech: 'pierce',
    hint: '无视一半格挡，还会塞杂念。它专门惩罚"只守不攻"。',
  },
  {
    key: 'inquisitor', name: '主考官', type: 'elite', art: 'inquisitor', tag: '精英',
    hp: 102, dmg: 12,
    moves: [{ k: 'atk', m: 1.25 }, { k: 'def', v: 14 }, { k: 'atk', m: 0.7, times: 2 }],
    mech: 'reviewer',
    hint: '复习官的上司。赏罚都更重——一回合没认真答对，它会加倍记恨。',
  },
  {
    key: 'tide', name: '题海', type: 'elite', art: 'tide', tag: '精英',
    hp: 96, dmg: 10,
    moves: [{ k: 'jam', n: 2 }, { k: 'atk', m: 1.15 }, { k: 'atk', m: 0.6, times: 2 }],
    hint: '无穷的题目淹过来：杂念占住手牌位，攻击一波接一波。先把源头打碎。',
  },
  {
    key: 'oblivion', name: '遗忘', type: 'boss', art: 'oblivion', tag: 'BOSS',
    hp: 150, dmg: 14,
    moves: [{ k: 'atk', m: 1 }, { k: 'atk', m: 0.6, times: 2 }, { k: 'buff', v: 2 }],
    mech: 'oblivion',
    hint: '本局你错得最多的主题，对它伤害 +4；但你在该主题上答对，它本回合 -3。',
  },
  {
    key: 'lethe', name: '忘川', type: 'boss', art: 'lethe', tag: 'BOSS',
    hp: 158, dmg: 13,
    moves: [{ k: 'atk', m: 1 }, { k: 'jam', n: 2 }, { k: 'atk', m: 0.65, times: 2 }, { k: 'buff', v: 2 }],
    mech: 'lethe',
    hint: '你的每一次答错都会让它永久 +1 攻——它是遗忘本身，喂不得。',
  },
];

/**
 * 增益牌。它们原来是"遗物"——挂在界面右上角、白给、永远生效。
 *
 * 转成牌之后，每一张都要求你为它付一次钱：抽到手上、花 1 点行动力、占掉一个手牌位。
 * 换来的是本场战斗剩下的时间里持续生效。所以这套东西现在和知识卡是同一个货币体系，
 * 不再是"局外成长"。
 *
 * 每种只有一张（`openPowerReward` 会排除已拥有的），所以不需要处理同名叠加。
 */
export const POWERS: PowerDef[] = [
  {
    id: 'log', icon: '记', name: '错题本', color: '#e08048',
    card: '答错时该主题攻击 +1（最多 +6）',
    desc: '答错变成投资：这一场里反复错同一个主题，反而在那一块越打越重。',
  },
  {
    id: 'hourglass', icon: '时', name: '沙漏', color: '#e8b64c',
    card: '每回合行动力 +1',
    desc: '把时间摊平：这一手先把自己赚回来，之后每一回合都多一次出手机会。',
  },
  {
    id: 'index', icon: '索', name: '索引卡', color: '#6f9ee8',
    card: '每回合多抽 1 张牌',
    desc: '手上多一张牌，就多一道能答的题。牌组越厚它越值钱。',
  },
  {
    id: 'binder', icon: '订', name: '装订线', color: '#4fd6cf',
    card: '每回合第一次答错不花行动力',
    desc: '一次容错。答错仍然作废、仍然进弃牌堆，只是不让你连节奏一起输掉。',
  },
  {
    id: 'mirrorcard', icon: '镜', name: '双面镜', color: '#a78bfa',
    card: '打出时随机解锁一种卡',
    desc: '它照出你已经会的那部分。一次性效果，但省下的是一整道题的节奏。',
  },
  {
    id: 'lamp', icon: '灯', name: '长明灯', color: '#e8c86c',
    card: '每回合开始获得 3 点格挡',
    desc: '灯亮着，就不再完全空手挨打。答错锁卡的那几回合尤其要紧。',
  },
  {
    id: 'marker', icon: '笔', name: '荧光笔', color: '#d06fa8',
    card: '每回合第一次答对抽 1 张',
    desc: '它奖励的不是"答对"，是"这一回合你先答对了什么"这个顺序。',
  },
];

export const POWER_BY_ID = Object.fromEntries(POWERS.map((p) => [p.id, p])) as Record<string, PowerDef>;

/**
 * 全局强度旋钮。所有数值调整都集中在这里，方便无头模拟复跑。
 *
 * 解锁系统那四个数是配套的：开局白送格挡 + 答错补格挡，是为了让"全锁"
 * 的头两回合不至于裸奔；freeMult 则是把"答对"换成输出的那条曲线 —— 它
 * 抵消了敌人随层数的血量成长，也就是这个游戏原本缺的成长曲线。
 *
 * 这里曾经还有一张 ECON 表（识记/理解/迁移三档的退还与赔付）。押注机制
 * 整个拿掉之后，出牌的节奏收支只剩「一张 1 点、答对退回」这一条，那张表连带
 * tierStat、switchTier、结算页的标定表一起删了 —— 缘由见 README「押注机制被删掉了」。
 */
export const BAL = {
  hp: 1.45, dmg: 1.6, baseHp: 70, baseAp: 3, handSize: 6,
  /**
   * 答对退还这一手的行动力。押注没了之后，节奏只剩这一条规则：
   * 行动力买的不是"出牌次数"，而是"犯错次数" —— 会的人一回合能把整把牌打完，
   * 不会的人打三张就没油了。这条是模拟里技巧曲线唯一还站得住的原因：
   * 关掉它，5 点行动力下 72% 和 88% 水平的胜率会挤在一起（69% vs 70%）。
   */
  refundRight: true,
  /** 已解锁卡种的免答出牌倍率 */
  freeMult: 1.5,
  /** 普通战斗掉落增益牌的概率。精英必掉，这里是「偶尔见着一次」的那一档 */
  powerDrop: 0.15,
  /** 长明灯每回合给的格挡 */
  lampBlock: 3,
  /** 错题本每次答错给该主题加的攻击（上限 6） */
  logAtk: 1,
  /**
   * 记忆稳固度到这个数，一张卡才从「学习期」进「复习期」。
   *
   * 用稳固度而不是"答对几次"，是因为它**会掉**：答错一次 ×0.4，卡片自己退回学习期。
   * 于是惩罚是自限的 —— 一张牌顶多坑你一次，之后它重新变回"还在学"。
   * 而累积的答对数只说明"这套题你做过多少遍"，新手做多了也会被算成复习期。
   *
   * 数值 4 ≈ 连续答对三次（1 → 2 → 3.6 → 6.5）。记忆条按 `stab / (stab + 2×门槛)` 归一，
   * 所以复习期的门槛正好落在条子的 1/3 处。
   */
  reviewStab: 4,
  /**
   * 学习期答错：牌回抽牌堆，下一回合抽回来，不进弃牌堆。
   *
   * 学习阶段犯错是学费，不该顺手把工具没收 —— 代价只剩"这一手作废 + 1 点行动力"。
   * 注意这条和"进弃牌堆"的差别不是文案差别：10 张牌 6 张手牌，回合结束整把都会进弃牌堆，
   * 所以"回牌堆"真正的意思是"下一回合你一定会再见到它"。
   */
  learnForgive: true,
  /**
   * 复习期答错要不要再加一档惩罚：这个卡种整场作废（进弃牌堆，之后只能快攻）。
   *
   * 实测过，默认关。开着它更像"遗忘"，但代价落在错误的地方：
   *   --runs=800            熟练 53% · 答题 64/局
   *   --runs=800 --strict=1 熟练 38% · 答题 52/局
   * 作废的牌不能再被问，等于把"答错的惩罚"变成了"少答四分之一的题"——
   * 而这个游戏的目的是让人多答题。所以复习期的代价停在"牌不再自动回来"这一档。
   * 留着这个开关，是为了以后想试更硬的复习期时不用重写。
   */
  reviewStrict: false,
  /** 答错时按卡面格挡的多少比例补偿（半懂也能挡一点） */
  missBlock: 0.5,
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
};

export const NODE_META: Record<NodeType, { k: string; g: string; color: string }> = {
  fight: { k: '战斗', g: '⚔', color: '#c9744a' },
  elite: { k: '精英', g: '☠', color: '#d9534f' },
  rest: { k: '复习', g: '✦', color: '#4fd6cf' },
  event: { k: '事件', g: '?', color: '#a78bfa' },
  boss: { k: '首领', g: '✺', color: '#e8b64c' },
};
