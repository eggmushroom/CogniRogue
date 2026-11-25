import { g, roundRect, VH, VW } from '../gfx/canvas';
import { C, FONT_NUM, FONT_TITLE, withAlpha } from '../gfx/theme';
import { button, panel, text } from '../gfx/ui';
import { drawMarkdown, layoutMarkdown } from '../gfx/markdown';
import { hover, onBlock, onClick, onDismiss, consumeModalWheel } from '../input';
import type { JobState } from '../core/library';
import { generationStage, inspectJob, inspectedJob, jobsSnapshot } from './jobstate';
import { DrawerMotion, reduceMotion } from '../gfx/motion';
import { drawScribe, type SpiritKind } from '../gfx/art/scribe';
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
let outputScroll: number | null = null;
const outputExpanded = new Map<string, boolean>();
type ModelCall = NonNullable<NonNullable<JobState['modelOutput']>['calls']>[number];
type OutputStep = {
  kind: 'assistant' | 'tool';
  key: string;
  collapsed: boolean;
  y: number;
  h: number;
  left: number;
  cardW: number;
  title: string;
  status: string;
  color: string;
  layout?: ReturnType<typeof layoutMarkdown>;
  bodyY: number;
  detail?: string;
};
let outputLayout: { key: string; width: number; steps: OutputStep[]; height: number } | null = null;

function selectJob(id: string, poll = true) {
  selected = id;
  inspectJob(poll ? id : '');
  outputScroll = null;
  outputExpanded.clear();
}
let listScroll = 0;
const motion = new DrawerMotion();

export const taskbarOpen = () => motion.visible(opened);
function openTaskbar() {
  if (opened) return;
  selectJob('');
  listScroll = 0;
  opened = true;
}
export function closeTaskbar(immediate = false) {
  opened = false;
  selectJob('');
  if (immediate) motion.reset();
}

