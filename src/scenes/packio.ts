import { G, panelOf } from '../core/infra';
import {
  activeBankId, readBank, refreshRemoteBanks, removeServiceBank, useBank, type BankRow,
} from '../core/library';
import { importRemoteBank } from '../core/library/remote';
import { pickFile } from './filepick';

/**
 * 题库面板的导入、切换与删除。
 *
 * 只有题目会变。卡面（101 张）在 `cards/catalog.ts` 里写死，导入和生成都碰不到。
 * 格式校验由服务端存储入口执行，解析规则只在 `parse.ts` 定义。
 *
 * 「从文档建题库」不在这儿：它要先让玩家确认划分计划，流程在 `plangen.ts`。
 * 这里接收已经整理好的题库文件。
 */

export async function requestPackFile() {
  const p = panelOf('pack');
  if (!p || p.loading) return;
  p.loading = true;
  const file = await pickFile('.md,.markdown,.txt,.json');
  if (G.panel !== p) return;
  if (!file) { p.loading = false; return; }
  const result = await importRemoteBank(await file.text());
  if (!result.ok || !result.id) {
    if (G.panel === p) G.panel = { k: 'pack', ok: false, msg: result.error || '题库保存失败。' };
    return;
  }
  await refreshRemoteBanks();
  if (G.panel === p) {
    p.loading = false;
    await openBank(result.id);
  }
}

export async function openBank(id: string) {
  const p = panelOf('pack');
  if (!p || p.loading) return;
  p.loading = true;
  const result = await readBank(id);
  if (G.panel !== p) return;
  G.panel = { k: 'pack', ok: result.ok, msg: result.ok ? '' : result.msg,
    page: result.ok ? { bankId: id, bank: result.bank } : undefined };
}

export async function selectBank() {
  const p = panelOf('pack');
  const page = p?.page;
  if (!p || !page || p.loading || page.bankId === activeBankId()) return;
  p.loading = true;
  p.msg = '';
  const result = await useBank(page.bankId, () => G.panel === p);
  if (G.panel !== p) return;
  p.loading = false;
  p.ok = result.ok;
  p.msg = result.ok ? '' : result.msg;
  if (result.ok) page.bank = result.bank;
}

export function openBankTopic(topic: string) {
  const p = panelOf('pack');
  if (p?.page && !p.loading) G.panel = { ...p, page: { ...p.page, topic } };
}

export function backInLibrary() {
  const page = panelOf('pack')?.page;
  if (!page) return;
  const { bankId, bank, topic } = page;
  G.panel = { k: 'pack', ok: true, msg: '', page: topic ? { bankId, bank, lastTopic: topic } : undefined };
}

export function askToDeleteBank(row: BankRow, fromDocument: boolean) {
  const p = panelOf('pack');
  if (!p || p.deletion || row.builtin || !row.remote) return;
  G.panel = { ...p, deletion: { id: row.id, name: row.name, fromDocument, pending: false } };
}

export function cancelBankDeletion() {
  const p = panelOf('pack');
  if (p?.deletion && !p.deletion.pending) G.panel = { ...p, deletion: undefined };
}

export async function confirmBankDeletion() {
  const p = panelOf('pack');
  const target = p?.deletion;
  if (!target || target.pending) return;
  target.pending = true;
  const result = await removeServiceBank(target.id);
  if (G.panel === p) {
    G.panel = { k: 'pack', ok: result.ok, msg: result.msg, page: result.ok ? undefined : p.page };
  }
}
