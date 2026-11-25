import { g, roundRect, VH, VW, wrapText } from '../../gfx/canvas';
import { C, FONT_NUM, font, FONT_TITLE, FONT_UI, withAlpha } from '../../gfx/theme';
import { action, bar, panel, text } from '../../gfx/ui';
import { drawArtIcon } from '../../gfx/art/icons';
import { AccordionMotion } from '../../gfx/motion';
import { drawMarkdown, layoutMarkdown } from '../../gfx/markdown';
import { hover, onClick } from '../../input';
import { BAL } from '../../core/model';
import { G, panelOf } from '../../core/infra';
import { clearQuestionMemory, countQuestions, isRetired, listBanks, listDocuments, rightCount, serviceModelName, serviceReady, sourceBank, wrongCount, type BankRow } from '../../core/library';
import type { BankPage, ModelForm, Panel, PlanView, Question, QuestionBank } from '../../core/model';
import {
  box, heading, overflowAffordance, scrollArea,
  MENU_BUTTON_H, MENU_GAP, MENU_H, MENU_PAD, MENU_RADIUS, MENU_ROW_RADIUS,
  MENU_W, MENU_X, MENU_Y,
} from './common';
import { openBank, openBankTopic, selectBank, askToDeleteBank, confirmBankDeletion, requestPackFile } from '../packio';
import { startDocFlow, openSavedDocument, replan, approvePlan, documentJobs, generateSelectedTopics } from '../plangen';
import { openModelForm, toggleReveal, focusModelField, saveModelForm, modelFields } from '../settings';
import { leavePanel, panelExit } from '../navigation';
import { drawField } from '../textfield';

/* ── 题库 ─────────────────────────────────────────────────── */

// Menu polish informed by Unslop by Damir Sokolovsky (CC BY 4.0).
const questionMotion = new WeakMap<BankPage, AccordionMotion>();
const questionAnchor = new WeakMap<BankPage, { id: string; offset: number }>();
let lastPreview: string | undefined;
const QUESTION_HEADER_H = 48;
const QUESTION_TITLE_SIZE = 16;
const QUESTION_TITLE_WIDTH = 176;
const packW = MENU_W;
const packH = MENU_H;
const packX = MENU_X;
const packY = MENU_Y;
const listX = packX + MENU_PAD;
const listW = packW - MENU_PAD * 2;
const listTop = packY + 152;
const footerY = packY + 640;

export function drawPackPanel(t: number) {
  const p = panelOf('pack');
  if (!p) return;
  if (p.deletion) return drawBankDeletion(p.deletion);

  const rows = listBanks();
  const page = p.page;
  const row = page && rows.find((bank) => bank.id === page.bankId);
  box(packX, packY, packW, packH, C.gold, panelExit(), MENU_RADIUS);
  if (row && page) {
    lastPreview = row.id;
    const bank = row.on ? sourceBank() : page.bank;
    const doc = listDocuments().find((entry) => entry.docId === row.id);
    const name = doc?.name ?? row.name;
    if (page.topic) drawBankQuestions(page, name, bank, page.topic, t);
    else drawBankTopics(row, name, !!doc, bank, !!p.loading, page.lastTopic);
  } else {
    drawBankList(rows, !!p.loading);
  }
  if (p.msg) {
    g.font = font(13, 500, FONT_UI);
    g.fillStyle = p.ok ? C.green : C.red;
    wrapText(p.msg, listW).slice(0, 2).forEach((line, i) => g.fillText(line, listX, packY + 704 + i * 18));
  }
}

function packHeading(name: string, summary = '') {
  text(name, listX, packY + 88, { size: 30, weight: 600, family: FONT_TITLE, maxW: listW });
  if (summary) text(summary, listX, packY + 120, { size: 14, color: C.dim, maxW: listW });
}

