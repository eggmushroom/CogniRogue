import { G } from '../core/infra';
import { after } from '../core/infra/schedule';
import {
  countQuestions, importBank, jobState, listBanks, refreshRemoteBanks, removeBank,
  sourceBank, startGenerate, uploadDoc, useBank, useRemoteBank,
} from '../core/library';

/**
 * 题库面板的四件事：从文档生成、导入本地文件、粘贴、切换与删除。
 *
 * 只有题目会变。卡面（101 张）在 `cards/catalog.ts` 里写死，导入和生成都碰不到。
 * 格式校验一律走 `importBank` → `parse.ts`：主题不限，格式不合规整体拒绝并列出第几行。
 *
 * 「从头到尾」两种来源：
 *   · 本地文件 / 剪贴板 —— 已经有 md，浏览器解析完存进 localStorage；
 *   · 文档生成 —— 把文档交给本机服务，服务调模型出题、落成一份题库，再取回来。
 */

const say = (msg: string, ok = true) => {
  G.panel = { k: 'pack', msg, ok };
};

const wait = (ms: number) => new Promise<void>((r) => after(ms, r));

/** 选一个文件。所有入口共用：`input` 用完就扔，不挂在 DOM 上。 */
function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    // 取消选择不会触发 change；不 resolve 也无害（面板上的文案会停在那儿）
    input.click();
  });
}

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

/**
 * 从一份文档生成题库：上传 → 服务端逐章出题 → 取回来。
 *
 * 生成要调模型，所以**只有服务能算**：浏览器不发这个请求，key 也不在浏览器里。
 * 没起服务（`npm run serve`）时这条路直接说清楚，本地导入那条路照旧可用。
 */
export async function generateFromDoc() {
  const f = await pickFile('.md,.markdown,.txt,.pdf');
  if (!f) return;

  say(`上传「${f.name}」…`, true);
  const up = await uploadDoc(f.name, await f.arrayBuffer());
  if (!up.ok || !up.docId) return say(up.error ?? '上传失败。', false);

  say(`已收到「${f.name}」（${up.chars} 字符），正在按章节出题…`, true);
  const job = await startGenerate(up.docId, 20);
  if (!job.ok || !job.job) return say(job.error ?? '起不了生成任务。', false);

  for (;;) {
    await wait(2000);
    const st = await jobState(job.job);
    if (!st) return say('服务没有回答，任务状态取不到 —— 看看服务的终端。', false);
    if (st.state === 'running') {
      say(`正在生成「${f.name}」… ${Math.round(st.ms / 1000)} 秒`, true);
      continue;
    }
    if (st.state === 'fail') return say('生成失败：' + (st.tail || '没有更多信息'), false);

    // 生成物已经在服务的题库目录里了，重新问一遍清单就能看到它
    const n = await refreshRemoteBanks();
    const bank = listBanks().find((b) => b.id === st.bankId);
    if (!bank) return say(`生成完了，但清单里没有它（服务现在有 ${n} 份）。`, false);
    const r = await useRemoteBank(bank.id);
    // 服务的退出码只说明"跑完了"，不说明"出题了"：0 道题也是正常退出
    const produced = countQuestions(sourceBank());
    if (!r.ok || !produced) {
      return say('生成回来是空的：服务跑完了，但一道题也没出。多半是这份文档里没有能出题的段落 —— 看看服务终端的输出。', false);
    }
    return say(`已生成「${bank.name}」：${bank.total} 道题 / ${bank.topics} 个主题，已切过去。`, true);
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
