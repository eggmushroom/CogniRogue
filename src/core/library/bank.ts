import { CATALOG } from '../cards/catalog';
import { readStore, writeStore } from '../infra/storage';
import type { Question, QuestionBank } from '../model/types';
import { QUESTION_FORMAT, hash32, parseAnyQuestionBank } from './parse';
import { remoteBankText, remoteBanks, serviceInfo } from './remote';

/**
 * 载入的题库，也是唯一允许外部替换的东西。
 * 卡池在 `cards/catalog.ts` 写死，换题库只换题目。
 *
 * 这里是**整份**题库（所有主题）。一局开局时 `library/stage.ts` 从它按主题取一批题，
 * 拼成本局的临时题库；阶段不再各自切一份。
 * `BANK` 是 let 绑定，调试入口必须用 getter 读。
 * `byTopic` 的键只是分组名，不设白名单。
 */
export let BANK: QuestionBank = { name: '（尚未载入题库）', byTopic: {}, issues: [] };

export const sourceBank = (): QuestionBank => BANK;

export const countQuestions = (bank: QuestionBank): number =>
  Object.values(bank.byTopic).reduce((n, pool) => n + pool.length, 0);
export const bankQuestionCount = (): number => countQuestions(BANK);

/** 把题库摊平成一个池，按题号去重；同一次载入里顺序稳定。 */
export function flattenBank(bank: QuestionBank): Question[] {
  const out: Question[] = [];
  const seen = new Set<string>();
  for (const pool of Object.values(bank.byTopic)) {
    for (const q of pool) {
      if (seen.has(q.qid)) continue;
      seen.add(q.qid);
      out.push(q);
    }
  }
  return out;
}

/** 当前题库的全部题目（所有主题）。 */
export function allQuestions(): Question[] {
  return flattenBank(BANK);
}

/**
 * 把几份各自独立、都带 `# 题库名` 的 md 合成一份文本。
 *
 * `parseQuestionBank` 遇到 `# ` 会先把这一行当题库名，所以多份直接拼接时
 * 只会留下最后一个名字。这里剥掉每份的一级标题（不动 `## 主题`），
 * 在最前面挂一个合集名。单份现在也能单独导入：只是题池会薄一些。
 */