function drawBankList(rows: BankRow[], loading: boolean) {
  const documents = listDocuments();
  const bankItem = (bank: BankRow, documentName?: string) => ({
    id: bank.id, name: documentName ?? bank.name,
    detail: `${bank.topics} 个主题 · ${bank.total} 道题`, selected: bank.on,
    run: () => void openBank(bank.id),
  });
  const groups = [
    { label: '内置题库', list: rows.filter((bank) => bank.builtin).map((bank) => bankItem(bank)) },
    { label: '我的题库', list: [
      ...rows.filter((bank) => bank.remote && !documents.some((doc) => doc.docId === bank.id)).map((bank) => bankItem(bank)),
      ...documents.map((doc) => {
        const bank = rows.find((entry) => entry.id === doc.docId);
        if (bank) return bankItem(bank, doc.name);
        const imported = doc.importedPlanId && doc.importedPlanId === doc.planId;
        const detail = imported ? '未出题' : doc.planId ? '待确认' : '未划分';
        return { id: doc.docId, name: doc.name, detail, selected: false, run: () => void openSavedDocument(doc.docId) };
      }),
    ] },
  ].filter((group) => group.list.length);
  const count = groups.reduce((n, group) => n + group.list.length, 0);
  packHeading('题库');
  const rowH = 64;
  const groupH = 32;
  const gap = MENU_GAP;
  const h = footerY - listTop - 24;
  const view = scrollArea(listX, listTop, listW, h, count * (rowH + gap) + groups.length * groupH, 'pack:list');
  let y = view.y;
  for (const group of groups) {
    text(group.label, listX + 16, y + 12, { size: 14, weight: 500, color: C.dim });
    y += groupH;
    for (const bank of group.list) {
      menuRow(view, y, rowH, bank.name, bank.detail, '', `bank:${bank.id}`, loading ? undefined : bank.run,
        { current: bank.selected, visited: bank.id === lastPreview });
      y += rowH + gap;
    }
  }
  view.restore();
  overflowAffordance(view, listX, listW);

  if (loading) {
    text('正在读取题库…', listX, footerY + 22, { size: 14, color: C.dim });
  } else {
    action(listX, footerY, 184, MENU_BUTTON_H, '从文档建题库', () => void startDocFlow(), 'primary', { r: MENU_ROW_RADIUS });
    action(listX + 196, footerY, 168, MENU_BUTTON_H, '导入题库文件', () => void requestPackFile(), 'ghost', { size: 14, r: MENU_ROW_RADIUS });
  }
}

function drawBankTopics(row: BankRow, title: string, fromDocument: boolean, bank: QuestionBank, loading: boolean, lastTopic?: string) {
  const topics = Object.entries(bank.byTopic);
  packHeading(title, `${topics.length} 个主题 · ${countQuestions(bank)} 道题`);
  const rowH = 52;
  const gap = MENU_GAP;
  const h = footerY - 24 - listTop;
  const view = scrollArea(listX, listTop, listW, h, topics.length * (rowH + gap), `pack:topics:${row.id}`);
  let y = view.y;
  for (const [name, questions] of topics) {
    if (y + rowH > view.y0 && y < view.y0 + view.h) {
      const mastered = questions.filter((q) => isRetired(q)).length;
      menuRow(view, y, rowH, name, '', `${mastered}/${questions.length}`, `topic:${name}`,
        loading ? undefined : () => openBankTopic(name),
        { visited: name === lastTopic, progress: questions.length ? mastered / questions.length : 0 });
    }
    y += rowH + gap;
  }
  view.restore();
  overflowAffordance(view, listX, listW);

  const selectW = 160;
  action(listX + listW - selectW, footerY, selectW, MENU_BUTTON_H,
    loading ? '正在切换…' : row.on ? '已选择此题库' : '选择此题库',
    () => void selectBank(), 'primary', { size: 15, mark: row.on ? 'check' : undefined, disabled: loading || row.on, r: MENU_ROW_RADIUS });
  if (loading || !row.remote || row.builtin) return;
  if (fromDocument) action(listX, footerY, 160, MENU_BUTTON_H, '文档主题', () => void openSavedDocument(row.id), 'ghost', { r: MENU_ROW_RADIUS });
  action(listX + (fromDocument ? 172 : 0), footerY, 108, MENU_BUTTON_H, fromDocument ? '删除生成题目' : '删除题库',
    () => askToDeleteBank(row, fromDocument), 'ghost', { size: 13, r: MENU_ROW_RADIUS });
}

