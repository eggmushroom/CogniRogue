import { g, roundRect, wrapText, VH, VW } from '../gfx/canvas';
import { C, font, FONT_NUM, FONT_TITLE, withAlpha } from '../gfx/theme';
import { action, button, panel, text } from '../gfx/ui';
import { hover, onBlock, onClick, onDismiss, consumeModalWheel } from '../input';
import { jobTraceUrl, type JobActivity, type JobState } from '../core/library';
import { generationLabel, generationStep, jobFailureReason, jobsSnapshot } from './jobstate';
import { DrawerMotion, reduceMotion } from '../gfx/motion';
import { drawScribe, drawScribeAtWork, type ScribeAction, type SpiritKind } from '../gfx/art/scribe';
import { drawExitControl, type ExitAction } from './exit-control';

const PANEL = { x: VW - 426, y: 78, w: 402, h: 754 };
const ROW_H = 80;
const ROW_GAP = 8;
const SPIRIT_NAMES = [
  '墨墨', '焰豆', '泡泡', '青团', '栗子', '团团',
  '小砚', '灯芯', '雨点', '苔苔', '豆沙', '卷卷',
  '墨丸', '赤豆', '水滴', '芽芽', '松果', '糯米',
  '乌云', '火苗', '浪花', '叶片', '山核', '圆仔',
] as const;
let opened = false;
let selected = '';
let listScroll = 0;
const motion = new DrawerMotion();

export const taskbarOpen = () => motion.visible(opened);
function openTaskbar() {
  if (opened) return;
  selected = '';
  listScroll = 0;
  opened = true;
}
export function openTaskDetail(id: string) {
  openTaskbar();
  selected = id;
}

export function closeTaskbar(immediate = false) {
  opened = false;
  selected = '';
  if (immediate) motion.reset();
}

export function taskbarExit(): ExitAction | null {
  if (!opened) return null;
  return selected ? { kind: 'back', run: () => { selected = ''; } } : { kind: 'close', run: closeTaskbar };
}

function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

function stateText(state: JobState['state']): string {
  return state === 'queued' ? '排队中' : state === 'running' ? '运行中' : state === 'done' ? '已完成' : '失败';
}

function stateColor(state: JobState['state']): string {
  return state === 'queued' ? C.dim : state === 'running' ? C.blue : state === 'done' ? C.green : C.red;
}

function drawHandle(running: number, onOpen: () => void) {
  const x = VW - 164;
  const y = 22;
  button(x, y, 140, 42, '任务', 'ghost', { size: 14, mark: 'tasks' });
  if (running) {
    roundRect(x + 99, y + 9, 28, 24, 8);
    g.fillStyle = withAlpha(C.blue, 0.18);
    g.fill();
    text(String(running), x + 113, y + 21, { size: 12, family: FONT_NUM, align: 'center', color: C.blue });
  }
  onClick(x, y, 140, 42, () => {
    if (opened) taskbarExit()?.run();
    else { onOpen(); openTaskbar(); }
  }, '后台任务');
}

function currentWork(job: JobState): { action: ScribeAction; label: string; active: boolean } {
  const label = generationLabel(job);
  if (job.state === 'done') return { action: 'bind', label, active: false };
  if (job.state !== 'running') return { action: 'idle', label, active: false };
  if (job.progress?.phase === 'commit' || job.progress?.phase === 'complete') {
    return { action: 'bind', label: job.progress.label ?? label, active: job.progress.phase === 'commit' };
  }
  const latest = job.activity?.at(-1);
  if (latest) {
    if (!latest.active) {
      const detail = latest.kind === 'source' ? `已读取《${latest.title}》` :
        latest.kind === 'reviewed' ? `核验完成 · ${latest.passed} 道通过 · ${latest.rejected} 道拒绝` : label;
      return { action: 'idle', label: detail, active: false };
    }
    if (latest.kind === 'index') return { action: 'read', label: '查找参考章节', active: true };
    if (latest.kind === 'draft') return { action: 'draft', label: '构思题目中', active: true };
    if (latest.kind === 'review') return { action: 'review', label, active: true };
  }
  if (generationStep(job) === 1) return { action: 'review', label, active: true };
  return { action: 'idle', label: job.progress?.phase === 'starting' ? '准备中' : label, active: false };
}

