/**
 * 本机题库服务的客户端。**前端只查询显示**：题库清单、原文、答题记账、
 * 文档生成与本局题池都由 FastAPI 服务提供（`server/app.py`，`npm run serve`）。
 *
 * 服务不在是**正常状态**，不是错误：`dist/index.html` 双击打开、没起服务，
 * 玩家仍可用随程序的英语题库。所以这里的每个函数失败都返回空值，不抛。
 */
import { AGENTIC_OVERLAP_CHARS, AGENTIC_WINDOW } from '../model/plan';
import type { Question, QuestionSource, QuestionSourceSection } from '../model/types';

/**
 * 服务地址由 `main.ts` 按页面来源设置：
 *
 *   · `file://`（双击 dist/index.html）只用英语内置题库；
 *   · 开发服务器（默认 5178）和 `npm run serve`（默认 7777）都走同源 `/api`。
 *
 * 这样浏览器里始终只有一个来源，既没有跨域，也不用记两个地址。
 * core 不碰 DOM，所以这件事由组合根算好再交进来。
 */
export const DEFAULT_SERVICE = 'http://127.0.0.1:7777';
let base = DEFAULT_SERVICE;
let compatibleUntil = 0;
let compatibleValue = false;
let compatibilityCheck: Promise<boolean> | null = null;

export const serviceBase = (): string => base;

/** 传空串表示"用当前页面的源"。 */
export function setServiceBase(url: string) {
  const next = url.replace(/\/+$/, '');
  if (base !== next) {
    base = next;
    compatibleUntil = 0;
    compatibilityCheck = null;
  }
}

/** Refuse to send data to an older local service that still acknowledges the retired API. */
async function serviceCompatible(): Promise<boolean> {
  if (Date.now() < compatibleUntil) return compatibleValue;
  if (compatibilityCheck) return compatibilityCheck;
  const checkedBase = base;
  compatibilityCheck = (async () => {
    let ok = false;
    try {
      const response = await fetch(checkedBase + '/api/health', { signal: AbortSignal.timeout(1500) });
      if (response.ok) {
        const payload = await response.json() as { apiVersion?: unknown };
        ok = payload.apiVersion === 1;
      }
    } catch { /* The local service is optional. */ }
    if (base === checkedBase) {
      compatibleValue = ok;
      compatibleUntil = Date.now() + (ok ? 15000 : 2000);
    }
    return ok;
  })();
  try { return base === checkedBase && await compatibilityCheck; }
  finally { if (base === checkedBase) compatibilityCheck = null; }
}

export interface RemoteBank {
  id: string;
  name: string;
  /** `pack` 是仓库里那几份，`generated` 是从文档生成出来的。 */
  kind: 'pack' | 'generated';
  bytes: number;
}

async function get(path: string, ms: number): Promise<Response | null> {
  if (!await serviceCompatible()) return null;
  try {
    const r = await fetch(serviceBase() + path, { signal: AbortSignal.timeout(ms) });
    return r.ok ? r : null;
  } catch {
    // 没服务、端口不对、超时、被浏览器拦了：都当"没有服务"，回落到内置题库
    return null;
  }
}

async function post(path: string, body: unknown, ms: number): Promise<Response | null> {
  if (!await serviceCompatible()) return null;
  try {
    const r = await fetch(serviceBase() + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(ms),
    });
    return r.ok ? r : null;
  } catch {
    return null;
  }
}

export async function remoteBanks(ms = 2000): Promise<RemoteBank[]> {
  const r = await get('/api/banks', ms);
  if (!r) return [];
  try {
    const list = (await r.json()) as unknown;
    if (!Array.isArray(list)) return [];
    return list.filter((b): b is RemoteBank =>
      !!b && typeof b.id === 'string' && typeof b.name === 'string');
  } catch {
    return [];
  }
}

export async function remoteBankText(id: string, ms = 15000): Promise<string | null> {
  const r = await get('/api/banks/' + encodeURIComponent(id), ms);
  return r ? await r.text() : null;
}

function questionSourcePath(bankId: string, topic: string, qid: string) {
  const [bank, group, question] = [bankId, topic, qid].map(encodeURIComponent);
  return `/api/banks/${bank}/topics/${group}/questions/${question}/source`;
}

