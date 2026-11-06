/** 领域模型。这一层不认识 canvas，也不认识 DOM。 */

export interface Question {
  q: string;
  options: string[];
  answer: number;
  explain: string;
}

/**
 * 卡牌效果。`strike` 是基准，其余五种各偏一门：
 * 洞察破防、巩固堆挡、内化回血、串联分段、专注抽牌。
 */
export type Eff = 'strike' | 'pierce' | 'guard' | 'drain' | 'chain' | 'focus';

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
 * 一张知识卡：卡面效果恒定，题目是点开之后才付的代价。
 * `qs` 是这个知识点的题库 —— 一次只问一道，所以同一个知识点会被从不同角度反复问。
 */
export interface CardDef {
  id: string;
  topic: string;
  /** 知识点短名，印在卡面上。 */
  name: string;
  /** 第一道题的题干，也用来兜底生成卡名与 id */
  q: string;
  /** 效果底数：伤害与格挡的基数，实际值由 effect 折算 */
  atk: number;
  blk: number;
  /** 这张卡怎么把上面的数字花出去 */
  eff: Eff;
  qs: Question[];
  /**
   * 有值就是一张增益牌：它不出题，打出后本场持续生效。
   * 增益牌不进解锁统计、不参与记忆调度，也不吃"答对退款"。
   */
  power?: PowerId;
  junk?: boolean;
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

export type Mech = 'reviewer' | 'pierce' | 'oblivion';

export type ArtKey = 'shard' | 'examiner' | 'oblivion';

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
