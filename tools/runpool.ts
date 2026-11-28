import { readFileSync } from 'node:fs';
import { parseAnyQuestionBank } from '../src/core/library/parse';
import { selectRunQuestions } from '../src/core/library/pool';

interface Input {
  text: string;
  action?: 'inspect' | 'find-question';
  topic?: string;
  qid?: string;
  topics?: string[];
  retired?: string[];
  quota?: number;
}

const input = JSON.parse(readFileSync(0, 'utf8')) as Input;
const bank = parseAnyQuestionBank(input.text);
if (input.action === 'inspect') {
  const topics = Object.keys(bank.byTopic).map((title) => ({ title, count: bank.byTopic[title]?.length ?? 0 }));
  process.stdout.write(JSON.stringify({ name: bank.name, topics, total: topics.reduce((n, row) => n + row.count, 0), issues: bank.issues }));
  process.exit(0);
}
if (input.action === 'find-question') {
  const q = (bank.byTopic[input.topic ?? ''] ?? []).find((row) => row.qid === input.qid);
  process.stdout.write(JSON.stringify({ question: q ? { stem: q.q, options: q.options, answer: q.answer } : null }));
  process.exit(0);
}
const retired = new Set(input.retired ?? []);
const quota = Math.max(1, Math.min(100, Math.floor(input.quota ?? 20)));
const questions = selectRunQuestions(Object.values(bank.byTopic).flat(), input.topics ?? [],
  (question) => retired.has(question.qid), quota);

process.stdout.write(JSON.stringify({ questions }));
