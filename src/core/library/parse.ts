import type { QLevel, Question, QuestionBank } from '../model/types';

/**
 * 题库 DSL：纯文本。
 *
 *   # 题库名                 可选
 *   ## 任意主题              可选，题池名不校验
 *   ### 题干
 *   A) 选项 / B) 选项
 *   = B                      答案字母
 *   + 解析                   可选
 *   ? 同一池的另一道题        `? 理解:` 前缀存成 `level`
 *
 * 主题不限，格式要过：题干非空、2–4 个选项、答案在范围内。
 * 违规题进 `issues`，由 `loadQuestionBank` 整体拒绝。
 * 每题生成稳定题号 `qid`（主题 + 规范化题干的 hash）。
 * `@ 卡名` / `% 攻 挡 效果` 是旧包遗留行，解析时忽略。
 * 卡面在 `cards/catalog.ts`，导入题库换不掉卡池。
 */

/** 写题人用的中文标签 → 认知层级。没写标签的旧题保持 undefined。 */
const Q_LEVEL: Record<string, QLevel> = {
  识记: 'recall', 回忆: 'recall',
  理解: 'understand', 应用: 'understand',
  迁移: 'transfer', 挑战: 'transfer', 进阶: 'transfer', 变式: 'transfer',
};

export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 4;
/** 界面上给写题人的一句话格式说明。 */
export const QUESTION_FORMAT = `每道题要有非空题干、${MIN_OPTIONS}–${MAX_OPTIONS} 个选项、= 答案字母（不能越过选项数）`;

/** 题干里的空白不该影响题号：同一个知识点换行/多空格仍然指回同一道题。 */
const normStem = (s: string) => s.trim().replace(/\s+/g, ' ');

/**
 * FNV-1a。题号只要「同题同号、异题不同号」，不需要加密强度。
 */
function hash32(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** 题号 = 主题 + 规范化题干。主题相同的两道同题干题会被 `push` 去重。 */
export const questionId = (topic: string, stem: string): string =>
  `q_${hash32(topic + '\u0000' + normStem(stem))}`;

const newQ = (s: string): Question => ({ qid: '', topic: '', q: s, options: [], answer: -1, explain: '' });

/** 一道题合不合格（只看格式），返回 null 表示合格。 */
function diagnose(q: Question | null, lineNo: number): string | null {
  if (!q) return null;
  const tag = `第 ${lineNo} 行「${(q.q.trim() || '(无题干)').slice(0, 16)}」`;
  if (!q.q.trim()) return `${tag}：缺少题干，选项要写在 ### 或 ? 之后`;
  if (q.options.length < MIN_OPTIONS || q.options.length > MAX_OPTIONS) {
    return `${tag}：有 ${q.options.length} 个选项，需要 ${MIN_OPTIONS}–${MAX_OPTIONS} 个`;
  }
  if (q.options.some((o) => !o.trim())) return `${tag}：有空选项`;
  if (q.answer < 0) return `${tag}：缺少 = 答案字母`;
  if (q.answer >= q.options.length) {
    const letter = String.fromCharCode(65 + q.answer);
    return `${tag}：答案 ${letter} 超出 ${q.options.length} 个选项的范围`;
  }
  return null;
}

/** 把一道合格的题放进题池；同主题重复题干只保留第一道。 */
function push(bank: QuestionBank, topic: string, q: Question) {
  q.topic = topic;
  q.qid = questionId(topic, q.q);
  const pool = (bank.byTopic[topic] ??= []);
  if (!pool.some((x) => x.qid === q.qid)) pool.push(q);
}

export function parseQuestionBank(text: string): QuestionBank {
  const bank: QuestionBank = { name: '未命名题库', byTopic: {}, issues: [] };
  let topic = '未分类';
  let q: Question | null = null;
  let qLine = 0;

  const flushQ = () => {
    if (q) {
      const issue = diagnose(q, qLine);
      if (issue) bank.issues!.push(issue);
      else push(bank, topic, q);
    }
    q = null;
  };

  let lineNo = 0;
  for (const raw of text.split(/\r?\n/)) {
    lineNo++;
    const line = raw.trim();
    if (!line || line.startsWith('>')) continue;

    if (line.startsWith('# ')) { flushQ(); bank.name = line.slice(2).trim(); continue; }
    // `##` 是可选分组：名字随便写，空缺就回落到「未分类」
    if (line.startsWith('## ')) {
      flushQ();
      topic = line.slice(3).trim() || '未分类';
      continue;
    }

    // `###` 与 `?` 都只是「这个池里的下一道题」，不再是"一张卡"
    if (line.startsWith('### ') || line.startsWith('? ')) {
      flushQ();
      qLine = lineNo;
      const s = line.startsWith('? ') ? line.slice(2).trim() : line.slice(4).trim();
      const m = s.match(/^(识记|理解|迁移|回忆|应用|挑战|进阶|变式)\s*[:：]\s*(.+)$/);
      q = newQ(m ? m[2].trim() : s);
      if (m) q.level = Q_LEVEL[m[1]];
      continue;
    }

    const om = line.match(/^([A-Za-z])[).、:：]\s*(.+)$/);
    if (om) {
      // 题干没写就先落选项：造一个空题干的题，让 diagnose 报出「缺少题干」
      (q ??= newQ('')).options.push(om[2].trim());
      if (!q.q) qLine = lineNo;
      continue;
    }

    const am = line.match(/^=\s*([A-Za-z])/);
    if (am) {
      if (q) q.answer = am[1].toUpperCase().charCodeAt(0) - 65;
      else bank.issues!.push(`第 ${lineNo} 行：= 答案字母前面没有题目`);
      continue;
    }

    if (line.startsWith('+ ')) { if (q) q.explain = line.slice(2).trim(); continue; }

    // 旧知识包的卡面行：卡面现在内置，这些行不影响任何东西
    if (line.startsWith('@ ') || line.startsWith('% ')) continue;
  }
  flushQ();
  return bank;
}