export function mergePacks(texts: string[], name = '合集题库'): string {
  const body = texts
    .map((t) => t.replace(/^#[ \t][^\n]*\r?\n/m, ''))
    .join('\n\n');
  return `# ${name}\n\n${body}`;
}

/** 阶段层切出一份题库后挂上来。只改"当前阶段用哪份题"，不改来源。 */
export function setActiveBank(next: QuestionBank) {
  BANK = next;
}

/**
 * 载入外部题库：**只校验格式，不校验主题**。
 *
 * 解析层把不合规的题收进 `issues`，这里有任何一条就整体拒绝并把前几条
 * 原样报出来（静默丢题会让写题人以为题写进去了）。校验失败时原题库
 * 原封不动，不会出现「一半是新题、一半是旧题」的中间状态。
 *
 * 换的是整份题库；本局已经建好的临时题库不受影响 —— 新题下一局开局才进池。
 */
export function loadQuestionBank(text: string): { ok: boolean; msg: string } {
  let next: QuestionBank;
  try {
    next = parseAnyQuestionBank(text);
  } catch (err) {
    return { ok: false, msg: '解析失败：' + (err as Error).message };
  }

  const issues = next.issues;
  if (issues.length) {
    // 面板上放不下长篇诊断，只列前两条；其余用计数带过
    const shown = issues.slice(0, 2).join('；');
    const more = issues.length > 2 ? ` ……另有 ${issues.length - 2} 处` : '';
    return {
      ok: false,
      msg: `已拒绝：${issues.length} 处格式不合规，原题库保持不变。${shown}${more}。`
        + `格式要求：${QUESTION_FORMAT}。`,
    };
  }

  const total = Object.values(next.byTopic).reduce((n, pool) => n + pool.length, 0);
  if (!total) {
    return { ok: false, msg: `没有解析出任何题目。格式要求：${QUESTION_FORMAT}。` };
  }

  BANK = next;
  const pools = Object.keys(next.byTopic).length;
  return {
    ok: true,
    msg: `载入「${next.name}」：${total} 道题 / ${pools} 个题池。`
      + `卡池仍是内置的 ${CATALOG.length} 张卡；下一局开局会按主题从这里取题。`,
  };
}

/* ── 题库档案：内置一份 + 玩家导入的若干份 ───────────────────────── */

/**
 * 玩家可以有好几份题库，切来切去。内置那份随程序走，导入的那些存在这台浏览器里。
 *
 * **存原文，不存解析结果。** 解析器（`parse.ts`）是「什么叫一道合法的题」的唯一真相，
 * 存解析结果等于把它抄第二遍，改判据时两份必然分叉。原文几十到几百 KB，
 * 切换时重解析一遍是毫秒级的事。
 */
const BANKS_KEY = 'cognirogue.banks.v1';
const ACTIVE_KEY = 'cognirogue.bank.active.v1';
/** 浏览器配额约 5 MB，留足余量；超了明说，不静默丢掉刚导入的那份。 */
const MAX_STORED = 8;
const MAX_CHARS = 1_500_000;

interface StoredBank {
  id: string;
  name: string;
  text: string;
  total: number;
  topics: number;
}

/** 随程序走的那些题库（`builtin.ts` 在启动时灌进来）。删不掉。 */
interface ShippedBank {
  id: string;
  name: string;
  text: string;
  total: number;
  topics: number;
}

let shipped: ShippedBank[] = [];

/** 服务端还有哪些题库（随程序的那几份不重复列）。 */
let remoteRows: Array<{ id: string; name: string; total: number; topics: number }> = [];
/** 服务在不在。**它不是必需项**：不在的时候玩家照样有完整的内置题库。 */
let serviceUp = false;
/** 服务能不能出题（它那侧有没有模型 key；key 不下发到浏览器）。 */
let serviceCanGen = false;
/** 服务在用的模型名，只为了在设置里显示"配的是哪个"。 */
let serviceModel = '';
export const serviceOnline = (): boolean => serviceUp;
export const serviceReady = (): boolean => serviceCanGen;
export const serviceModelName = (): string => serviceModel;

const shapeOf = (b: QuestionBank) => ({
  total: countQuestions(b),
  topics: Object.keys(b.byTopic).length,
});

function stored(): StoredBank[] {
  const raw = readStore(BANKS_KEY);
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return [];
    return list.filter((b): b is StoredBank =>
      !!b && typeof b.id === 'string' && typeof b.name === 'string' && typeof b.text === 'string');
  } catch {
    // 坏掉的档案当空的处理：宁可少几份题库，也不要让标题页起不来
    return [];
  }
}

const saveStored = (list: StoredBank[]) => writeStore(BANKS_KEY, JSON.stringify(list));

/** 现在用的是哪份。空串表示"没选过"，用列表里第一份。 */
export const activeBankId = (): string => readStore(ACTIVE_KEY) ?? '';

export interface BankRow {
  id: string;
  name: string;
  total: number;
  topics: number;
  on: boolean;
  /** 随程序走的那几份删不掉。 */
  builtin: boolean;
  /** 由本机服务提供（`npm run serve`）：切它要等一次网络往返。 */
  remote?: boolean;
}

export function listBanks(): BankRow[] {
  const on = activeBankId() || shipped[0]?.id || '';
  const rows: BankRow[] = shipped.map((b) => ({
    id: b.id, name: b.name, total: b.total, topics: b.topics, on: b.id === on, builtin: true,
  }));
  for (const b of stored()) {
    rows.push({ id: b.id, name: b.name, total: b.total, topics: b.topics, on: b.id === on, builtin: false });
  }
  for (const b of remoteRows) {
    rows.push({ id: b.id, name: b.name, total: b.total, topics: b.topics, on: b.id === on, builtin: false, remote: true });
  }
  return rows;
}

/**
 * 启动：把随程序走的题库都量一遍，再挂上该用的那份。
 * 顺序不能反 —— 恢复失败时 `BANK` 必须是可用的，标题页会直接读它。
 */
export function initBanks(packs: Array<{ id: string; md: string }>): void {
  shipped = [];
  for (const p of packs) {
    const r = loadQuestionBank(p.md);
    // 随程序走的题库解析不过说明是构建出了问题：少一份，别让整个游戏起不来
    if (!r.ok) continue;
    shipped.push({ id: p.id, name: BANK.name, text: p.md, ...shapeOf(BANK) });
  }
  const first = shipped[0];
  if (!first) return;
  loadQuestionBank(first.text);

  // 老版本把"内置那份"记成字面量 'builtin'，这里当成第一份
  const want = activeBankId() === 'builtin' ? first.id : activeBankId();
  if (!want || want === first.id) return;
  // 上次用的那份可能已经不在了（导入的被删掉、或换了版本）：那就留在默认那份上
  if (shipped.some((b) => b.id === want) || stored().some((b) => b.id === want)) useBank(want);
}

/** 切到某一份。切完立刻生效（面板与标题页都读 `BANK`），已经开局的那一局不受影响。 */
export function useBank(id: string): { ok: boolean; msg: string } {
  const ship = shipped.find((b) => b.id === id);
  if (ship) {
    const r = loadQuestionBank(ship.text);
    if (r.ok) writeStore(ACTIVE_KEY, id);
    return r;
  }
  const rec = stored().find((b) => b.id === id);
  if (!rec) return { ok: false, msg: '这份题库不在了 —— 可能已经被删掉。' };
  const r = loadQuestionBank(rec.text);
  if (r.ok) writeStore(ACTIVE_KEY, id);
  return r;
}

/**
 * 切到服务端的一份。只有它需要等网络，所以单独一个 async 入口 ——
 * `useBank()` 保持同步，面板和启动流程里那些同步调用不用跟着改。
 */
export async function useRemoteBank(id: string): Promise<{ ok: boolean; msg: string }> {
  const text = await remoteBankText(id);
  if (!text) return { ok: false, msg: '服务没有回答，这份题库取不到 —— 服务是不是停了？内置题库不受影响。' };
  const r = loadQuestionBank(text);
  if (r.ok) writeStore(ACTIVE_KEY, id);
  return r;
}

/**
 * 问一次服务的状态：在不在、能不能出题。**不问题库清单**，很便宜，面板可以常调。
 */
export async function refreshServiceInfo(): Promise<boolean> {
  const info = await serviceInfo();
  serviceUp = !!info;
  serviceCanGen = !!info?.canGenerate;
  serviceModel = info?.model ?? '';
  if (!serviceUp) remoteRows = [];
  return serviceUp;
}

/**
 * 问一次服务：还有哪些题库。
 *
 * 题数、主题数在**这里**数（`parse.ts` 是"什么叫一道题"的唯一真相），服务端只报文件名和字节数。
 * 解析不了的直接不列 —— 列出来玩家点进去也是坏的。
 * 上次用的那份如果正好是服务端的，这会儿才能接上。
 */
export async function refreshRemoteBanks(): Promise<number> {
  if (!(await refreshServiceInfo())) return 0;

  const rows: typeof remoteRows = [];
  for (const b of await remoteBanks()) {
    if (shipped.some((s) => s.id === b.id)) continue;
    const text = await remoteBankText(b.id);
    if (!text) continue;
    try {
      const qb = parseAnyQuestionBank(text);
      const shape = shapeOf(qb);
      // 0 道题的题库不列：生成任务失败时也会留下一个空文件，列出来只会让人点进去看空
      if (!shape.total) continue;
      rows.push({ id: b.id, name: qb.name || b.name, ...shape });
    } catch {
      continue;
    }
  }
  remoteRows = rows;

  const want = activeBankId();
  if (want && rows.some((r) => r.id === want) && BANK.name !== rows.find((r) => r.id === want)?.name) {
    await useRemoteBank(want);
  }
  return rows.length;
}

/**
 * 导入一份题库：先过解析器，通过才存盘并切过去。
 * 同一份内容再导入一次是替换而不是多出一份 —— 否则反复导入同一个文件会塞满配额。
 */
export function importBank(text: string): { ok: boolean; msg: string } {
  const list = stored();
  const id = 'b_' + hash32(text);
  const at = list.findIndex((b) => b.id === id);
  if (at < 0 && list.length >= MAX_STORED) {
    return { ok: false, msg: `这台浏览器里已经存了 ${MAX_STORED} 份。先在面板里删掉一份，再导入 —— 本次没有载入。` };
  }
  if (at < 0 && text.length > MAX_CHARS) {
    return { ok: false, msg: '这份题库太大了（浏览器存不下）。先拆成两份小的 —— 本次没有载入。' };
  }

  const r = loadQuestionBank(text);
  if (!r.ok) return r;

  const rec: StoredBank = { id, name: BANK.name, text, ...shapeOf(BANK) };
  if (at >= 0) list[at] = rec;
  else list.push(rec);
  saveStored(list);

  // 写不进去（配额满、隐私模式）时不能假装存好了：读回来比一比
  if (stored().length !== list.length) {
    return { ok: true, msg: `${r.msg}但这台浏览器存不下（配额满了），刷新就回到默认题库。` };
  }
  writeStore(ACTIVE_KEY, id);
  return { ok: true, msg: `${r.msg}已经存在这台浏览器里，下次打开还是它。` };
}

/** 删掉一份导入的题库；删的正好是正在用的那份就回落内置。 */
export function removeBank(id: string): { ok: boolean; msg: string } {
  const list = stored();
  const name = list.find((b) => b.id === id)?.name ?? '';
  const left = list.filter((b) => b.id !== id);
  if (left.length === list.length) return { ok: false, msg: '没有这份题库。' };
  saveStored(left);
  if (activeBankId() === id) {
    const back = shipped[0];
    const r = back ? useBank(back.id) : { ok: false, msg: '' };
    return { ok: true, msg: `删掉了「${name}」，换回${r.ok ? '默认题库' : '空题库'}。` };
  }
  return { ok: true, msg: `删掉了「${name}」。` };
}
