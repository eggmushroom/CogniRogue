/**
 * 模型调用层：OpenAI 兼容的 `/chat/completions`，只用 Node 内置 `fetch`。
 *
 * 为什么不用 SDK：`dependencies` 永远为空（项目保持零运行时依赖）。这里多一个依赖，
 * 整个仓库就多一个"下一次 npm install 可能装不上"的理由，
 * 而我们要的只是「POST 一段 JSON，拿回一段 JSON」。
 *
 * 这一层只做传输与重试，不懂题、不懂记忆 —— 提示词在 `generate.ts`。
 */

import { traceSpan } from './trace';

export interface LlmConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
  /** 单次请求超时（毫秒）。 */
  timeoutMs?: number;
  /** 首次请求之外的重试次数。 */
  retries?: number;
  /** 默认要求 JSON；二元审核响应设为 false，只接受模型原始文本。 */
  jsonMode?: boolean;
  /** 打印每次调用的 token 用量，方便看账。 */
  verbose?: boolean;
}

/** 生成层只认这个接口：自检可以塞一个假的进来，不需要网络。 */
export interface Llm {
  ask(system: string, user: string): Promise<string>;
  tool?(system: string,
    messages: Array<{ role: 'user' | 'assistant' | 'tool'; content: string; toolCallId?: string; calls?: Array<{ id: string; name: string; arguments: string }> }>,
    tools: Array<{ name: string; description: string; parameters: unknown }>,
  ): Promise<{ text: string; calls: Array<{ id: string; name: string; arguments: string }> }>;
}

type Usage = { prompt_tokens?: number; completion_tokens?: number };
type Reply = { text: string; usage?: Usage; toolCalls?: Array<{ id: string; name: string; arguments: string }> };
type ProviderError = { message?: string; code?: string | number; type?: string };

type ToolDelta = { index: number; id?: string; function?: { name?: string; arguments?: string } };

type ModelFrame = {
  choices?: Array<{ delta?: { content?: string; tool_calls?: ToolDelta[] }; message?: { content?: string }; finish_reason?: string }>;
  usage?: Usage;
  error?: ProviderError;
};

type AttemptDetails = {
  kind: 'timeout' | 'network' | 'http' | 'provider' | 'invalid-response' | 'empty-response';
  code?: string;
  message: string;
};
type AttemptFailure = AttemptDetails & { retry: number; durationMs: number; status?: number };

export class LlmRequestError extends Error {
  constructor(readonly failures: readonly AttemptFailure[]) {
    const last = failures.at(-1);
    const status = last?.status === undefined ? '' : ` HTTP ${last.status}`;
    super(`调用失败（${failures.length} 次请求）：${last?.kind ?? ''}${status} ${last?.message ?? ''}`);
    this.name = 'LlmRequestError';
  }
}

class ProviderReplyError extends Error {
  readonly code?: string;

  constructor(error: ProviderError, fallback: string) {
    super(typeof error.message === 'string' && error.message ? error.message : fallback);
    this.code = providerCode(error);
  }
}

function providerCode(error?: ProviderError): string | undefined {
  const code = error?.code ?? error?.type;
  return typeof code === 'string' || typeof code === 'number' ? String(code) : undefined;
}

function httpFailure(status: number, body: string): AttemptDetails {
  let error: ProviderError | undefined;
  try { error = (JSON.parse(body) as ModelFrame | null)?.error; } catch { /* plain-text gateway error */ }
  const message = typeof error?.message === 'string' ? error.message : body;
  return { kind: 'http', message: message || `HTTP ${status}`, code: providerCode(error) };
}

function thrownFailure(error: unknown, signal: AbortSignal, reading: boolean): AttemptDetails {
  const err = error as { name?: string; code?: unknown; cause?: { code?: unknown } } | undefined;
  const value = err?.cause?.code ?? err?.code;
  const code = typeof value === 'string' ? value : undefined;
  if (signal.aborted || err?.name === 'TimeoutError' || code === 'ETIMEDOUT' || /^UND_ERR_.*TIMEOUT$/.test(code ?? '')) {
    return { kind: 'timeout', message: '模型请求超时', code };
  }
  const message = error instanceof Error ? error.message : '未知模型请求错误';
  if (error instanceof ProviderReplyError) return { kind: 'provider', message, code };
  if (!reading || code === 'UND_ERR_SOCKET' || code === 'ECONNRESET') return { kind: 'network', message, code };
  return { kind: 'invalid-response', message, code };
}

