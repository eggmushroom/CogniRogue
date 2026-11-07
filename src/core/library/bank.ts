import { CATALOG } from '../cards/catalog';
import type { Question, QuestionBank } from '../model/types';
import { QUESTION_FORMAT, parseAnyQuestionBank } from './parse';

/**
 * library/bank —— 当前题库，也是**唯一允许外部替换的东西**。
 *
 * 卡牌库在 `cards/catalog.ts` 里写死；这里只持有题目。导入一份 md
 * 会换掉 BANK，但 PACK（卡池）一个字节都不会变 —— 卡数、卡名、
 * 攻挡、效果、card id 全部保持，玩家的复习进度因此也不会失效。
 *
 * `BANK` 是 let 绑定：ESM live binding 保证所有工具包读到的都是当前题库，
 * 调试入口必须用 getter 读它，不能快照（和以前 PACK 的坑一样）。
 *
 * 主题**不设白名单**：`byTopic` 的键只是写题人自己起的分组名。
 * 校验只看格式（见 `QUESTION_FORMAT`），不要求覆盖内置卡牌库的 16 个主题，
 * 也不要求主题名和卡面一致。出题用 `poolFor()` 兜底，任何题库都能玩。
 */
export let BANK: QuestionBank = { name: '（尚未载入题库）', byTopic: {}, issues: [] };

export const bankTopics = (): string[] => Object.keys(BANK.byTopic);
export const bankQuestionCount = (): number =>
  Object.values(BANK.byTopic).reduce((n, pool) => n + pool.length, 0);

/** 某个主题的题目池。可能为空 —— 空了由 `poolFor` 回退到全部题目。 */
export const questionsFor = (topic: string): Question[] => BANK.byTopic[topic] ?? [];

/**
 * `G.qSeen` 里全局题池专用的键。用一个题目名不可能出现的字符串，
 * 免得写题人起一个同名的 `##` 主题把两套「已问过」记录混在一起。
 */
export const GLOBAL_QKEY = '\u0000global';

/**
 * 全部题目摊平成一个池，按题干去重。顺序只取决于 `byTopic` 的键顺序与池内顺序，
 * 同一次载入里是稳定的 —— `qSeen` 记的题号才不会指到别的题上。
 */
export function allQuestions(): Question[] {
  const out: Question[] = [];
  const seen = new Set<string>();
  for (const pool of Object.values(BANK.byTopic)) {
    for (const q of pool) {
      if (seen.has(q.q)) continue;
      seen.add(q.q);
      out.push(q);
    }
  }
  return out;
}

/**
 * 点开一张牌时用哪一份题池：
 *   1. 这张卡的主题有题 → 用这个主题池（内置题库走这条路，行为不变）；
 *   2. 没有 → 从**全部题目**里抽。
 *
 * 第 2 条是「题库不限制主题」能成立的关键：只写一个主题、主题名随便起、
 * 甚至完全不写 `##` 的题库，照样能喂饱全部 83 张卡；没有哪张牌会变成
 * 点不开的死牌。返回值里的 `key` 是 `G.qSeen` 的分桶键，两条路互不串号。
 */
export function poolFor(topic: string): { key: string; list: Question[] } {
  const own = questionsFor(topic);
  return own.length
    ? { key: topic, list: own }
    : { key: GLOBAL_QKEY, list: allQuestions() };
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

/**
 * 载入外部题库：**只校验格式，不校验主题**。
 *
 * 解析层把不合规的题收进 `issues`，这里有任何一条就整体拒绝并把前几条
 * 原样报出来（静默丢题会让写题人以为题写进去了）。校验失败时原题库
 * 原封不动，不会出现「一半是新题、一半是旧题」的中间状态。
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

  BANK = next;
  const pools = Object.keys(next.byTopic).length;
  return {
    ok: true,
    msg: `载入「${next.name}」：${total} 道题 / ${pools} 个题池。`
      + `卡池仍是内置的 ${CATALOG.length} 张卡；题目按主题优先，没匹配到就从全部题目里抽。`,
  };
}
