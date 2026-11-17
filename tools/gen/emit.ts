/**
 * 题目 → 题库 DSL。这是生成链路的**唯一出口**。
 *
 * 为什么不让模型直接吐 DSL：模型会在答案字母上越界、会漏 `! 固定顺序`、
 * 会把选项写成三个。这些正是 `core/library/parse.ts` 解析期要拒绝的东西，
 * 所以这里只收结构化数据，纹理由代码生成；生成的文本再喂回同一个解析器
 * 复验一遍 —— **模型写内容，代码保证格式**。
 */
import { parseQuestionBank } from '../../src/core/library';
import type { Question } from '../../src/core/model';

/** 模型该产出、也只该产出的东西。 */
export interface GenQuestion {
  /** 概念主键：同主题内唯一，题号按它派生。 */
  concept: string;
  stem: string;
  options: string[];
  /** 0 基下标。 */
  answer: number;
  explain?: string;
  noShuffle?: boolean;
}

export interface GenTopic {
  topic: string;
  questions: GenQuestion[];
}

const letter = (i: number) => String.fromCharCode(65 + i);

/** 一道题渲染成 DSL 行；`~ 概念` 一定写，否则题号会跟着题干漂。 */
export function emitQuestion(q: GenQuestion): string {
  const out = [`### ${q.stem.trim()}`, `~ ${q.concept.trim()}`];
  q.options.forEach((o, i) => out.push(`${letter(i)}) ${o.trim()}`));
  out.push(`= ${letter(q.answer)}`);
  if (q.noShuffle) out.push('! 固定顺序');
  if (q.explain?.trim()) out.push(`+ ${q.explain.trim()}`);
  return out.join('\n');
}

export function emitPack(name: string, topics: GenTopic[]): string {
  const blocks = [`# ${name}`];
  for (const t of topics) {
    if (!t.questions.length) continue;
    blocks.push(`## ${t.topic}`);
    for (const q of t.questions) blocks.push(emitQuestion(q));
  }
  return blocks.join('\n\n') + '\n';
}

export interface PackCheck {
  ok: boolean;
  /** 解析器报的格式问题，带行号。 */
  issues: string[];
  /** 每题一道，按 `qid` 索引：题号 → 题干，用来发现「换了概念却没换号」。 */
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
 * 当前题库里 `qid → 概念`。
 *
 * 玩家导出的快照按 qid 记，并进记忆要按概念记，中间这一步就在这里。
 * 没写 `~` 的老题不进表：它们的号跟着题干走，映射过去也会错。
 */
export function conceptByQid(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const bank = parseQuestionBank(text);
  for (const topic of Object.keys(bank.byTopic)) {
    for (const q of bank.byTopic[topic]) if (q.concept) out[q.qid] = q.concept;
  }
  return out;
}