function errorExcerpt(text: string, apiKey: string, limit: number): string {
  const redacted = apiKey ? text.replaceAll(apiKey, '[REDACTED]') : text;
  return redacted
    .replace(/\bBearer\s+[^\s"',;]+/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[a-z0-9_-]{8,}\b/gi, '[REDACTED]')
    .replace(/(["']?(?:api[_-]?key|access[_-]?token|authorization)["']?\s*[=:]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s&,;}]+)/gi, '$1[REDACTED]')
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .slice(0, limit);
}

const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504]);
const tokenCount = (value?: number) => Number.isSafeInteger(value) && value! >= 0 ? value : undefined;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function readStream(res: Response, onChunk: () => void): Promise<Reply> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error('模型没有返回输出流');
  const decoder = new TextDecoder();
  let pending = '', text = '';
  let fields: string[] = [];
  let usage: Usage | undefined;
  let finished = false, done = false;
  const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();

  function dispatch() {
    if (!fields.length) return;
    const payload = fields.join('\n');
    fields = [];
    if (payload.trim() === '[DONE]') { done = true; return; }
    const frame = JSON.parse(payload) as ModelFrame;
    if (frame.error) throw new ProviderReplyError(frame.error, '模型中断了输出');
    if (frame.usage) usage = frame.usage;
    const choice = frame.choices?.[0];
    if (choice?.finish_reason) finished = true;
    if (typeof choice?.delta?.content === 'string' && choice.delta.content) {
      text += choice.delta.content;
      onChunk();
    }
    for (const call of choice?.delta?.tool_calls ?? []) {
      const item = toolCalls.get(call.index) ?? { id: '', name: '', arguments: '' };
      item.id += call.id ?? '';
      item.name += call.function?.name ?? '';
      item.arguments += call.function?.arguments ?? '';
      toolCalls.set(call.index, item);
      onChunk();
    }
  }

  function line(raw: string) {
    const value = raw.replace(/\r$/, '');
    if (!value) dispatch();
    else if (value.startsWith('data:')) fields.push(value.slice(5).replace(/^ /, ''));
  }

  try {
    while (!done) {
      const next = await reader.read();
      pending += next.done ? decoder.decode() : decoder.decode(next.value, { stream: true });
      let end: number;
      while (!done && (end = pending.indexOf('\n')) !== -1) {
        line(pending.slice(0, end));
        pending = pending.slice(end + 1);
      }
      if (next.done) {
        if (!done && pending) line(pending);
        if (!done) dispatch();
        break;
      }
    }
    if (!done && !finished) throw new Error('模型输出流提前结束');
    return { text, usage, toolCalls: [...toolCalls.values()] };
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function modelAttempt(cfg: LlmConfig, retry: number, requestMode: number, tools: boolean) {
  const started = performance.now();
  const finish = traceSpan('model.request', { model: cfg.model, retry, stream: requestMode > 0, streamUsage: requestMode === 2, tools });
  let status: number | undefined;
  let providerRequestId: string | undefined;
  let firstChunkMs: number | undefined;
  let headersMs: number | undefined;
  return {
    response(res: Response) {
      status = res.status;
      headersMs = Math.round(performance.now() - started);
      const id = res.headers.get('x-request-id') ?? res.headers.get('request-id');
      if (id && /^[A-Za-z0-9_.:-]{1,128}$/.test(id) && !/^sk[-_]/i.test(id) && !id.includes(cfg.apiKey)) providerRequestId = id;
    },
    firstChunk() { firstChunkMs ??= Math.round(performance.now() - started); },
    finish(outcome: 'ok' | 'error' | 'fallback', usage?: Usage, errorKind?: AttemptDetails['kind']) {
      finish(outcome, { status, providerRequestId, headersMs, firstChunkMs, errorKind,
        inputTokens: tokenCount(usage?.prompt_tokens), outputTokens: tokenCount(usage?.completion_tokens) });
    },
  };
}

export function openAiLlm(cfg: LlmConfig): Llm {
  const url = cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions';
  const retries = cfg.retries ?? 3;
  const toolRetries = cfg.retries ?? 1;
  const timeoutMs = cfg.timeoutMs ?? 180_000;
  // 缓存服务商对 SSE 用量参数的兼容性，后续 JIT 回合直接使用。
  let toolMode: 1 | 2 = 2;
  const toolAttempt = async (system: string, messages: Array<{ role: 'user' | 'assistant' | 'tool'; content: string; toolCallId?: string; calls?: Array<{ id: string; name: string; arguments: string }> }>, tools: Array<{ name: string; description: string; parameters: unknown }>, retry: number) => {
    const requestMessages = [{ role: 'system', content: system }, ...messages.map((m) => m.role === 'tool'
      ? { role: 'tool', tool_call_id: m.toolCallId, content: m.content }
      : m.role === 'assistant' && m.calls
        ? { role: 'assistant', content: m.content || null, tool_calls: m.calls.map((call) => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } })) }
        : { role: m.role, content: m.content })];
    const toolDefs = tools.map((item) => ({ type: 'function', function: { name: item.name, description: item.description, parameters: item.parameters } }));
    let response: Response;
    let observation: ReturnType<typeof modelAttempt>;
    let signal: AbortSignal;
    for (;;) {
      observation = modelAttempt(cfg, retry, toolMode, true);
      signal = AbortSignal.timeout(timeoutMs);
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
          body: JSON.stringify({ model: cfg.model, stream: true, ...(toolMode === 2 ? { stream_options: { include_usage: true } } : {}),
            temperature: 0.2, messages: requestMessages, tools: toolDefs, tool_choice: 'auto' }),
          signal,
        });
      } catch (error) {
        observation.finish('error', undefined, thrownFailure(error, signal, false).kind);
        throw error;
      }
      observation.response(response);
      if (response.ok) break;
      const body = (await response.text().catch(() => '')).slice(0, 300);
      if (toolMode === 2 && [400, 422, 501].includes(response.status) && /stream_options|include_usage/i.test(body)) {
        observation.finish('fallback', undefined, 'http');
        toolMode = 1;
        continue;
      }
      observation.finish('error', undefined, 'http');
      throw new Error(`模型工具调用失败（HTTP ${response.status}）：${body}`);
    }

    if (!response.headers.get('content-type')?.includes('text/event-stream')) {
      observation.finish('error', undefined, 'invalid-response');
      throw new Error('模型接受了流式请求，但没有返回 SSE 输出流；为避免长时间同步等待，本次生成已中止。');
    }
    try {
      const reply = await readStream(response, observation.firstChunk);
      observation.finish('ok', reply.usage);
      return { text: reply.text, calls: reply.toolCalls ?? [] };
    } catch (error) {
      observation.finish('error', undefined, thrownFailure(error, signal, true).kind);
      throw error;
    }
  };

  const tool = async (system: string, messages: Parameters<NonNullable<Llm['tool']>>[1], tools: Parameters<NonNullable<Llm['tool']>>[2]) => {
    const failures: AttemptFailure[] = [];
    for (let attempt = 0; attempt <= toolRetries; attempt++) {
      if (attempt > 0) {
        await sleep(Math.min(1000 * 2 ** (attempt - 1), 8000));
      }
      const started = performance.now();
      try {
        return await toolAttempt(system, messages, tools, attempt);
      } catch (error) {
        const err = error as { name?: string; code?: unknown; cause?: { code?: unknown } } | undefined;
        const raw = error instanceof Error ? error.message : '未知模型请求错误';
        const codeValue = err?.cause?.code ?? err?.code;
        const code = typeof codeValue === 'string' ? codeValue : undefined;
        const status = /HTTP (\d{3})/.exec(raw)?.[1];
        const httpStatus = status ? Number(status) : undefined;
        const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError'
          || /aborted due to timeout|timed out|请求超时/i.test(raw) || /^UND_ERR_.*TIMEOUT$/.test(code ?? '');
        const failure: AttemptDetails = timedOut
          ? { kind: 'timeout', message: '模型工具调用超时', ...(code ? { code } : {}) }
          : httpStatus !== undefined
            ? httpFailure(httpStatus, raw)
            : error instanceof ProviderReplyError
              ? { kind: 'provider', message: raw, ...(error.code ? { code: error.code } : {}) }
              : error instanceof TypeError || code === 'ECONNRESET' || code === 'UND_ERR_SOCKET'
                ? { kind: 'network', message: raw, ...(code ? { code } : {}) }
                : { kind: 'invalid-response', message: raw, ...(code ? { code } : {}) };
        failures.push({ ...failure, retry: attempt, durationMs: Math.round(performance.now() - started),
          ...(httpStatus === undefined ? {} : { status: httpStatus }),
          ...(failure.code ? { code: errorExcerpt(failure.code, cfg.apiKey, 100) } : {}),
          message: errorExcerpt(failure.message, cfg.apiKey, 400) });
        const retryable = timedOut || failure.kind === 'network'
          || (httpStatus !== undefined && RETRYABLE.has(httpStatus));
        if (!retryable || attempt === toolRetries) throw new LlmRequestError(failures);
      }
    }
    throw new LlmRequestError(failures);
  };

  return {
    async ask(system, user) {
      const failures: AttemptFailure[] = [];
      for (let attempt = 0; attempt <= retries; attempt++) {
        if (attempt > 0) {
          // 指数退避：429 连着来时不要一秒内再撞三次。
          await sleep(Math.min(1000 * 2 ** (attempt - 1), 8000));
        }
        let res: Response;
        const started = performance.now();
        const signal = AbortSignal.timeout(timeoutMs);
        const observation = modelAttempt(cfg, attempt, 0, false);
        const record = (failure: AttemptDetails, status?: number) => {
          failures.push({ kind: failure.kind, retry: attempt, durationMs: Math.round(performance.now() - started),
            status, code: failure.code && errorExcerpt(failure.code, cfg.apiKey, 100),
            message: errorExcerpt(failure.message, cfg.apiKey, 400) });
        };
        try {
          res = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
            body: JSON.stringify({
              model: cfg.model,
              messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
              temperature: 0.2,
              ...(cfg.jsonMode === false ? {} : { response_format: { type: 'json_object' } }),
            }),
            signal,
          });
          observation.response(res);
        } catch (err) {
          const failure = thrownFailure(err, signal, false);
          observation.finish('error', undefined, failure.kind);
          record(failure);
          continue;
        }
        if (!res.ok) {
          try {
            record(httpFailure(res.status, await res.text()), res.status);
          } catch (err) {
            record(thrownFailure(err, signal, true), res.status);
          }
          observation.finish('error', undefined, failures.at(-1)?.kind);
          if (RETRYABLE.has(res.status)) continue;
          throw new LlmRequestError(failures);
        }

        let reply: Reply;
        try {
          if (res.headers.get('content-type')?.includes('text/event-stream')) {
            reply = await readStream(res, observation.firstChunk);
          } else {
            const data = await res.json() as ModelFrame;
            if (data.error) throw new ProviderReplyError(data.error, '模型返回错误');
            reply = { text: data.choices?.[0]?.message?.content ?? '', usage: data.usage };
          }
          if (!reply.text.trim()) {
            observation.finish('error', reply.usage, 'empty-response');
            record({ kind: 'empty-response', message: '模型返回了空内容' }, res.status);
            continue;
          }
        } catch (err) {
          const failure = thrownFailure(err, signal, true);
          observation.finish('error', undefined, failure.kind);
          record(failure, res.status);
          continue;
        }
        const { text, usage } = reply;
        observation.finish('ok', usage);
        if (cfg.verbose) console.log(`  · tokens ${usage?.prompt_tokens ?? '?'} in / ${usage?.completion_tokens ?? '?'} out`);
        return text;
      }
      throw new LlmRequestError(failures);
    },
    tool,
  };
}



