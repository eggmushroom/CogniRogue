/**
 * 模型调用层：OpenAI 兼容的 `/chat/completions`，只用 Node 内置 `fetch`。
 *
 * 为什么不用 SDK：`dependencies` 永远为空（AGENTS.md）。这里多一个依赖，
 * 整个仓库就多一个"下一次 npm install 可能装不上"的理由，
 * 而我们要的只是「POST 一段 JSON，拿回一段 JSON」。
 *
 * 这一层只做传输与重试，不懂题、不懂记忆 —— 提示词在 `generate.ts`。
 */

export interface LlmConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
  /** 单次请求超时（毫秒）。 */
  timeoutMs?: number;
  /** 失败重试次数（只重试网络错误与 429 / 5xx）。 */
  retries?: number;
  /** 打印每次调用的 token 用量，方便看账。 */
  verbose?: boolean;
}

/** 生成层只认这个接口：自检可以塞一个假的进来，不需要网络。 */
export interface Llm {
  ask(system: string, user: string): Promise<string>;
  tool?(system: string,
    messages: Array<{ role: 'user' | 'assistant' | 'tool'; content: string; toolCallId?: string; calls?: Array<{ id: string; name: string; arguments: string }> }>,
    tools: Array<{ name: string; description: string; parameters: unknown }>,
  ): Promise<{ text: string; calls: Array<{ id: string; name: string; arguments: string }>; reportToolResult?: (id: string, result: { ok: boolean; detail: string }) => void }>;
}

type Usage = { prompt_tokens?: number; completion_tokens?: number };
type Reply = { text: string; usage?: Usage; toolCalls?: Array<{ id: string; name: string; arguments: string }> };
type ToolTrace = { id: string; name: string; arguments: string; state: 'streaming' | 'running' | 'complete' | 'failed'; detail?: string };
type Output = {
  call: number;
  phase: 'waiting' | 'live' | 'batch' | 'tools' | 'complete';
  text: string;
  toolCalls?: ToolTrace[];
  inputTokens?: number;
  outputTokens?: number;
};

type ModelFrame = {
  choices?: Array<{ delta?: { content?: string }; message?: { content?: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> }; finish_reason?: string }>;
  usage?: Usage;
  error?: { message?: string };
};

