import type { CardDef } from '../model/types';

/**
 * cards/catalog —— **内置卡牌库**。这是卡面的唯一来源，不接受外部输入。
 *
 * 题库（packs/*.md，玩家可从标题页导入）只提供题目：主题分组是可选的，
 * 点开牌时才按卡面主题取题、缺题回退到全部题目。卡面 —— 有多少张卡、
 * 叫什么、属于哪个主题、攻挡数字、效果 —— 一律由这张常量表决定，
 * 换题库不会动它分毫。
 *
 * 这么做有三个直接后果：
 *   1. 卡池恒定 83 张 / 16 主题，「开局固定卡组」和「奖励随机抽」才有稳定底座；
 *   2. card id 不再由题干生成，换题库不会让复习记忆失效、也不会把旧牌变成杂念；
 *   3. 外部 md 里写不出 % 攻挡、@ 卡名，写题人改不了数值平衡。
 *
 * id 是历史格式（序号 + 题干前缀），刻意保留：它已经写进过玩家的 localStorage。
 * 现在它只是一串固定字符串，与当前题库内容再无关系。
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
  { id: "0:二分查找在 n 个有序元素上的最坏时", topic: "复杂度", name: "折半之刃", atk: 6, blk: 5, cost: 1, eff: "pierce", kind: 'knowledge' },
  { id: "1:递归式 T(n) = 2T(n/2)", topic: "复杂度", name: "均衡裁决", atk: 7, blk: 5, cost: 'x', eff: "chain", kind: 'knowledge' },
  { id: "2:快速排序的最坏时间复杂度出现在什么情", topic: "复杂度", name: "逆风快斩", atk: 8, blk: 5, cost: 1, eff: "strike", mods: { atkMul: 1.15 }, kind: 'knowledge' },
  { id: "3:哈希表里所有键都冲突、全部挤在同一条", topic: "复杂度", name: "长链壁垒", atk: 12, blk: 8, cost: 2, eff: "guard", kind: 'knowledge' },
  { id: "4:同时需要「尾部插入均摊 O(1)」和", topic: "数据结构", name: "扩容远见", atk: 3, blk: 2, cost: 0, eff: "focus", kind: 'knowledge' },
  { id: "5:优先队列（每次取出最小元素）最常用的", topic: "数据结构", name: "堆顶威压", atk: 7, blk: 5, cost: 1, eff: "strike", kind: 'knowledge' },
  { id: "6:并查集同时使用「路径压缩」和「按秩合", topic: "数据结构", name: "同源归一", atk: 17, blk: 13, cost: 2, eff: "chain", kind: 'knowledge' },
  { id: "7:布隆过滤器判断一个元素「不存在」时，", topic: "数据结构", name: "铁口直断", atk: 17, blk: 13, cost: 2, eff: "pierce", kind: 'knowledge' },
  { id: "8:单链表判断是否有环，且要求额外空间 ", topic: "数据结构", name: "双影逐环", atk: 15, blk: 10, cost: 2, eff: "chain", mods: { times: 3, atkMul: 0.45 }, kind: 'knowledge' },
  { id: "9:下列排序算法中，稳定的是？", topic: "排序与查找", name: "秩序守护", atk: 7, blk: 5, cost: 1, eff: "guard", kind: 'knowledge' },
  { id: "10:在无序数组中找第 k 大的元素，平均", topic: "排序与查找", name: "直取要害", atk: 17, blk: 13, cost: 2, eff: "pierce", kind: 'knowledge' },
  { id: "11:内存装不下的大文件排序，标准做法是？", topic: "排序与查找", name: "分卷归仓", atk: 8, blk: 5, cost: 1, eff: "guard", kind: 'knowledge' },
  { id: "12:计数排序适用的前提条件是？", topic: "排序与查找", name: "限额回血", atk: 15, blk: 10, cost: 2, eff: "drain", kind: 'knowledge' },
  { id: "13:在一棵平衡的二叉搜索树里查找一个元素", topic: "树与堆", name: "循径而下", atk: 6, blk: 5, cost: 1, eff: "pierce", kind: 'knowledge' },
  { id: "14:用 Floyd 自底向上法把 n 个", topic: "树与堆", name: "自底筑垒", atk: 12, blk: 10, cost: 2, eff: "guard", kind: 'knowledge' },
  { id: "15:AVL 树规定任意节点左右子树高度差", topic: "树与堆", name: "不倒之枝", atk: 7, blk: 5, cost: 1, eff: "strike", kind: 'knowledge' },
  { id: "16:数据库索引普遍用 B+ 树而不是二叉", topic: "树与堆", name: "页垒纵深", atk: 14, blk: 10, cost: 2, eff: "guard", mods: { blkMul: 2.2 }, kind: 'knowledge' },
  { id: "17:哈夫曼编码构造出来的是一棵什么样的二", topic: "树与堆", name: "轻重两叉", atk: 7, blk: 5, cost: 1, eff: "chain", kind: 'knowledge' },
  { id: "18:字典树（Trie）判断一个长度为 L", topic: "树与堆", name: "词径延展", atk: 7, blk: 5, cost: 1, eff: "focus", kind: 'knowledge' },
  { id: "19:Dijkstra 算法在哪种情况下会", topic: "图论", name: "直抵捷径", atk: 17, blk: 10, cost: 2, eff: "pierce", kind: 'knowledge' },
  { id: "20:一个有向图能做拓扑排序，充要条件是？", topic: "图论", name: "因果序斩", atk: 7, blk: 5, cost: 1, eff: "chain", kind: 'knowledge' },
  { id: "21:边权全部相等（无权图）时求单源最短路", topic: "图论", name: "层层推进", atk: 6, blk: 6, cost: 1, eff: "strike", kind: 'knowledge' },
  { id: "22:Kruskal 求最小生成树时，用来", topic: "图论", name: "连枝成盾", atk: 17, blk: 13, cost: 3, eff: "guard", mods: { blkMul: 2.4 }, kind: 'knowledge' },
  { id: "23:有向图的「强连通分量」指的是？", topic: "图论", name: "寻环引路", atk: 7, blk: 5, cost: 1, eff: "focus", kind: 'knowledge' },
  { id: "24:判断「顶点 u 和 v 之间有没有一", topic: "图论", name: "邻接汲取", atk: 6, blk: 5, cost: 1, eff: "drain", kind: 'knowledge' },
  { id: "25:递归式 T(n) = 3T(n/4)", topic: "递归与分治", name: "合流重斩", atk: 17, blk: 10, cost: 2, eff: "chain", kind: 'knowledge' },
  { id: "26:标准归并排序的额外空间复杂度是？", topic: "递归与分治", name: "辅存壁垒", atk: 6, blk: 6, cost: 1, eff: "guard", kind: 'knowledge' },
  { id: "27:编译器能把递归优化成循环，通常要求递", topic: "递归与分治", name: "回旋收势", atk: 4, blk: 2, cost: 0, eff: "focus", kind: 'knowledge' },
  { id: "28:一个问题适合用分治，最关键的特征是？", topic: "递归与分治", name: "分合之基", atk: 7, blk: 6, cost: 1, eff: "strike", kind: 'knowledge' },
  { id: "29:能对一个「答案值」做二分查找，隐含的", topic: "递归与分治", name: "试答之刺", atk: 8, blk: 5, cost: 'x', eff: "pierce", kind: 'knowledge' },
  { id: "30:递归过深导致栈溢出，直接原因是？", topic: "递归与分治", name: "栈血回流", atk: 7, blk: 6, cost: 1, eff: "drain", mods: { atkMul: 0.9, heal: 0.6 }, kind: 'knowledge' },
  { id: "31:一个问题能用动态规划求解，通常需要同", topic: "动态规划", name: "重叠壁垒", atk: 7, blk: 6, cost: 1, eff: "guard", kind: 'knowledge' },
  { id: "32:0/1 背包用一维数组 dp[j] ", topic: "动态规划", name: "负重双击", atk: 4, blk: 2, cost: 0, eff: "chain", mods: { atkMul: 0.6 }, kind: 'knowledge' },
  { id: "33:两个序列的最长公共子序列（LCS），", topic: "动态规划", name: "公共脉络", atk: 7, blk: 5, cost: 1, eff: "focus", kind: 'knowledge' },
  { id: "34:自顶向下记忆化搜索相比自底向上递推，", topic: "动态规划", name: "以忆养身", atk: 15, blk: 10, cost: 2, eff: "drain", kind: 'knowledge' },
  { id: "35:最长递增子序列（LIS）的 O(n ", topic: "动态规划", name: "节节攀升", atk: 17, blk: 10, cost: 2, eff: "pierce", kind: 'knowledge' },
  { id: "36:DP 里用「滚动数组」把二维表压成一", topic: "动态规划", name: "压境一击", atk: 6, blk: 6, cost: 1, eff: "strike", kind: 'knowledge' },
  { id: "37:贪心算法能拿到全局最优解，通常需要问", topic: "贪心策略", name: "贪锋直进", atk: 7, blk: 5, cost: 1, eff: "strike", kind: 'knowledge' },
  { id: "38:区间调度（选最多个互不重叠的区间）的", topic: "贪心策略", name: "择段续行", atk: 3, blk: 2, cost: 0, eff: "focus", kind: 'knowledge' },
  { id: "39:分数背包能用「按单位价值从高到低装」", topic: "贪心策略", name: "散装护持", atk: 14, blk: 10, cost: 2, eff: "guard", kind: 'knowledge' },
  { id: "40:只允许一次买卖、求最大利润，O(n)", topic: "贪心策略", name: "低吸高掷", atk: 3, blk: 3, cost: 0, eff: "strike", kind: 'knowledge' },
  { id: "41:一个贪心策略在样例上「看起来总是对」", topic: "贪心策略", name: "两段试锋", atk: 7, blk: 5, cost: 1, eff: "chain", kind: 'knowledge' },
  { id: "42:KMP 算法在失配时不回退主串指针，", topic: "字符串匹配", name: "失配之刺", atk: 17, blk: 10, cost: 2, eff: "pierce", mods: { atkMul: 1.1 }, kind: 'knowledge' },
  { id: "43:Rabin-Karp 用滚动哈希做字", topic: "字符串匹配", name: "滚筒双击", atk: 8, blk: 5, cost: 'x', eff: "chain", kind: 'knowledge' },
  { id: "44:取模哈希里把模数取得更大（或用双哈希", topic: "字符串匹配", name: "同值之盾", atk: 7, blk: 7, cost: 'x', eff: "guard", kind: 'knowledge' },
  { id: "45:Manacher 求最长回文子串能做", topic: "字符串匹配", name: "镜像延展", atk: 17, blk: 10, cost: 2, eff: "focus", kind: 'knowledge' },
  { id: "46:编辑距离（插入/删除/替换各代价 1", topic: "字符串匹配", name: "改字汲能", atk: 15, blk: 13, cost: 2, eff: "drain", mods: { heal: 0.65 }, kind: 'knowledge' },
  { id: "47:回溯法与单纯 DFS 的主要区别是？", topic: "回溯与搜索", name: "剪枝快斩", atk: 7, blk: 5, cost: 1, eff: "strike", kind: 'knowledge' },
  { id: "48:N 皇后问题里，用位掩码记录列与对角", topic: "回溯与搜索", name: "后阵连环", atk: 26, blk: 16, cost: 3, eff: "chain", kind: 'knowledge' },
  { id: "49:在状态数随深度按 b^d 增长的图上", topic: "回溯与搜索", name: "两翼包抄", atk: 6, blk: 6, cost: 1, eff: "focus", kind: 'knowledge' },
  { id: "50:A* 能保证找到最优解，对启发函数 ", topic: "回溯与搜索", name: "先见之刺", atk: 15, blk: 10, cost: 2, eff: "pierce", mods: { atkMul: 1.15 }, kind: 'knowledge' },
  { id: "51:迭代加深搜索（IDDFS）主要解决 ", topic: "回溯与搜索", name: "层层设防", atk: 7, blk: 6, cost: 1, eff: "guard", kind: 'knowledge' },
  { id: "52:从长度未知的数据流里等概率抽 1 个", topic: "随机化与概率", name: "一瓢知江", atk: 17, blk: 10, cost: 2, eff: "focus", mods: { draw: 2, atkMul: 0.6 }, kind: 'knowledge' },
  { id: "53:Fisher-Yates 洗牌为什么", topic: "随机化与概率", name: "乱数横扫", atk: 7, blk: 5, cost: 1, eff: "strike", kind: 'knowledge' },
  { id: "54:随机化枢轴让快速排序的期望复杂度变成", topic: "随机化与概率", name: "掷骰双斩", atk: 17, blk: 13, cost: 2, eff: "chain", kind: 'knowledge' },
  { id: "55:「蒙特卡洛算法」和「拉斯维加斯算法」", topic: "随机化与概率", name: "赌运回血", atk: 8, blk: 5, cost: 'x', eff: "drain", kind: 'knowledge' },
  { id: "56:计算随机变量的期望时，「期望的线性性", topic: "随机化与概率", name: "期望贯穿", atk: 6, blk: 6, cost: 1, eff: "pierce", kind: 'knowledge' },
  { id: "57:进程和线程最本质的区别是？", topic: "操作系统", name: "双线齐击", atk: 7, blk: 5, cost: 1, eff: "strike", kind: 'knowledge' },
  { id: "58:虚拟内存里 TLB 的作用是？", topic: "操作系统", name: "快表索引", atk: 17, blk: 13, cost: 2, eff: "focus", mods: { draw: 2, atkMul: 0.55 }, kind: 'knowledge' },
  { id: "59:死锁的四个必要条件里，不包括哪一个？", topic: "操作系统", name: "僵局壁垒", atk: 15, blk: 11, cost: 3, eff: "guard", mods: { blkMul: 2.6 }, kind: 'knowledge' },
  { id: "60:一次进程上下文切换的开销主要不包含哪", topic: "操作系统", name: "换场汲息", atk: 6, blk: 6, cost: 1, eff: "drain", kind: 'knowledge' },
  { id: "61:LRU 页面置换算法的依据是？", topic: "操作系统", name: "换页两段", atk: 7, blk: 5, cost: 1, eff: "chain", kind: 'knowledge' },
  { id: "62:用户程序发起系统调用时，控制权进入内", topic: "操作系统", name: "越界之刺", atk: 6, blk: 5, cost: 1, eff: "pierce", kind: 'knowledge' },
  { id: "63:TCP 建立连接为什么是三次握手而不", topic: "计算机网络", name: "三度缔约", atk: 26, blk: 16, cost: 3, eff: "strike", mods: { times: 3, atkMul: 0.38 }, kind: 'knowledge' },
  { id: "64:下面哪一项是 TCP 提供而 UDP", topic: "计算机网络", name: "可靠壁垒", atk: 12, blk: 10, cost: 2, eff: "guard", kind: 'knowledge' },
  { id: "65:TCP 慢启动阶段，拥塞窗口 cwn", topic: "计算机网络", name: "控流缓图", atk: 7, blk: 5, cost: 1, eff: "focus", kind: 'knowledge' },
  { id: "66:TCP 首部里的「接收窗口」字段主要", topic: "计算机网络", name: "截流汲能", atk: 6, blk: 6, cost: 1, eff: "drain", kind: 'knowledge' },
  { id: "67:浏览器输入域名到拿到 IP，DNS ", topic: "计算机网络", name: "循名两问", atk: 7, blk: 5, cost: 1, eff: "chain", kind: 'knowledge' },
  { id: "68:事务 ACID 里的 I（隔离性）指", topic: "数据库", name: "四德之壁", atk: 14, blk: 8, cost: 2, eff: "guard", kind: 'knowledge' },
  { id: "69:「不可重复读」指的是哪种现象？", topic: "数据库", name: "隔离阶击", atk: 7, blk: 6, cost: 1, eff: "strike", kind: 'knowledge' },
  { id: "70:联合索引 (a, b, c) 上，下", topic: "数据库", name: "联径直取", atk: 15, blk: 10, cost: 2, eff: "pierce", kind: 'knowledge' },
  { id: "71:第三范式（3NF）主要消除的是？", topic: "数据库", name: "分解两段", atk: 3, blk: 2, cost: 0, eff: "chain", kind: 'knowledge' },
  { id: "72:MVCC 让读不阻塞写、写不阻塞读，", topic: "数据库", name: "版本之眼", atk: 17, blk: 13, cost: 2, eff: "focus", kind: 'knowledge' },
  { id: "73:两个线程同时执行 count++ 却", topic: "并发与同步", name: "争先一击", atk: 7, blk: 5, cost: 1, eff: "strike", kind: 'knowledge' },
  { id: "74:自旋锁更适合哪种场景？", topic: "并发与同步", name: "持锁壁垒", atk: 6, blk: 6, cost: 1, eff: "guard", kind: 'knowledge' },
  { id: "75:编译器和 CPU 都会重排指令，内存", topic: "并发与同步", name: "禁令之刺", atk: 26, blk: 16, cost: 3, eff: "pierce", mods: { atkMul: 1.2 }, kind: 'knowledge' },
  { id: "76:CAS 的 ABA 问题指的是？", topic: "并发与同步", name: "两变之察", atk: 7, blk: 5, cost: 1, eff: "chain", kind: 'knowledge' },
  { id: "77:计数信号量 sem 的当前值是 3，", topic: "并发与同步", name: "令牌汲取", atk: 6, blk: 5, cost: 1, eff: "drain", kind: 'knowledge' },
  { id: "78:程序的时间局部性和空间局部性分别指？", topic: "体系结构与编译", name: "近邻预取", atk: 4, blk: 2, cost: 0, eff: "focus", kind: 'knowledge' },
  { id: "79:CPU 流水线里的「数据冒险」指的是", topic: "体系结构与编译", name: "停摆壁垒", atk: 7, blk: 6, cost: 1, eff: "guard", kind: 'knowledge' },
  { id: "80:编译器前端里，把字符流变成 toke", topic: "体系结构与编译", name: "译锋直斩", atk: 6, blk: 5, cost: 1, eff: "strike", kind: 'knowledge' },
  { id: "81:0.1 + 0.2 在多数语言里不等", topic: "体系结构与编译", name: "失真两段", atk: 7, blk: 5, cost: 1, eff: "chain", kind: 'knowledge' },
  { id: "82:Amdahl 定律说明并行加速比的上", topic: "体系结构与编译", name: "上限贯穿", atk: 26, blk: 20, cost: 3, eff: "pierce", mods: { atkMul: 1.1 }, kind: 'knowledge' },
];