/** 从环境变量读配置。Key 只从环境来，不接受命令行参数 —— 它会进 shell 历史。 */
export function configFromEnv(env: NodeJS.ProcessEnv = process.env): LlmConfig {
  const apiKey = env.GEN_API_KEY ?? env.OPENAI_API_KEY ?? '';
  return {
    apiKey,
    baseUrl: env.GEN_BASE_URL ?? 'https://api.deepseek.com',
    model: env.GEN_MODEL ?? 'deepseek-chat',
    verbose: env.GEN_VERBOSE === '1',
  };
}

/** 审核配置可单独覆盖；未填写的字段回退到生成模型，确保默认可用且仍执行审核。 */
export function reviewConfigFromEnv(env: NodeJS.ProcessEnv = process.env): LlmConfig {
  return {
    apiKey: env.REVIEW_API_KEY?.trim() || env.GEN_API_KEY?.trim() || env.OPENAI_API_KEY?.trim() || '',
    baseUrl: env.REVIEW_BASE_URL?.trim() || env.GEN_BASE_URL?.trim() || 'https://api.deepseek.com',
    model: env.REVIEW_MODEL?.trim() || env.GEN_MODEL?.trim() || 'deepseek-chat',
    jsonMode: false,
    verbose: env.REVIEW_VERBOSE === '1',
  };
}

/**
 * 从模型回复里取出 JSON。
 *
 * 即使要了 `json_object`，模型偶尔仍会裹一层 ```json 围栏或加一句前言；
 * 这里只负责把最外层对象抠出来，抠不出来就明确报错，不去猜。
 */
export function parseJsonReply(text: string): unknown {
  const t = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(t);
  const body = fenced ? fenced[1] : t;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error(`模型回复里没有 JSON 对象：${t.slice(0, 200)}`);
  return JSON.parse(body.slice(start, end + 1));
}