function menuRow(
  view: { y0: number; h: number }, y: number, h: number, name: string, detail: string, status: string,
  label: string, run?: () => void, state: { progress?: number; current?: boolean; visited?: boolean } = {},
) {
  const top = Math.max(y, view.y0);
  const bottom = Math.min(y + h, view.y0 + view.h);
  if (bottom <= top) return;
  const hv = !!run && hover(listX, top, listW, bottom - top);
  roundRect(listX, y, listW, h, MENU_ROW_RADIUS);
  g.fillStyle = hv ? C.panelHi : withAlpha(C.ink, state.visited ? 0.085 : 0.025);
  g.fill();
  const right = listX + listW;
  const cy = y + h / 2;
  const maxW = listW - 256;
  text(name, listX + 16, cy - (detail ? 10 : 0), { size: 16, weight: 500, maxW });
  if (detail) text(detail, listX + 16, cy + 12, { size: 13, color: C.dim, maxW });
  if (state.progress !== undefined) bar(right - 156, cy - 3, 64, 6, state.progress, C.gold);
  if (state.current) drawArtIcon('check', right - 56, cy, 20, C.gold);
  if (status) text(status, right - 44, cy, {
    size: 13, color: C.dim, align: 'right', maxW: 192,
  });
  drawArtIcon('forward', right - 20, cy, 20, hv ? C.gold : run ? C.dim : C.faint);
  if (run) onClick(listX, top, listW, bottom - top, run, label);
}

function drawBankQuestions(page: BankPage, name: string, bank: QuestionBank, topic: string, t: number) {
  const list = packSorted(bank.byTopic[topic] ?? []);
  packHeading(topic, name);
  let motion = questionMotion.get(page);
  if (!motion) questionMotion.set(page, motion = new AccordionMotion());
  const progress = motion.update(page.question, t);
  const gap = 6;
  const layouts = list.map((q) => {
    const ok = rightCount(q.topic, q.qid);
    const bad = wrongCount(q.topic, q.qid);
    const amount = progress.get(q.qid) ?? 0;
    const layout = amount > 0 ? questionLayout(q, listW, !!(ok + bad)) : null;
    const h = layout ? QUESTION_HEADER_H + Math.round((layout.h - QUESTION_HEADER_H) * amount) : QUESTION_HEADER_H;
    return { q, ok, bad, layout, h, amount };
  });
  const anchor = questionAnchor.get(page);
  let anchorDelta = 0;
  let need = 0;
  for (const item of layouts) {
    // Switching rows collapses the old card above the new one; keep the clicked title under the pointer.
    if (anchor?.id === item.q.qid) { anchorDelta = need - anchor.offset; anchor.offset = need; }
    need += item.h + gap;
  }
  const view = scrollArea(listX, listTop, listW, packY + 688 - listTop, need, `pack:questions:${page.bankId}:${topic}`, undefined, anchorDelta);
  let y = view.y;
  for (const item of layouts) {
    drawPackQuestion(view, listX, y, listW, page, item);
    y += item.h + gap;
  }
  view.restore();
  overflowAffordance(view, listX, listW);
}

function questionTitle(q: Question, w: number) {
  return layoutMarkdown(q.q, w - QUESTION_TITLE_WIDTH, QUESTION_TITLE_SIZE, 500);
}

function questionLayout(q: Question, w: number, answered: boolean) {
  const title = questionTitle(q, w);
  const options = q.options.map((opt) => layoutMarkdown(opt, w - 88, 14));
  const explain = layoutMarkdown(q.explain, w - 64, 13);
  const h = 12 + title.h + 16
    + options.reduce((n, option) => n + option.h + 8, 0)
    + (explain.h ? explain.h + 12 : 0) + (answered ? 40 : 0);
  return { title, options, explain, h };
}

