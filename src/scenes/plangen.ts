import { G, panelOf } from '../core/infra';
import type { PlanView } from '../core/model';
import {
  importDocumentTopics, readBank, refreshDocuments, serviceInfo, remoteDocument, startGenerate, startPlan, uploadDoc,
} from '../core/library';
import type { PlanRemote } from '../core/library';
import { pickFile } from './filepick';
import { jobsSnapshot, registerJobs, watchJob } from './jobstate';

const fresh = (docId: string, name: string): PlanView => ({
  docId, name, tier: '', chars: 0, topics: [], notes: [],
  canAgentic: false, imported: false, selected: new Set(), busy: '', msg: '', ok: true, planId: '',
});

/** 面板上的数据一直是同一份对象：界面每帧重画，改它就是刷新。 */
function show(v: PlanView) {
  G.panel = { k: 'plan', data: v, returnPage: panelOf('pack')?.page };
}

function fail(v: PlanView, msg: string) {
  v.busy = '';
  v.ok = false;
  v.msg = msg;
}

/** 回到原题库预览；任务可能已经追加题目，不继续用打开工作台前的原文。 */
export function closePlan() {
  const p = panelOf('plan');
  if (!p) return;
  const page = p.returnPage;
  const parent = G.panel = { k: 'pack', msg: '', ok: true, page };
  if (page && p.data.docId === page.bankId) {
    void readBank(page.bankId).then((result) => {
      if (result.ok && G.panel === parent && parent.page === page) page.bank = result.bank;
    });
  }
}

/** 已上传文档从档案恢复；读档不触发划分或模型调用。 */
export async function openSavedDocument(docId: string) {
  const v = fresh(docId, '');
  v.busy = 'plan';
  v.msg = '读取文档…';
  show(v);
  await loadDocument(v);
}

async function loadDocument(v: PlanView) {
  const [saved, info] = await Promise.all([remoteDocument(v.docId), serviceInfo()]);
  if (!saved) { fail(v, '文档暂时无法读取，请重试'); return; }
  v.name = saved.name;
  v.chars = saved.chars;
  v.canAgentic = !!info?.canGenerate;
  if (saved.plan) {
    apply(v, saved.plan, saved.planId);
    v.imported = !!saved.planId && saved.importedPlanId === saved.planId;
  }
  if (saved.job) {
    v.busy = 'plan';
    v.msg = saved.job.title;
    const result = await watchJob(saved.job.id, (job) => { v.msg = job.progress?.label ?? job.title; });
    v.busy = '';
    if (!result || result.state === 'fail') { fail(v, '任务未完成，可从已保存的文档重试'); return; }
    await loadDocument(v);
    return;
  }
  v.busy = '';
  if (!saved.plan) v.msg = '尚未划分主题';
}

/** 换一种切法。`agentic` 会调模型，所以只有玩家点它才会走到这儿。 */
export async function replan(mode: 'auto' | 'fixed' | 'agentic') {
  if (G.panel.k !== 'plan' || G.panel.data.busy || G.panel.data.imported) return;
  await runPlan(G.panel.data, mode);
}

export async function approvePlan(v: PlanView) {
  if (v.busy || v.imported || !v.planId || !v.topics.length) return;
  v.busy = 'submit';
  v.msg = '正在保存主题…';
  const result = await importDocumentTopics(v.docId, v.planId);
  if (!result.ok) { fail(v, result.error ?? '主题导入失败'); return; }
  v.imported = true;
  v.busy = '';
  v.ok = true;
  v.msg = '';
  void refreshDocuments();
}

export function documentJobs(v: PlanView) {
  return jobsSnapshot().filter((job) => job.bankId === v.docId);
}

export async function generateSelectedTopics(v: PlanView, selected: number[]) {
  if (v.busy || !v.imported || !v.canAgentic || !selected.length) return;
  v.busy = 'submit';
  v.msg = '提交出题任务…';
  const result = await startGenerate(v.docId, v.planId, selected);
  if (!result.ok || !result.jobs?.length) { fail(v, result.error ?? '无法提交出题任务'); return; }
  registerJobs(result.jobs);
  v.selected.clear();
  v.busy = '';
  v.ok = true;
  v.msg = `已提交 ${result.jobs.length} 个主题的出题任务`;
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
    fail(v, up.error ?? '上传失败。');
    return;
  }
  v.docId = up.docId;
  v.chars = up.chars ?? 0;
  void refreshDocuments();
  await loadDocument(v);
  if (v.planId || !v.ok || G.panel.k !== 'plan' || G.panel.data !== v) return;
  await runPlan(v, 'auto');
}

async function runPlan(v: PlanView, mode: 'auto' | 'fixed' | 'agentic') {
  v.busy = 'plan';
  v.ok = true;
  const label = mode === 'agentic' ? '模型分章' : '解析文档主题';
  v.msg = `${label}…`;
  const started = await startPlan(v.docId, mode, v.name);
  if (!started.ok || !started.job) {
    fail(v, started.error ?? '划分任务起不来。');
    return;
  }

  const st = await watchJob(started.job, (job) => {
    v.msg = `${label}… ${Math.round(job.ms / 1000)} 秒`;
  });
  if (!st) {
    fail(v, '暂时无法获取进度，请稍后查看任务');
    return;
  }
  if (st.state === 'fail' || !st.plan) {
    fail(v, `${label}失败，请重试或更换文档`);
    return;
  }
  apply(v, st.plan, started.planId ?? '');
  if (st.plan.tier === 'fixed') {
    if (mode === 'auto') v.msg = '未识别到目录主题，已按段落划分';
    if (mode === 'agentic') v.msg = '模型未能划分主题，已按段落划分';
  }
  void refreshDocuments();
}

function apply(v: PlanView, plan: PlanRemote, planId: string) {
  v.tier = plan.tier;
  v.chars = plan.chars || v.chars;
  v.topics = plan.topics.map((t) => ({
    id: t.id,
    title: t.title,
    chars: t.chars,
    ...(t.pageFrom ? { pageFrom: t.pageFrom, pageTo: t.pageTo } : {}),
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
}
