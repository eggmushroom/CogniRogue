import type { Question, QuestionBank } from '../model/types';
import { closesFence, codeFence } from './markdown';

/**
 * 题库 DSL：纯文本。
 *
 *   # 题库名                 可选
 *   ## 任意主题              可选，题池名不校验
 *   ### 题干
 *   ~ 知识点 ID              可选：不同题可以共用
 *   ^ q_题号                 可选：缺省时按主题和题干派生
 *   A) 选项 / B) 选项
 *   = B                      答案字母
 *   + 解析                   可选
 *   ! 固定顺序               可选：选项语义依赖位置，出题时不打乱
 *   ? 同一池的另一道题        `? 理解:` 这类前缀会被剥掉，只留题干
 *
 * 题干、选项、解析可以续行：比字段标记再缩进两个空格，多出的缩进属于 Markdown。
 * 围栏内的行不作 DSL 标记处理。
 *
 * 主题不限，格式要过：题干非空、2–4 个选项、答案在范围内。
 * 选项顺序默认每局打乱（免得玩家背字母）；含「以上都对」这类位置依赖
 * 选项的题必须自己写 `! 固定顺序`，解析器在校验期就拒绝没声明的题，
 * 而不是等出题时靠正则猜选项文案。
 * 违规题进 `issues`，由 `loadQuestionBank` 整体拒绝。
 * 逐题作答记录按 `qid`，生成器按 `knowledgeId` 汇总复练记录。
 * `@ 卡名` / `% 攻 挡 效果` 是旧包遗留行，解析时忽略。
 * 卡面在 `cards/catalog.ts`，导入题库换不掉卡池。
 */

export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 4;
/** 界面上给写题人的一句话格式说明。 */
export const QUESTION_FORMAT = `每道题要有非空题干、${MIN_OPTIONS}–${MAX_OPTIONS} 个选项、= 答案字母（不能越过选项数）；选项里有「以上都对」这类依赖位置的写法时，必须写「! 固定顺序」`;

/** 题干里的排版空白不该影响缺省题号。 */
const normStem = (s: string) => s.trim().replace(/\s+/g, ' ');

/**
 * 位置依赖选项的**校验提示**，不是出题策略。解析期拿它要求作者显式写
 * `! 固定顺序`；出题视图只认 Question.noShuffle，不读选项文本。
 */
const POSITIONAL_HINT = /^(以上|下述|前面|全都|全部都是|以上皆|以上均|其余|其他都)/;

/**
 * FNV-1a。题号只要「同题同号、异题不同号」，不需要加密强度。
 */
export function hash32(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export const questionId = (topic: string, stem: string): string =>
  `q_${hash32(topic + '\u0000' + normStem(stem))}`;

/** Generated packs carry an identity; hand-authored groups can still be plain headings. */
export function topicHeading(value: string) {
  const match = /^(.*?)\s+<!-- topic: (t_[a-f0-9]{24}) -->$/.exec(value.trim());
  const title = (match ? match[1].trim() : value.trim()) || '未分类';
  return { id: match?.[2] ?? title, title };
}

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
  if (q.options.some((o) => POSITIONAL_HINT.test(o)) && !q.noShuffle) {
    return `${tag}：有依赖位置的选项，但未写「! 固定顺序」——打乱后会变成错题`;
  }
  if (q.knowledgeId !== undefined && !q.knowledgeId.trim()) return `${tag}：~ 后面要写知识点 ID`;
  return null;
}

/** 把一道合格的题放进题池；只按单题 qid 去重。 */
function push(bank: QuestionBank, topic: string, q: Question, seen: Set<string>, where: string) {
  q.topic = topic;
  const explicit = !!q.qid;
  q.qid ||= questionId(topic, q.q);
  if (seen.has(q.qid)) {
    if (explicit) bank.issues.push(`${where}：题号 ${q.qid} 重复`);
    return;
  }
  seen.add(q.qid);
  (bank.byTopic[topic] ??= []).push(q);
}

