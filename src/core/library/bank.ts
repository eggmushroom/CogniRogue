import { CATALOG } from '../cards/catalog';
import type { Question, QuestionBank } from '../model/types';
import { QUESTION_FORMAT, parseAnyQuestionBank } from './parse';

/**
 * library/bank —— 当前阶段题库，也是**唯一允许外部替换的东西**。
 *
 * 卡牌库在 `cards/catalog.ts` 里写死；这里只持有题目。导入一份 md
 * 会换掉整份来源题库，但 PACK（卡池）一个字节都不会变 —— 卡数、卡名、
 * 攻挡、效果、card id 全部保持，玩家的复习进度因此也不会失效。
 *
 * 两个层次必须分清：
 *   - `sourceBank()` 是**载入的完整题库**（内置 400 道临时单词题，或玩家导入的那份）；
 *   - `BANK` 是**当前阶段正在用的题库**，由 `library/stage.ts` 从来源题库切出来。
 * 战斗中只读 `BANK`，所以换阶段不会把整座塔的题一起换掉；换题库只改来源，
 * 下一次进阶段时才会重新切。
 *
 * `BANK` 是 let 绑定：ESM live binding 保证所有工具包读到的都是当前题库，
 * 调试入口必须用 getter 读它，不能快照（和以前 PACK 的坑一样）。
 *
 * 主题**不设白名单**：`byTopic` 的键只是写题人自己起的分组名。
 * 校验只看格式（见 `QUESTION_FORMAT`），不要求覆盖内置卡牌库的 16 个主题，
 * 也不要求主题名和卡面一致。
 */
export let BANK: QuestionBank = { name: '（尚未载入题库）', byTopic: {}, issues: [] };

/** 载入的完整题库。切阶段、换题库都从它出发，而不是从上一阶段的切片出发。 */
let SOURCE: QuestionBank | null = null;
/**
 * 来源题库的版本号。`loadQuestionBank` 换一次就 +1；阶段层靠它判断
 * "手上这份 BANK 还是不是从当前来源切的"。
 */
let GEN = 0;

export const bankGeneration = (): number => GEN;
export const sourceBank = (): QuestionBank => SOURCE ?? BANK;

export const countQuestions = (bank: QuestionBank): number =>
  Object.values(bank.byTopic).reduce((n, pool) => n + pool.length, 0);
export const bankQuestionCount = (): number => countQuestions(BANK);

/**
 * 把题库摊平成一个池，按题号去重。顺序只取决于 `byTopic` 的键顺序与池内顺序，
 * 同一次载入里是稳定的。以前按题干去重，现在按 `qid` —— 题号已经包含主题。
 */
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

/** 当前阶段题库的全部题目。 */
export function allQuestions(): Question[] {
  return flattenBank(BANK);
}

/**
 * 把几份各自独立、都带 `# 题库名` 的 md 合成一份文本。
 *
 * `parseQuestionBank` 遇到 `# ` 会先把这一行当题库名，所以多份直接拼接时
 * 只会留下最后一个名字。这里剥掉每份的一级标题（不动 `## 主题`），
 * 在最前面挂一个合集名。单份现在也能单独导入 —— 只是题池会薄一些。
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
 * 它换的是**来源题库**；当前阶段会等下一次 `enterStage()` 才重新切片。
 */
export function loadQuestionBank(text: string): { ok: boolean; msg: string } {
  let next: QuestionBank;
  try {
    next = parseAnyQuestionBank(text);
  } catch (err) {
    return { ok: false, msg: '解析失败：' + (err as Error).message };
  }

  const issues = next.issues ?? [];
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

  SOURCE = next;
  BANK = next;
  GEN += 1;
  const pools = Object.keys(next.byTopic).length;
  return {
    ok: true,
    msg: `载入「${next.name}」：${total} 道题 / ${pools} 个题池。`
      + `卡池仍是内置的 ${CATALOG.length} 张卡；每个阶段会从这份题库里切出自己那一章。`,
  };
}
