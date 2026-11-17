import { CATALOG } from '../cards/catalog';
import type { Question, QuestionBank } from '../model/types';
import { QUESTION_FORMAT, parseAnyQuestionBank } from './parse';

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
