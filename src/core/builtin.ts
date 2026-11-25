/**
 * 单文件离线版唯一内置题库；服务端导入的题库不会打进前端构建产物。
 */
import words from '../../packs/words.md?raw';

/** id 是存档中的稳定题库编号。 */
export const SHIPPED_PACK = { id: 'words', md: words };
