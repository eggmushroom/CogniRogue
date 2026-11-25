import {
  allQuestions, archiveAnswerRun, answerHistory, pendingAnswerEvents, listBanks, listDocuments, remoteAnswerRuns, remoteAnswerRun,
  type RemoteAnswerRecord, type RemoteAnswerRun,
} from '../core/library';
import { g, roundRect, VH, VW } from '../gfx/canvas';
import { C, FONT_TITLE, withAlpha } from '../gfx/theme';
import { action, panel, text } from '../gfx/ui';
import { consumeModalWheel, hover, onBlock, onClick, onDismiss } from '../input';
import { DrawerMotion } from '../gfx/motion';
import { drawArtIcon } from '../gfx/art/icons';
import { drawExitControl, type ExitAction } from './exit-control';
import { overflowAffordance, resetScroll, scrollArea } from './overlay/common';

const PANEL = { x: 22, y: 78, w: 402, h: 754 };
let opened = false;
let archived = false;
let expanded: string | undefined;
const LIST = 'answers:pending';
const ARCHIVE = 'answers:archive';
let remoteRecords: RemoteAnswerRun[] | null = null;
const runDetails = new Map<string, RemoteAnswerRecord[]>();
let refreshAt = 0;
let request = 0;
const runKey = (bankId: string, runId: string) => `${bankId}:${runId}`;
let stemSource: ReturnType<typeof allQuestions> | null = null;
let stemById = new Map<string, string>();
const motion = new DrawerMotion();

export const answerbarOpen = () => motion.visible(opened);
export function closeAnswerbar(immediate = false) {
  opened = false;
  archived = false;
  expanded = undefined;
  resetScroll(LIST);
  resetScroll(ARCHIVE);
  remoteRecords = null;
  runDetails.clear();
  request++;
  if (immediate) motion.reset();
}
function refreshRecords() {
  refreshAt = Date.now() + 2500;
  const id = ++request;
  void remoteAnswerRuns(archived).then((rows) => {
    if (opened && id === request && rows) {
      remoteRecords = rows.filter((row) => !queuedArchives().has(runKey(row.bankId, row.runId)));
    }
  });
}

function showArchive(next: boolean) {
  archived = next;
  remoteRecords = null;
  expanded = undefined;
  refreshRecords();
}

export function answerbarExit(): ExitAction | null {
  if (!opened) return null;
  return archived ? { kind: 'back', run: () => showArchive(false) } : { kind: 'close', run: closeAnswerbar };
}

type RecordRow = ReturnType<typeof answerHistory>[number] | RemoteAnswerRecord;

function queuedArchives() {
  return new Set(pendingAnswerEvents().flatMap((event) =>
    event.type === 'archive' && event.runId ? [runKey(event.bankId, event.runId)] : []));
}

function row(record: RecordRow, y: number, stem: string) {
  const { x, w } = PANEL;
  const h = 48;
  roundRect(x + 26, y, w - 52, h, 5);
  g.fillStyle = withAlpha('#ffffff', 0.025);
  g.fill();
  const right = record.type === 'answer' && record.right;
  g.fillStyle = record.type === 'reset' ? C.dim : right ? C.green : C.red;
  g.fillRect(x + 26, y + 8, 2, h - 16);
  const title = record.type === 'reset' ? '已重置' : right ? '答对' : '答错';
  text(title + ' · ' + record.topic, x + 38, y + 15, { size: 12, weight: 600, color: C.ink, maxW: w - 88 });
  text(stem.replace(/\s+/g, ' ') || record.qid, x + 38, y + 34, { size: 12, color: C.dim, maxW: w - 88 });
}

interface AnswerGroup {
  key: string;
  runId?: string;
  records: RecordRow[];
  summary?: RemoteAnswerRun;
}

