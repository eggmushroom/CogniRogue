import { G, loadPack } from '../core/game';

/** 载入知识包：文件选择器 + 剪贴板，两条路都不需要玩家碰控制台。 */
export function requestPackFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.md,.markdown,.txt,.json';
  input.onchange = () => {
    const f = input.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      const res = loadPack(String(r.result ?? ''));
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
    const res = loadPack(txt);
    G.panel = { k: 'pack', msg: res.msg, ok: res.ok };
  } catch (err) {
    G.panel = { k: 'pack', msg: '读不到剪贴板（浏览器一般只在 https 或 localhost 下允许）：' + (err as Error).message, ok: false };
  }
}