function activityLabel(event: JobActivity): string {
  switch (event.kind) {
    case 'index': return '开始查找参考章节';
    case 'source': return `已读《${event.title}》`;
    case 'draft': return '已请求模型出题';
    case 'review': return `提交 ${event.total} 道候选题审核`;
    case 'reviewed': return `${event.passed} 道通过 · ${event.rejected} 道拒绝${event.pending ? ` · ${event.pending} 道待审` : ''}`;
  }
}

function drawActivity(job: JobState, x: number, y: number, w: number, limit: number) {
  const events = job.activity?.slice(-limit);
  if (!events?.length) return;
  text('最近动作', x, y, { size: 12, weight: 600, color: C.dim });
  events.forEach((event, i) => {
    const rowY = y + 28 + i * 32;
    const latest = i === events.length - 1 && event.active;
    g.fillStyle = latest ? C.gold : C.lineHi;
    g.fillRect(x + 4, rowY - 2, 4, 4);
    text(activityLabel(event), x + 20, rowY, { size: 13, color: latest ? C.ink : C.ink2, maxW: w - 120 });
    text(`+${elapsed(event.ms)}`, x + w, rowY, { size: 12, family: FONT_NUM, color: C.dim, align: 'right' });
  });
}

function spiritOf(job: JobState): { name: string; kind: SpiritKind } {
  let hash = 0;
  for (const char of job.id) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  const kind = (hash % SPIRIT_NAMES.length) as SpiritKind;
  return { name: SPIRIT_NAMES[kind], kind };
}

function drawTaskRow(job: JobState, y: number, t: number, listY: number, listBottom: number) {
  const x = PANEL.x + 18;
  const w = PANEL.w - 36;
  const top = Math.max(listY, y);
  const bottom = Math.min(listBottom, y + ROW_H);
  if (bottom <= top) return;
  const agent = job.taskType !== 'plan';
  const active = agent && job.state === 'running';
  const spirit = agent ? spiritOf(job) : null;
  const lit = hover(x, top, w, bottom - top);
  panel(x, y, w, ROW_H, { radius: 8, fill: lit ? C.panelHi : withAlpha(active ? C.gold : C.ink, active ? 0.06 : 0.025),
    stroke: active ? C.goldDim : C.line });
  const tx = x + (agent ? 72 : 16);
  const work = agent ? currentWork(job) : null;
  if (spirit && work) {
    if (active && work?.active) {
      g.save();
      g.translate(x + 36, y + 40);
      g.scale(0.54, 0.54);
      drawScribeAtWork(0, 0, work.action, t, spirit.kind, !reduceMotion());
      g.restore();
    } else {
      drawScribe(x + 36, y + 40, 48, 'idle', t, spirit.kind);
    }
  }
  text(spirit?.name ?? '文档处理', tx, y + 22, { size: 13, weight: 600, color: agent ? C.gold : C.dim });
  text(work?.label ?? stateText(job.state),
    x + w - 16, y + 22, { size: 12, align: 'right', color: stateColor(job.state) });
  text(job.title, tx, y + 43, { size: 14, weight: 600, maxW: x + w - 16 - tx });
  if (job.name) text(job.name, tx, y + 63, { size: 11, color: C.dim, maxW: x + w - 16 - tx });
  onClick(x, top, w, bottom - top, () => openTaskDetail(job.id), `任务:${job.id}`);
}

const GENERATION_STEPS = ['出题', '审核', '入库'] as const;