/**
 * 题目列的顺序：没掌握的排前面，掌握的沉到最后。
 *
 * 排的是"接下来该练哪道"，所以键是 错的次数多 → 对的次数少 → 题库原序。
 * 原序当兜底：没有历史的题按题库的顺序读，比按题号 hash 排好找得多。
 */
function packSorted(list: Question[]): Question[] {
  const key = (q: Question) => ({
    done: isRetired(q),
    ok: rightCount(q.topic, q.qid),
    bad: wrongCount(q.topic, q.qid),
  });
  return list
    .map((q, i) => ({ q, i, k: key(q) }))
    .sort((a, b) =>
      Number(a.k.done) - Number(b.k.done)
      || b.k.bad - a.k.bad
      || a.k.ok - b.k.ok
      || a.i - b.i)
    .map((x) => x.q);
}

/** 一道题的状态：颜色 + 一句话。判据只在这儿，别处不许自己比 `retireAt`。 */
function qStatusOf(q: Question, ok: number, bad: number): { color: string; label: string } | null {
  if (isRetired(q)) return { color: C.green, label: '已掌握' };
  if (ok > 0) return { color: C.gold, label: `答对 ${ok}/${BAL.retireAt}` };
  if (bad > 0) return { color: C.red, label: `答错 ${bad}` };
  return null;
}

/** 热区按可见区域裁切，长题目超出一屏后仍能收起、重置。 */
function drawPackQuestion(
  view: { y0: number; y: number; h: number }, x: number, cy: number, w: number, page: BankPage,
  { q, ok, bad, layout, h: rowH, amount }: {
    q: Question; ok: number; bad: number; layout: ReturnType<typeof questionLayout> | null; h: number; amount: number;
  },
) {
  const hitTop = Math.max(cy, view.y0);
  const hitBottom = Math.min(cy + rowH, view.y0 + view.h);
  if (hitBottom <= hitTop) return;
  const hv = hover(x, hitTop, w, hitBottom - hitTop);
  const st = qStatusOf(q, ok, bad);
  let infoY = 0;

  g.save();
  roundRect(x, cy, w, rowH, MENU_ROW_RADIUS);
  g.fillStyle = withAlpha(C.ink, (hv ? 0.05 : 0.02) + amount * 0.025);
  g.fill();
  if (amount > 0) {
    g.strokeStyle = withAlpha(C.lineHi, 0.8 * amount);
    g.lineWidth = 1;
    g.stroke();
  }
  g.clip();

  const title = layout?.title ?? questionTitle(q, w);
  const titleY = cy + 12 - (title.rows[0]?.y ?? 0);
  drawMarkdown(title, x + 32, titleY, C.ink, 0, 1);
  if (st) text(st.label, x + w - 44, cy + 24, { size: 12, color: st.color, align: 'right' });
  g.save();
  g.translate(x + w - 20, cy + 24);
  g.rotate(Math.PI * amount);
  drawArtIcon('expand', 0, 0, 20, hv ? C.gold : C.dim);
  g.restore();

  if (layout && rowH > QUESTION_HEADER_H) {
    g.save();
    g.globalAlpha *= amount;
    drawMarkdown(title, x + 32, titleY, C.ink, 1);
    let oy = titleY + title.h + 16;
    layout.options.forEach((option, i) => {
      const right = i === q.answer;
      text(`${'ABCDEF'[i] ?? '?'}`, x + 32, oy + 11, { size: 13, color: right ? C.green : C.dim, family: FONT_NUM });
      drawMarkdown(option, x + 56, oy, right ? C.green : C.ink2);
      if (right) drawArtIcon('check', x + w - 20, oy + 11, 16, C.green);
      oy += option.h + 8;
    });
    drawMarkdown(layout.explain, x + 32, oy, C.dim);
    infoY = cy + layout.h - 20;
    if (ok + bad > 0) {
      g.fillStyle = C.line;
      g.fillRect(x + 32, infoY - 20, w - 64, 1);
      text(`答对 ${ok} 次 · 答错 ${bad} 次`, x + 32, infoY, { size: 12, color: C.dim });
    }
    g.restore();
  }

  onClick(x, hitTop, w, hitBottom - hitTop, () => {
    if (panelOf('pack')?.page !== page) return;
    page.question = page.question === q.qid ? undefined : q.qid;
    if (page.question) questionAnchor.set(page, { id: q.qid, offset: cy - view.y });
    else questionAnchor.delete(page);
  }, `q:${q.qid}`);
  // 重置后注册，避免被整行热区吞掉；只在按钮完整可见时响应。
  if (page.question === q.qid && ok + bad > 0 && infoY - 16 >= hitTop && infoY + 8 <= hitBottom) {
    const rx = x + w - 16;
    const rh = hover(rx - 60, infoY - 16, 64, 24);
    text('重置', rx, infoY, { size: 11, color: rh ? C.red : C.dim, align: 'right' });
    onClick(rx - 60, infoY - 16, 64, 24,
      () => clearQuestionMemory(page.bankId, q.topic, q.qid), 'reset:' + q.qid);
  }
  g.restore();
}

