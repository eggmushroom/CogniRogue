import type { Question, QView } from '../model/types';
import { shuffle } from '../infra/util';

/**
 * library/question：出题视图。
 *
 * 题库里的 `= B` 是作者写的固定答案位置。直接照着摆，玩家几局之后背下来的
 * 就是「这题选 A」，而不是知识点本身（内置包原始分布里 A 甚至超过一半）。
 * 所以每次点开一张牌，都重新排一次选项顺序，答案索引跟着一起换算。
 *
 * 这是**纯变换**：不改 `Question` 本体，同一道题下次点开会得到另一份顺序。
 * 判定、反馈、键盘快捷键一律读 `QView`，绝不回头读 `q.answer`。
 */

/**
 * 只认题库声明的 `noShuffle`：位置依赖是**数据属性**，由 parse.ts 在解析期
 * 校验并要求作者写 `! 固定顺序`。以前这里用正则猜选项文案，猜漏了就把
 * 一道题洗成错题，而作者只能靠 README 一句「别写」来兜。
 */
export function shuffleOptions(q: Question): QView {
  const options = q.options.slice();
  const answer = q.answer;
  const originalIndices = options.map((_, i) => i);
  // 选项不足、答案越界、或题库显式声明了固定顺序时，原样返回
  if (q.noShuffle || options.length < 2 || answer < 0 || answer >= options.length) {
    return { options, answer, originalIndices };
  }

  // 洗的是下标，答案索引跟着一起换算；和 `infra/util.shuffle` 共用一份 Fisher-Yates。
  const idx = shuffle(originalIndices);
  return { options: idx.map((i) => options[i]), answer: idx.indexOf(answer), originalIndices: idx };
}
