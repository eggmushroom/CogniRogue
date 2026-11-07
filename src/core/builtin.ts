/**
 * 内置题库。用 vite 的 ?raw 内联，构建后是单文件，双击就能玩。
 *
 * 三份 .md 都是标准格式的题库，每份覆盖 5–6 个主题；单独导入也完全可用
 * （题库不限制主题，缺题的卡会从全部题目里抽）。默认合成一份大题库，
 * 让每个题池都够厚。
 * 合并规则在 library/bank.ts，无头模拟 tools/sim.ts 用同一个函数读同样的
 * 三份文件，两边不会漂移。
 *
 * 注意这里**没有卡牌**：卡面在 cards/catalog.ts，不随题库导入而改变。
 */
import algorithms from '../../packs/algorithms.md?raw';
import advanced from '../../packs/advanced.md?raw';
import systems from '../../packs/systems.md?raw';
import { mergePacks } from './library/bank';

export const BUILTIN_MD: string = mergePacks(
  [algorithms, advanced, systems],
  '计算机科学 · 精选题库',
);