function drawGenerationProgress(job: JobState, x: number, y: number, w: number) {
  const current = generationStep(job);
  const running = job.state === 'running';
  const failed = job.state === 'fail';
  const stepW = w / GENERATION_STEPS.length;
  const railY = y + 10;
  const cx = (index: number) => x + (index + 0.5) * stepW;
  g.fillStyle = C.lineHi;
  g.fillRect(cx(0), railY - 0.5, cx(2) - cx(0), 1);
  if (current > 0) {
    g.fillStyle = C.goldDim;
    g.fillRect(cx(0), railY - 0.5, cx(Math.min(current, 2)) - cx(0), 1);
  }
  GENERATION_STEPS.forEach((label, index) => {
    const active = index === current && running;
    const color = index < current ? C.gold : index === current && failed ? C.red : active ? C.blue : C.dim;
    g.beginPath();
    g.arc(cx(index), railY, 4.5, 0, Math.PI * 2);
    g.fillStyle = color;
    g.fill();
    text(label, cx(index), y + 38, { size: 13, align: 'center', color });
  });

  const review = job.progress?.phase === 'review' ? job.progress : undefined;
  if (running && review && review.total > 0) {
    const trackW = w - 48;
    const progress = Math.max(0, Math.min(1, review.completed / review.total));
    panel(x + 24, y + 60, trackW, 6, { radius: 3, fill: C.line, stroke: 'none' });
    if (progress > 0) panel(x + 24, y + 60, trackW * progress, 6, { radius: 3, fill: C.blue, stroke: 'none' });
  }
}

function drawDetail(job: JobState, y: number, t: number) {
  const x = PANEL.x + 24;
  const w = PANEL.w - 48;
  if (job.taskType !== 'plan') {
    const spirit = spiritOf(job);
    const work = currentWork(job);
    panel(x, y, w, 164, { radius: 8, fill: withAlpha(C.ink, 0.035), stroke: C.line });
    g.save();
    g.translate(x + w / 2, y + 56);
    g.scale(1.28, 1.28);
    drawScribeAtWork(0, 0, work.action, t, spirit.kind, work.active && !reduceMotion());
    g.restore();
    text(spirit.name, x + w / 2, y + 116, { size: 24, family: FONT_TITLE, align: 'center', color: C.gold });
    text(work.label, x + w / 2, y + 144, { size: 14, align: 'center', color: stateColor(job.state) });

    text(job.title, x, y + 196, { size: 18, weight: 600, maxW: w });
    if (job.name) text(job.name, x, y + 224, { size: 13, color: C.dim, maxW: w });
    if (job.state !== 'queued') text((job.state === 'running' ? '已运行 ' : '耗时 ') + elapsed(job.ms),
      x, y + (job.name ? 248 : 224), { size: 12, color: C.dim });
    drawGenerationProgress(job, x, y + 272, w);

    g.fillStyle = C.line;
    g.fillRect(x, y + 360, w, 1);
    if (job.state === 'fail') {
      g.save();
      g.font = font(13);
      const lines = wrapText(jobFailureReason(job.tail), w).slice(0, 6);
      g.restore();
      lines.forEach((line, i) => text(line, x, y + 384 + i * 20, { size: 13, color: C.red }));
      drawActivity(job, x, y + 388 + lines.length * 20, w, 3);
    } else {
      drawActivity(job, x, y + 384, w, 6);
    }
    return;
  }
  text(stateText(job.state), x + w, y + 10, { size: 12, align: 'right', color: stateColor(job.state) });
  text(job.title, x, y + 42, { size: 16, weight: 600, color: C.ink, maxW: w });
  if (job.state !== 'queued') {
    text((job.state === 'running' ? '已运行' : '耗时') + ' ' + elapsed(job.ms), x, y + 70, { size: 12, color: C.dim });
  }
  if (job.progress) {
    const { completed, total, label } = job.progress;
    text(`${completed}/${total}${label ? ` · ${label}` : ''}`, x, y + 98,
      { size: 12, color: C.blue, maxW: w });
  }
  if (job.state === 'fail') {
    text('未能完成，请重试',
      x, y + 132, { size: 12, color: C.dim, maxW: w });
  }
}

