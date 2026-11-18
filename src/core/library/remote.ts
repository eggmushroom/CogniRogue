/**
 * 本机题库服务的客户端。**前端只查询显示**：题库清单、原文、答题记账、
 * 文档生成全在服务那侧（`server/index.mjs`，`npm run serve`）。
 *
 * 服务不在是**正常状态**，不是错误：`dist/index.html` 双击打开、没起服务，
 * 玩家照样有随程序的五份题库。所以这里的每个函数失败都返回空值，不抛。
 */

/**
 * 服务的地址。默认本机 7777，`main.ts` 启动时按页面来源改一次：
 *
 *   · `file://`（双击 dist/index.html）没有同源可谈 → 直连 `127.0.0.1:7777`；
 *   · 开发服务器（5178）和 `npm run serve`（7777）都把 `/api` 转给服务 → 用页面自己的源。
 *
 * 这样浏览器里始终只有一个来源，既没有跨域，也不用记两个地址。
 * core 不碰 DOM，所以这件事由组合根算好再交进来。
 */
export const DEFAULT_SERVICE = 'http://127.0.0.1:7777';
let base = DEFAULT_SERVICE;

export const serviceBase = (): string => base;

/** 传空串表示"用当前页面的源"。 */
export function setServiceBase(url: string) {
  base = url.replace(/\/+$/, '');
}

export interface RemoteBank {
  id: string;
  name: string;
  /** `pack` 是仓库里那几份，`generated` 是从文档生成出来的。 */
  kind: 'pack' | 'generated';
  bytes: number;
}

async function get(path: string, ms: number): Promise<Response | null> {
  try {
    const r = await fetch(serviceBase() + path, { signal: AbortSignal.timeout(ms) });
    return r.ok ? r : null;
  } catch {
    // 没服务、端口不对、超时、被浏览器拦了：都当"没有服务"，回落到内置题库
    return null;
  }
}

async function post(path: string, body: unknown, ms: number): Promise<Response | null> {
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

/** 服务在不在。超时要短：首页每帧都等它就等于卡住。 */
export async function probeService(ms = 700): Promise<boolean> {
  return !!(await get('/api/health', ms));
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

/** 局末把这一局的答题记录交给服务记账。服务不在就什么也不做。 */
export async function sendAnswers(payload: unknown): Promise<boolean> {
  return !!(await post('/api/answers', payload, 4000));
}

export interface ServiceInfo {
  ok: boolean;
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

export interface DocUpload {
  ok: boolean;
  docId?: string;
  name?: string;
  chars?: number;
  kind?: string;
  error?: string;
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
    return (await r.json()) as DocUpload;
  } catch {
    return { ok: false, error: '连不上本机服务 —— 先跑 npm run serve。' };
  }
}

export interface GenJob {
  ok: boolean;
  job?: string;
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
  try {
    const r = await fetch(serviceBase() + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(ms),
    });
    const data = (await r.json().catch(() => null)) as T | null;
    if (data) return data;
    return { ok: false, error: `服务回了 ${r.status}，没有说明。` } as T;
  } catch {
    return { ok: false, error: down } as T;
  }
}

export async function startGenerate(docId: string, per = 20, plan = ''): Promise<GenJob> {
  return postJson<GenJob>('/api/generate', { docId, per, plan }, 15_000,
    '服务没有回答（是不是没起，或者已经开始生成别的了）。');
}

/** 一份划分计划：和 `tools/gen/plan.ts` 的 `Plan` 同形，只取界面要用的字段。 */
export interface PlanTopicRemote {
  title: string;
  from: number;
  to: number;
  chars: number;
  summary: string;
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
): Promise<PlanStart> {
  return postJson<PlanStart>('/api/plan', { docId, mode, name }, 15_000,
    '服务没有回答 —— 先跑 npm run serve。');
}

export interface JobState {
  state: 'running' | 'done' | 'fail';
  kind?: 'plan' | 'gen';
  bankId?: string;
  planId?: string;
  ms: number;
  tail: string;
  /** 计划任务跑完时带回来的一份计划。 */
  plan?: PlanRemote;
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