/** null = no recorded evidence; undefined = request failed and can be retried. */
export async function remoteQuestionSource(bankId: string, topic: string, qid: string): Promise<QuestionSource | null | undefined> {
  const r = await get(questionSourcePath(bankId, topic, qid), 8000);
  if (!r) return undefined;
  try {
    const data = await r.json() as { source?: QuestionSource | null };
    return data.source === null || (data.source && Array.isArray(data.source.sections)) ? data.source : undefined;
  } catch {
    return undefined;
  }
}

export async function remoteSourceSection(bankId: string, topic: string, qid: string, sectionId: string): Promise<QuestionSourceSection | null | undefined> {
  const r = await get(questionSourcePath(bankId, topic, qid) + '?section=' + encodeURIComponent(sectionId), 8000);
  if (!r) return undefined;
  try {
    const { section } = await r.json() as { section?: QuestionSourceSection | null };
    if (section === null) return null;
    return section?.id === sectionId && typeof section.text === 'string' && Array.isArray(section.pages) ? section : undefined;
  } catch {
    return undefined;
  }
}

/** 把尚未确认的答题事件交给服务；服务确认前保留本地记录。 */
export async function sendAnswers(payload: unknown): Promise<boolean> {
  return !!(await post('/api/answers', payload, 4000));
}

export interface RemoteAnswerRecord {
  id: string;
  clientId?: string;
  bankId: string;
  runId?: string;
  topic: string;
  qid: string;
  type: 'answer' | 'reset';
  right?: boolean;
  choice?: number;
  archived: boolean;
  at: string;
}

export interface RemoteAnswerRun { bankId: string; runId: string; latest: number; at: string; total: number; correct: number }

export async function remoteAnswerRuns(archived: boolean): Promise<RemoteAnswerRun[] | null> {
  const r = await get(`/api/answers/runs?archived=${archived}&limit=100`, 5000);
  if (!r) return null;
  try {
    const rows = await r.json() as unknown;
    return Array.isArray(rows) ? rows as RemoteAnswerRun[] : null;
  } catch {
    return null;
  }
}

export async function remoteAnswerRun(bankId: string, runId: string): Promise<RemoteAnswerRecord[]> {
  const r = await get(`/api/answers/runs/${encodeURIComponent(bankId)}/${encodeURIComponent(runId)}?limit=100`, 5000);
  if (!r) return [];
  try { const rows = await r.json() as unknown; return Array.isArray(rows) ? rows as RemoteAnswerRecord[] : []; }
  catch { return []; }
}

export interface RunPoolResult {
  ok: boolean;
  questions?: Question[];
  error?: string;
}

export async function requestRunPool(input: {
  bankId: string; topics: string[]; retired: string[]; quota: number;
}): Promise<RunPoolResult> {
  return postJson<RunPoolResult>('/api/run-pool', input, 25_000,
    '本局题目没有取到，请检查本机题库服务后重试。');
}

export async function importRemoteBank(text: string): Promise<{ ok: boolean; id?: string; name?: string; error?: string }> {
  return postJson('/api/banks/import', { text }, 20_000,
    '题库没有保存，请先启动本机服务。');
}

export async function deleteRemoteBank(id: string): Promise<boolean> {
  const result = await postJson<{ ok: boolean }>('/api/banks/delete', { id }, 5000,
    '题库没有删除，请检查本机服务。');
  return result.ok;
}

export interface ServiceInfo {
  ok: boolean;
  version: string;
  banks: number;
  generated: number;
  /** 服务有没有配置模型 key。**key 本身永远不下发到浏览器**。 */
  canGenerate: boolean;
  model: string;
  /** 模型接口地址。不是秘密，设置页要拿它当默认值填进输入框。 */
  baseUrl: string;
}

export async function serviceInfo(ms = 1200): Promise<ServiceInfo | null> {
  const r = await get('/api/health', ms);
  if (!r) return null;
  try {
    return (await r.json()) as ServiceInfo;
  } catch {
    return null;
  }
}

export interface PdfExtraction {
  pageCount: number;
  imagePages: number[];
  unreadablePages: number[];
  blankPages: number[];
}