/** 也吃 JSON，方便脚本生成题库。主题同样不设白名单。 */
export function parseAnyQuestionBank(text: string): QuestionBank {
  const t = text.trim();
  if (!t.startsWith('{')) return parseQuestionBank(t);

  type JsonQ = Partial<Question>;
  type JsonCard = { topic?: string; qs?: JsonQ[]; tiers?: JsonQ[]; q?: string; options?: string[]; answer?: number; explain?: string };
  const j = JSON.parse(t) as {
    name?: string;
    /** 主题 → 题目数组。键名任意，也可以只有一个未分类池 */
    byTopic?: Record<string, JsonQ[]>;
    /** 老格式：卡片自带题库。按 topic 汇总，卡面定义一概丢弃 */
    cards?: JsonCard[];
  };
  if (!j.byTopic && !Array.isArray(j.cards)) {
    throw new Error('JSON 需要 byTopic 对象或 cards 数组');
  }

  const bank: QuestionBank = { name: j.name ?? '自定义题库', byTopic: {}, issues: [] };

  const normalize = (list: JsonQ[], topic: string, where: string): Question[] => {
    const out: Question[] = [];
    (list ?? []).forEach((x, i) => {
      const q: Question = {
        qid: '', topic,
        q: x.q ?? '', options: x.options ?? [], answer: x.answer ?? -1,
        explain: x.explain ?? '', level: x.level,
      };
      const issue = diagnose(q, 0);
      if (issue) bank.issues!.push(`${where}[${i}]：${issue.slice(issue.indexOf('：') + 1)}`);
      else {
        q.qid = questionId(topic, q.q);
        if (!out.some((y) => y.qid === q.qid)) out.push(q);
      }
    });
    return out;
  };

  if (j.byTopic) {
    for (const topic of Object.keys(j.byTopic)) {
      const pool = normalize(j.byTopic[topic] ?? [], topic, `byTopic.${topic}`);
      if (pool.length) bank.byTopic[topic] = pool;
    }
  } else {
    const byTopic: Record<string, JsonQ[]> = {};
    for (const c of j.cards!) {
      const topic = c.topic ?? '未分类';
      const raw = c.qs?.length ? c.qs : c.tiers?.length ? c.tiers
        : [{ q: c.q, options: c.options, answer: c.answer, explain: c.explain }];
      (byTopic[topic] ??= []).push(...raw);
    }
    for (const topic of Object.keys(byTopic)) {
      const pool = normalize(byTopic[topic], topic, `cards[${topic}]`);
      if (pool.length) bank.byTopic[topic] = pool;
    }
  }
  return bank;
}
