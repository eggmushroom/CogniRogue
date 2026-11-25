import { jobState, refreshRemoteBanks, serviceJobs, streamJob, type JobState } from '../core/library';

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
let detail: { id: string; job: JobState | null; next: number; polling: boolean; stream?: AbortController; streaming?: boolean } | null = null;

export function inspectJob(id: string) {
  detail?.stream?.abort();
  detail = id ? { id, job: null, next: 0, polling: false } : null;
}

export const inspectedJob = () => detail?.job;

function tickDetail(now: number) {
  const current = detail;
  if (!current || current.streaming || current.polling || now < current.next ||
      current.job?.state === 'done' || current.job?.state === 'fail') return;
  current.next = now + 800;
  current.streaming = true;
  const controller = new AbortController();
  current.stream = controller;
  void streamJob(current.id, (job) => {
    if (detail !== current) return;
    current.job = job;
    if (job.state === 'done' || job.state === 'fail') controller.abort();
  }, controller.signal).catch(async () => {
    if (detail !== current || controller.signal.aborted) return;
    current.polling = true;
    try { current.job = await jobState(current.id, 2500); }
    finally { current.polling = false; }
  }).finally(() => {
    if (detail === current) {
      current.streaming = false;
      current.stream = undefined;
      if (current.job?.state !== 'done' && current.job?.state !== 'fail') current.next = 0;
    }
  });
}

const watchers = new Map<string, Watcher>();

export const jobsSnapshot = (): JobState[] => jobs;

/** 题库写入阶段与模型输出状态分别显示。 */
export function generationStage(job: JobState) {
  if (job.state === 'fail') return { index: -1, label: '未完成' };
  if (job.state === 'done') return { index: 3, label: '已写入题库' };
  if (job.state === 'queued') return { index: 0, label: '排队中' };
  if (job.progress?.phase === 'commit' || job.progress?.phase === 'complete') return { index: 2, label: '写入题库中' };
  return { index: 1, label: job.progress?.phase === 'starting' ? '准备出题' : '出题中' };
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
  tickDetail(now);
  if (polling || now < nextPoll) return;
  nextPoll = now + (watchers.size ? 1000 : 2200);
  polling = true;

  const polledRevision = revision;
  const ids = [...watchers.keys()];
  void Promise.all([
    serviceJobs(),
    Promise.all(ids.map(async (id) => [id, await jobState(id)] as const)),
  ]).then(([rows, details]) => {
    if (polledRevision === revision) {
      const done = new Set(jobs.filter((job) => job.state === 'done').map((job) => job.id));
      if (loaded && rows.some((job) => job.bankId && job.state === 'done' && !done.has(job.id))) {
        void refreshRemoteBanks();
      }
      jobs = rows.slice().reverse();
      loaded = true;
    }
    for (const [id, job] of details) {
      const watcher = watchers.get(id);
      if (!watcher) continue;
      if (!job) {
        watchers.delete(id);
        watcher.resolve(null);
      } else if (job.state === 'running' || job.state === 'queued') {
        watcher.onProgress(job);
      } else {
        watchers.delete(id);
        watcher.resolve(job);
      }
    }
  }).finally(() => { polling = false; });
}
