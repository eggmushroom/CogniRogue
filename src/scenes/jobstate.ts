import { jobState, refreshRemoteBanks, serviceJobs, type JobState } from '../core/library';

interface Watcher {
  onProgress: (job: JobState) => void;
  promise: Promise<JobState | null>;
  resolve: (job: JobState | null) => void;
}

let jobs: JobState[] = [];
let nextPoll = 0;
let polling = false;
let revision = 0;
let loaded = false;
const watchers = new Map<string, Watcher>();

export const jobsSnapshot = (): JobState[] => jobs;

export function generationStep(job: JobState) {
  if (job.state === 'done') return 3;
  if (job.state === 'queued') return -1;
  const phase = job.progress?.phase;
  if (phase === 'commit' || phase === 'complete') return 2;
  return phase === 'review' ? 1 : 0;
}

export function generationLabel(job: JobState): string {
  if (job.state === 'fail') return '未完成';
  if (job.state === 'done') {
    // Older jobs only recorded the count in the completion log.
    const previousCount = /^✓ 写入 .*：(\d+) 道题 \//m.exec(job.tail)?.[1];
    const written = job.progress?.written ?? previousCount;
    return written == null ? '已写入题库' : `已入库 ${written} 道`;
  }
  if (job.state === 'queued') return '排队中';
  if (generationStep(job) === 2) return '写入题库中';
  if (job.progress?.phase === 'review') {
    const { completed, total } = job.progress;
    return `审核中 · ${completed}/${total}`;
  }
  return job.progress?.phase === 'starting' ? '准备出题' : '出题中';
}

export function jobFailureReason(tail: string): string {
  if (/模型拒绝 0 道，待审 0 道/.test(tail)) {
    return /JIT 取数超过/.test(tail)
      ? '已读取原文，但模型连续取数后没有生成候选题，可以重新生成。'
      : '本轮没有生成可审核的候选题，可以重新生成。';
  }
  const lines = tail.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const message = lines.filter((line) => line.startsWith('✗')).at(-1) ?? lines.at(-1) ?? '任务失败';
  if (/^✗?\s*The operation was aborted due to timeout\.?$/i.test(message)) {
    return '模型请求超时，本轮任务已结束，可以重新生成。';
  }
  if (/调用失败.*timeout/i.test(message)) {
    return '模型请求超时，系统已自动重试仍未成功；本轮未入库，可以稍后重新生成。';
  }
  if (/调用失败.*HTTP 429|rate.?limit|too many requests/i.test(message)) {
    return '模型服务当前请求过多，系统已重试仍未成功；请稍后重新生成。';
  }
  if (/调用失败.*HTTP 5\d\d|模型工具调用失败（HTTP 5\d\d）/i.test(message)) {
    return '模型服务暂时不可用，系统已重试仍未成功；请稍后重新生成。';
  }
  return message.replace(/^✗\s*/, '').slice(0, 220);
}

export function registerJobs(accepted: JobState[]) {
  const ids = new Set(accepted.map((job) => job.id));
  jobs = [...accepted.slice().reverse(), ...jobs.filter((job) => !ids.has(job.id))];
  revision++;
  nextPoll = 0;
  if (accepted.some((job) => job.state === 'done')) void refreshRemoteBanks();
}

export function watchJob(id: string, onProgress: (job: JobState) => void): Promise<JobState | null> {
  const existing = watchers.get(id);
  if (existing) { existing.onProgress = onProgress; return existing.promise; }

  let resolve!: Watcher['resolve'];
  const promise = new Promise<JobState | null>((done) => { resolve = done; });
  watchers.set(id, { onProgress, promise, resolve });
  nextPoll = 0;
  return promise;
}

/** 同一轮轮询同时供任务侧栏与等待结果的流程使用。 */
export function tickJobs(now: number) {
  if (polling || now < nextPoll) return;
  const active = jobs.some((job) => job.state === 'running' || job.state === 'queued');
  nextPoll = now + (watchers.size || active ? 1000 : 2200);
  polling = true;

  const polledRevision = revision;
  const ids = [...watchers.keys()];
  return serviceJobs().then(async (rows) => {
    if (!rows || polledRevision !== revision) return;
    const done = new Set(jobs.filter((job) => job.state === 'done').map((job) => job.id));
    if (loaded && rows.some((job) => job.bankId && job.state === 'done' && !done.has(job.id))) {
      void refreshRemoteBanks();
    }
    jobs = rows.slice().reverse();
    loaded = true;

    for (const id of ids) {
      const watcher = watchers.get(id);
      if (!watcher) continue;
      const job = rows.find((row) => row.id === id);
      if (job?.state === 'running' || job?.state === 'queued') {
        watcher.onProgress(job);
        continue;
      }
      // 分章结果只在任务详情中返回。详情请求失败时，下轮继续取。
      const result = job?.state === 'done' && job.taskType === 'plan' ? await jobState(id) : job;
      if (result === null) continue;
      watchers.delete(id);
      watcher.resolve(result ?? null);
    }
  }).finally(() => { polling = false; });
}
