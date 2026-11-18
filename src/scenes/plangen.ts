import { G } from '../core/infra';
import { after } from '../core/infra/schedule';
import type { PlanView } from '../core/model';
import {
  countQuestions, jobState, listBanks, refreshRemoteBanks, serviceInfo, sourceBank,
  startGenerate, startPlan, uploadDoc, useRemoteBank,
} from '../core/library';
import type { PlanRemote } from '../core/library';
import { pickFile } from './filepick';

/**
 * 「从文档建题库」的三步：上传 → **确认划分** → 出题。
 *
 * 中间那一步是新加的，因为切分决定整份题库长什么样，而它没法在出题之后补救：
 * 切错了只能重跑，重跑要花模型额度。所以先让玩家看见「会切成哪几节、每节多大、
 * 哪些节被合并了」，确认之后再开始出题。
 *
 * 划分一律在服务里跑（它要调模型），所以这里是「起任务 → 轮询 → 换面板」。
 */
const wait = (ms: number) => new Promise<void>((r) => after(ms, r));

const fresh = (docId: string, name: string): PlanView => ({
  docId, name, tier: '', chars: 0, topics: [], notes: [],
  canAgentic: false, busy: '', msg: '', ok: true, planId: '',
});

/** 面板上的数据一直是同一份对象：界面每帧重画，改它就是刷新。 */
function show(v: PlanView) {
  G.panel = { k: 'plan', data: v };
}

/** 退出计划面板：回到题库面板，什么也没变。 */
export function closePlan() {
  if (G.panel.k !== 'plan') return;
  if (G.panel.data.busy) return;
  G.panel = { k: 'pack', msg: '', ok: true };
}

/** 换一种切法。`agentic` 会调模型，所以只有玩家点它才会走到这儿。 */
export async function replan(mode: 'auto' | 'fixed' | 'agentic') {
  if (G.panel.k !== 'plan' || G.panel.data.busy) return;
  await runPlan(G.panel.data, mode);
}

/** 按当前计划出题。 */
export async function approvePlan() {
  if (G.panel.k !== 'plan' || G.panel.data.busy) return;
  await generate(G.panel.data);
}

/** 入口：选一份文档，上传，然后自动跑一次「有目录按目录、没有按固定大小」。 */
export async function startDocFlow() {
  const f = await pickFile('.md,.markdown,.txt,.pdf');
  if (!f) return;

  const v = fresh('', f.name);
  v.busy = 'plan';
  v.msg = `上传「${f.name}」…`;
  show(v);

  const up = await uploadDoc(f.name, await f.arrayBuffer());
  if (!up.ok || !up.docId) {
    v.busy = '';
    v.ok = false;
    v.msg = up.error ?? '上传失败。';
    return;
  }
  v.docId = up.docId;
  v.chars = up.chars ?? 0;
  // 没有模型时，"让模型分章"这条路要藏起来：点下去只会报错
  const info = await serviceInfo();
  v.canAgentic = !!info?.canGenerate;
  await runPlan(v, 'auto');
}

async function runPlan(v: PlanView, mode: 'auto' | 'fixed' | 'agentic') {
  v.busy = 'plan';
  v.ok = true;
  const label = mode === 'agentic' ? '让模型分章' : mode === 'fixed' ? '按固定大小切' : '解析目录';
  v.msg = `${label}…`;
  show(v);

  const started = await startPlan(v.docId, mode, v.name);
  if (!started.ok || !started.job) {
    v.busy = '';
    v.ok = false;
    v.msg = started.error ?? '划分任务起不来。';
    return;
  }

  for (;;) {
    await wait(900);
    const st = await jobState(started.job);
    if (!st) {
      v.busy = '';
      v.ok = false;
      v.msg = '服务没有回答，任务状态取不到 —— 看看服务的终端。';
      return;
    }
    if (st.state === 'running') {
      v.msg = `${label}… ${Math.round(st.ms / 1000)} 秒`;
      continue;
    }
    if (st.state === 'fail' || !st.plan) {
      v.busy = '';
      v.ok = false;
      v.msg = `${label}失败：` + (st.tail || '没有更多信息');
      return;
    }
    apply(v, st.plan, started.planId ?? '');
    return;
  }
}

function apply(v: PlanView, plan: PlanRemote, planId: string) {
  v.tier = plan.tier;
  v.chars = plan.chars || v.chars;
  v.topics = plan.topics.map((t) => ({
    title: t.title,
    chars: t.chars,
    summary: t.summary,
    summarized: t.summarized,
    ...(t.merged && t.merged > 1 ? { merged: t.merged } : {}),
    ...(t.sim !== undefined ? { sim: t.sim } : {}),
  }));
  v.notes = plan.notes.slice();
  v.planId = planId;
  v.busy = '';
  v.ok = true;
  v.msg = '';
  show(v);
}

async function generate(v: PlanView) {
  v.busy = 'gen';
  v.ok = true;
  v.msg = '出题中…（每节一次调用，节越多越久）';
  show(v);

  const job = await startGenerate(v.docId, 20, v.planId);
  if (!job.ok || !job.job) {
    v.busy = '';
    v.ok = false;
    v.msg = job.error ?? '起不了生成任务。';
    return;
  }

  for (;;) {
    await wait(2000);
    const st = await jobState(job.job);
    if (!st) {
      v.busy = '';
      v.ok = false;
      v.msg = '服务没有回答，任务状态取不到 —— 看看服务的终端。';
      return;
    }
    if (st.state === 'running') {
      v.msg = `出题中… ${Math.round(st.ms / 1000)} 秒`;
      continue;
    }
    if (st.state === 'fail') {
      v.busy = '';
      v.ok = false;
      v.msg = '生成失败：' + (st.tail || '没有更多信息');
      return;
    }

    // 生成物已经在服务的题库目录里了，重新问一遍清单就能看到它
    const n = await refreshRemoteBanks();
    const bank = listBanks().find((b) => b.id === st.bankId);
    if (!bank) {
      v.busy = '';
      v.ok = false;
      v.msg = `生成完了，但清单里没有它（服务现在有 ${n} 份）。`;
      return;
    }
    const r = await useRemoteBank(bank.id);
    // 服务的退出码只说明"跑完了"，不说明"出题了"：0 道题也是正常退出
    const produced = countQuestions(sourceBank());
    if (!r.ok || !produced) {
      v.busy = '';
      v.ok = false;
      v.msg = '生成回来是空的：服务跑完了，但一道题也没出。多半是这份文档里没有能出题的段落 —— 看看服务终端的输出。';
      return;
    }
    G.panel = {
      k: 'pack',
      msg: `已生成「${bank.name}」：${bank.total} 道题 / ${bank.topics} 个主题，已切过去。`,
      ok: true,
    };
    return;
  }
}