const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504]);
const LIVE_SNAPSHOT_MS = 50;
const tokenCount = (value?: number) => Number.isSafeInteger(value) && value! >= 0 ? value : undefined;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function readStream(res: Response, onText: (text: string) => void, onToolCalls?: (calls: Array<{ id: string; name: string; arguments: string }>) => void): Promise<Reply> {
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
    if (frame.error) throw new Error(frame.error.message || '模型中断了输出');
    if (frame.usage) usage = frame.usage;
    const choice = frame.choices?.[0];
    if (choice?.finish_reason) finished = true;
    if (typeof choice?.delta?.content === 'string' && choice.delta.content) {
      text += choice.delta.content;
      onText(text);
    }
    for (const call of (choice as typeof choice & { delta?: { tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }> } })?.delta?.tool_calls ?? []) {
      const item = toolCalls.get(call.index) ?? { id: '', name: '', arguments: '' };
      item.id += call.id ?? '';
      item.name += call.function?.name ?? '';
      item.arguments += call.function?.arguments ?? '';
      toolCalls.set(call.index, item);
      onToolCalls?.([...toolCalls.values()].map((entry) => ({ ...entry })));
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

export function openAiLlm(cfg: LlmConfig, onOutput?: (output: Output) => void): Llm {
  const url = cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions';
  const retries = cfg.retries ?? 3;
  const timeoutMs = cfg.timeoutMs ?? 120_000;
  // 缓存兼容端点支持的模式，后续 JIT 回合不用重复试探。
  let mode = onOutput ? 2 : 0;
  let currentCall = 0;

  function publish(phase: Output['phase'], text = '', usage?: Usage, toolCalls?: ToolTrace[]) {
    if (!onOutput) return;
    onOutput({ call: currentCall, phase, text,
      ...(toolCalls ? { toolCalls: toolCalls.map((call) => ({ ...call })) } : {}),
      inputTokens: tokenCount(usage?.prompt_tokens), outputTokens: tokenCount(usage?.completion_tokens) });
  }

  /** OpenAI-compatible tool round; downgrade usage streaming, then streaming itself when rejected. */
  let toolMode: 0 | 1 | 2 = 2;
  const tool = async (system: string, messages: Array<{ role: 'user' | 'assistant' | 'tool'; content: string; toolCallId?: string; calls?: Array<{ id: string; name: string; arguments: string }> }>, tools: Array<{ name: string; description: string; parameters: unknown }>) => {
    currentCall++;
    publish('waiting');
    const requestMessages = [{ role: 'system', content: system }, ...messages.map((m) => m.role === 'tool'
      ? { role: 'tool', tool_call_id: m.toolCallId, content: m.content }
      : m.role === 'assistant' && m.calls
        ? { role: 'assistant', content: m.content || null, tool_calls: m.calls.map((call) => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } })) }
        : { role: m.role, content: m.content })];
    const toolDefs = tools.map((item) => ({ type: 'function', function: { name: item.name, description: item.description, parameters: item.parameters } }));
    let response: Response;
    for (;;) {
      const stream = toolMode > 0;
      response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({ model: cfg.model, stream, ...(toolMode === 2 ? { stream_options: { include_usage: true } } : {}),
          temperature: 0.2, messages: requestMessages, tools: toolDefs, tool_choice: 'auto' }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.ok) break;
      const body = (await response.text().catch(() => '')).slice(0, 300);
      if (toolMode === 2 && [400, 422, 501].includes(response.status) && /stream_options|include_usage/i.test(body)) { toolMode = 1; continue; }
      if (toolMode > 0 && /stream/i.test(body) && [400, 422, 501].includes(response.status)) { toolMode = 0; continue; }
      throw new Error(`模型工具调用失败（HTTP ${response.status}）：${body}`);
    }

    let latest = '';
    let trace: ToolTrace[] = [];
    let reply: Reply;
    if (!response.headers.get('content-type')?.includes('text/event-stream')) {
      const data = await response.json() as ModelFrame;
      if (data.error) throw new Error(data.error.message || '模型返回错误');
      const message = data.choices?.[0]?.message;
      latest = message?.content ?? '';
      const calls = message?.tool_calls ?? [];
      reply = { text: latest, usage: data.usage, toolCalls: calls.map((call) => ({
        id: call.id, name: call.function.name, arguments: call.function.arguments,
      })) };
      publish('batch', latest, reply.usage);
    } else {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let sentLive = false;
      let lastLive = '';
      const flushLive = () => {
        timer = undefined;
        if (!sentLive) return;
        const signature = JSON.stringify([latest, trace]);
        if (signature === lastLive) return;
        lastLive = signature;
        publish('live', latest, undefined, trace);
      };
      const streamUpdate = () => {
        if (!onOutput) return;
        if (!sentLive) {
          sentLive = true;
          lastLive = JSON.stringify([latest, trace]);
          publish('live', latest, undefined, trace);
        } else {
          timer ??= setTimeout(flushLive, LIVE_SNAPSHOT_MS);
        }
      };
      try {
        reply = await readStream(response,
          (text) => { latest = text; streamUpdate(); },
          (calls) => { trace = calls.map((call) => ({ ...call, state: 'streaming' })); streamUpdate(); });
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
        flushLive();
      }
    }
    const calls = reply.toolCalls ?? [];
    trace = calls.map((call) => ({ ...call, state: 'running' }));
    if (trace.length) publish('tools', reply.text || latest, reply.usage, trace);
    else publish('complete', reply.text || latest, reply.usage);
    return { text: reply.text, calls, reportToolResult: (id: string, result: { ok: boolean; detail: string }) => {
      trace = trace.map((call) => call.id === id
        ? { ...call, state: result.ok ? 'complete' : 'failed', detail: result.detail }
        : call);
      publish('tools', reply.text || latest, reply.usage, trace);
    } };
  };

  return {
    async ask(system, user) {
      currentCall++;
      let lastErr = '';
      for (let attempt = 0; attempt <= retries; attempt++) {
        publish('waiting');
        if (attempt > 0) {
          // 指数退避：429 连着来时不要一秒内再撞三次。
          await sleep(Math.min(1000 * 2 ** (attempt - 1), 8000));
        }
        let res: Response;
        try {
          for (;;) {
            if (!mode && onOutput) publish('batch');
            res = await fetch(url, {
              method: 'POST',
              headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
              body: JSON.stringify({
                model: cfg.model,
                messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
                temperature: 0.2,
                response_format: { type: 'json_object' },
                ...(mode ? { stream: true } : {}),
                ...(mode === 2 ? { stream_options: { include_usage: true } } : {}),
              }),
              signal: AbortSignal.timeout(timeoutMs),
            });
            if (res.ok) break;
            const body = (await res.text().catch(() => '')).slice(0, 400);
            lastErr = `HTTP ${res.status}：${body}`;
            if (mode && [400, 422, 501].includes(res.status) && /stream|include_usage/i.test(body)) {
              mode = mode === 2 && /stream_options|include_usage/i.test(body) ? 1 : 0;
              continue;
            }
            break;
          }
        } catch (err) {
          lastErr = `网络错误：${(err as Error).message}`;
          continue;
        }
        if (!res.ok) {
          if (RETRYABLE.has(res.status)) continue;
          throw new Error(lastErr);
        }

        let reply: Reply;
        let latest = '';
        let timer: ReturnType<typeof setTimeout> | undefined;
        let sent = false;
        let lastLive = '';
        try {
          if (res.headers.get('content-type')?.includes('text/event-stream')) {
            reply = await readStream(res, (text) => {
              latest = text;
              if (!sent) {
                publish('live', latest);
                sent = true;
                lastLive = latest;
              } else {
                // Coalesce tiny provider fragments without delaying the final visible text.
                timer ??= setTimeout(() => {
                  timer = undefined;
                  lastLive = latest;
                  publish('live', latest);
                }, LIVE_SNAPSHOT_MS);
              }
            });
          } else {
            const data = await res.json() as ModelFrame;
            if (data.error) throw new Error(data.error.message || '模型返回错误');
            reply = { text: data.choices?.[0]?.message?.content ?? '', usage: data.usage };
          }
          if (!reply.text.trim()) { lastErr = '模型返回了空内容'; continue; }
        } catch (err) {
          lastErr = `读取模型回复失败：${(err as Error).message}`;
          continue;
        } finally {
          if (timer !== undefined) clearTimeout(timer);
          timer = undefined;
          if (sent && latest !== lastLive) {
            lastLive = latest;
            publish('live', latest);
          }
        }
        const { text, usage } = reply;
        publish('complete', text, usage);
        if (cfg.verbose) console.log(`  · tokens ${usage?.prompt_tokens ?? '?'} in / ${usage?.completion_tokens ?? '?'} out`);
        return text;
      }
      throw new Error(`调用失败（重试 ${retries} 次后放弃）：${lastErr}`);
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
