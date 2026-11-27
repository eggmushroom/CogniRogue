/**
 * 题目 → 题库 DSL。这是生成链路的**唯一出口**。
 *
 * 为什么不让模型直接吐 DSL：模型会在答案字母上越界、会漏 `! 固定顺序`、
 * 会把选项写成三个。这些正是 `core/library/parse.ts` 解析期要拒绝的东西，
 * 所以这里只收结构化数据，纹理由代码生成；生成的文本再喂回同一个解析器
 * 复验一遍 —— **模型写内容，代码保证格式**。
 */
import { parseQuestionBank } from '../../src/core/library';
import { topicHeading } from '../../src/core/library/parse';
import type { Question } from '../../src/core/model';
import { closesFence, codeFence } from '../../src/core/library/markdown';

/** 已经程序规范化的题目。 */
export interface GenQuestion {
  /** 稳定知识点 ID：同一知识点的变式题共用。 */
  knowledgeId: string;
  knowledgeLabel?: string;
  qid: string;
  stem: string;
  options: string[];
  /** 0 基下标。 */
  answer: number;
  explain?: string;
  noShuffle?: boolean;
  /** 审核时实际提供的原文章节，仅存于服务侧，不渲染进游戏题库。 */
  sectionIds?: string[];
}

export interface GenTopic {
  topic: string;
  topicId?: string;
  questions: GenQuestion[];
}

const letter = (i: number) => String.fromCharCode(65 + i);
const field = (marker: string, value: string) => {
  const rows = value.trim().split(/\r?\n/);
  return rows.length === 1 ? `${marker} ${rows[0]}` : [marker, ...rows.map((row) => row ? `  ${row}` : '')].join('\n');
};

/** 一道题渲染成 DSL 行；`~ 概念` 一定写，否则题号会跟着题干漂。 */
export function emitQuestion(q: GenQuestion): string {
  const out = [field('###', q.stem), `~ ${q.knowledgeId.trim()}`, `^ ${q.qid}`];
  q.options.forEach((o, i) => out.push(field(`${letter(i)})`, o)));
  out.push(`= ${letter(q.answer)}`);
  if (q.noShuffle) out.push('! 固定顺序');
  if (q.explain?.trim()) out.push(field('+', q.explain));
  return out.join('\n');
}

export function emitPack(name: string, topics: GenTopic[]): string {
  const blocks = [`# ${name}`];
  for (const t of topics) {
    if (!t.questions.length) continue;
    blocks.push(`## ${t.topic}${t.topicId ? ` <!-- topic: ${t.topicId} -->` : ''}`);
    for (const q of t.questions) blocks.push(emitQuestion(q));
  }
  return blocks.join('\n\n') + '\n';
}

/** 保留原来的章节顺序与题号；生成主题只按 ID 合并。 */
export function appendPack(existing: string, delta: string): string {
  if (!existing.trim()) return delta;

  const split = (text: string) => {
    const lines = text.trimEnd().split(/\r?\n/);
    const title = lines.shift() ?? '# 生成的题库';
    const preamble: string[] = [];
    const order: string[] = [];
    const topics = new Map<string, string[]>();
    const headings = new Map<string, string>();
    let current = '';
    let fence: string | undefined;
    for (const line of lines) {
      if (!fence && line.startsWith('## ')) {
        current = topicHeading(line.slice(3)).id;
        headings.set(current, line);
        if (!topics.has(current)) {
          order.push(current);
          topics.set(current, []);
        }
      } else if (current) {
        topics.get(current)!.push(line);
      } else {
        preamble.push(line);
      }
      if (fence) {
        if (closesFence(line, fence)) fence = undefined;
      } else {
        fence = codeFence(line.replace(/^(?:###|\?|[A-Za-z][).、:：]|\+) +/, ''))?.[2];
      }
    }
    return { title, preamble, order, topics, headings };
  };

  const base = split(existing);
  const added = split(delta);
  for (const topic of added.order) {
    const body = added.topics.get(topic)!;
    base.headings.set(topic, added.headings.get(topic)!);
    if (!base.topics.has(topic)) {
      base.order.push(topic);
      base.topics.set(topic, body);
    } else {
      base.topics.get(topic)!.push('', ...body);
    }
  }

  const sections = base.order.map((topic) => {
    const body = base.topics.get(topic)!.join('\n').trim();
    return [base.headings.get(topic), body].filter(Boolean).join('\n\n');
  });
  return [base.title, ...base.preamble, ...sections].join('\n\n').trimEnd() + '\n';
}

export interface PackCheck {
  ok: boolean;
  /** 解析器报的格式问题，带行号。 */
  issues: string[];
  /** 每题一道，按 `qid` 索引：题号 → 题干，用来发现单题 ID 重复。 */
  byQid: Record<string, string>;
  count: number;
}

/**
 * 复验：把渲染出来的文本喂回**游戏自己的**解析器。
 *
 * 这是整条链路的质量闸门 —— 生成器没有第二套格式定义，
 * 所以"能过 parse.ts"就等于"游戏里一定能载入"。
 */
export function checkPack(text: string): PackCheck {
  const bank = parseQuestionBank(text);
  const byQid: Record<string, string> = {};
  let count = 0;
  for (const topic of Object.keys(bank.byTopic)) {
    for (const q of bank.byTopic[topic]) {
      byQid[q.qid] = q.q;
      count += 1;
    }
  }
  return { ok: bank.issues.length === 0, issues: bank.issues, byQid, count };
}

/** 便于把解析结果按主题摊平，做"该出的题都出出来了"这类比对。 */
export function countByTopic(text: string): Record<string, Question[]> {
  return parseQuestionBank(text).byTopic;
}

/**
 * 当前题库里 `qid → knowledgeId`。
 *
 * 玩家导出的快照按 qid 记，并进记忆按 knowledgeId 汇总，中间这一步就在这里。
 * 没写 `~` 的老题不进表：它们的号跟着题干走，映射过去也会错。
 */
export function knowledgeIdByQid(questions: readonly Question[]): Record<string, string> {
  return Object.fromEntries(questions.flatMap(q => q.knowledgeId ? [[q.qid, q.knowledgeId]] : []));
}