export function taskbarExit(): ExitAction | null {
  if (!opened) return null;
  return selected ? { kind: 'back', run: () => selectJob('') } : { kind: 'close', run: closeTaskbar };
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

function scribeWork(job: JobState) {
  if (job.state !== 'running' || reduceMotion()) return 'idle';
  return generationStage(job).index === 2 ? 'bind' : 'write';
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
  const tx = x + (agent ? 56 : 16);
  if (spirit) drawScribe(x + 32, y + 40, 40, scribeWork(job), t, spirit.kind);
  text(spirit?.name ?? '文档处理', tx, y + 22, { size: 13, weight: 600, color: agent ? C.gold : C.dim });
  text(agent ? generationStage(job).label : stateText(job.state),
    x + w - 16, y + 22, { size: 12, align: 'right', color: stateColor(job.state) });
  text(job.title, tx, y + 43, { size: 14, weight: 600, maxW: x + w - 16 - tx });
  if (job.name) text(job.name, tx, y + 63, { size: 11, color: C.dim, maxW: x + w - 16 - tx });
  onClick(x, top, w, bottom - top, () => selectJob(job.id, agent), `任务:${job.id}`);
}

function formatJsonPrefix(source: string): string {
  let result = '';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (const char of source.trimStart()) {
    if (inString) {
      result += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; result += char; }
    else if (/\s/.test(char)) continue;
    else if (char === '{' || char === '[') {
      result += char + '\n';
      depth++;
      result += '  '.repeat(depth);
    } else if (char === '}' || char === ']') {
      const lineStart = result.lastIndexOf('\n');
      if (lineStart >= 0 && !result.slice(lineStart + 1).trim()) result = result.slice(0, lineStart);
      else result = result.replace(/[ \t]+$/, '');
      depth = Math.max(0, depth - 1);
      result += '\n' + '  '.repeat(depth) + char;
    } else if (char === ',') result += ',\n' + '  '.repeat(depth);
    else if (char === ':') result += ': ';
    else result += char;
  }
  return result;
}

function renderedReply(source: string) {
  // Format valid JSON prefixes too, so code appears as it streams and does not reflow when parsing finally succeeds.
  if (/^\s*[\[{]/.test(source)) return '```json\n' + formatJsonPrefix(source) + '\n```';
  return source;
}
function renderedArguments(source: string) {
  try { return JSON.stringify(JSON.parse(source), null, 2); }
  catch { return source || '…'; }
}

function callPresentation(call: ModelCall, job: JobState) {
  if (job.state === 'fail' && call.phase !== 'complete') return { label: '中断', color: C.red };
  if (call.phase === 'waiting') return { label: '连接中', color: C.dim };
  if (call.phase === 'live') return { label: '生成中', color: C.blue };
  if (call.phase === 'batch') return { label: '等待完整回复', color: C.gold };
  if (call.phase === 'tools') return { label: '工具执行', color: C.orange };
  return { label: '完成', color: C.green };
}

function buildOutputSteps(calls: ModelCall[], job: JobState, width: number): OutputStep[] {
  const steps: OutputStep[] = [];
  let y = 0;
  const add = (kind: OutputStep['kind'], key: string, title: string, status: string, color: string,
    body: string, detail = '') => {
    const left = kind === 'tool' ? 40 : 24;
    const cardW = width - left - 4;
    const bodyY = kind === 'tool' ? 43 : 30;
    const layout = body ? layoutMarkdown(body, cardW - 24, kind === 'tool' ? 11 : 12) : undefined;
    const latestAssistant = `${job.id}:${calls.at(-1)?.call}:assistant`;
    const defaultExpanded = kind === 'assistant' && key === latestAssistant;
    const collapsed = !(outputExpanded.get(key) ?? defaultExpanded);
    const h = collapsed ? Math.max(46, kind === 'tool' ? 50 : 46)
      : Math.max(42, bodyY + (layout?.h ?? 0) + (detail ? 20 : 8));
    steps.push({ kind, key, collapsed, y, h, left, cardW, title, status, color, layout, bodyY, detail: detail || undefined });
    y += h + 8;
  };

  for (const call of calls) {
    const phase = callPresentation(call, job);
    const tools = call.toolCalls ?? [];
    const usage = call.inputTokens == null && call.outputTokens == null ? ''
      : ` · ${call.inputTokens ?? '—'}→${call.outputTokens ?? '—'} tok`;
    if (call.text) add('assistant', `${job.id}:${call.call}:assistant`, `模型 · 第 ${call.call} 轮`, phase.label + usage, phase.color, renderedReply(call.text));
    else if (!tools.length) {
      const body = call.phase === 'batch' ? '此模型未提供流式响应，等待完整回复。'
        : call.phase === 'complete' ? '没有文本内容。' : '等待模型输出……';
      add('assistant', `${job.id}:${call.call}:assistant`, `模型 · 第 ${call.call} 轮`, phase.label + usage, phase.color, body);
    }

    for (const tool of tools) {
      const interrupted = job.state === 'fail' && (tool.state === 'streaming' || tool.state === 'running');
      const state = interrupted ? { label: '中断', color: C.red }
        : tool.state === 'streaming' ? { label: '接收调用', color: C.blue }
          : tool.state === 'running' ? { label: '执行中', color: C.orange }
            : tool.state === 'complete' ? { label: '已完成', color: C.green }
              : { label: '未完成', color: C.red };
      const name = tool.name || '工具调用';
      const args = renderedArguments(tool.arguments);
      const body = `\`\`\`json\n${args}\n\`\`\``;
      add('tool', `${job.id}:${call.call}:tool:${tool.id}`, name, state.label, state.color, body, tool.detail ?? '');
    }
  }
  return steps;
}

function drawModelOutput(job: JobState, x: number, y: number, w: number) {
  const output = job.modelOutput;
  const calls: ModelCall[] = output?.calls ?? (output?.text ? [{
    call: 1, phase: output.phase ?? 'complete', text: output.text,
    inputTokens: output.inputTokens, outputTokens: output.outputTokens,
  }] : []);
  const active = job.state === 'running';
  const latest = calls.at(-1);
  const info = active && latest?.phase === 'live' ? `流式输出 · 第 ${latest.call} 轮`
    : active && latest?.phase === 'tools' ? `工具执行 · 第 ${latest.call} 轮`
      : calls.length ? `${calls.length} 轮` : '';
  const infoColor = latest?.phase === 'tools' ? C.orange : latest?.phase === 'live' ? C.blue : C.dim;
  text('工作过程', x, y, { size: 13, color: C.ink, weight: 600 });
  if (info) text(info, x + w, y, { size: 12, align: 'right', color: infoColor });
  const top = y + 18;
  const h = PANEL.y + PANEL.h - top - 53;
  const pad = 10;
  const viewH = h - pad * 2;
  const innerW = w - pad * 2;
  panel(x, top, w, h, { radius: 8, fill: C.void, stroke: C.line });
  const wheel = consumeModalWheel();
  if (!calls.length) {
    text(job.state === 'queued' ? '排队中' : !active ? '此任务没有保存模型输出' : '等待模型输出',
      x + pad, top + 28, { size: 13, color: C.dim });
    return;
  }

  const key = `${job.id}:${job.state}:${innerW}:` + calls.map((call) =>
    `${call.call}/${call.phase}/${call.text.length}/${call.text.slice(-20)}/${call.inputTokens ?? ''}/${call.outputTokens ?? ''}/` +
    (call.toolCalls ?? []).map((tool) => `${tool.id}:${tool.name}:${tool.state}:${tool.arguments.length}:${tool.arguments.slice(-12)}:${tool.detail ?? ''}`).join(','),
  ).join('|');
  if (!outputLayout || outputLayout.key !== key || outputLayout.width !== innerW) {
    const steps = buildOutputSteps(calls, job, innerW);
    outputLayout = { key, width: innerW, steps, height: steps.length ? steps.at(-1)!.y + steps.at(-1)!.h : 0 };
  }
  const { steps, height } = outputLayout;
  const max = Math.max(0, height - viewH);
  if (wheel && hover(x, top, w, h)) {
    const next = Math.max(0, Math.min(max, (outputScroll ?? max) + Math.sign(wheel) * 42));
    outputScroll = next === max ? null : next;
  }
  const offset = Math.min(max, outputScroll ?? max);
  g.save();
  g.beginPath();
  g.rect(x + 4, top + 4, w - 8, h - 8);
  g.clip();

  const contentX = x + pad;
  const contentY = top + pad - offset;
  const railX = contentX + 9;
  if (steps.length > 1) {
    g.beginPath();
    g.moveTo(railX, contentY + 16);
    g.lineTo(railX, contentY + steps.at(-1)!.y + 16);
    g.strokeStyle = C.line;
    g.lineWidth = 1;
    g.stroke();
  }
  for (const step of steps) {
    const stepY = contentY + step.y;
    if (stepY + step.h < top + 4 || stepY > top + h - 4) continue;
    const cardX = contentX + step.left;
    roundRect(cardX, stepY, step.cardW, step.h, 7);
    g.fillStyle = withAlpha(step.kind === 'tool' ? C.gold : C.panel, step.kind === 'tool' ? 0.07 : 0.72);
    g.fill();
    g.strokeStyle = withAlpha(step.color, 0.32);
    g.lineWidth = 1;
    g.stroke();
    g.fillStyle = step.color;
    g.fillRect(cardX + 1, stepY + 8, 2, Math.max(12, step.h - 16));
    g.beginPath();
    g.moveTo(railX, stepY + 16);
    g.lineTo(cardX, stepY + 16);
    g.strokeStyle = C.lineHi;
    g.stroke();
    g.beginPath();
    g.arc(railX, stepY + 16, 3.5, 0, Math.PI * 2);
    g.fillStyle = step.color;
    g.fill();

    text(step.title, cardX + 12, stepY + 16, {
      size: step.kind === 'tool' ? 11 : 12,
      family: step.kind === 'tool' ? FONT_NUM : undefined,
      color: step.kind === 'tool' ? C.gold : C.ink2,
      weight: 600,
      maxW: step.cardW - 132,
    });
    text(step.status, cardX + step.cardW - 26, stepY + 16, {
      size: 10, align: 'right', color: step.color, maxW: 86,
    });
    g.beginPath();
    g.moveTo(cardX + step.cardW - 13, stepY + (step.collapsed ? 14 : 18));
    g.lineTo(cardX + step.cardW - 9, stepY + (step.collapsed ? 18 : 14));
    g.lineTo(cardX + step.cardW - 5, stepY + (step.collapsed ? 14 : 18));
    g.strokeStyle = C.dim;
    g.lineWidth = 1.5;
    g.stroke();
    if (step.collapsed) {
      text(step.kind === 'tool' ? '参数 · 点击展开' : '点击展开', cardX + 12, stepY + 36, { size: 9, color: C.dim });
    } else {
      if (step.kind === 'tool') text('参数', cardX + 12, stepY + 33, { size: 9, color: C.dim });
      if (step.layout) drawMarkdown(step.layout, cardX + 12, stepY + step.bodyY, C.ink2);
      if (step.detail) text(step.detail, cardX + 12, stepY + step.h - 11,
        { size: 10, color: step.color, maxW: step.cardW - 24 });
    }
    const visibleTop = Math.max(stepY, top + 4);
    const visibleBottom = Math.min(stepY + step.h, top + h - 4);
    if (visibleBottom > visibleTop) {
      onClick(cardX, visibleTop, step.cardW, visibleBottom - visibleTop, () => {
        outputExpanded.set(step.key, step.collapsed);
        outputLayout = null;
        outputScroll = offset >= max ? null : offset;
      }, '工作步骤:' + step.key);
    }
  }
  g.restore();
  if (max) {
    const track = viewH;
    const thumb = Math.max(14, track * viewH / height);
    g.fillStyle = C.lineHi;
    g.fillRect(x + w - 7, top + pad + (track - thumb) * offset / max, 2, thumb);
  }
  if (latest?.phase === 'complete') {
    const input = calls.reduce((sum, call) => sum + (call.inputTokens ?? 0), 0);
    const output = calls.reduce((sum, call) => sum + (call.outputTokens ?? 0), 0);
    const hasUsage = calls.some((call) => call.inputTokens != null || call.outputTokens != null);
    text(hasUsage ? `合计 Token：输入 ${input} · 输出 ${output}` : '未返回 token 用量',
      x + w, top + h + 19, { size: 11, align: 'right', color: C.dim });
  }
}

function drawDetail(job: JobState, y: number, t: number) {
  const x = PANEL.x + 24;
  const w = PANEL.w - 48;
  if (job.taskType !== 'plan') {
    const spirit = spiritOf(job);
    drawScribe(x + w / 2, y + 44, 72, scribeWork(job), t, spirit.kind);
    text(spirit.name, x + w / 2, y + 100, { size: 26, family: FONT_TITLE, align: 'center', color: C.gold });
    text(generationStage(job).label, x + w / 2, y + 130,
      { size: 14, align: 'center', color: stateColor(job.state) });
    g.fillStyle = C.line;
    g.fillRect(x, y + 160, w, 1);
    text(job.title, x, y + 192, { size: 18, weight: 600, maxW: w });
    if (job.name) text(job.name, x, y + 222, { size: 13, color: C.dim, maxW: w });
    if (job.state !== 'queued') text((job.state === 'running' ? '已运行 ' : '耗时 ') + elapsed(job.ms),
      x, y + 254, { size: 12, color: C.dim });
    drawModelOutput(job, x, y + 286, w);
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
  if (selected && !jobs.some((job) => job.id === selected)) selectJob('');
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
    const current = inspectedJob();
    drawDetail(current?.id === selectedJob.id ? current : selectedJob, y + 100, t);
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

export function drawTaskbar(dt: number, t: number, onOpen: () => void) {
  const jobs = jobsSnapshot();
  const pending = jobs.filter((job) => job.state === 'running' || job.state === 'queued').length;
  if (taskbarOpen()) onDismiss(0, 0, VW, VH, () => closeTaskbar(), '任务抽屉遮罩');
  drawHandle(pending, onOpen);
  motion.draw(opened, dt, 1, () => drawDrawer(t));
}
