/**
 * 内置题库。用 vite 的 ?raw 内联，构建后是单文件，双击就能玩。
 *
 * 现在**临时换成单词表**（`packs/words.md`，5 章 × 80 词）：题目量够一局长局按
 * "每题最多 3 次"跑完五幕。原来的计算机三份 md（algorithms / advanced / systems）
 * 仍然留在 `packs/` 里，可以从标题页导入，不会被删。
 *
 * 合并规则在 library/bank.ts，无头模拟 tools/sim.ts 用同一个函数读同样的文件，
 * 两边不会漂移。
 *
 * 注意这里**没有卡牌**：卡面在 cards/catalog.ts，不随题库导入而改变。
 */
import words from '../../packs/words.md?raw';
import { mergePacks } from './library/bank';

export const BUILTIN_MD: string = mergePacks([words], '英语单词表 · 临时题库');
