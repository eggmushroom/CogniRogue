import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';

export type TraceAttrs = Record<string, string | number | boolean | string[] | undefined>;
type Span = (outcome: string, attrs?: TraceAttrs) => void;
const parent = new AsyncLocalStorage<string>();

export function traceIdentity() {
  const traceId = process.env.COG_TRACE_ID;
  const jobId = process.env.COG_JOB_ID;
  return traceId && jobId ? { traceId, jobId } : undefined;
}

function start(name: string, attrs: TraceAttrs): { id: string; finish: Span } | undefined {
  const identity = traceIdentity();
  const parentSpanId = parent.getStore() ?? process.env.COG_PARENT_SPAN_ID;
  if (!identity || !parentSpanId) return;
  const id = randomBytes(8).toString('hex');
  const started = performance.now();
  const common = { v: 1, ...identity, spanId: id, parentSpanId, name };
  const event = (data: object) => console.log('@@trace ' + JSON.stringify({ ...common, at: Date.now(), ...data }));
  event({ event: 'start', attrs });
  let ended = false;
  return { id, finish: (outcome, attrs = {}) => {
    if (ended) return;
    ended = true;
    event({ event: 'end', outcome, durationMs: Math.round(performance.now() - started), attrs });
  } };
}

export function traceSpan(name: string, attrs: TraceAttrs): Span {
  return start(name, attrs)?.finish ?? (() => {});
}

export async function traced<T>(name: string, attrs: TraceAttrs, work: (finish: Span) => Promise<T>): Promise<T> {
  const span = start(name, attrs);
  if (!span) return work(() => {});
  return parent.run(span.id, async () => {
    try {
      const value = await work(span.finish);
      span.finish('ok');
      return value;
    } catch (error) {
      span.finish('error');
      throw error;
    }
  });
}

export function tracedSync<T>(name: string, attrs: TraceAttrs, work: (finish: Span) => T): T {
  const span = start(name, attrs);
  if (!span) return work(() => {});
  return parent.run(span.id, () => {
    try {
      const value = work(span.finish);
      span.finish('ok');
      return value;
    } catch (error) {
      span.finish('error');
      throw error;
    }
  });
}
