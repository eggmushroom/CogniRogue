import { G, panelOf } from '../core/infra';
import type { PlanView } from '../core/model';
import { AGENTIC_OVERLAP_CHARS, AGENTIC_WINDOW, MAX_AGENTIC_WINDOW, MIN_AGENTIC_WINDOW } from '../core/model/plan';
import {
  importDocumentTopics, readBank, refreshDocuments, refreshRemoteBanks, serviceInfo, remoteDocument, resetRemoteDocument, deleteRemoteDocument, startGenerate, startPlan, uploadDoc,
} from '../core/library';
import type { PlanRemote } from '../core/library';
import { pickFile } from './filepick';
import { editField, fieldOf, type KeyIn } from './textfield';
import { jobFailureReason, jobsSnapshot, registerJobs, watchJob } from './jobstate';

const fresh = (docId: string, name: string): PlanView => ({
  docId, name, tier: '', chars: 0, topics: [], notes: [],
  agenticWindow: AGENTIC_WINDOW, agenticOverlapChars: AGENTIC_OVERLAP_CHARS,
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
    if (!result) { fail(v, '任务未完成，可从已保存的文档重试'); return; }
    if (result.state === 'fail') { fail(v, jobFailureReason(result.tail)); return; }
    await loadDocument(v);
    return;
  }
  v.busy = '';
  if (!saved.plan) v.msg = '尚未划分主题';
}

/** 换一种切法。`agentic` 会调模型，所以只有玩家点它才会走到这儿。 */
export async function replan(mode: 'auto' | 'fixed' | 'agentic') {
  if (G.panel.k !== 'plan' || G.panel.data.busy || G.panel.data.imported) return;
  const v = G.panel.data;
  if (mode === 'agentic' && !commitAgenticOverlap(v)) return;
  v.agenticOverlapInput = undefined;
  await runPlan(v, mode);
}

export function adjustAgenticWindow(delta: number) {
  if (G.panel.k !== 'plan' || G.panel.data.busy || G.panel.data.imported) return;
  const v = G.panel.data;
  v.agenticWindow = Math.max(MIN_AGENTIC_WINDOW, Math.min(MAX_AGENTIC_WINDOW, v.agenticWindow + delta));
  v.agenticOverlapChars = Math.min(v.agenticOverlapChars, v.agenticWindow);
}

export function focusAgenticOverlap() {
  const v = panelOf('plan')?.data;
  if (!v || v.busy || v.imported || !v.canAgentic) return;
  v.agenticOverlapInput ??= fieldOf();
}

function commitAgenticOverlap(v: PlanView): boolean {
  const value = v.agenticOverlapInput?.value;
  if (value) {
    const chars = Number(value);
    if (chars > v.agenticWindow) {
      fail(v, `重叠字符数请输入 0–${v.agenticWindow.toLocaleString()} 之间的整数`);
      return false;
    }
    v.agenticOverlapChars = chars;
    if (!v.ok) { v.ok = true; v.msg = ''; }
  }
  v.agenticOverlapInput = undefined;
  return true;
}

export function planKey(k: KeyIn): boolean {
  const v = panelOf('plan')?.data;
  const input = v?.agenticOverlapInput;
  if (!v || !input || v.busy || v.imported || v.confirmAction) return false;
  if (k.key === 'Enter') { commitAgenticOverlap(v); return true; }
  if (k.key === 'Escape') { v.agenticOverlapInput = undefined; return true; }
  if (k.key.length === 1 && !/^\d$/.test(k.key)) return true;
  return editField(input, k, String(MAX_AGENTIC_WINDOW).length);
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

export function requestDocumentAction(action: 'reset' | 'delete') {
  if (G.panel.k !== 'plan' || G.panel.data.busy || !G.panel.data.docId) return;
  G.panel.data.confirmAction = action;
}

export function cancelDocumentAction() {
  if (G.panel.k === 'plan' && !G.panel.data.busy) G.panel.data.confirmAction = undefined;
}

export async function confirmDocumentAction() {
  if (G.panel.k !== 'plan') return;
  const view = G.panel.data;
  const action = view.confirmAction;
  if (!action || view.busy) return;
  view.busy = action;
  view.msg = action === 'reset' ? '正在重置文档题库…' : '正在删除文档…';
  const result = action === 'reset' ? await resetRemoteDocument(view.docId) : await deleteRemoteDocument(view.docId);
  if (!result.ok) {
    view.busy = '';
    view.ok = false;
    view.msg = result.error ?? '操作失败';
    return;
  }
  if (action === 'reset') {
    view.confirmAction = undefined;
    view.busy = '';
    view.ok = true;
    view.msg = '已重置；原文件仍保留';
    await refreshRemoteBanks();
    await loadDocument(view);
    return;
  }
  await Promise.all([refreshDocuments(), refreshRemoteBanks()]);
  G.panel = { k: 'pack', msg: '已删除上传文档及其生成内容', ok: true };
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
  const started = await startPlan(v.docId, mode, v.name, v.agenticWindow, v.agenticOverlapChars);
  if (!started.ok || !started.job) {
    fail(v, started.error ?? '划分任务起不来。');
    return;
  }

  const st = await watchJob(started.job, (job) => {
    v.msg = `${job.progress?.label ?? label}… ${Math.round(job.ms / 1000)} 秒`;
  });
  if (!st) {
    fail(v, '暂时无法获取进度，请稍后查看任务');
    return;
  }
  if (st.state === 'fail') { fail(v, jobFailureReason(st.tail)); return; }
  if (!st.plan) {
    fail(v, `${label}失败，请重试或更换文档`);
    return;
  }
  apply(v, st.plan, started.planId ?? '');
  if (st.plan.tier === 'fixed' && mode === 'auto') v.msg = '未识别到目录主题，已按段落划分';
  void refreshDocuments();
}

function apply(v: PlanView, plan: PlanRemote, planId: string) {
  v.tier = plan.tier;
  if (plan.agenticWindow) v.agenticWindow = plan.agenticWindow;
  if (plan.tier === 'agentic') {
    // 旧分章计划按窗口的 10% 重叠，当时没有单独保存这个值。
    v.agenticOverlapChars = plan.agenticOverlapChars ?? Math.floor(v.agenticWindow / 10);
  }
  v.chars = plan.chars || v.chars;
  v.topics = plan.topics.map((t) => ({
    id: t.id,
    title: t.title,
    chars: t.chars,
    ...(t.pageFrom ? { pageFrom: t.pageFrom, pageTo: t.pageTo } : {}),
    summary: t.summary,
    summarized: t.summarized,
    ...(t.subtopics?.length ? { subtopics: t.subtopics.map((sub) => ({
      title: sub.title, summary: sub.summary, ...(sub.pageFrom ? { pageFrom: sub.pageFrom, pageTo: sub.pageTo } : {}),
    })) } : {}),
    ...(t.merged && t.merged > 1 ? { merged: t.merged } : {}),
    ...(t.sim !== undefined ? { sim: t.sim } : {}),
  }));
  v.notes = plan.notes.slice();
  v.planId = planId;
  v.busy = '';
  v.ok = true;
  v.msg = '';
}
