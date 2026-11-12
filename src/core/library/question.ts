import type { Question, QView } from '../model/types';

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

/** 这类选项的语义依赖自己排在第几位，打乱就会变成错题，直接跳过。 */
const POSITIONAL = /^(以上|下述|前面|全都|全部都是|以上皆|以上均|其余|其他都)/;

export function shuffleOptions(q: Question): QView {
  const options = q.options.slice();
  const answer = q.answer;
  // 选项不足、答案越界、或含「以上都对」这类选项时，原样返回
  if (options.length < 2 || answer < 0 || answer >= options.length
      || options.some((o) => POSITIONAL.test(o))) {
    return { options, answer };
  }

  const idx = options.map((_, i) => i);
  // Fisher-Yates：每个排列等概率，不做「随机交换一遍」那种有偏写法
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return { options: idx.map((i) => options[i]), answer: idx.indexOf(answer) };
}