function drawBankDeletion(target: NonNullable<Extract<Panel, { k: 'pack' }>['deletion']>) {
  const w = 584;
  const h = 264;
  const x = (VW - w) / 2;
  const y = (VH - h) / 2;
  const left = x + 32;
  const right = x + w - 32;
  box(x, y, w, h, C.red, null, MENU_RADIUS);
  heading(target.fromDocument ? '删除题目？' : '删除题库？', left, y + 54);
  text(`「${target.name}」`, left, y + 97, { size: 18, weight: 600, maxW: right - left });
  text(target.fromDocument ? '将删除这份题库的全部生成题目。' : '将删除整份题库及其中的所有题目。',
    left, y + 131, { size: 15, color: C.ink2 });
  if (target.fromDocument) {
    text('来源文档、主题和答题记录会保留。', left, y + 156, { size: 15, color: C.dim });
  }
  if (target.pending) {
    text('正在删除…', right, y + 217, { size: 15, color: C.dim, align: 'right' });
    return;
  }
  action(right - 244, y + 193, 104, MENU_BUTTON_H, '取消', leavePanel, 'ghost', { r: MENU_ROW_RADIUS });
  action(right - 128, y + 193, 128, MENU_BUTTON_H, '确认删除', () => void confirmBankDeletion(), 'danger', { r: MENU_ROW_RADIUS });
}

