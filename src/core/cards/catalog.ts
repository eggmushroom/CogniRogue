import type { CardDef } from '../model/types';

/**
 * cards/catalog —— **内置卡牌库**。这是卡面的唯一来源，不接受外部输入。
 *
 * 题库（packs/*.md，玩家可从标题页导入）只提供题目：来源题库按课程表
 * 切成每一幕的 BANK，点开牌时从当前阶段抽题。卡面 —— 有多少张卡、
 * 叫什么、属于哪个分类、攻挡数字、效果 —— 一律由这张常量表决定，
 * 换题库不会动它分毫。
 *
 * 这么做有三个直接后果：
 *   1. 卡池恒定 101 张 / 16 主题，「开局固定卡组」和「奖励随机抽」才有稳定底座；
 *   2. card id 与题干解耦：id 是固定短键（`c00`…），换题库不会让复习记忆失效、
 *      也不会把旧牌变成杂念；旧题干 id 的迁移表在 `cards/legacy.ts`，不在这里；
 *   3. 外部 md 里写不出 % 攻挡、@ 卡名，写题人改不了数值平衡。
 *
 * 这张表里没有题干、没有题目内容，也没有旧 id；`topic` 只是卡牌分类/展示标签，
 * **不参与抽题** —— 点开牌时抽的是当前阶段的 BANK，和这张卡叫什么主题无关。
 *
 * ## 费用（cost）
 *
 * 0–3 点，或者 `'x'`（花光剩下的全部行动力，花几点结算几次），和杀戮尖塔同一套读法。
 * 数值随费用一起给，基准是"1 费 = 原来那张牌"：
 *   0 费 ≈ 半价，2 费 ≈ 2.1 倍，3 费 ≈ 3.3 倍；巩固类格挡不跟着线性涨
 *   （格挡只用一回合，堆到用不完就是浪费），所以单独一档 1.7 / 2.2 倍。
 *
 * 答对只退 1 点（`BAL.refund`），所以 1 费牌答对等于免费、2 费净花 1 点、3 费净花 2 点 ——
 * 一次出 3 点的牌，等于用这一回合剩下的节奏换一次大输出。这层换算就是数值表的依据。
 */
