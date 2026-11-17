import { G } from '../core/infra';
import { importBank, removeBank, useBank } from '../core/library';

/**
 * 题库面板的三类操作：导入、切换、删除。
 *
 * 这里只换题目。卡面（101 张）在 `cards/catalog.ts` 里写死，导入文件碰不到；
 * 格式校验由 `importBank` → `parse.ts` 负责：主题不限，格式不合规会整体拒绝并列出第几行。
 * 导入的题库存在浏览器里（`cognirogue.banks.v1`），刷新之后还在。
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
      const res = importBank(String(r.result ?? ''));
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
    const res = importBank(txt);
    G.panel = { k: 'pack', msg: res.msg, ok: res.ok };
  } catch (err) {
    G.panel = { k: 'pack', msg: '读不到剪贴板（浏览器一般只在 https 或 localhost 下允许）：' + (err as Error).message, ok: false };
  }
}

/** 切到某一份。已经开局的那一局不受影响，新题库下一局开工才进池。 */
export function switchBank(id: string) {
  const r = useBank(id);
  G.panel = { k: 'pack', msg: r.msg, ok: r.ok };
}

export function dropBank(id: string) {
  const r = removeBank(id);
  G.panel = { k: 'pack', msg: r.msg, ok: r.ok };
}
