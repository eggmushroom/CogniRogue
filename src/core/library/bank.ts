import { CATALOG } from '../cards/catalog';
import { readStore, writeStore } from '../infra/storage';
import type { Question, QuestionBank } from '../model/types';
import { QUESTION_FORMAT, parseAnyQuestionBank } from './parse';
import { deleteRemoteBank, remoteBankText, remoteBanks, remoteDocuments, serviceInfo, type RemoteDocument, type ServiceInfo } from './remote';

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

export const bankTopicTitle = (bank: QuestionBank, id: string): string => bank.byTopic[id]?.[0]?.topicTitle ?? id;

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

let flatBankCache: { bank: QuestionBank; questions: Question[] } | null = null;

/** 当前题库的全部题目（所有主题）。 */
export function allQuestions(): Question[] {
  if (!flatBankCache || flatBankCache.bank !== BANK) {
    flatBankCache = { bank: BANK, questions: flattenBank(BANK) };
  }
  return flatBankCache.questions;
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

type BankRead = { ok: true; msg: string; bank: QuestionBank } | { ok: false; msg: string };

/**
 * 读取外部题库：**只校验格式，不校验主题**。
 *
 * 解析层把不合规的题收进 `issues`，这里有任何一条就整体拒绝并把前几条
 * 原样报出来（静默丢题会让写题人以为题写进去了）。校验失败时原题库
 * 原封不动，不会出现「一半是新题、一半是旧题」的中间状态。
 */
function parseBank(text: string): BankRead {
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

  const total = countQuestions(next);
  if (!total) {
    return { ok: false, msg: `没有解析出任何题目。格式要求：${QUESTION_FORMAT}。` };
  }

  const pools = Object.keys(next.byTopic).length;
  return {
    ok: true,
    bank: next,
    msg: `载入「${next.name}」：${total} 道题 / ${pools} 个题池。`
      + `卡池仍是内置的 ${CATALOG.length} 张卡；下一局开局会按主题从这里取题。`,
  };
}

/** 换的是整份题库；本局已经建好的临时题库不受影响。 */
export function loadQuestionBank(text: string): { ok: boolean; msg: string } {
  const result = parseBank(text);
  if (result.ok) BANK = result.bank;
  return result;
}

/* ── 题库档案：内置题库 + 本机服务题库 ─────────────────────────── */
const ACTIVE_KEY = 'cognirogue.bank.active.v1';
let selectedBankId = readStore(ACTIVE_KEY) ?? '';

function setActiveBank(id: string, bank: QuestionBank) {
  BANK = bank;
  selectedBankId = id;
  writeStore(ACTIVE_KEY, id);
}

/** 随程序走的英语题库。 */
interface ShippedBank {
  id: string;
  name: string;
  bank: QuestionBank;
  total: number;
  topics: number;
  msg: string;
}

let shipped: ShippedBank | null = null;

/** 服务端导入或生成的题库。 */
let remoteRows: Array<{ id: string; name: string; total: number; topics: number }> = [];
let documents: RemoteDocument[] = [];
export const listDocuments = (): readonly RemoteDocument[] => documents;
export async function refreshDocuments(): Promise<void> {
  documents = await remoteDocuments();
}
/** 服务在不在 / 能不能出题 / 配的是哪个模型。**它不是必需项**：不在的时候玩家照样有完整的内置题库。 */
let serviceInfoNow: ServiceInfo | null = null;
export const serviceOnline = (): boolean => !!serviceInfoNow;
export const serviceReady = (): boolean => !!serviceInfoNow?.canGenerate;
export const serviceModelName = (): string => serviceInfoNow?.model ?? '';
/** 模型接口地址，给设置页的输入框当默认值（key 不在此列，它永远不下发）。 */
export const serviceModelBase = (): string => serviceInfoNow?.baseUrl ?? '';

const shapeOf = (b: QuestionBank) => ({
  total: countQuestions(b),
  topics: Object.keys(b.byTopic).length,
});

export function activeBankId(): string {
  const id = selectedBankId;
  if (shipped?.id === id || remoteRows.some((bank) => bank.id === id)) return id;
  return shipped?.id || 'words';
}

export interface BankRow {
  id: string;
  name: string;
  total: number;
  topics: number;
  on: boolean;
  /** 随程序走的英语题库不可删除。 */
  builtin: boolean;
  /** 由本机服务提供（`npm run serve`）：切它要等一次网络往返。 */
  remote?: boolean;
}

export function listBanks(): BankRow[] {
  const on = activeBankId();
  const rows: BankRow[] = shipped ? [{
    id: shipped.id, name: shipped.name, total: shipped.total, topics: shipped.topics,
    on: shipped.id === on, builtin: true,
  }] : [];
  for (const b of remoteRows) {
    rows.push({ id: b.id, name: b.name, total: b.total, topics: b.topics, on: b.id === on, builtin: false, remote: true });
  }
  return rows;
}

/** 启动时解析一次内置题库；格式错误就让构建产物失败，不静默少一份。 */
export function initBank(id: string, md: string): void {
  const result = loadQuestionBank(md);
  if (!result.ok) throw new Error('内置题库「' + id + '」无效：' + result.msg);
  shipped = { id, name: BANK.name, bank: BANK, msg: result.msg, ...shapeOf(BANK) };
}

/** 浏览题库不改变新一局用的题源。 */
export async function readBank(id: string): Promise<BankRead> {
  if (shipped?.id === id) return { ok: true, bank: shipped.bank, msg: shipped.msg };
  const text = await remoteBankText(id);
  if (!text) return { ok: false, msg: '服务没有回答，这份题库取不到 —— 服务是不是停了？内置题库不受影响。' };
  return parseBank(text);
}

/** 用户退出页面后，迟到的原文不能覆盖后来选中的题库。 */
export async function useBank(id: string, stillSelected = () => true): Promise<BankRead> {
  const result = await readBank(id);
  if (!stillSelected()) return { ok: false, msg: '' };
  if (result.ok) setActiveBank(id, result.bank);
  return result;
}

/**
 * 问一次服务的状态：在不在、能不能出题。**不问题库清单**，很便宜，面板可以常调。
 */
export async function refreshServiceInfo(): Promise<boolean> {
  serviceInfoNow = await serviceInfo();
  if (!serviceInfoNow) {
    remoteRows = [];
    documents = [];
    if (shipped) setActiveBank(shipped.id, shipped.bank);
  }
  return !!serviceInfoNow;
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
  await refreshDocuments();

  const rows: typeof remoteRows = [];
  for (const b of await remoteBanks()) {
    if (shipped?.id === b.id) continue;
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
  if (want && rows.some((r) => r.id === want)) {
    await useBank(want, () => activeBankId() === want);
  }
  return rows.length;
}

export async function removeServiceBank(id: string): Promise<{ ok: boolean; msg: string }> {
  const row = remoteRows.find((bank) => bank.id === id);
  if (!row) return { ok: false, msg: '没有这份题库。' };
  if (!(await deleteRemoteBank(id))) return { ok: false, msg: '题库没有删除，请检查本机服务。' };
  remoteRows = remoteRows.filter((bank) => bank.id !== id);
  if (selectedBankId === id && shipped) setActiveBank(shipped.id, shipped.bank);
  return { ok: true, msg: `删除了「${row.name}」。` };
}