function groupRecords(records: RecordRow[]): AnswerGroup[] {
  const groups = new Map<string, AnswerGroup>();
  for (const record of records) {
    const key = record.runId ? runKey(record.bankId, record.runId) : `record:${record.id}`;
    const group = groups.get(key) ?? { key, runId: record.runId, records: [] };
    group.records.push(record);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function removeRemoteGroup(group: AnswerGroup) {
  if (!remoteRecords) return;
  remoteRecords = remoteRecords.filter((record) => runKey(record.bankId, record.runId) !== group.key);
  runDetails.delete(group.key);
}

function questionStems() {
  const questions = allQuestions();
  if (questions !== stemSource) {
    stemSource = questions;
    stemById = new Map(questions.map((question) => [question.qid, question.q]));
  }
  return stemById;
}

function archiveGroup(group: AnswerGroup) {
  if (!group.runId) return;
  archiveAnswerRun(group.runId, group.summary?.bankId ?? group.records[0]?.bankId);
  removeRemoteGroup(group);
  if (expanded === group.key) expanded = undefined;
  request++;
}

const dateFormat = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

function groupDate(record: RecordRow) {
  if (!record) return '';
  // Older offline records have no timestamp field; their event ID starts with the creation time.
  const local = record.id.match(/^([a-z0-9]+)-/i);
  const at = 'at' in record ? new Date(record.at) : new Date(local ? parseInt(local[1], 36) : NaN);
  return Number.isFinite(at.getTime()) ? dateFormat.format(at) : '';
}

function drawPanel() {
  const { x, y, w, h } = PANEL;
  panel(x, y, w, h, { stroke: C.lineHi, accent: C.gold });
  // 空白处仍属于抽屉；后注册的按钮热区会覆盖这层拦截。
  onBlock(x, y, w, h, '答题记录面板');
  const exit = answerbarExit();
  const titleX = x + (exit?.kind === 'back' ? 108 : 24);
  text(archived ? '已归档' : '答题记录', titleX, y + 34, { size: 20, weight: 700, family: FONT_TITLE, color: C.ink });
  const pending = answerHistory().filter((record) => record.archived === archived).slice().reverse();
  const groupsByKey = new Map(groupRecords(pending).map((group) => [group.key, group]));
  for (const summary of remoteRecords ?? []) {
    const key = runKey(summary.bankId, summary.runId);
    const group = groupsByKey.get(key) ?? { key, runId: summary.runId, records: [] };
    group.summary = summary;
    groupsByKey.set(key, group);
  }
  const groups = [...groupsByKey.values()].sort((a, b) => (b.summary?.latest ?? 0) - (a.summary?.latest ?? 0));
  const count = groups.reduce((sum, group) => sum + (group.summary?.total ?? group.records.length), 0);
  text(`${groups.length} 局 · ${count} 题`, titleX, y + 60, { size: 12, color: C.dim });
  if (!archived) action(x + 176, y + 17, 88, 34, '已归档', () => showArchive(true), 'ghost', { size: 12 });
  drawExitControl(x, y, w, exit);
  g.fillStyle = C.line;
  g.fillRect(x + 18, y + 78, w - 36, 1);
  if (!groups.length) {
    text(archived ? '暂无归档记录' : '答题后，记录会显示在这里。', x + 24, y + 120, { size: 13, color: C.dim });
    consumeModalWheel();
    return;
  }
  const top = y + 92;
  const viewH = h - 108;
  const left = x + 18;
  const width = w - 36;
  const header = 56;
  const recordStep = 52;
  const gap = 8;
  const total = groups.reduce((sum, group) => sum + header + gap + (expanded === group.key ? (runDetails.get(group.key) ?? group.records).length * recordStep : 0), 0);
  const view = scrollArea(left, top, width, viewH, total, archived ? ARCHIVE : LIST, consumeModalWheel());
  const bottom = top + viewH;
  const banks = new Map(listBanks().map((bank) => [bank.id, bank.name]));
  for (const doc of listDocuments()) banks.set(doc.docId, doc.name);
  const stems = expanded ? questionStems() : undefined;
  let cy = view.y;
  for (const group of groups) {
    if (cy >= bottom) break;
    const open = expanded === group.key;
    const hitTop = Math.max(cy, top);
    const hitH = Math.min(cy + header, bottom) - hitTop;
    if (hitH > 0) {
      const record = group.records[0] ?? ({ bankId: group.summary?.bankId ?? '', runId: group.runId, topic: '', qid: '', id: '', type: 'reset', archived } as RecordRow);
      const canArchive = !archived && !!group.runId;
      const archiveW = canArchive ? 100 : 0;
      const toggleW = width - archiveW;
      const lit = hover(left, hitTop, toggleW, hitH);
      panel(left, cy, width, header, { radius: 8, fill: open || lit ? C.panelHi : C.panel, stroke: C.line });
      g.save();
      g.translate(left + 18, cy + 27);
      if (open) g.rotate(Math.PI);
      drawArtIcon('expand', 0, 0, 16, lit ? C.gold : C.dim);
      g.restore();
      const label = banks.get(record.bankId) ?? record.bankId;
      const answers = group.records.filter((item) => item.type === 'answer');
      const score = group.summary ? `${group.summary.correct}/${group.summary.total}` : answers.length ? `${answers.filter((item) => 'right' in item && item.right).length}/${answers.length}` : '已重置';
      const date = group.summary?.at ? dateFormat.format(new Date(group.summary.at)) : groupDate(record);
      text(label, left + 36, cy + 17, { size: 14, weight: 600, maxW: toggleW - 44 });
      text([date, score].filter(Boolean).join(' · '), left + 36, cy + 38, { size: 12, color: C.dim, maxW: toggleW - 44 });
      onClick(left, hitTop, toggleW, hitH, () => {
        expanded = open ? undefined : group.key;
        if (!open && group.runId && group.summary && !runDetails.has(group.key)) {
          void remoteAnswerRun(group.summary.bankId, group.runId).then((rows) => { if (opened && expanded === group.key) runDetails.set(group.key, rows.reverse()); });
        }
      }, `答题局:${group.key}`);
      const by = cy + 12;
      if (canArchive && by >= top && by + 32 <= bottom) {
        action(left + width - 92, by, 80, 32, '归档本局', () => archiveGroup(group), 'ghost', { size: 12 });
      }
    }
    cy += header;
    if (open) {
      for (const record of (runDetails.get(group.key) ?? group.records)) {
        if (cy + recordStep > top && cy < bottom) row(record, cy, stems?.get(record.qid) ?? '');
        cy += recordStep;
      }
    }
    cy += gap;
  }
  view.restore();
  overflowAffordance(view, left, width);
}

export function drawAnswerbar(dt: number, onOpen: () => void) {
  const x = 22;
  const y = 22;
  if (answerbarOpen()) onDismiss(0, 0, VW, VH, () => closeAnswerbar(), '答题记录遮罩');
  action(x, y, 152, 42, '答题记录', () => {
    if (opened) answerbarExit()?.run();
    else { onOpen(); opened = true; refreshRecords(); }
  }, 'ghost', { size: 13, mark: 'records' });
  if (opened && Date.now() >= refreshAt) refreshRecords();
  motion.draw(opened, dt, -1, drawPanel);
}
