import type { Question } from '../model/types';
import { G } from '../infra/state';
import { shuffle } from '../infra/util';
import { rulesOf } from '../cards/powers';
import { battleQuestionCount } from '../cards/grade';
import { stagePool } from '../library/stage';

/**
 * combat/questions —— 一场战斗的题目池。
 *
 * 规则从"点一张牌现抽一道题"改成"**开战前就把这一场的题抽好**"：
 *
 *   1. 题量由牌组算（`battleQuestionCount`）：牌组里越贵的牌越多，这一场的新题越多；
 *   2. 每道题在本**局**最多被抽到 3 次（`MAX_PICK_PER_RUN`）；到上限就不再进新题池；
 *   3. 新题池空了不锁牌 —— 从本章复用得最少的那几道（见 `takeQuestion`）。
 *
 * 为什么预抽而不是现抽：
 *   1. 玩家能在开战前看到"这一场还有几道题"，答错的代价于是可见、可规划；
 *   2. 答错不再只是"这一手作废"，而是"本场的题少了一道" —— 代价落在题量上，
 *      不落在行动力上（那条会让人不敢碰不会的知识）；
 *   3. 题量由牌组决定之后，"带多少贵牌"和"这一场要背多少"直接挂钩，
 *      构筑第一次真的影响学习量，而不只影响输出。
 */
export const MAX_PICK_PER_RUN = 3;

/** 本局还能被抽到的题（没到 3 次上限）。 */
function eligible(list: Question[]): Question[] {
  return list.filter((q) => (G.qPicked[q.qid] ?? 0) < MAX_PICK_PER_RUN);
}

/**
 * 开战：按牌组算题量，从当前章题库抽一份本场题池。
 *
 * `qPicked` 是**本局**的曝光计数，所以它跨场活着；这里只清本场的 `qLeft`。
 *
 * **只有真被问到的题才算一次曝光**（在 `takeQuestion` 里加），预抽本身不烧配额 ——
 * 否则一场抽 10 道、只问 4 道，另外 6 道的"3 次机会"就白烧了，
 * 一局 60 场下来整章都会被提前问完。
 */
export function drawBattleQuestions() {
  const list = stagePool();
  // 课表加的是**这一场的题量**（`R.questions`），而不是"答错不消耗" ——
  // 后者等于把答错的代价删掉，那是规则层面的改动，不该由一个掉落物来做。
  // 多出来的题要兑现成格挡，靠 `takeQuestion` 标出"这一道是不是新的"，
  // 见 `syllabusBlock`。
  const want = battleQuestionCount(G.deck) + rulesOf().questions;
  // 只放"还没到本局 3 次上限"的新题。凑不够 `want` 也不拿已满的题来凑数：
  // 那些题 `takeQuestion` 会跳过，放进 `qLeft` 只会让顶栏读数虚高。
  // 新题用完由 `takeQuestion` 进入复用，见那里。
  G.qLeft = shuffle(eligible(list)).slice(0, want);
}

/**
 * 取一道题给这一手用。
 *
 * 先从本场的新题池取；池空之后**不返回 null，也不锁牌**：从本章挑被问得最少
 * 的一道重复问。内置单词表每章 80 道题，按每局 3 次上限算是 240 次曝光，
 * 一幕十几场战斗用不满 —— 所以这一步现在主要是给导入的小题库兜底。
 * 但它必须留着：硬锁会让答错多的人在长战斗里一张知识卡都打不出去，
 * 正好违背"不惩罚不会"。
 *
 * 代价仍然存在：答错会消耗一道**新题**，新题用完之前少的就是一次学习机会；
 * 用完之后的重复不再额外收费。顶栏的「题 N」数的就是这个新题池。
 *
 * 也正因为复用是免费的，这里**不能把新题自动补回池里**：一补，答错的代价
 * 就重新变成无限的了（早期版本的 800 局实测里，技巧曲线会整个塌掉）。
 */
export function takeQuestion(): Question | null {
  while (G.qLeft.length) {
    const q = G.qLeft.pop()!;
    // `qLeft` 现在只装新题，这里理论上不会命中；保留跳过是给坏状态兜底。
    if ((G.qPicked[q.qid] ?? 0) >= MAX_PICK_PER_RUN) continue;
    G.qPicked[q.qid] = (G.qPicked[q.qid] ?? 0) + 1;
    // 这一道确实是本场新题：课表只在 `fresh` 上兑现，复用不会白拿格挡。
    G.qFresh = true;
    return q;
  }
  // 本场新题用完了（或整章都到了 3 次上限）。**这时允许重复最少被问到的那几道**，
  // 而不是让知识卡整场变成废纸：一场打不下去比重复一道题糟得多。
  // 内置题库每章 80 道，正常一局用不到这里；它是给"只写了 10 道题"的导入题库留的路。
  G.qFresh = false;
  const list = stagePool();
  if (!list.length) return null;
  const min = Math.min(...list.map((q) => G.qPicked[q.qid] ?? 0));
  const reuse = shuffle(list.filter((q) => (G.qPicked[q.qid] ?? 0) === min))[0];
  if (!reuse) return null;
  G.qPicked[reuse.qid] = (G.qPicked[reuse.qid] ?? 0) + 1;
  return reuse;
}