export function drawPlanPanel(v: PlanView) {
  const w = 1180;
  const pad = 40;
  const cw = w - pad * 2;
  const x = (VW - w) / 2;
  const h = 736;
  const y = (VH - h) / 2;
  box(x, y, w, h, C.gold, panelExit(), MENU_RADIUS);

  const planned = !!v.planId && v.topics.length > 0;
  const jobs = v.imported ? documentJobs(v) : [];
  const legacyRunning = jobs.some((job) => job.topic == null && job.state === 'running');
  const latest = new Map<number, (typeof jobs)[number]>();
  for (const job of jobs) {
    if (job.planId === v.planId && job.topic != null && !latest.has(job.topic)) latest.set(job.topic, job);
  }
  const available = new Set<number>();
  if (v.imported && !legacyRunning) v.topics.forEach((_, i) => {
    const state = latest.get(i)?.state;
    if (state !== 'running' && state !== 'queued') available.add(i);
  });
  const selected = [...available].filter((i) => v.selected.has(i));
  heading(v.imported ? '选择出题主题' : '文档主题', x + pad, y + 68);

  roundRect(x + pad, y + 96, cw, 64, MENU_ROW_RADIUS);
  g.fillStyle = 'rgba(255,255,255,.022)';
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,.07)';
  g.lineWidth = 1;
  roundRect(x + pad, y + 96, cw, 64, MENU_ROW_RADIUS);
  g.stroke();

  text(v.name, x + pad + 20, y + 120, { size: 16, weight: 600, color: C.ink, maxW: cw - 240 });
  const split = v.tier === 'toc' ? '按目录划分' : v.tier === 'agentic' ? '模型分章' : '按段落划分';
  if (planned) text(`${v.topics.length} 个主题 · ${split}`, x + pad + 20, y + 146,
    { size: 12, color: C.dim });

  const listTop = y + 184;
  const listH = 404;
  const gap = 8;
  const layouts = v.topics.map((topic) => {
    g.font = font(16, 500, FONT_UI);
    const title = wrapText(topic.title, cw - 216);
    g.font = font(13, 400, FONT_UI);
    const summary = v.imported ? [] : wrapText(topic.summary, cw - 216).slice(0, 2);
    return { title, summary, h: 40 + title.length * 24 + (topic.pageFrom ? 24 : 0) + summary.length * 20 };
  });
  const need = layouts.reduce((n, layout) => n + layout.h + gap, 0);
  const view = scrollArea(x + pad, listTop, cw, listH, need, v.docId + (v.imported ? ':topics' : ':preview'));

  if (!v.topics.length && !v.busy) {
    text('暂无主题', x + pad + cw / 2, listTop + 90,
      { size: 14, color: C.dim, align: 'center' });
  }
  let cy = view.y;
  v.topics.forEach((t, i) => {
    const layout = layouts[i];
    const rowH = layout.h;
    const hitTop = Math.max(cy, view.y0);
    const hitBottom = Math.min(cy + rowH, view.y0 + listH);
    const selectable = !v.busy && available.has(i);
    const checked = available.has(i) && v.selected.has(i);
    const hv = selectable && hitBottom > hitTop && hover(view.x, hitTop, cw, hitBottom - hitTop);
    roundRect(view.x, cy, cw, rowH, MENU_ROW_RADIUS);
    g.fillStyle = checked ? withAlpha(C.gold, 0.09) : hv ? C.panelHi : withAlpha(C.ink, 0.025);
    g.fill();

    layout.title.forEach((line, j) => text(line, view.x + 20, cy + 28 + j * 24,
      { size: 16, weight: 500, color: C.ink, maxW: cw - 216 }));
    const pages = t.pageFrom
      ? `第 ${t.pageFrom}${t.pageTo !== t.pageFrom ? `-${t.pageTo}` : ``} 页`
      : '';
    const metaY = cy + 28 + layout.title.length * 24;
    if (pages) text(pages, view.x + 20, metaY, { size: 12, color: C.dim, maxW: cw - 216 });
    layout.summary.forEach((line, j) => text(line, view.x + 20, metaY + (pages ? 24 : 0) + j * 20,
      { size: 13, color: C.dim, maxW: cw - 216 }));
    if (v.imported) {
      const state = latest.get(i)?.state;
      const status = state === 'queued' ? '排队中' : state === 'running' ? '生成中'
        : state === 'done' ? '已完成' : state === 'fail' ? '失败' : '';
      const bx = view.x + cw - 54;
      const by = cy + 18;
      if (status) text(status, bx - 16, by + 12, { align: 'right', size: 13, color: state === 'fail' ? C.red : C.dim });
      if (available.has(i)) {
        panel(bx, by, 24, 24, { radius: 4, fill: checked ? withAlpha(C.gold, 0.22) : C.bg, stroke: checked ? C.gold : C.lineHi });
        if (selectable && hitBottom > hitTop) onClick(view.x, hitTop, cw, hitBottom - hitTop, () => {
          if (checked) v.selected.delete(i);
          else v.selected.add(i);
        }, `select-topic:${i}`);
        if (checked) drawArtIcon('check', bx + 12, by + 12, 20, C.gold);
      }
    }
    cy += rowH + gap;
  });
  view.restore();
  overflowAffordance(view, x + pad, cw);

  g.fillStyle = 'rgba(255,255,255,.06)';
  g.fillRect(x + pad, y + 608, cw, 1);

  const fy = y + 628;
  if (v.busy) {
    text(v.msg || '处理中…', x + pad, y + 652, { size: 14, color: C.gold, maxW: cw });
  } else if (v.imported) {
    if (available.size) {
      const allSelected = selected.length === available.size;
      action(x + pad, fy, 132, 46, allSelected ? '取消全选' : '全选', () => {
        v.selected = new Set(allSelected ? [] : available);
      }, 'ghost', { r: MENU_ROW_RADIUS });
    }
    text(legacyRunning ? '整库出题进行中' : `已选 ${selected.length} 个主题`, x + pad + (available.size ? 148 : 0), fy + 23,
      { size: 14, color: C.dim });
    action(x + w - pad - 200, fy, 200, 46, '生成所选主题', () => void generateSelectedTopics(v, selected), 'primary', {
      disabled: !selected.length || !v.canAgentic, r: MENU_ROW_RADIUS,
    });
  } else {
    if (planned) {
      action(x + w - pad - 200, fy, 200, 46, '确认主题划分', () => void approvePlan(v), 'primary', { r: MENU_ROW_RADIUS });
    } else if (v.docId) {
      action(x + w - pad - 200, fy, 200, 46, '划分主题', () => void replan('auto'), 'primary', { r: MENU_ROW_RADIUS });
    }
    if (v.docId && v.canAgentic) {
      action(x + pad + 212, fy, 168, 46, '模型分章', () => void replan('agentic'), 'ghost', { size: 14, r: MENU_ROW_RADIUS });
    }
    action(x + pad, fy, 200, 46, '更换文档', () => void startDocFlow(), 'ghost', { size: 14, r: MENU_ROW_RADIUS });
  }

  if (!v.busy) {
    const hint = v.docId && !v.canAgentic ? '请在「设置 › 出题模型」配置模型' : '';
    g.font = font(13, 500, FONT_UI);
    g.fillStyle = v.ok ? C.dim : C.red;
    wrapText([v.msg, hint].filter(Boolean).join(' · '), cw).slice(0, 2)
      .forEach((ln, i) => g.fillText(ln, x + pad, y + 700 + i * 18));
  }
}

