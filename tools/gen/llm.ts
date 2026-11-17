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
}

const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504]);

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function openAiLlm(cfg: LlmConfig): Llm {
  const url = cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions';
  const retries = cfg.retries ?? 3;
  const timeoutMs = cfg.timeoutMs ?? 120_000;

  return {
    async ask(system, user) {
      let lastErr = '';
      for (let attempt = 0; attempt <= retries; attempt++) {
        if (attempt > 0) {
          // 指数退避：429 连着来时不要一秒内再撞三次
          await sleep(Math.min(1000 * 2 ** (attempt - 1), 8000));
        }
        let res: Response;
        try {
          res = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
            body: JSON.stringify({
              model: cfg.model,
              messages: [
                { role: 'system', content: system },
                { role: 'user', content: user },
              ],
              temperature: 0.2,
              response_format: { type: 'json_object' },
            }),
            signal: AbortSignal.timeout(timeoutMs),
          });
        } catch (err) {
          lastErr = `网络错误：${(err as Error).message}`;
          continue;
        }

        if (!res.ok) {
          const body = (await res.text().catch(() => '')).slice(0, 400);
          lastErr = `HTTP ${res.status}：${body}`;
          if (RETRYABLE.has(res.status)) continue;
          throw new Error(lastErr);
        }

        const data = (await res.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        const text = data.choices?.[0]?.message?.content ?? '';
        if (!text.trim()) { lastErr = '模型返回了空内容'; continue; }
        if (cfg.verbose) {
          const u = data.usage;
          console.log(`  · tokens ${u?.prompt_tokens ?? '?'} in / ${u?.completion_tokens ?? '?'} out`);
        }
        return text;
      }
      throw new Error(`调用失败（重试 ${retries} 次后放弃）：${lastErr}`);
    },
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