export interface DocUpload {
  ok: boolean;
  docId?: string;
  name?: string;
  chars?: number;
  kind?: string;
  pdfExtraction?: PdfExtraction;
  error?: string;
}

export interface RemoteDocument {
  docId: string;
  name: string;
  kind: 'pdf' | 'md';
  chars: number;
  createdAt: string;
  planId: string;
  importedPlanId?: string;
  pdfExtraction?: PdfExtraction;
}

export async function remoteDocuments(): Promise<RemoteDocument[]> {
  const r = await get('/api/docs', 3000);
  return r ? await r.json() as RemoteDocument[] : [];
}

export async function remoteDocument(id: string): Promise<(RemoteDocument & { plan?: PlanRemote; job?: JobState }) | null> {
  const r = await get('/api/docs/' + encodeURIComponent(id), 5000);
  return r ? await r.json() : null;
}


async function mutateDocument(id: string, method: 'POST' | 'DELETE'): Promise<SubmitResult> {
  if (!await serviceCompatible()) return { ok: false, error: '本机服务没有响应' };
  try {
    const r = await fetch(serviceBase() + '/api/docs/' + encodeURIComponent(id) + (method === 'POST' ? '/reset' : ''), {
      method, signal: AbortSignal.timeout(10_000),
    });
    const data = await r.json().catch(() => null) as { detail?: string } | null;
    return r.ok ? { ok: true } : { ok: false, error: data?.detail ?? `请求失败（${r.status}）` };
  } catch {
    return { ok: false, error: '本机服务没有响应' };
  }
}

/** 清除文档派生的主题划分和生成题目，但保留已上传的原文件。 */
export function resetRemoteDocument(id: string): Promise<SubmitResult> {
  return mutateDocument(id, 'POST');
}

/** 删除已上传文档及其派生题库、划分、记忆和章节文件。 */
export function deleteRemoteDocument(id: string): Promise<SubmitResult> {
  return mutateDocument(id, 'DELETE');
}

/** 上传一份文档。pdf 由服务端抽文字（pymupdf 在服务端，不在浏览器）。 */
export async function uploadDoc(name: string, body: ArrayBuffer): Promise<DocUpload> {
  try {
    const r = await fetch(serviceBase() + '/api/docs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'x-doc-name': encodeURIComponent(name) },
      body,
      // 大 PDF 抽文字要时间，给足 120 秒
      signal: AbortSignal.timeout(120_000),
    });
    const data = await r.json() as DocUpload & { detail?: string };
    return r.ok ? data : { ok: false, error: data.detail ?? '上传失败。' };
  } catch {
    return { ok: false, error: '连不上本机服务 —— 先跑 npm run serve。' };
  }
}

interface SubmitResult {
  ok: boolean;
  error?: string;
}

/**
 * POST 一份 JSON，**把 4xx 的 error 也带回来**。
 *
 * `post()` 把非 2xx 一律当"没有服务"，可生成和划分这两条路上的 400
 * （没配模型、没有这份文档）恰恰是最需要说给玩家听的那种回答 ——
 * 用「服务没有回答」盖掉它，玩家会去查服务是不是没起。
 */
async function postJson<T>(path: string, body: unknown, ms: number, down: string): Promise<T> {
  if (!await serviceCompatible()) return { ok: false, error: down } as T;
  try {
    const r = await fetch(serviceBase() + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(ms),
    });
    const data = (await r.json().catch(() => null)) as (T & { detail?: string }) | null;
    if (!r.ok) return { ok: false, error: data?.detail ?? `请求失败（${r.status}）` } as T;
    if (data) return data;
    return { ok: false, error: `服务回了 ${r.status}，没有说明。` } as T;
  } catch {
    return { ok: false, error: down } as T;
  }
}

export async function importDocumentTopics(docId: string, plan: string): Promise<SubmitResult> {
  return postJson<SubmitResult>(`/api/docs/${encodeURIComponent(docId)}/topics`, { plan }, 5000, '本机服务没有响应');
}

export async function startGenerate(docId: string, plan: string, topics: number[]) {
  return postJson<SubmitResult & { jobs?: JobState[] }>('/api/generate', { docId, plan, topics }, 15_000,
    '本机服务没有响应');
}

