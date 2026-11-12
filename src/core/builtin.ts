/**
 * 内置题库（`packs/words.md`，5 章 × 80 词），用 vite 的 ?raw 内联。
 * 合并规则在 `library/bank.ts`，sim 用同一个函数读同一份文件。
 * 这里没有卡牌：卡面在 `cards/catalog.ts`，不随题库导入改变。
 */
import words from '../../packs/words.md?raw';
import { mergePacks } from './library/bank';

export const BUILTIN_MD: string = mergePacks([words], '英语单词表 · 临时题库');