export const CATALOG: CardDef[] = [
  { id: "c00", topic: "复杂度", name: "折半之刃", atk: 6, blk: 5, cost: 1, eff: "pierce", kind: 'knowledge' },
  { id: "c01", topic: "复杂度", name: "均衡裁决", atk: 7, blk: 5, cost: 'x', eff: "chain", kind: 'knowledge' },
  { id: "c02", topic: "复杂度", name: "逆风快斩", atk: 8, blk: 5, cost: 1, eff: "strike", mods: { atkMul: 1.15 }, kind: 'knowledge' },
  { id: "c03", topic: "复杂度", name: "长链壁垒", atk: 12, blk: 8, cost: 2, eff: "guard", kind: 'knowledge' },
  { id: "c04", topic: "数据结构", name: "扩容远见", atk: 3, blk: 2, cost: 0, eff: "focus", kind: 'knowledge' },
  { id: "c05", topic: "数据结构", name: "堆顶威压", atk: 7, blk: 5, cost: 1, eff: "strike", kind: 'knowledge' },
  { id: "c06", topic: "数据结构", name: "同源归一", atk: 17, blk: 13, cost: 2, eff: "chain", kind: 'knowledge' },
  { id: "c07", topic: "数据结构", name: "铁口直断", atk: 17, blk: 13, cost: 2, eff: "pierce", kind: 'knowledge' },
  { id: "c08", topic: "数据结构", name: "双影逐环", atk: 15, blk: 10, cost: 2, eff: "chain", mods: { times: 3, atkMul: 0.45 }, kind: 'knowledge' },
  { id: "c09", topic: "排序与查找", name: "秩序守护", atk: 7, blk: 5, cost: 1, eff: "guard", kind: 'knowledge' },
  { id: "c10", topic: "排序与查找", name: "直取要害", atk: 17, blk: 13, cost: 2, eff: "pierce", kind: 'knowledge' },
  { id: "c11", topic: "排序与查找", name: "分卷归仓", atk: 8, blk: 5, cost: 1, eff: "guard", kind: 'knowledge' },
  { id: "c12", topic: "排序与查找", name: "限额回血", atk: 15, blk: 10, cost: 2, eff: "drain", kind: 'knowledge' },
  { id: "c13", topic: "树与堆", name: "循径而下", atk: 6, blk: 5, cost: 1, eff: "pierce", kind: 'knowledge' },
  { id: "c14", topic: "树与堆", name: "自底筑垒", atk: 12, blk: 10, cost: 2, eff: "guard", kind: 'knowledge' },
  { id: "c15", topic: "树与堆", name: "不倒之枝", atk: 7, blk: 5, cost: 1, eff: "strike", kind: 'knowledge' },
  { id: "c16", topic: "树与堆", name: "页垒纵深", atk: 14, blk: 10, cost: 2, eff: "guard", mods: { blkMul: 2.2 }, kind: 'knowledge' },
  { id: "c17", topic: "树与堆", name: "轻重两叉", atk: 7, blk: 5, cost: 1, eff: "chain", kind: 'knowledge' },
  { id: "c18", topic: "树与堆", name: "词径延展", atk: 7, blk: 5, cost: 1, eff: "focus", kind: 'knowledge' },
  { id: "c19", topic: "图论", name: "直抵捷径", atk: 17, blk: 10, cost: 2, eff: "pierce", kind: 'knowledge' },
  { id: "c20", topic: "图论", name: "因果序斩", atk: 7, blk: 5, cost: 1, eff: "chain", kind: 'knowledge' },
  { id: "c21", topic: "图论", name: "层层推进", atk: 6, blk: 6, cost: 1, eff: "strike", kind: 'knowledge' },
  { id: "c22", topic: "图论", name: "连枝成盾", atk: 17, blk: 13, cost: 3, eff: "guard", mods: { blkMul: 2.4 }, kind: 'knowledge' },
  { id: "c23", topic: "图论", name: "寻环引路", atk: 7, blk: 5, cost: 1, eff: "focus", kind: 'knowledge' },
  { id: "c24", topic: "图论", name: "邻接汲取", atk: 6, blk: 5, cost: 1, eff: "drain", kind: 'knowledge' },
  { id: "c25", topic: "递归与分治", name: "合流重斩", atk: 17, blk: 10, cost: 2, eff: "chain", kind: 'knowledge' },
  { id: "c26", topic: "递归与分治", name: "辅存壁垒", atk: 6, blk: 6, cost: 1, eff: "guard", kind: 'knowledge' },
  { id: "c27", topic: "递归与分治", name: "回旋收势", atk: 4, blk: 2, cost: 0, eff: "focus", kind: 'knowledge' },
  { id: "c28", topic: "递归与分治", name: "分合之基", atk: 7, blk: 6, cost: 1, eff: "strike", kind: 'knowledge' },
  { id: "c29", topic: "递归与分治", name: "试答之刺", atk: 8, blk: 5, cost: 'x', eff: "pierce", kind: 'knowledge' },
  { id: "c30", topic: "递归与分治", name: "栈血回流", atk: 7, blk: 6, cost: 1, eff: "drain", mods: { atkMul: 0.9, heal: 0.6 }, kind: 'knowledge' },
  { id: "c31", topic: "动态规划", name: "重叠壁垒", atk: 7, blk: 6, cost: 1, eff: "guard", kind: 'knowledge' },
  { id: "c32", topic: "动态规划", name: "负重双击", atk: 4, blk: 2, cost: 0, eff: "chain", mods: { atkMul: 0.6 }, kind: 'knowledge' },
  { id: "c33", topic: "动态规划", name: "公共脉络", atk: 7, blk: 5, cost: 1, eff: "focus", kind: 'knowledge' },
  { id: "c34", topic: "动态规划", name: "以忆养身", atk: 15, blk: 10, cost: 2, eff: "drain", kind: 'knowledge' },
  { id: "c35", topic: "动态规划", name: "节节攀升", atk: 17, blk: 10, cost: 2, eff: "pierce", kind: 'knowledge' },
  { id: "c36", topic: "动态规划", name: "压境一击", atk: 6, blk: 6, cost: 1, eff: "strike", kind: 'knowledge' },
  { id: "c37", topic: "贪心策略", name: "贪锋直进", atk: 7, blk: 5, cost: 1, eff: "strike", kind: 'knowledge' },
  { id: "c38", topic: "贪心策略", name: "择段续行", atk: 3, blk: 2, cost: 0, eff: "focus", kind: 'knowledge' },
  { id: "c39", topic: "贪心策略", name: "散装护持", atk: 14, blk: 10, cost: 2, eff: "guard", kind: 'knowledge' },
  { id: "c40", topic: "贪心策略", name: "低吸高掷", atk: 3, blk: 3, cost: 0, eff: "strike", kind: 'knowledge' },
  { id: "c41", topic: "贪心策略", name: "两段试锋", atk: 7, blk: 5, cost: 1, eff: "chain", kind: 'knowledge' },
  { id: "c42", topic: "字符串匹配", name: "失配之刺", atk: 17, blk: 10, cost: 2, eff: "pierce", mods: { atkMul: 1.1 }, kind: 'knowledge' },
  { id: "c43", topic: "字符串匹配", name: "滚筒双击", atk: 8, blk: 5, cost: 'x', eff: "chain", kind: 'knowledge' },
  { id: "c44", topic: "字符串匹配", name: "同值之盾", atk: 7, blk: 7, cost: 'x', eff: "guard", kind: 'knowledge' },
  { id: "c45", topic: "字符串匹配", name: "镜像延展", atk: 17, blk: 10, cost: 2, eff: "focus", kind: 'knowledge' },
  { id: "c46", topic: "字符串匹配", name: "改字汲能", atk: 15, blk: 13, cost: 2, eff: "drain", mods: { heal: 0.65 }, kind: 'knowledge' },
  { id: "c47", topic: "回溯与搜索", name: "剪枝快斩", atk: 7, blk: 5, cost: 1, eff: "strike", kind: 'knowledge' },
  { id: "c48", topic: "回溯与搜索", name: "后阵连环", atk: 26, blk: 16, cost: 3, eff: "chain", kind: 'knowledge' },
  { id: "c49", topic: "回溯与搜索", name: "两翼包抄", atk: 6, blk: 6, cost: 1, eff: "focus", kind: 'knowledge' },
  { id: "c50", topic: "回溯与搜索", name: "先见之刺", atk: 15, blk: 10, cost: 2, eff: "pierce", mods: { atkMul: 1.15 }, kind: 'knowledge' },
  { id: "c51", topic: "回溯与搜索", name: "层层设防", atk: 7, blk: 6, cost: 1, eff: "guard", kind: 'knowledge' },
  { id: "c52", topic: "随机化与概率", name: "一瓢知江", atk: 17, blk: 10, cost: 2, eff: "focus", mods: { draw: 2, atkMul: 0.6 }, kind: 'knowledge' },
  { id: "c53", topic: "随机化与概率", name: "乱数横扫", atk: 7, blk: 5, cost: 1, eff: "strike", kind: 'knowledge' },
  { id: "c54", topic: "随机化与概率", name: "掷骰双斩", atk: 17, blk: 13, cost: 2, eff: "chain", kind: 'knowledge' },
  { id: "c55", topic: "随机化与概率", name: "赌运回血", atk: 8, blk: 5, cost: 'x', eff: "drain", kind: 'knowledge' },
  { id: "c56", topic: "随机化与概率", name: "期望贯穿", atk: 6, blk: 6, cost: 1, eff: "pierce", kind: 'knowledge' },
  { id: "c57", topic: "操作系统", name: "双线齐击", atk: 7, blk: 5, cost: 1, eff: "strike", kind: 'knowledge' },
  { id: "c58", topic: "操作系统", name: "快表索引", atk: 17, blk: 13, cost: 2, eff: "focus", mods: { draw: 2, atkMul: 0.55 }, kind: 'knowledge' },
  { id: "c59", topic: "操作系统", name: "僵局壁垒", atk: 15, blk: 11, cost: 3, eff: "guard", mods: { blkMul: 2.6 }, kind: 'knowledge' },
  { id: "c60", topic: "操作系统", name: "换场汲息", atk: 6, blk: 6, cost: 1, eff: "drain", kind: 'knowledge' },
  { id: "c61", topic: "操作系统", name: "换页两段", atk: 7, blk: 5, cost: 1, eff: "chain", kind: 'knowledge' },
  { id: "c62", topic: "操作系统", name: "越界之刺", atk: 6, blk: 5, cost: 1, eff: "pierce", kind: 'knowledge' },
  { id: "c63", topic: "计算机网络", name: "三度缔约", atk: 26, blk: 16, cost: 3, eff: "strike", mods: { times: 3, atkMul: 0.38 }, kind: 'knowledge' },
  { id: "c64", topic: "计算机网络", name: "可靠壁垒", atk: 12, blk: 10, cost: 2, eff: "guard", kind: 'knowledge' },
  { id: "c65", topic: "计算机网络", name: "控流缓图", atk: 7, blk: 5, cost: 1, eff: "focus", kind: 'knowledge' },
  { id: "c66", topic: "计算机网络", name: "截流汲能", atk: 6, blk: 6, cost: 1, eff: "drain", kind: 'knowledge' },
  { id: "c67", topic: "计算机网络", name: "循名两问", atk: 7, blk: 5, cost: 1, eff: "chain", kind: 'knowledge' },
  { id: "c68", topic: "数据库", name: "四德之壁", atk: 14, blk: 8, cost: 2, eff: "guard", kind: 'knowledge' },
  { id: "c69", topic: "数据库", name: "隔离阶击", atk: 7, blk: 6, cost: 1, eff: "strike", kind: 'knowledge' },
  { id: "c70", topic: "数据库", name: "联径直取", atk: 15, blk: 10, cost: 2, eff: "pierce", kind: 'knowledge' },
  { id: "c71", topic: "数据库", name: "分解两段", atk: 3, blk: 2, cost: 0, eff: "chain", kind: 'knowledge' },
  { id: "c72", topic: "数据库", name: "版本之眼", atk: 17, blk: 13, cost: 2, eff: "focus", kind: 'knowledge' },
  { id: "c73", topic: "并发与同步", name: "争先一击", atk: 7, blk: 5, cost: 1, eff: "strike", kind: 'knowledge' },
  { id: "c74", topic: "并发与同步", name: "持锁壁垒", atk: 6, blk: 6, cost: 1, eff: "guard", kind: 'knowledge' },
  { id: "c75", topic: "并发与同步", name: "禁令之刺", atk: 26, blk: 16, cost: 3, eff: "pierce", mods: { atkMul: 1.2 }, kind: 'knowledge' },
  { id: "c76", topic: "并发与同步", name: "两变之察", atk: 7, blk: 5, cost: 1, eff: "chain", kind: 'knowledge' },
  { id: "c77", topic: "并发与同步", name: "令牌汲取", atk: 6, blk: 5, cost: 1, eff: "drain", kind: 'knowledge' },
  { id: "c78", topic: "体系结构与编译", name: "近邻预取", atk: 4, blk: 2, cost: 0, eff: "focus", kind: 'knowledge' },
  { id: "c79", topic: "体系结构与编译", name: "停摆壁垒", atk: 7, blk: 6, cost: 1, eff: "guard", kind: 'knowledge' },
  { id: "c80", topic: "体系结构与编译", name: "译锋直斩", atk: 6, blk: 5, cost: 1, eff: "strike", kind: 'knowledge' },
  { id: "c81", topic: "体系结构与编译", name: "失真两段", atk: 7, blk: 5, cost: 1, eff: "chain", kind: 'knowledge' },
  { id: "c82", topic: "体系结构与编译", name: "上限贯穿", atk: 26, blk: 20, cost: 3, eff: "pierce", mods: { atkMul: 1.1 }, kind: 'knowledge' },

  /* ── 联动卡 ──────────────────────────────────────────────────
   * 这四张的攻击底数不是印死的，而是由**前几张牌留下的状态**算出来
   * （见 combat/link.ts）。卡面与结算共用 liveStatOf，所以抽牌 / 堆甲 /
   * 打出顺序改变的是真实伤害，不是一行提示文字。
   *
   * 都是 B 级（1 费、要答题）—— 联动是给答题环节加一层决策，不是绕过它。
   * atk / blk 在这里只是「牌组画廊里的静态底数」，实战按 link 现算，
   * 卡面右下角的 note 会写明数值从哪来。
   * ──────────────────────────────────────────────────────────── */
  { id: "c83", topic: "联动", name: "博览强记", atk: 3, blk: 5, cost: 1, eff: "strike", kind: 'knowledge',
    link: { atkFrom: 'drawn', per: 1, floor: 3, note: '本回合每抽 1 张 +1 伤' } },
  { id: "c84", topic: "联动", name: "铸甲为刃", atk: 0, blk: 5, cost: 1, eff: "strike", kind: 'knowledge',
    link: { atkFrom: 'block', per: 1, floor: 0, note: '造成当前护甲等额伤害' } },
  { id: "c85", topic: "联动", name: "续火", atk: 3, blk: 4, cost: 1, eff: "strike", kind: 'knowledge',
    link: { nextMul: 2, note: '下一张牌伤害 ×2' } },
  { id: "c86", topic: "联动", name: "叠章", atk: 4, blk: 4, cost: 1, eff: "strike", kind: 'knowledge',
    link: { grow: 3, note: '本场每打出一次，下次 +3 伤' } },

  /* ── 自伤与节奏卡 ──────────────────────────────────────────────
   * 这一批不往上堆“更大的数字”，而是给每张牌加一个**要不要现在付**的问题：
   *
   *   · 自伤（`mods.selfHp`）：伤害/格挡高于同费，但打出后自己掉血。血是
   *     这一局的血，不是这一场的资源，所以它逼玩家判断“这一下值不值得换”。
   *   · 0 费过牌：不花行动力，但占一次答题机会；它把“这回合还能不能继续”
   *     变成抽牌顺序问题，而不是费用问题。
   *   · 多段 / 低费高挡：给“先打哪张、留哪张”多一个排序理由。
   *
   * 自伤不是费用：费用栏仍然只写行动力，卡面效果区单独写「失去 X 点生命」，
   * 结算和卡面共用 `resolveEff().selfHp`，不会出现“卡面写 3、实际扣 5”。
   * ──────────────────────────────────────────────────────────── */
  { id: "c87", topic: "复杂度", name: "焚稿", atk: 12, blk: 5, cost: 1, eff: "strike",
    mods: { atkMul: 1.15, selfHp: 3 }, kind: 'knowledge' },
  { id: "c88", topic: "数据结构", name: "透支斩", atk: 10, blk: 4, cost: 0, eff: "strike",
    mods: { atkMul: 1.1, selfHp: 4 }, kind: 'knowledge' },
  { id: "c89", topic: "排序与查找", name: "血墨", atk: 10, blk: 6, cost: 1, eff: "drain",
    mods: { heal: 0.65, selfHp: 2 }, kind: 'knowledge' },
  { id: "c90", topic: "树与堆", name: "断章", atk: 20, blk: 8, cost: 2, eff: "strike",
    mods: { atkMul: 1.1, selfHp: 5 }, kind: 'knowledge' },
  { id: "c91", topic: "图论", name: "以伤换页", atk: 0, blk: 4, cost: 0, eff: "focus",
    mods: { draw: 2, selfHp: 2 }, kind: 'knowledge' },
  { id: "c92", topic: "递归与分治", name: "翻页", atk: 2, blk: 0, cost: 0, eff: "focus",
    mods: { draw: 1 }, kind: 'knowledge' },
  { id: "c93", topic: "动态规划", name: "合页", atk: 0, blk: 1, cost: 0, eff: "guard",
    mods: { blkMul: 2.2 }, kind: 'knowledge' },
  { id: "c94", topic: "贪心策略", name: "双页连斩", atk: 10, blk: 5, cost: 1, eff: "chain",
    mods: { times: 3, atkMul: 0.55 }, kind: 'knowledge' },
  { id: "c95", topic: "字符串匹配", name: "回潮", atk: 8, blk: 6, cost: 1, eff: "drain",
    mods: { heal: 0.8 }, kind: 'knowledge' },
  { id: "c96", topic: "回溯与搜索", name: "缓冲页", atk: 0, blk: 3, cost: 1, eff: "guard",
    mods: { blkMul: 2.2 }, kind: 'knowledge' },
  { id: "c97", topic: "随机化与概率", name: "抽样回响", atk: 3, blk: 0, cost: 0, eff: "focus",
    mods: { draw: 1, atkMul: 1.4 }, kind: 'knowledge' },
  { id: "c98", topic: "操作系统", name: "并行三线", atk: 18, blk: 4, cost: 2, eff: "chain",
    mods: { times: 3, atkMul: 0.45 }, kind: 'knowledge' },
  { id: "c99", topic: "计算机网络", name: "最后一行", atk: 22, blk: 10, cost: 3, eff: "pierce",
    mods: { atkMul: 1.2, selfHp: 4 }, kind: 'knowledge' },
  { id: "c100", topic: "数据库", name: "归零点", atk: 0, blk: 2, cost: 0, eff: "guard",
    mods: { blkMul: 1.7 }, kind: 'knowledge' },
];