function drawDrawer(t: number) {
  const { x, y, w, h } = PANEL;
  // Keep active work visible even when recent finished jobs would fill the drawer.
  const rows = jobsSnapshot();
  const jobs = [...rows.filter((job) => job.state === 'running'), ...rows.filter((job) => job.state === 'queued'),
    ...rows.filter((job) => job.state === 'done' || job.state === 'fail')];
  if (selected && !jobs.some((job) => job.id === selected)) selected = '';
  panel(x + 5, y + 8, w, h, { fill: withAlpha(C.void, 0.72), stroke: 'none' });
  panel(x, y, w, h, { stroke: C.lineHi, accent: C.gold });
  // 空白处仍属于抽屉；后注册的按钮热区会覆盖这层拦截。
  onBlock(x, y, w, h, '任务抽屉面板');

  const exit = taskbarExit();
  const titleX = x + (exit?.kind === 'back' ? 108 : 24);
  text('后台任务', titleX, y + 32, { size: 21, weight: 700, family: FONT_TITLE, color: C.ink });
  const running = jobs.filter((job) => job.state === 'running').length;
  const queued = jobs.filter((job) => job.state === 'queued').length;
  const summary = [running ? `${running} 项运行中` : '', queued ? `${queued} 项排队中` : ''].filter(Boolean).join(' · ');
  if (summary) text(summary, titleX, y + 59, { size: 12, color: C.dim });
  drawExitControl(x, y, w, exit);
  g.fillStyle = C.line;
  g.fillRect(x + 18, y + 78, w - 36, 1);

  const selectedJob = jobs.find((job) => job.id === selected);
  if (selectedJob) {
    drawDetail(selectedJob, y + 100, t);
    const traceId = selectedJob.traceId;
    if (traceId) {
      const footerY = y + h - 57;
      text(traceId.slice(0, 12), x + 24, footerY + 18, { size: 12, family: FONT_NUM, color: C.dim });
      action(x + w - 248, footerY, 100, 36, '复制 Trace ID', () => {
        void navigator.clipboard?.writeText(traceId).catch(() => {});
      }, 'ghost', { size: 12 });
      action(x + w - 138, footerY, 114, 36, '下载 Trace', () => {
        const link = document.createElement('a');
        link.href = jobTraceUrl(traceId);
        link.download = `trace-${traceId}.jsonl`;
        link.click();
      }, 'ghost', { size: 12 });
    }
    return;
  }
  if (!jobs.length) {
    text('暂无任务', x + 24, y + 120, { size: 15, weight: 600, color: C.ink2 });
    return;
  }

  const listY = y + 94;
  const listH = h - 112;
  const contentH = jobs.length * (ROW_H + ROW_GAP) - ROW_GAP;
  const maxScroll = Math.max(0, contentH - listH);
  const wheel = consumeModalWheel();
  listScroll = Math.max(0, Math.min(maxScroll, listScroll + (hover(x + 8, listY, w - 16, listH) ? wheel * 0.7 : 0)));
  g.save();
  roundRect(x + 8, listY, w - 16, listH, 4);
  g.clip();
  jobs.forEach((job, i) => drawTaskRow(job, listY + i * (ROW_H + ROW_GAP) - listScroll, t, listY, listY + listH));
  g.restore();
}

export function drawTaskbar(dt: number, t: number, onOpen: () => void, showHandle = true) {
  const jobs = jobsSnapshot();
  const pending = jobs.filter((job) => job.state === 'running' || job.state === 'queued').length;
  if (taskbarOpen()) onDismiss(0, 0, VW, VH, () => closeTaskbar(), '任务抽屉遮罩');
  if (showHandle) drawHandle(pending, onOpen);
  motion.draw(opened, dt, 1, () => drawDrawer(t));
}
