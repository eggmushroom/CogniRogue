import { G } from '../core/infra';
import {
  importBank, listBanks, removeBank, useBank, useRemoteBank,
} from '../core/library';
import { pickFile } from './filepick';

/**
 * 题库面板的四件事：从文档生成、导入本地文件、粘贴、切换与删除。
 *
 * 只有题目会变。卡面（101 张）在 `cards/catalog.ts` 里写死，导入和生成都碰不到。
 * 格式校验一律走 `importBank` → `parse.ts`：主题不限，格式不合规整体拒绝并列出第几行。
 *
 * 「从文档建题库」不在这儿：它要先让玩家确认划分计划，流程在 `plangen.ts`。
 * 这里只剩下"已经有 md"的两条路（本地文件 / 剪贴板）和题库的切换删除。
 */

const say = (msg: string, ok = true) => {
  G.panel = { k: 'pack', msg, ok };
};

export async function requestPackFile() {
  const f = await pickFile('.md,.markdown,.txt,.json');
  if (!f) return;
  const res = importBank(await f.text());
  say(res.msg, res.ok);
}

export async function pastePack() {
  try {
    const txt = await navigator.clipboard.readText();
    if (!txt.trim()) return say('剪贴板是空的。', false);
    const res = importBank(txt);
    say(res.msg, res.ok);
  } catch (err) {
    say('读不到剪贴板（浏览器一般只在 https 或 localhost 下允许）：' + (err as Error).message, false);
  }
}

/** 切到某一份。已经开局的那一局不受影响，新题库下一局开工才进池。 */
export async function switchBank(id: string) {
  const row = listBanks().find((b) => b.id === id);
  const r = row?.remote ? await useRemoteBank(id) : useBank(id);
  say(r.msg, r.ok);
}

export function dropBank(id: string) {
  const r = removeBank(id);
  say(r.msg, r.ok);
}
