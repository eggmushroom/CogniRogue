/**
 * 随程序一起走的那几份题库，用 vite 的 ?raw 内联 —— 双击 `dist/index.html` 就有题库，
 * 不需要联网、不需要导入。
 *
 * 为什么把样例题库也塞进来：只有一份「英语单词表」时，玩家打开「题库」看到的是一行，
 * 那这个面板就等于不存在。仓库里本来就躺着几份能直接玩的题库（`packs/`），
 * 让它们出现在列表里才有"选"这件事。
 *
 * 合并规则在 `library/bank.ts`，sim 用同一个函数读同一份文件。
 * 这里没有卡牌：卡面在 `cards/catalog.ts`，不随题库改变。
 */
import advanced from '../../packs/advanced.md?raw';
import algorithms from '../../packs/algorithms.md?raw';
import rustCn from '../../packs/rust-cn.md?raw';
import systems from '../../packs/systems.md?raw';
import words from '../../packs/words.md?raw';
import { mergePacks } from './library/bank';

export interface ShippedPack {
  /** 存在浏览器里的"上次用哪份"记的是这个 id，改名等于把玩家的选择清空。 */
  id: string;
  md: string;
}

/**
 * 第一份是默认题库。其余照列表顺序显示。
 * 名字来自每份 md 自己的 `# ` 行（`words` 那份是单词表片段，所以套个合集名）。
 */
export const SHIPPED_PACKS: ShippedPack[] = [
  { id: 'words', md: mergePacks([words], '英语单词表 · 临时题库') },
  { id: 'rust-cn', md: rustCn },
  { id: 'algorithms', md: algorithms },
  { id: 'advanced', md: advanced },
  { id: 'systems', md: systems },
];