export function parseQuestionBank(text: string): QuestionBank {
  const bank: QuestionBank = { name: '未命名题库', byTopic: Object.create(null), issues: [] };
  let topic = '未分类';
  let topicTitle: string | undefined;
  let q: Question | null = null;
  let qLine = 0;
  let append: ((line: string) => void) | undefined;
  const seen = new Set<string>();
  let fieldIndent = 0;
  let fence: { marker: string; indent: number; line: number } | undefined;
  const openFence = (value: string, indent: number, line: number) => {
    const match = codeFence(value);
    if (match) fence = { marker: match[2], indent, line };
  };

  const flushQ = () => {
    if (q) {
      q.q = q.q.trim();
      q.options = q.options.map((option) => option.trim());
      q.explain = q.explain.trim();
      const issue = diagnose(q, qLine);
      if (issue) bank.issues.push(issue);
      else push(bank, topic, q, seen, `第 ${qLine} 行`);
    }
    q = null;
    append = undefined;
  };

  let lineNo = 0;
  for (const raw of text.split(/\r?\n/)) {
    lineNo++;
    const leading = raw.match(/^ */)![0].length;
    if (fence) {
      const content = raw.slice(Math.min(fence.indent, leading));
      append?.(content);
      if (closesFence(content, fence.marker)) fence = undefined;
      continue;
    }
    if (append && (leading >= fieldIndent + 2 || codeFence(raw))) {
      const indent = leading >= fieldIndent + 2 ? fieldIndent + 2 : Math.min(fieldIndent, leading);
      const content = raw.slice(indent);
      append(content);
      openFence(content, indent, lineNo);
      continue;
    }
    const line = raw.trim();
    if (!line || line.startsWith('>')) {
      if (!line) append?.('');
      continue;
    }

    if (line.startsWith('# ')) { flushQ(); bank.name = line.slice(2).trim(); continue; }
    // `##` 是可选分组：名字随便写，空缺就回落到「未分类」
    if (line.startsWith('## ')) {
      flushQ();
      const heading = topicHeading(line.slice(3));
      topic = heading.id;
      topicTitle = heading.title;
      continue;
    }

    // `###` 与 `?` 都只是「这个池里的下一道题」，不再是"一张卡"
    if (line === '###' || line.startsWith('### ') || line.startsWith('? ')) {
      flushQ();
      qLine = lineNo;
      const s = line.startsWith('? ') ? line.slice(2).trim() : line.slice(4).trim();
      const m = s.match(/^(识记|理解|迁移|回忆|应用|挑战|进阶|变式)\s*[:：]\s*(.+)$/);
      q = newQ(m ? m[2].trim() : s);
      if (topicTitle && topicTitle !== topic) q.topicTitle = topicTitle;
      const question = q;
      fieldIndent = leading;
      append = (value) => { question.q += '\n' + value; };
      openFence(q.q, leading, lineNo);
      continue;
    }

    const om = line.match(/^([A-Za-z])[).、:：](?:\s*(.+))?$/);
    if (om) {
      // 题干没写就先落选项：造一个空题干的题，让 diagnose 报出「缺少题干」
      const options = (q ??= newQ('')).options;
      const index = options.push(om[2]?.trim() ?? '') - 1;
      fieldIndent = leading;
      append = (value) => { options[index] += '\n' + value; };
      openFence(options[index], leading, lineNo);
      if (!q.q) qLine = lineNo;
      continue;
    }

    const am = line.match(/^=\s*([A-Za-z])/);
    if (am) {
      append = undefined;
      if (q) q.answer = am[1].toUpperCase().charCodeAt(0) - 65;
      else bank.issues.push(`第 ${lineNo} 行：= 答案字母前面没有题目`);
      continue;
    }

    if (line === '+' || line.startsWith('+ ')) {
      if (q) {
        const question = q;
        question.explain = line.slice(2).trim();
        fieldIndent = leading;
        append = (value) => { question.explain += '\n' + value; };
        openFence(question.explain, leading, lineNo);
      }
      continue;
    }

    if (line.startsWith('! ')) {
      append = undefined;
      const flag = line.slice(2).trim();
      if (flag !== '固定顺序') {
        bank.issues.push(`第 ${lineNo} 行：未知标记「! ${flag}」，只认「! 固定顺序」`);
      } else if (q) {
        q.noShuffle = true;
      } else {
        bank.issues.push(`第 ${lineNo} 行：! 固定顺序 前面没有题目`);
      }
      continue;
    }

    if (line.startsWith('~') || line.startsWith('^')) {
      append = undefined;
      const value = line.slice(1).trim();
      if (!q || !value) bank.issues.push(`第 ${lineNo} 行：${line[0]} 需要跟在题目后并填写 ID`);
      else if (line.startsWith('~')) q.knowledgeId = value;
      else q.qid = value;
      continue;
    }

    // 旧知识包的卡面行：卡面现在内置，这些行不影响任何东西
    if (line.startsWith('@ ') || line.startsWith('% ')) continue;
  }
  if (fence) bank.issues.push(`第 ${fence.line} 行：代码块未闭合`);
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
  const seen = new Set<string>();

  const normalize = (list: JsonQ[], topic: string, where: string): void => {
    (list ?? []).forEach((x, i) => {
      const q: Question = {
        qid: x.qid ?? '', topic,
        knowledgeId: x.knowledgeId,
        q: x.q ?? '', options: x.options ?? [], answer: x.answer ?? -1,
        explain: x.explain ?? '', noShuffle: x.noShuffle,
      };
      const issue = diagnose(q, 0);
      if (issue) bank.issues.push(`${where}[${i}]：${issue.slice(issue.indexOf('：') + 1)}`);
      else push(bank, topic, q, seen, `${where}[${i}]`);
    });
  };

  if (j.byTopic) {
    for (const topic of Object.keys(j.byTopic)) {
      normalize(j.byTopic[topic] ?? [], topic, `byTopic.${topic}`);
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
      normalize(byTopic[topic], topic, `cards[${topic}]`);
    }
  }
  return bank;
}
