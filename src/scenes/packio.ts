import { G } from '../core/infra';
import { loadQuestionBank } from '../core/library';

/**
 * 载入题库：文件选择器 + 剪贴板，两条路都不需要玩家碰控制台。
 *
 * 这里只换题目。卡面（101 张）在 cards/catalog.ts 里写死，导入文件碰不到；
 * 格式校验由 loadQuestionBank 负责：主题不限，格式不合规会整体拒绝并列出第几行。
 */
export function requestPackFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.md,.markdown,.txt,.json';
  input.onchange = () => {
    const f = input.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      const res = loadQuestionBank(String(r.result ?? ''));
      G.panel = { k: 'pack', msg: res.msg, ok: res.ok };
    };
    r.readAsText(f);
  };
  input.click();
}

export async function pastePack() {
  try {
    const txt = await navigator.clipboard.readText();
    if (!txt.trim()) {
      G.panel = { k: 'pack', msg: '剪贴板是空的。', ok: false };
      return;
    }
    const res = loadQuestionBank(txt);
    G.panel = { k: 'pack', msg: res.msg, ok: res.ok };
  } catch (err) {
    G.panel = { k: 'pack', msg: '读不到剪贴板（浏览器一般只在 https 或 localhost 下允许）：' + (err as Error).message, ok: false };
  }
}