/**
 * 设置只保留玩法和模型；连接情况由实际操作反馈，不作为独立配置项。
 */
export function drawSettingsPanel(t: number) {
  const p = G.panel;
  if (p.k !== 'settings') return;
  if (p.form) {
    drawModelForm(p.form, p.msg, p.ok, t);
    return;
  }
  const w = MENU_W;
  const rowH = 64;
  const h = MENU_H;
  const x = MENU_X;
  const y = MENU_Y;
  box(x, y, w, h, C.gold, panelExit(), MENU_RADIUS);
  heading('设置', x + MENU_PAD, y + 88);

  const ready = serviceReady();

  const rows = [
    {
      name: '玩法说明',
      status: '',
      run: () => { G.panel = { k: 'help', fromSettings: { msg: p.msg, ok: p.ok } }; },
    },
    {
      name: '出题模型',
      status: ready
        ? serviceModelName() || '默认模型'
        : '未配置',
      run: openModelForm,
    },
  ];

  const view = { y0: listTop, h: rows.length * (rowH + MENU_GAP) };
  rows.forEach((r, i) => menuRow(view, listTop + i * (rowH + MENU_GAP), rowH,
    r.name, '', r.status, r.name, r.run));

  const fy = y + h - 36;
  if (p.msg) {
    g.font = font(13, 500, FONT_UI);
    g.fillStyle = p.ok ? C.green : C.red;
    const lines = wrapText(p.msg, w - MENU_PAD * 2).slice(0, 2);
    lines.forEach((ln, i) => g.fillText(ln, x + MENU_PAD, fy - (lines.length - 1 - i) * 19));
  }
}
/**
 * 模型参数的编辑页：接口地址、模型、密钥。
 *
 * 地址和模型名带服务报上来的当前值；密钥永远是空框 —— 服务从不下发 key，
 * 所以这里能"改"不能"看"，留空就是不改。
 *
 * 画布没有 DOM 输入框，字段由 `textfield.ts` 画、按键由 `settings.ts` 的
 * `settingsKey` 收拢 —— 这一页只负责排版和命中矩形。
 */