/** A retry is a new task; submitting the same failed task again returns its direct successor. */
export function retryGeneration(id: string) {
  return postJson<SubmitResult & { job?: JobState }>(`/api/jobs/${encodeURIComponent(id)}/retry`, {}, 8000,
    '本机服务没有响应，请稍后再试。');
}

/** 一份划分计划：和 `tools/gen/plan.ts` 的 `Plan` 同形，只取界面要用的字段。 */
export interface PlanTopicRemote {
  id: string;
  title: string;
  from: number;
  to: number;
  chars: number;
  pageFrom?: number;
  pageTo?: number;
  summary: string;
  subtopics?: Array<{ title: string; from: number; to: number; chars: number; pageFrom?: number; pageTo?: number; summary: string }>;
  summarized: 'model' | 'none';
  merged?: number;
  sim?: number;
}

export interface PlanRemote {
  v: number;
  name: string;
  tier: 'toc' | 'agentic' | 'fixed';
  size: number;
  depth: number;
  agenticWindow?: number;
  agenticOverlapChars?: number;
  chars: number;
  topics: PlanTopicRemote[];
  notes: string[];
}

export interface PlanStart {
  ok: boolean;
  job?: string;
  planId?: string;
  error?: string;
}

/**
 * 起一次划分。`mode=auto` 有目录就按目录切，没有就按固定大小装箱；
 * `agentic` 要玩家先授权（它会调模型），`fixed` 是永远可用的兜底。
 */
export async function startPlan(
  docId: string, mode: 'auto' | 'toc' | 'fixed' | 'agentic', name: string,
  agenticWindow = AGENTIC_WINDOW, agenticOverlapChars = AGENTIC_OVERLAP_CHARS,
): Promise<PlanStart> {
  return postJson<PlanStart>('/api/plan', { docId, mode, name, agenticWindow, agenticOverlapChars }, 15_000,
    '服务没有回答 —— 先跑 npm run serve。');
}

export type JobActivityEvent =
  | { kind: 'index' | 'draft'; active: boolean }
  | { kind: 'source'; title: string; active: false }
  | { kind: 'review'; total: number; active: boolean }
  | { kind: 'reviewed'; passed: number; rejected: number; pending: number; active: false };

export type JobActivity = JobActivityEvent & { ms: number };

export interface JobFailure {
  stage: 'plan' | 'prepare' | 'generate' | 'review' | 'commit';
  code: string;
}

export interface JobState {
  id: string;
  state: 'queued' | 'running' | 'done' | 'fail';
  taskType: 'plan' | 'generate' | 'update';
  title: string;
  bankId?: string | null;
  planId?: string | null;
  topic?: number | null;
  name?: string | null;
  ms: number;
  tail: string;
  traceId?: string;
  retryOfJobId?: string;
  failure?: JobFailure;
  progress?: { phase: string; completed: number; total: number; label?: string; written?: number };
  activity?: JobActivity[];
  /** 计划任务跑完时带回来的一份计划。 */
  plan?: PlanRemote;
}

export function jobTraceUrl(traceId: string): string {
  return serviceBase() + '/api/traces/' + encodeURIComponent(traceId);
}

export async function serviceJobs(ms = 3000): Promise<JobState[] | null> {
  const r = await get('/api/jobs', ms);
  if (!r) return null;
  try {
    const rows = (await r.json()) as unknown;
    return Array.isArray(rows) ? rows as JobState[] : null;
  } catch {
    return null;
  }
}

export async function jobState(id: string, ms = 8000): Promise<JobState | null> {
  const r = await get('/api/jobs/' + encodeURIComponent(id), ms);
  if (!r) return null;
  try {
    return (await r.json()) as JobState;
  } catch {
    return null;
  }
}

/**
 * 把模型配置交给服务（存在服务那侧，浏览器只过一手）。
 *
 * `key` 传空串表示**不改**：设置页的密钥框平时是空的 —— 服务从不下发 key，
 * 前端也就没有"把原来的 key 再提交一遍"的可能。
 */
export async function setGenConfig(cfg: { baseUrl: string; key: string; model: string }): Promise<boolean> {
  return !!(await post('/api/config', cfg, 5000));
}
