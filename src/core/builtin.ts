/** 内置知识包。用 vite 的 ?raw 内联，构建后是单文件，双击就能玩。 */
import md from '../../packs/algorithms.md?raw';

export const BUILTIN_MD: string = md;