function drawModelForm(f: ModelForm, msg: string, ok: boolean, t: number) {
  const w = 800;
  const h = f.connection ? 624 : 512;
  const x = (VW - w) / 2;
  const y = (VH - h) / 2;
  box(x, y, w, h, C.gold, panelExit(), MENU_RADIUS);
  heading('出题模型', x + 40, y + 84);

  const caretOn = Math.sin(t * 5) > -0.45; // 不闪的竖线看着像排版错误
  const fx = x + 40;
  const fw = w - 80;
  const kinds = [
    ['接口地址', 'https://api.deepseek.com/v1'],
    ['模型名称', ''],
    ['密钥', serviceReady() ? '留空保留原密钥' : ''],
  ] as const;
  const fields = modelFields(f);
  const order = f.connection ? [1, 2, 0] : [1, 2];
  order.forEach((i, row) => {
    const field = fields[i];
    const ry = y + 156 + row * 112;
    const focused = f.field === i;
    text(kinds[i][0], fx, ry - 24, { size: 14, color: C.ink2 });
    drawField(fx, ry, fw, 48, field, {
      focused,
      masked: i === 2 && !f.reveal,
      placeholder: kinds[i][1],
      caretOn: focused ? caretOn : false,
      rightGap: focused && field.value ? 30 : 0,
    });
    onClick(fx, ry, fw, 48, () => focusModelField(i));
    // 有焦点且非空时给一个 ✕：整串换掉比一个字一个字退格现实，
    // 而"点进格里就全选"那种隐形行为在没有选区高亮时会让人丢数据。
    if (focused && field.value) {
      const clearAt = fx + fw - 20;
      const lit = hover(clearAt - 12, ry + 11, 28, 24);
      text('×', clearAt, ry + 24, { size: 16, color: lit ? C.ink : C.faint, align: 'center' });
      onClick(clearAt - 12, ry + 11, 28, 24, () => { field.value = ''; field.caret = 0; });
    }
    if (i === 2) {
      // 明文开关做成文字链接：它属于这一格，不该长成第二颗按钮
      const lit = hover(fx + fw - 56, ry - 40, 56, 32);
      text(f.reveal ? '隐藏' : '显示', fx + fw, ry - 24, {
        size: 12, color: lit ? C.ink : C.dim, align: 'right',
      });
      onClick(fx + fw - 56, ry - 40, 56, 32, toggleReveal, '显示密钥');
    }
  });

  const connectionY = y + h - 148;
  const connectionHover = hover(fx, connectionY - 16, 160, 32);
  const connectionColor = connectionHover ? C.ink : C.dim;
  drawArtIcon(f.connection ? 'collapse' : 'expand', fx + 10, connectionY, 20, connectionColor);
  text('连接设置', fx + 28, connectionY, { size: 13, color: connectionColor });
  onClick(fx, connectionY - 16, 160, 32, () => {
    f.connection = !f.connection;
    if (!f.connection && f.field === 0) focusModelField(1);
  }, '连接设置');

  g.fillStyle = C.line;
  g.fillRect(fx, y + h - 96, fw, 1);

  if (msg) {
    g.save();
    g.font = font(13, 500, FONT_UI);
    g.fillStyle = ok ? C.green : C.red;
    wrapText(msg, fw).slice(0, 1).forEach((ln) => g.fillText(ln, fx, y + h - 116));
    g.restore();
  }
  action(x + w - 40 - 124, y + h - 72, 124, 44, '保存', () => { void saveModelForm(); }, 'primary', { size: 15, r: MENU_ROW_RADIUS });
}
