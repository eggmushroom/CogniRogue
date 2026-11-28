import { throws } from 'node:assert/strict';
import { mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
/**
 * 生成工具里**确定性**的那一半：切分与取数。
 *
 * 跑 `npm run gencheck`；它不碰网络、不碰随机，所以是 `npm run verify` 的一道门。
 * 模型那一段验不了"生成得好不好"，但"切得对不对"必须验 —— 切错了，
 * 再好的模型也只是在错误的上下文里编题。
 */
import {
  DEFAULT_BUDGET, blocksOf, chunkMarkdown, paragraphsOf, readSection, sliceLines, splitText, tocText,
} from './chunk';
import {
  AGENTIC_MERGE_MAX_CHARS, agenticPlan, firstSentence, pageRange, titledPlan, tocPlan,
} from './plan';
import type { PlanTopic } from './plan';
import { AGENTIC_OVERLAP_CHARS, AGENTIC_WINDOW, MAX_AGENTIC_WINDOW, MIN_AGENTIC_WINDOW } from '../../src/core/model/plan';
import { appendPack, checkPack, knowledgeIdByQid, countByTopic, emitPack } from './emit';
import { parseQuestionBank } from '../../src/core/library/parse';
import { sendAnswers, serviceBase, setServiceBase } from '../../src/core/library/remote';
import { tickJobs, watchJob } from '../../src/scenes/jobstate';
import { generateTopic } from './generate';
import { LlmRequestError, modelFailureCode, openAiLlm, reviewConfigFromEnv, type Llm } from './llm';
import { parseReviewReply, reviewQuestion, reviewQuestions } from './review';
import { changedTopicMemFiles, readTopicMem, sourceIndexFile } from './memory';
import { indexTopicMemory, knowledgeProgress, memText, mergeSnapshot, newTopicMem, readMemorySection, recordApprovedQuestions, sourceIndexText, sourceSectionId, syncBankQuestions, topicIdOf } from './memory';

let fails = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) fails += 1;
};

// A successful retry still needs both request attempts under the same question span.
{
  const fetch = globalThis.fetch;
  const log = console.log;
  const context = { COG_TRACE_ID: 'a'.repeat(32), COG_JOB_ID: 'job-test', COG_PARENT_SPAN_ID: 'b'.repeat(16) };
  const previous = Object.fromEntries(Object.keys(context).map((key) => [key, process.env[key]]));
  const events: Array<{ traceId: string; name: string; spanId: string; parentSpanId: string;
    event: string; outcome?: string; attrs: Record<string, unknown> }> = [];
  let calls = 0;
  try {
    Object.assign(process.env, context);
    console.log = (line: string) => { if (line.startsWith('@@trace ')) events.push(JSON.parse(line.slice(8))); };
    globalThis.fetch = async () => {
      if (++calls === 1) throw new DOMException('test-token', 'TimeoutError');
      return Response.json({ choices: [{ message: { content: '1' } }], usage: { prompt_tokens: 15, completion_tokens: 1 } },
        { headers: { 'x-request-id': 'provider-test' } });
    };
    await reviewQuestions(openAiLlm({ apiKey: 'test-token', baseUrl: 'http://test.invalid', model: 'stub', retries: 1 }), [
      { qid: 'q_trace', stem: '不应进入 trace 的题干', options: ['甲', '乙'], answer: 0,
        sources: [{ sectionId: 'sec_trace', text: '不应进入 trace 的原文' }] },
    ]);
  } finally {
    globalThis.fetch = fetch;
    console.log = log;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  const question = events.find((event) => event.name === 'question.review' && event.event === 'start');
  const requests = events.filter((event) => event.name === 'model.request');
  const serial = JSON.stringify(events);
  ok(question?.attrs.qid === 'q_trace' && question.parentSpanId === context.COG_PARENT_SPAN_ID
    && events.every((event) => event.traceId === context.COG_TRACE_ID)
    && requests.length === 4 && requests.every((event) => event.parentSpanId === question.spanId)
    && requests[0]?.attrs.retry === 0 && requests[1]?.attrs.errorKind === 'timeout'
    && requests[2]?.attrs.retry === 1 && requests[3]?.outcome === 'ok'
    && requests[3]?.attrs.inputTokens === 15 && requests[3]?.attrs.providerRequestId === 'provider-test'
    && events.at(-1)?.outcome === 'pass' && !serial.includes('test-token') && !serial.includes('不应进入 trace'),
  'Trace：审核超时后重试成功，两次请求用同一逐题 span 串联，且仅记录诊断字段');
}

// 审核配置留空时安全回退到生成模型；显式审核配置仍可逐项覆盖。
const fallbackReview = reviewConfigFromEnv({ GEN_API_KEY: 'gen-key', GEN_BASE_URL: 'https://gen.example/v1', GEN_MODEL: 'gen-model' });
ok(fallbackReview.apiKey === 'gen-key' && fallbackReview.baseUrl === 'https://gen.example/v1' && fallbackReview.model === 'gen-model',
  '审核未单独配置时沿用生成模型凭据、地址和模型');
const overrideReview = reviewConfigFromEnv({ GEN_API_KEY: 'gen-key', GEN_BASE_URL: 'https://gen.example/v1', GEN_MODEL: 'gen-model',
  REVIEW_API_KEY: 'review-key', REVIEW_BASE_URL: 'https://review.example/v1', REVIEW_MODEL: 'review-model' });
ok(overrideReview.apiKey === 'review-key' && overrideReview.baseUrl === 'https://review.example/v1' && overrideReview.model === 'review-model',
  '审核独立配置优先于生成模型配置');

// 审核输出限定为一个字符 0/1；任何额外内容均不得放行。
ok(parseReviewReply('1', 'q_demo').verdict === 'pass' && parseReviewReply('0', 'q_demo').verdict === 'reject',
  '审核契约：只接受 0/1 并映射为通过/拒绝');
ok(['1\n理由：正确', '```json\n1\n```', '{"pass":true}', ' 1 '].every((text) => {
  const result = parseReviewReply(text, 'q_demo');
  return result.verdict === 'pending' && result.issue === 'invalid-output';
}), '审核契约：格式异常标为待审，不当作 0');
let reviewPrompt = '';
const reviewFixture = { qid: 'q_demo', stem: '题目', options: ['甲', '乙'], answer: 0,
  sources: [{ sectionId: 'sec_a', text: '原文\n  保留格式' }] };
const reviewed = await reviewQuestion({ ask: async (system, user) => {
  reviewPrompt = `${system}\n${user}`;
  return '1';
} }, reviewFixture);
ok(reviewed.verdict === 'pass' && reviewPrompt.includes('一个字符')
  && reviewPrompt.includes(`"sourceSections":${JSON.stringify(reviewFixture.sources)}`),
  '审核调用要求只输出 0/1，并提交保留格式的章节原文');
const unavailable = await reviewQuestion({ ask: async () => { throw new Error('timeout'); } }, reviewFixture);
ok(unavailable.verdict === 'pending' && unavailable.issue === 'request-failed', '请求失败不计为模型拒绝');
{
  const fetch = globalThis.fetch;
  const cfg = { apiKey: 'review-key-for-test', baseUrl: 'http://test.invalid/v1', model: 'stub', jsonMode: false, retries: 0 };
  const attempts = async (retries = 0) => {
    const result = await reviewQuestion(openAiLlm({ ...cfg, retries }), reviewFixture);
    // main.ts writes the review result directly into each question's JSON report.
    return result.verdict === 'pending' && result.issue === 'request-failed' ? result.attempts : undefined;
  };
  try {
    let calls = 0;
    globalThis.fetch = async () => ++calls === 1
      ? Response.json({ error: { code: 'rate_limit', message: `retry later; rejected ${cfg.apiKey} and Bearer echoed-token` } }, { status: 429 })
      : new Response('gateway unavailable', { status: 503 });
    const retried = await attempts(1);
    const stored = JSON.stringify(retried);
    ok(retried?.length === 2 && retried[0]?.kind === 'http' && retried[0].status === 429
      && retried[0].code === 'rate_limit' && retried[0].retry === 0 && retried[1]?.retry === 1
      && retried[1].status === 503 && retried[1].message === 'gateway unavailable'
      && retried.every((item) => item.durationMs >= 0) && stored.includes('retry later')
      && !stored.includes(cfg.apiKey) && !stored.includes('echoed-token'), '审核报告记录 429 和重试后的 503，并对错误内容脱敏');

    globalThis.fetch = async () => { throw new DOMException('deadline', 'TimeoutError'); };
    ok((await attempts())?.[0]?.kind === 'timeout', '审核报告区分请求超时');
    globalThis.fetch = async () => { throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } }); };
    const network = (await attempts())?.[0];
    ok(network?.kind === 'network' && network.code === 'ECONNRESET' && network.status === undefined, '审核报告保留底层网络错误码');

    globalThis.fetch = async () => Response.json({ error: { code: 'overloaded', message: 'over capacity' } });
    const provider = (await attempts())?.[0];
    ok(provider?.kind === 'provider' && provider.status === 200 && provider.code === 'overloaded'
      && provider.message === 'over capacity', '审核报告识别 HTTP 200 中的接口错误');
    globalThis.fetch = async () => new Response('not JSON');
    ok((await attempts())?.[0]?.kind === 'invalid-response', '审核报告区分无法解析的响应');
    globalThis.fetch = async () => Response.json({ choices: [{ message: { content: '' } }] });
    ok((await attempts())?.[0]?.kind === 'empty-response', '审核报告区分空回复');
  } finally {
    globalThis.fetch = fetch;
  }
}
{
  const fetch = globalThis.fetch;
  const cfg = { apiKey: 'tool-key-for-test', baseUrl: 'http://test.invalid/v1', model: 'stub', retries: 1, timeoutMs: 1000 };
  let calls = 0;
  const toolStream = () => new Response(
    'data: ' + JSON.stringify({ choices: [{ delta: { content: 'done' }, finish_reason: null }] }) + '\n\n'
      + 'data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\n'
      + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  try {
    globalThis.fetch = async (_url, init) => {
      calls++;
      const body = JSON.parse(String(init?.body));
      if (calls === 1) throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } });
      return body.stream ? toolStream() : Response.json({ choices: [{ message: { content: 'sync' } }] });
    };
    const result = await openAiLlm(cfg).tool!('system', [{ role: 'user', content: 'read' }], []);
    ok(calls === 2 && result.text === 'done', 'JIT 工具调用遇到瞬时网络错误后会重试并继续');

    calls = 0;
    globalThis.fetch = async () => {
      calls++;
      throw new DOMException('deadline', 'TimeoutError');
    };
    let error = '';
    try { await openAiLlm(cfg).tool!('system', [{ role: 'user', content: 'read' }], []); }
    catch (err) { error = err instanceof Error ? err.message : String(err); }
    ok(calls === 2 && error.includes('timeout') && error.includes('2 次请求'), 'JIT 工具调用超时会有限重试并报告尝试次数');

    calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return Response.json({ code: 'INSUFFICIENT_BALANCE', message: 'Insufficient account balance' }, { status: 403 });
    };
    let balance = '';
    try { await openAiLlm(cfg).tool!('system', [], []); }
    catch (err) {
      if (err instanceof LlmRequestError && err.failures[0]) balance = modelFailureCode(err.failures[0]);
    }
    const review = await reviewQuestion(openAiLlm(cfg), {
      qid: 'balance', stem: 'Question?', options: ['A', 'B'], answer: 0, explain: '', sources: [],
    });
    const reviewFailure = review.verdict === 'pending' && review.issue === 'request-failed' && review.attempts?.[0];
    ok(calls === 2 && balance === 'balance' && !!reviewFailure && modelFailureCode(reviewFailure) === 'balance',
      '出题工具和审核请求都能识别余额不足，且各自只发出一次请求');
  } finally {
    globalThis.fetch = fetch;
  }
}

let reviewActive = 0;
let reviewPeak = 0;
const reviewProgress: number[] = [];
const parallelReviews = await reviewQuestions({ ask: async (_system, user) => {
  reviewActive++;
  reviewPeak = Math.max(reviewPeak, reviewActive);
  const id = (JSON.parse(user) as { qid: string }).qid;
  await new Promise((resolve) => setTimeout(resolve, 5));
  reviewActive--;
  return id.endsWith('bad') ? '0' : '1';
} }, ['a', 'b', 'c', 'bad', 'e'].map((qid) => ({
  ...reviewFixture, qid,
})), 2, (completed) => reviewProgress.push(completed));
ok(reviewProgress.join(',') === '1,2,3,4,5', '并发审核在每道题完成后递增进度');
ok(reviewPeak === 2 && parallelReviews.map((r) => r.qid).join(',') === 'a,b,c,bad,e'
  && parallelReviews[3]?.verdict === 'reject', '批量审核限制并发且保留题目顺序与拒绝结果');

const lines = (...s: string[]) => s.join('\n');

// 有前言、有代码块、有三级标题的小册子
const BOOK = lines(
  '前言：这本小册子只讲三件事。',
  '',
  '# 第一章 复杂度',
  '',
  '## 1.1 二分查找',
  '',
  '在有序数组上二分，每次比较折半。',
  '最坏比较 log2(n) 次。',
  '',
  '```ts',
  '# 这一行是代码注释，不是标题',
  'const mid = (lo + hi) >> 1;',
  '```',
  '',
  '## 1.2 排序',
  '',
  '比较排序的渐进下界是 n log n。',
  '',
  '# 第二章 图',
  '',
  '## 2.1 最短路',
  '',
  'Dijkstra 要求边权非负。',
);

const doc = chunkMarkdown(BOOK);
const indexPlan = tocPlan(BOOK, { name: '测试', depth: 1, size: 4000 })!;
const indexed = newTopicMem(indexPlan.topics[0].title, 'book.md', topicIdOf('book.md', BOOK, indexPlan.topics[0]!));
const sharedParentSource = '# 文档\n\n## 章节\n\n正文';
const siblingTopicA: PlanTopic = { title: '甲主题', from: 2, to: 3, chars: 2, summary: '', summarized: 'none' };
const siblingTopicB: PlanTopic = { title: '乙主题', from: 3, to: 4, chars: 2, summary: '', summarized: 'none' };
ok(topicIdOf('book.md', sharedParentSource, siblingTopicA, true) !== topicIdOf('book.md', sharedParentSource, siblingTopicB, true),
  '同一父标题下不同 agentic 主题生成不同 ID');
const sectionDir = mkdtempSync(join(tmpdir(), 'cognirogue-jit-'));
const sectionFiles = indexTopicMemory(indexed, BOOK, indexPlan.topics[0]);
for (const file of sectionFiles) writeFileSync(join(sectionDir, `${file.id}.md`), file.content, 'utf8');
const sectionId = indexed.sections!.find((section) => section.title === '1.1 二分查找')!.id;
ok(!Object.keys(indexed.knowledge).length && indexed.sections!.length === 3,
  '未生成题目的主题也有独立记忆与完整子节索引');
ok(readMemorySection(indexed, sectionDir, sectionId)!.includes('有序数组')
  && !readMemorySection(indexed, sectionDir, sectionId)!.includes('比较排序'), 'JIT 按 ID 直接读取独立章节文件');
ok(readMemorySection(indexed, sectionDir, sourceSectionId('book.md', ['第一章 复杂度', '2.1 最短路'])) === null,
  'ID 不属于当前主题时不会读取其他主题');
indexed.knowledge.binary = { label: 'binary', stem: '二分', gen: 2, questions: {} };
indexed.cursor = 1;
indexTopicMemory(indexed, BOOK, indexPlan.topics[0]);
ok(indexed.knowledge.binary.gen === 2 && indexed.cursor === 1, '重新划分保留学习记忆与增量游标');
ok(sourceIndexText(indexed).includes(`${sectionId} | 1.1 二分查找`), '主题记忆提供标题与文件 ID 对照表');
{
  const topicId = indexed.topicId;
  const legacyPath = join(sectionDir, `${topicId}.json`);
  const legacy = {
    ...indexed, v: 6, cursor: 4, stats: { qLegacy: { ok: 1, bad: 1, attempts: [2, 1] } },
    knowledge: {
      binary: { ...indexed.knowledge.binary, questions: { qLegacy: {
        stem: '二分', options: ['A', 'B'], answer: 0, sectionIds: [sectionId],
      } } },
    },
  };
  const load = () => readTopicMem(sectionDir, indexed.topic, indexed.source, topicId);
  const catalogPath = join(sectionDir, `${topicId}.questions.json`);
  const progressPath = join(sectionDir, `${topicId}.progress.json`);
  const source = sourceIndexFile(sectionDir, { ...indexed, sections: [{ id: sectionId, title: '新章节标题' }] });
  writeFileSync(legacyPath, JSON.stringify(legacy), 'utf8');
  const original = load();
  ok(original.sections?.length === indexed.sections?.length && original.cursor === 4
    && original.knowledge.binary.questions.qLegacy.sectionIds?.[0] === sectionId, 'v6 单文件完整恢复');

  writeFileSync(source.target, source.content, 'utf8');
  const mem = load();
  ok(mem.sections?.[0]?.title === '新章节标题' && mem.cursor === 4
    && mem.stats.qLegacy.attempts.join(',') === '2,1' && mem.knowledge.binary.gen === 2,
    '只迁移原文索引时，题目目录和作答进度仍从 v6 恢复');
  const migrated = changedTopicMemFiles(sectionDir, mem);
  ok(migrated.length === 2 && migrated[0].target === catalogPath && migrated[1].target === progressPath,
    '首次提交补齐动态记忆，复用原文索引');
  for (const file of migrated) writeFileSync(file.target, file.content, 'utf8');
  ok(changedTopicMemFiles(sectionDir, load()).length === 0, '已落盘且没有变化的组件无需写入');

  mergeSnapshot(mem, { v: 3, topicId, after: 4, through: 6,
    records: [{ seq: 6, type: 'answer', qid: 'qLegacy', right: false, choice: 2 }] }, {});
  const progress = changedTopicMemFiles(sectionDir, mem);
  ok(progress.length === 1 && progress[0].target === progressPath, '仅新增作答时只更新学习进度');
  for (const file of progress) writeFileSync(file.target, file.content, 'utf8');
  const updated = load();
  updated.knowledge.binary.gen++;
  const catalog = changedTopicMemFiles(sectionDir, updated);
  ok(updated.cursor === 6 && updated.stats.qLegacy.attempts.join(',') === '2,1,2'
    && catalog.length === 1 && catalog[0].target === catalogPath, '续读拆分后的游标和作答序列，出题只更新题目目录');
  for (const file of [legacyPath, source.target, catalogPath, progressPath]) unlinkSync(file);
}
const repeated = '# Root\n## Same\nFirst passage.\n## Same\nSecond passage.';
const repeatedPlan = tocPlan(repeated, { name: 'Root', depth: 2, size: 4000 })!;
const repeatedMem1 = newTopicMem('Same', 'repeat.md', topicIdOf('repeat.md', repeated, repeatedPlan.topics[0]!));
const repeatedMem2 = newTopicMem('Same', 'repeat.md', topicIdOf('repeat.md', repeated, repeatedPlan.topics[1]!));
const repeatedFiles1 = indexTopicMemory(repeatedMem1, repeated, repeatedPlan.topics[0]!);
const repeatedFiles2 = indexTopicMemory(repeatedMem2, repeated, repeatedPlan.topics[1]!);
ok(repeatedMem1.topicId !== repeatedMem2.topicId && repeatedFiles1[0]!.id !== repeatedFiles2[0]!.id
  && repeatedFiles1[0]!.content.includes('First passage.') && repeatedFiles2[0]!.content.includes('Second passage.'), '同名主题有不同 ID 与记忆文件');
const paths = doc.toc.map((e) => e.path.join(' > '));

ok(doc.title === '第一章 复杂度', `一级标题当书名（${doc.title}）`);

// 单主题答题流水进入记忆一次；同一批记录重试不会重复计数。
const answerMem = newTopicMem('第一章 复杂度', 'book.md', 't_aaaaaaaaaaaaaaaaaaaaaaaa');
const answerKnowledgeId = 'k_aaaaaaaaaaaaaaaaaaaaaaaa';
answerMem.knowledge[answerKnowledgeId] = { label: '二分查找边界', stem: '二分', gen: 1, questions: {} };
const answerMap = { qA: answerKnowledgeId, qB: answerKnowledgeId };
const feedback = (after: number, rows: Array<{ seq: number; qid: string; type: 'answer' | 'reset'; right?: boolean; choice?: number }>) => ({
  v: 3 as const, topicId: answerMem.topicId, after, through: rows.at(-1)?.seq ?? after, records: rows,
});
mergeSnapshot(answerMem, feedback(0, [
  { seq: 1, qid: 'qA', type: 'answer', right: false, choice: 2 },
  { seq: 2, qid: 'qA', type: 'reset' },
  { seq: 3, qid: 'qB', type: 'answer', right: false, choice: 3 },
  { seq: 4, qid: 'qA', type: 'answer', right: true, choice: 1 },
  { seq: 5, qid: 'qA', type: 'reset' },
]), answerMap);
const learned = answerMem.knowledge[answerKnowledgeId];
const stats = () => Object.values(answerMem.stats).reduce((sum, q) => ({ ok: sum.ok + q.ok, bad: sum.bad + q.bad }), { ok: 0, bad: 0 });
ok(stats().ok === 0 && stats().bad === 1 && answerMem.stats.qB?.attempts[0] === 3, '重复重置 A 不会扣掉同知识点 B 的错误');
ok(answerMem.cursor === 5 && !answerMem.stats.qA, '重置按 qid 清零并推进增量游标');
mergeSnapshot(answerMem, feedback(0, [{ seq: 1, qid: 'qA', type: 'answer', right: false, choice: 2 }]), answerMap);
ok(answerMem.cursor === 5 && stats().bad === 1, '重放旧游标不会重复消费答题流水');
learned!.questions.qB = { stem: '二分题', options: ['左移', '右移'], answer: 1 };
ok(memText(answerMem).includes('正确选项 2') && memText(answerMem).includes('选项选择顺序（1-based，'), '记忆从逐题流水组装正确选项与作答顺序');

// 知识点复用题号关系，掌握状态从所有变式的流水推导。
{
  const mem = newTopicMem('复练策略', 'book.md', answerMem.topicId);
  const question = (knowledgeId: string, qid: string) => ({
    knowledgeId, knowledgeLabel: knowledgeId, qid, stem: qid, options: ['正确', '错误'], answer: 0,
  });
  const initial = [question('待作答例', 'unanswered'), question('学习中例', 'learning'),
    question('已掌握例', 'mastered'), question('轻错例', 'low'), question('高错例', 'high')];
  recordApprovedQuestions(mem, initial);
  recordApprovedQuestions(mem, [initial[4]!, question('高错例', 'variant')]);
  ok(mem.knowledge.高错例.gen === 2 && Object.keys(mem.knowledge.高错例.questions).length === 2,
    '审核通过的新题补到同一知识点，重复题号不会重复计数');
  const answer = (seq: number, qid: string, right: boolean) => ({ seq, qid, type: 'answer' as const, right, choice: right ? 1 : 2 });
  mergeSnapshot(mem, feedback(0, [
    answer(1, 'learning', true), answer(2, 'mastered', true), answer(3, 'mastered', true), answer(4, 'mastered', true),
    answer(5, 'low', false), answer(6, 'high', false), answer(7, 'variant', false),
  ]), {});
  const states = Object.fromEntries(knowledgeProgress(mem).map(row => [row.id, row.state]));
  ok(states.待作答例 === 'unanswered' && states.学习中例 === 'learning' && states.已掌握例 === 'mastered'
    && states.轻错例 === 'review' && states.高错例 === 'review', '按同知识点下逐题流水区分四种学习状态');
  const prompt = memText(mem, 1);
  ok(prompt.includes('本轮优先复练 1 个知识点') && prompt.includes('- 高错例 [') && !prompt.includes('- 轻错例 [')
    && prompt.includes('待作答（1）：待作答例'), '按错误次数排序，复练目标不超过本轮题量');
  const before = JSON.stringify(mem);
  throws(() => mergeSnapshot(mem, feedback(7, [answer(8, 'high', false), answer(8, 'high', false)]), {}), /Invalid feedback order/);
  ok(JSON.stringify(mem) === before, '异常流水整批回滚，已保存的选项和游标保持一致');
  mergeSnapshot(mem, feedback(7, [answer(8, 'variant', true), answer(9, 'variant', true), answer(10, 'variant', true)]), {});
  ok(knowledgeProgress(mem).find(row => row.id === '高错例')?.state === 'mastered'
    && mem.stats.variant.attempts.join(',') === '2,1,1,1', '连续答对后退出待复练，逐题选项顺序完整保留');
}

let feedbackPrompt = '';
const targetedSectionId = sectionId;
const targetedSource = readMemorySection(indexed, sectionDir, targetedSectionId)!;
let feedbackRound = 0;
const feedbackLlm: Llm = {
  ask: async (_system, user) => {
    feedbackPrompt = user;
    feedbackRound++;
    return feedbackRound === 1
      ? JSON.stringify({ read: [targetedSectionId], questions: [] })
      : JSON.stringify({ questions: [{
        knowledge: '第一章 复杂度/二分查找',
        stem: '二分查找每次比较后区间如何变化？',
        options: ['减半', '不变'], answer: 0,
        sectionIds: [targetedSectionId],
      }] });
  },
};
const targeted = await generateTopic({
  topic: '第一章 复杂度', toc: `${targetedSectionId} | 1.1 二分查找`,
  memory: memText(answerMem), per: 1,
  read: (id) => id === targetedSectionId ? targetedSource : null,
}, feedbackLlm);
ok(feedbackPrompt.includes('玩家 0 对 1 错') && targeted.questions[0]?.knowledgeId.startsWith('k_'),
  '单主题增量生成读取重新纳入的答题记忆并允许生成新题号');
ok(targeted.questions[0]?.sectionIds[0] === targetedSectionId && targeted.sources.get(targetedSectionId) === targetedSource,
  '生成题只关联章节 ID，审核原文来自本轮实际读取的文件');
const generated = targeted.questions[0]!;
const stored = newTopicMem('增量测试', 'book.md');
stored.knowledge[generated.knowledgeId] = {
  label: generated.knowledgeLabel!, stem: generated.stem, gen: 1,
  questions: { [generated.qid]: { stem: generated.stem, options: generated.options, answer: generated.answer, sectionIds: generated.sectionIds } },
};
const reloadedPack = parseQuestionBank(emitPack('增量测试', [{ topic: stored.topic, topicId: stored.topicId, questions: [generated] }]));
syncBankQuestions(stored, reloadedPack.byTopic[stored.topicId]!);
ok(stored.knowledge[generated.knowledgeId]!.questions[generated.qid]?.sectionIds?.[0] === targetedSectionId,
  '下一次生成从题库回补旧题时不会擦掉记忆中的原文章节 ID');
ok(paths.length === 5 && paths[0] === '第一章 复杂度' && paths[1] === '第一章 复杂度 > 1.1 二分查找'
  && paths[4] === '第二章 图 > 2.1 最短路',
  `目录按标题层级展开（${paths.length} 条：${paths.join(' / ')}）`);

// 代码块里的 # 一旦被当成标题，这一整段代码就会从正文里消失、还多出一个假章节
ok(!paths.some((p) => p.includes('代码注释')),
  '代码块里的 # 没有变成标题');
ok(doc.chunks.some((c) => c.text.includes('const mid = (lo + hi) >> 1;')),
  '代码块整块留在正文里');

// 前言没有标题，但它也是内容：丢了就是静默少读一段
ok(doc.chunks.some((c) => c.path.length === 0 && c.text.includes('前言')),
  '第一个标题之前的正文没有丢');

// 最要紧的一条：切分只能搬动文本，不能弄丢任何一行
const all = doc.chunks.map((c) => c.text).join('\n');
const content = BOOK.split('\n').filter((l) => l.trim() && !/^#{1,6}\s/.test(l));
const lost = content.filter((l) => !all.includes(l.trim()));
ok(lost.length === 0, `每一行正文都落在某个块里（丢 ${lost.length} 行${lost[0] ? `：${lost[0]}` : ''}）`);

// 超预算的一节按段落装箱：块数变多，但每块都在预算内
const fat = lines('# 大章', '', ...Array.from({ length: 12 }, (_, i) => `第 ${i} 段讲一件事，${'很长的说明'.repeat(6)}。`).flatMap((p) => [p, '']));
const split = chunkMarkdown(fat, 200);
const fatParts = split.chunks.filter((c) => c.path[0] === '大章');
ok(fatParts.length > 1 && fatParts.every((c) => c.size <= 200),
  `超预算的一节被切成 ${fatParts.length} 块，最大 ${Math.max(...fatParts.map((c) => c.size))} 字（预算 200）`);
ok(split.toc.find((e) => e.path[0] === '大章')?.parts === fatParts.length,
  '目录里的块数与实际切出来的块数一致');

// 单段就超预算时只能按行装，仍然不许切断任何一行
const oneLine = 'x'.repeat(500);
const hard = chunkMarkdown(['# 硬章', '', oneLine].join('\n'), 200);
ok(hard.chunks.filter((c) => c.path[0] === '硬章').every((c) => c.text.split('\n').every((l) => oneLine.includes(l))),
  '单段超预算：按行装，不切断行');

// 没有任何标题的笔记也要能读，否则"吞一本散记"直接废掉
const flat = chunkMarkdown(lines('一段话。', '', '另一段话。'), 100);
ok(flat.toc.length === 0 && flat.chunks.length >= 1 && flat.chunks.every((c) => c.path.length === 0),
  `无标题文档回落到单层（${flat.chunks.length} 块）`);

// 纯函数：同样的输入必须给出同样的块，否则 diff 没法 review
ok(JSON.stringify(chunkMarkdown(BOOK)) === JSON.stringify(chunkMarkdown(BOOK)),
  '同一份输入切两次，结果逐字相同');

// JIT 取数：按路径拿到这一节连同子节
const ch1 = readSection(BOOK, ['第一章 复杂度']);
ok(!!ch1 && ch1.includes('二分查找') && ch1.includes('渐进下界'),
  '按路径取一章 = 这一节 + 所有子节');
ok(readSection(BOOK, ['不存在的章']) === null, '取不到的路径返回 null 而不是编一段');

// 书里的章常常只有一行标题，内容全在子节里。只取本节自己的块会拿到空串，
// 而模型照样会"出题"——只是凭空编。所以交给模型的正文必须整章取。
ok(doc.chunks.filter((c) => c.path.join('>') === '第一章 复杂度').length === 0,
  '章的正文为空（内容都在子节里）——取数不能只取本节');
ok(splitText(ch1 ?? '', DEFAULT_BUDGET).length >= 1 && (ch1 ?? '').includes('折半'),
  '整章按预算切开后有正文可喂（不是空串）');

ok(tocText(doc).includes('1.1 二分查找') && tocText(doc).includes('字'),
  '目录能渲染成 agent 读的一段文字');

ok(chunkMarkdown('').chunks.length === 0, '空文档不产生块');
ok(DEFAULT_BUDGET === 6000, `默认预算是 6000 字（${DEFAULT_BUDGET}）`);

// ── 输出层：模型写内容，代码保证格式 ──
const packText = emitPack('自检题库', [{
  topic: '复杂度',
  questions: [
    { knowledgeId: 'algo/binary-worst', qid: 'q_1', stem: '二分最坏比较几次？', options: ['O(1)', 'O(log n)'], answer: 1, explain: '每次折半。' },
    { knowledgeId: 'algo/sort-lower', qid: 'q_2', stem: '比较排序的下界？', options: ['n log n', 'n', '以上都对'], answer: 0, noShuffle: true },
  ],
}]);
const chk = checkPack(packText);
ok(chk.ok && chk.count === 2, `渲染出的题库能过游戏自己的解析器（${chk.count} 道，${chk.issues.length} 条问题）`);
ok(packText.includes('~ algo/binary-worst') && packText.includes('= B'),
  '知识点行、题号和答案字母都由代码写入，不靠模型拼');

const qidMap = knowledgeIdByQid(Object.values(parseQuestionBank(packText).byTopic).flat());
ok(Object.keys(qidMap).length === 2 && Object.values(qidMap).includes('algo/sort-lower'),
  'qid → knowledgeId 映射能把逐题作答归并到知识点');

// ── 一个主题 = 一个子 agent：JIT 取数 + 校验 + 去重（全离线，假模型） ──
const asked: string[] = [];
const generationRules: string[] = [];
let round = 0;
const fake: Llm = {
  ask: async (system, user) => {
    generationRules.push(system);
    asked.push(user);
    round += 1;
    if (round === 1) return JSON.stringify({ read: [sortSectionId, sectionId], questions: [] });
    return JSON.stringify({
      questions: [
        { knowledge: '二分查找最坏情况', stem: '二分查找最坏比几次？', options: ['O(1)', 'O(log n)'], answer: 1, sectionIds: [sectionId] },
        { knowledge: '二分查找最坏情况', stem: '二分查找最坏比几次？', options: ['甲', '乙'], answer: 0 },
        { knowledge: '比较排序下界', stem: '下界？', options: ['n', 'n log n', '以上都对'], answer: 1, sectionIds: [sortSectionId, sortSectionId] },
        { knowledge: 'algo/bad', stem: '答案越界', options: ['甲', '乙'], answer: 5 },
        { knowledge: 'algo/missing', stem: '缺少章节 ID', options: ['甲', '乙'], answer: 0 },
        { knowledge: 'algo/unread', stem: '引用未读章节', options: ['甲', '乙'], answer: 0, sectionIds: ['sec_unread'] },
      ],
    });
  },
};
const sortSectionId = indexed.sections!.find((section) => section.title === '1.2 排序')!.id;
const res = await generateTopic({
  topic: '复杂度',
  toc: sourceIndexText(indexed),
  memory: '（这个主题还没有记忆）',
  per: 6,
  read: (id) => readMemorySection(indexed, sectionDir, id),
}, fake);

ok(res.reads.includes(sortSectionId),
  `JIT：模型通过章节 ID 读取独立原文文件（${res.reads.join(' / ')}）`);
ok(!asked[0].includes('# 已读取的原文') && asked[0].includes('# 本主题的原文索引') && !asked[0].includes('渐进下界'),
  'JIT：首轮只注入目录和记忆，不注入任何正文');
const ungrounded = await generateTopic({
  topic: '复杂度', toc: '复杂度', memory: '', per: 1, read: () => null,
}, { ask: async () => JSON.stringify({ questions: [{ knowledge: 'algo/guess', stem: '猜测', options: ['甲', '乙'], answer: 0 }] }) });
ok(ungrounded.questions.length === 0, 'JIT：没有取到原文时不接受题目');
ok(asked.length === 2 && asked[1].includes('渐进下界'),
  '第二轮把读到的原文追加进了上下文');
ok(generationRules.length === 2 && generationRules[0] === generationRules[1]
  && generationRules[0].includes('生成 6 道') && generationRules[0].includes('"read"')
  && asked.every((message) => !message.includes('"questions"')),
  '兼容模式各轮共享同一套规则，用户消息只承载数据');
// Tool-calling agent asks the service for one exact section; the untouched chapter never enters context.
const toolContexts: string[] = [];
const toolRules: string[] = [];
let toolRound = 0;
const toolAgent: Llm = {
  ask: async () => '',
  tool: async (system, messages, _tools) => {
    toolRules.push(system);
    toolContexts.push(JSON.stringify(messages));
    toolRound++;
    if (toolRound === 1) return { text: '', calls: [{ id: 'read-1', name: 'read_source', arguments: JSON.stringify({ sectionId: sortSectionId }) }] };
    return { text: JSON.stringify({ questions: [{ knowledge: '排序下界', stem: '比较排序下界？', options: ['n', 'n log n'], answer: 1, sectionIds: [sortSectionId] }] }), calls: [] };
  },
};
const toolResult = await generateTopic({ topic: '复杂度', toc: `${sortSectionId} | 1.2 排序`, memory: '', per: 1, read: (id) => id === sortSectionId ? readMemorySection(indexed, sectionDir, id) : null }, toolAgent);
ok(toolResult.questions.length === 1 && toolResult.reads.length === 1 && toolResult.questions[0]?.sectionIds[0] === sortSectionId,
  'agent 通过 read_source 工具按需取一节，并为题目绑定章节 ID');
ok(!toolContexts[0].includes('渐进下界') && toolContexts[1].includes('渐进下界') && !toolContexts[1].includes('归并排序'),
  'JIT 工具只把申请的小节加入上下文，没有预载整个主题');
let multiReadRound = 0;
const multiReadAgent: Llm = {
  ask: async () => '',
  tool: async () => {
    multiReadRound++;
    if (multiReadRound <= 4) return { text: '', calls: [{ id: `read-${multiReadRound}`, name: 'read_source',
      arguments: JSON.stringify({ sectionId: sortSectionId }) }] };
    return { text: JSON.stringify({ questions: [{ knowledge: '多轮读取', stem: '多轮 JIT 后可出题吗？',
      options: ['可以', '不可以'], answer: 0, sectionIds: [sortSectionId] }] }), calls: [] };
  },
};
const multiReadResult = await generateTopic({ topic: '复杂度', toc: `${sortSectionId} | 1.2 排序`, memory: '', per: 1,
  read: (id) => id === sortSectionId ? readMemorySection(indexed, sectionDir, id) : null }, multiReadAgent);
ok(multiReadResult.questions.length === 1 && multiReadRound === 5,
  '多节主题连续 JIT 读取四轮后仍保留一轮合成题目的机会');
ok(toolRules.length === 2 && toolRules[0] === toolRules[1] && toolRules[0].includes('read_source')
  && !toolRules[0].includes('"read"')
  && toolRules[0].split('\n').slice(2).join('\n') === generationRules[0].split('\n').slice(2).join('\n'),
  '工具调用和兼容模式共享同一套出题、格式和记忆规则');
ok(res.questions.length === 4 && res.questions[0]?.sectionIds.join() === sectionId && res.questions[1]?.sectionIds.join() === sortSectionId
  && res.questions.slice(2).every((q) => q.sectionIds.join() === [sortSectionId, sectionId].join()),
  '合法 ID 去重并精确定位；缺失或无效 ID 的题仍送审，只回退到已读原文');
ok(res.questions[1]?.noShuffle === true, '位置依赖的选项自动补上「! 固定顺序」声明');
ok(res.dropped.length === 2
  && res.dropped.some((d) => d.reason.includes('重复'))
  && res.dropped.some((d) => d.reason.includes('越界')),
  `不合格的题被扔下并说明原因（${res.dropped.map((d) => d.reason).join(' / ')}）`);

// 经过模型审核后，只有明确放行的题可进入游戏题库。
const chainReviews = await reviewQuestions({ ask: async (_system, user) => {
  const q = JSON.parse(user) as { question: string; sourceSections: Array<{ text: string }> };
  if (q.question === '引用未读章节') return '0';
  if (q.question === '下界？') return '1。';
  return q.sourceSections.some((s) => s.text.includes('有序数组')) ? '1' : '0';
} }, res.questions.map((q) => ({ ...q, sources: q.sectionIds.map((id) => ({ sectionId: id, text: res.sources.get(id)! })) })));
const chain = emitPack('链路自检', [{ topic: '复杂度', questions: res.questions.filter((_q, i) => chainReviews[i]?.verdict === 'pass') }]);
const chainChk = checkPack(chain);
ok(chainReviews.map((r) => r.verdict).join() === 'pass,pending,pass,reject'
  && chainChk.ok && chainChk.count === 2 && chain.includes('缺少章节 ID') && !chain.includes('引用未读章节'),
  `仅审核返回 1 的题能直接载入游戏（${chainChk.count} 道）`);

const basePack = emitPack('增量自检', [
  { topic: '甲', questions: [{ knowledgeId: 'a', qid: 'q_a', stem: '旧题', options: ['是', '否'], answer: 0 }] },
  { topic: '乙', questions: [{ knowledgeId: 'b', qid: 'q_b', stem: '另一题', options: ['是', '否'], answer: 1 }] },
]);
const deltaPack = emitPack('增量自检', [
  { topic: '甲', questions: [{ knowledgeId: 'c', qid: 'q_c', stem: '新题', options: ['是', '否'], answer: 0 }] },
]);
const appended = appendPack(basePack, deltaPack);
const appendedCheck = checkPack(appended);
ok(appendedCheck.ok && appendedCheck.count === 3
  && (appended.match(/^## 甲$/gm) ?? []).length === 1
  && Object.keys(countByTopic(appended)).join(',') === '甲,乙'
  && appended.includes('### 旧题') && appended.includes('### 新题'),
'增量追加：保留旧题、合并同名主题且不改主题顺序');

const codeStem = lines('看 **这段代码**：', '```text', '## 不是主题', '', '  A) 不是选项', '= B', '```');
const codeOption = lines('~~~js', 'if (ok) {', '  run();', '}', '~~~');
const codeExplain = lines('使用 `run()`。', '', '> 第二段');
const codePack = emitPack('Markdown', [{ topic: '甲', questions: [{
  knowledgeId: 'code', qid: 'q_code', stem: codeStem, options: [codeOption, '`skip()`'], answer: 0, explain: codeExplain,
}] }]);
const codeBank = parseQuestionBank(appendPack(basePack, codePack));
const codeQuestion = codeBank.byTopic['甲']?.[1];
ok(!codeBank.issues.length && Object.keys(codeBank.byTopic).join(',') === '甲,乙'
  && codeQuestion?.q === codeStem && codeQuestion?.options[0] === codeOption && codeQuestion?.answer === 0
  && codeQuestion?.explain === codeExplain && codeQuestion?.qid === 'q_code',
'Markdown 字段经生成、追加与解析后保留换行、空行、缩进和 DSL 标记');

const bareCode = parseQuestionBank(lines('  ## 甲', '  ### 代码？', '  ```text', '    A) 内容', '  ```', '  A) 是', '  B) 否', '  = A'));
ok(!bareCode.issues.length && bareCode.byTopic['甲']?.[0]?.q === lines('代码？', '```text', '  A) 内容', '```'),
'兼容整体缩进的旧题库和未额外缩进的围栏');
ok(parseQuestionBank(codePack.replace('  ```\n', '')).issues.some((issue) => issue.includes('代码块未闭合')),
'未闭合的代码围栏报告导入错误');

// ── 划分计划：目录层 / 默认层 / 模型层，以及摘要合并 ──
const PLAN_DOC = lines(
  '# 上卷',
  '',
  '## 1.1 二分查找',
  '',
  '在有序数组上二分，每次比较折半。最坏比较 log n 次。',
  '',
  '```ts',
  'const mid = (lo + hi) >> 1;',
  '',
  'const x = mid + 1;',
  '```',
  '',
  '## 1.2 二分查找的变体',
  '',
  '下界与上界是二分的两种变体，仍然折半查找。',
  '',
  '## 1.3 哈希表',
  '',
  '哈希表用桶装冲突的键，查找平均 O(1)。',
);

// 段落：空行分组、代码块不拆、标题自成一段
const paras = paragraphsOf(PLAN_DOC);
ok(paras.some((p) => p.text.includes('const mid') && p.text.includes('const x')),
  '段落：代码块里的空行没有把它拆成两段');
ok(paras.every((p) => p.text.trim().length > 0 && p.to > p.from),
  `段落：${paras.length} 段都有正文、区间都不为空`);
ok(paras.some((p) => p.text.startsWith('## 1.2')), '段落：标题单独成段（切点可以落在标题前）');
ok(JSON.stringify(paragraphsOf(PLAN_DOC)) === JSON.stringify(paragraphsOf(PLAN_DOC)),
  '段落：同一份文档切两次结果逐字相同');

// 默认层：段落装箱，绝不切段落
const blocks = blocksOf(PLAN_DOC, 120);
ok(blocks.length >= 3, `默认划分：120 字目标切出 ${blocks.length} 节`);
ok(blocks.every((b) => {
  const text = sliceLines(PLAN_DOC, b.from, b.to);
  return text.includes('const mid') === text.includes('const x');
}), '默认划分：每一节要么整块含代码，要么整块不含（没在段落中间下刀）');
ok(blocks.every((b) => b.chars > 0 && b.title.length > 0), '默认划分：每节都有名字和正文');
ok(JSON.stringify(blocksOf(PLAN_DOC, 120)) === JSON.stringify(blocksOf(PLAN_DOC, 120)),
  '默认划分：纯函数，两次结果相同');

// 目录层
const tocPlaned = tocPlan(PLAN_DOC, { name: '上卷', depth: 2, size: 4000 })!;
ok(!!tocPlaned && tocPlaned.topics.length === 3,
  `目录划分：第 2 级标题切出 ${tocPlaned.topics.length} 节`);
ok(tocPlaned.topics[0].title === '1.1 二分查找' && tocPlaned.topics[2].title === '1.3 哈希表',
  '目录划分：用标题当节名，顺序与原文一致');
ok(tocPlaned.topics.every((t, i, arr) => i === 0 || t.from === arr[i - 1].to),
  '目录划分：相邻节的区间首尾相接，没有空档也不重叠');
ok(tocPlaned.topics[0].chars > 0 && tocPlaned.topics[0].chars < tocPlaned.chars,
  '目录划分：单节字数已统计，且小于全文');
ok(tocPlan(PLAN_DOC, { name: 'x', depth: 3, size: 4000 }) === null,
  '目录划分：该层级没有标题时返回 null（交给上层回落）');
const deeperOnly = '# 文档\n\n### 第一节\n\n内容一\n\n### 第二节\n\n内容二';
const autoDeep = titledPlan(deeperOnly, { name: 'x', depth: 2, size: 4000 });
ok(autoDeep?.tier === 'toc' && autoDeep.depth === 3 && autoDeep.topics.length === 2,
  '自动划分：缺少二级标题时选择可用的三级标题');
const repeatedHeadingLevels = '# 文档\n\n## 唯一章节\n\n### 子节一\n\n内容一\n\n### 子节二\n\n内容二';
const autoSubsections = titledPlan(repeatedHeadingLevels, { name: 'x', depth: 2, size: 4000 });
ok(autoSubsections?.depth === 3 && autoSubsections.topics.length === 2,
  '自动划分：单个章节标题下优先使用多个子节标题');
ok(AGENTIC_WINDOW === 8000 && MIN_AGENTIC_WINDOW === 2000 && MAX_AGENTIC_WINDOW === 20000,
  `agentic 窗口默认 8000 字，可设为 ${MIN_AGENTIC_WINDOW}-${MAX_AGENTIC_WINDOW} 字`);

ok(firstSentence('# 1. 入门指南\nch01-getting-started.md\n正文说明了 Rust 的安装步骤。')
  === '正文说明了 Rust 的安装步骤',
  '摘要：编号标题、页锚点和源文件名不冒充首句');

const paged = `<!-- cognirogue-page: 4 -->\n# 一节\n正文\n<!-- cognirogue-page: 5 -->\n续文\n`;
ok(JSON.stringify(pageRange(paged, 1, 6)) === JSON.stringify({ pageFrom: 4, pageTo: 5 }),
  `PDF 页锚点：计划行区间映射到原页 4-5`);
ok(pageRange(PLAN_DOC, 0, 2) === null, `Markdown 没有 PDF 页范围`);
const pageMem = newTopicMem('PDF 章节', 'book.pdf.md');
indexTopicMemory(pageMem, paged, { title: 'PDF 章节', from: 1, to: 6, chars: 10, summary: '', summarized: 'none' });
ok(pageMem.sections![0].pageFrom === 4 && pageMem.sections![0].pageTo === 5
  && sourceIndexText(pageMem).includes('PDF 第 4-5 页'), '未出题的 PDF 主题记忆保存物理页表');

// 每个窗口按段落编号，模型只选择段落起点。
const pad = '折半查找每次把区间减半，最坏比较次数随规模对数增长。'.repeat(14);
const flatDoc = lines(
  `第一步讲二分。${pad}`,
  '',
  `第二步讲哈希。${pad}`,
  '',
  `第三步讲排序。${pad}`,
);
const agenticLlm: Llm = {
  ask: async (_s, user) => {
    if (user.includes('# 原文顺序中的')) {
      const payload = user.split('\n\n')[1]!;
      const fragments = JSON.parse(payload) as Array<{ id: string; title: string; summary: string; subtopics: Array<{ id: string; title: string; summary: string }> }>;
      return JSON.stringify({ topics: fragments.map((fragment) => ({ title: fragment.title, summary: fragment.summary,
        fragmentIds: [fragment.id], subtopics: fragment.subtopics.map((sub) => ({
          title: sub.title, summary: sub.summary, fragmentIds: [sub.id],
        })) })) });
    }
    ok(user.includes('⟪1⟫') && user.includes('⟪3⟫'), '模型理解：每一窗段落带有序号');
    return JSON.stringify({ summary: '查找与排序', topics: [
      { title: '二分与哈希', summary: '介绍查找方法', start: 1,
        subtopics: [{ title: '二分查找', summary: '有序区间折半查找', start: 1 }] },
      { title: '排序', summary: '介绍排序方法', start: 2,
        subtopics: [{ title: '比较排序', summary: '通过比较排列元素', start: 2 }] },
    ] });
  },
};
const agented = (await agenticPlan(flatDoc, { name: '散记', depth: 2, size: 4000 }, agenticLlm))!;
ok(!!agented && agented.tier === 'agentic' && agented.agenticWindow === AGENTIC_WINDOW
  && agented.agenticOverlapChars === AGENTIC_OVERLAP_CHARS && agented.topics.length === 2,
  `模型划分：按模型给的切点分成 ${agented.topics.length} 节`);
ok(agented.topics[0].title === '二分与哈希' && agented.topics[1].title === '排序'
  && agented.topics[0].subtopics?.[0]?.title === '二分查找', '模型划分：生成主题、摘要与子主题层级');
ok(agented.topics.every((t, i, arr) => i === 0 || t.from === arr[i - 1].to),
  '模型划分：区间首尾相接（窗首由我们强制断开）');

const section = (title: string, start: number) => ({ title, summary: `${title}的说明`, start });
const fragment = (title: string, start: number, ...subtopics: ReturnType<typeof section>[]) =>
  ({ ...section(title, start), subtopics });
const longSummary = '共享引用允许读取借用的值，同一时刻可以有多个共享引用，只要这些共享引用仍被使用，就不能创建指向同一数据的可变引用。引用的生命周期还必须受限于它所借用的数据。';
const localReplies = [
  { summary: '常量与借用开篇', topics: [fragment('常量', 1, section('常量声明', 1)), fragment('借用', 2, section('共享借用', 2))] },
  { summary: '借用续篇', topics: [fragment('借用规则', 1, { ...section('共享借用续', 1), summary: longSummary }, section('可变借用', 2))] },
];
const group = (title: string, ...fragmentIds: string[]) => ({ title, summary: `${title}的说明`, fragmentIds });
const mergedTopics = [
  { ...group('常量', 'f001'), subtopics: [group('常量声明', 'f001.s001')] },
  { ...group('借用', 'f002', 'f003'), subtopics: [group('共享借用', 'f002.s001', 'f003.s001'), group('可变借用', 'f003.s002')] },
];
const windowDoc = [
  '<!-- cognirogue-page: 4 -->', `定义常量。${'甲'.repeat(700)}`, '', `共享借用开篇。${'乙'.repeat(700)}`,
  '<!-- cognirogue-page: 5 -->', `共享借用续篇。${'丙'.repeat(700)}`, '', `介绍可变借用。${'丁'.repeat(700)}`,
].join('\n');
const customWindowOpts = { name: '带页码的教材', depth: 2, size: 4000, agenticWindow: 2000, agenticOverlapChars: 200 };
const runChunkFixture = (result: typeof mergedTopics, requests: string[] = []) => {
  let window = 0;
  return agenticPlan(windowDoc, customWindowOpts, {
    ask: async (_system, user) => {
      requests.push(user);
      return JSON.stringify(user.startsWith('# 原文顺序中的') ? { topics: result } : localReplies[window++]);
    },
  });
};
const chunkRequests: string[] = [];
const customWindowPlan = (await runChunkFixture(mergedTopics, chunkRequests))!;
ok(longSummary.length > 60 && chunkRequests[2]?.includes(longSummary),
  '二级聚合：超过提示词长度的摘要保留完整内容并进入合并预算');
const mergeInput = JSON.parse(chunkRequests[2]!.split('\n\n')[1]!) as Array<{ id: string; startsWindow?: boolean }>;
ok(mergeInput.filter((fragment) => fragment.startsWindow).map((fragment) => fragment.id).join() === 'f003',
  '二级聚合：合并输入标记程序分窗边界，窗内主题不误标');
const [constants, borrowing] = customWindowPlan.topics;
const [shared, mutable] = borrowing.subtopics!;
ok(chunkRequests.length === 3 && customWindowPlan.agenticWindow === 2000 && customWindowPlan.topics.length === 2
  && borrowing.merged === 2 && shared.fragmentIds?.join() === 'f002.s001,f003.s001',
  '二级聚合：前一窗的第二个主题在后一窗延续，主题和子主题依次合并');
ok(customWindowPlan.agenticChunks?.map((chunk) => `${chunk.summary}:${chunk.pageFrom}-${chunk.pageTo}`).join()
  === '常量与借用开篇:4-4,借用续篇:5-5'
  && constants.pageTo === 4 && shared.pageFrom === 4 && shared.pageTo === 5 && mutable.pageFrom === 5,
  '二级聚合：保留块摘要，页锚点不会把前一段误算到下一页');
const memForChunks = newTopicMem(borrowing.title, 'sample.pdf.md');
const indexedChunks = indexTopicMemory(memForChunks, windowDoc, borrowing);
ok(indexedChunks.length === 2 && indexedChunks[0].content.includes('共享借用开篇')
  && indexedChunks[0].content.includes('共享借用续篇') && !indexedChunks[0].content.includes('介绍可变借用')
  && indexedChunks[1].content.includes('介绍可变借用') && indexedChunks[0].id !== indexedChunks[1].id
  && sourceIndexText(memForChunks).includes('PDF 第 4-5 页'), '二级聚合：跨窗子主题按 ID 单独存储原文，JIT 可定位页码');

for (const { windowSize, configuredOverlapChars } of [
  { windowSize: MIN_AGENTIC_WINDOW }, { windowSize: AGENTIC_WINDOW }, { windowSize: MAX_AGENTIC_WINDOW },
  { windowSize: MIN_AGENTIC_WINDOW, configuredOverlapChars: 337 },
]) {
  const overlapSize = configuredOverlapChars ?? 800;
  const codeFence = '```rust\n// \n```';
  const overlapTail = codeFence.replace('// ', `// ${'x'.repeat(overlapSize - codeFence.length)}`);
  const newBody = '乙'.repeat(windowSize - overlapSize - 2);
  const overlapDoc = ['甲'.repeat(windowSize - overlapSize - 2), overlapTail, newBody, '丙'.repeat(20)].join('\n\n');
  const overlapRequests: string[] = [];
  const overlapPlan = (await agenticPlan(overlapDoc, {
    ...customWindowOpts, agenticWindow: windowSize, agenticOverlapChars: configuredOverlapChars,
  }, {
    ask: async (_system, user) => {
      overlapRequests.push(user);
      return JSON.stringify({ summary: '块摘要', topics: [fragment('局部主题', 1, section('局部子主题', 1))] });
    },
  }, { merge: false }))!;
  const [first, second, third] = overlapPlan.agenticChunks!;
  ok(overlapPlan.agenticOverlapChars === overlapSize && overlapRequests.length === 3 && overlapTail.length === overlapSize
    && overlapRequests[0]?.endsWith(`⟪2⟫ ${overlapTail}`)
    && overlapRequests[1] === `# 前置上下文\n\n${overlapTail}\n\n# 窗口 2/3 的编号原文\n\n⟪1⟫ ${newBody}`
    && overlapRequests[2]?.startsWith('# 窗口 3/3')
    && first?.contextFrom === first?.from && second?.contextFrom === 2 && third?.contextFrom === third?.from,
    `二级聚合：${windowSize} 字窗口复用上一窗末尾 ${overlapSize} 字完整代码段，并计入本窗预算`);
  ok(first?.to === second?.from && second?.to === third?.from
    && overlapPlan.topics[0]?.to === overlapPlan.topics[1]?.from
    && overlapPlan.topics[1]?.subtopics?.[0]?.chunkIds?.join() === second?.id
    && second?.contextTo === second?.to,
    `二级聚合：${windowSize} 字窗口的重叠上下文不计入最终原文`);
}
const noOverlapRequests: string[] = [];
const noOverlapPlan = await agenticPlan(['甲'.repeat(1898), '乙'.repeat(100), '丙'.repeat(1900)].join('\n\n'),
  { ...customWindowOpts, agenticOverlapChars: 0 }, {
    ask: async (_system, user) => {
      noOverlapRequests.push(user);
      return JSON.stringify({ summary: '块摘要', topics: [fragment('局部主题', 1, section('局部子主题', 1))] });
    },
  }, { merge: false });
ok(noOverlapPlan?.agenticOverlapChars === 0 && noOverlapRequests.length === 2
  && noOverlapRequests[1]?.startsWith('# 窗口 2/2')
  && noOverlapPlan.agenticChunks?.every((chunk) => chunk.contextFrom === chunk.from) === true,
  '二级聚合：显式 0 字符关闭重叠，即使上一窗尾段可放入');
for (const agenticOverlapChars of [-1, customWindowOpts.agenticWindow + 1, 10.5]) {
  const rejected = await agenticPlan(flatDoc, { ...customWindowOpts, agenticOverlapChars }, agenticLlm)
    .then(() => false, (error: unknown) => error instanceof RangeError);
  ok(rejected, `模型划分：拒绝无效的重叠字符数 ${agenticOverlapChars}`);
}
ok(borrowing.chunkIds?.join() === 'chunk_001,chunk_002'
  && shared.chunkIds?.join() === 'chunk_001,chunk_002' && mutable.chunkIds?.join() === 'chunk_002',
  '二级聚合：跨窗口主题和子主题追溯到各自的核心块 ID');

const malformedMerges: Array<{ label: string; topics: typeof mergedTopics; error: string }> = [
  { label: '遗漏主题', topics: [mergedTopics[0]], error: '遗漏主题片段' },
  { label: '重复主题', topics: [...mergedTopics, mergedTopics[1]], error: '主题引用无效' },
  { label: '主题乱序', topics: [...mergedTopics].reverse(), error: '主题引用无效' },
  { label: '跨父主题引用', topics: [{ ...mergedTopics[0], subtopics: [mergedTopics[1].subtopics[0]] }, mergedTopics[1]],
    error: '子主题引用无效' },
  { label: '遗漏子主题', topics: [mergedTopics[0], { ...mergedTopics[1], subtopics: [mergedTopics[1].subtopics[0]] }],
    error: '遗漏子主题片段' },
];
for (const { label, topics, error } of malformedMerges) {
  const actual = await runChunkFixture(topics).then(() => '', (err: Error) => err.message);
  ok(actual.includes(error), `二级聚合：拒绝${label}`);
}

let budgetCalls = 0;
const manyChunks = Array.from({ length: 25 }, () => Array(6).fill('文'.repeat(300)).join('\n\n')).join('\n\n');
const budgetError = await agenticPlan(manyChunks, customWindowOpts, {
  ask: async () => {
    budgetCalls += 1;
    return JSON.stringify({ summary: '块摘要', topics: [{ title: '窗口主题', summary: '主题摘要', start: 1,
      subtopics: Array.from({ length: 6 }, (_, i) => ({ title: `子主题 ${i}`, start: i + 1, summary: '摘'.repeat(60) })),
    }] });
  },
}).then(() => '', (err: Error) => err.message);
ok(budgetCalls === 25 && budgetError.includes(String(AGENTIC_MERGE_MAX_CHARS))
  && budgetError.includes('增大窗口或拆分文档'), '二级聚合：超预算直接返回可操作错误，未发起全局合并请求');

let rejectedWindow = false;
try {
  await agenticPlan(flatDoc, { name: '越界', depth: 2, size: 4000, agenticWindow: 20001 }, agenticLlm);
} catch (error) {
  rejectedWindow = error instanceof RangeError;
}
ok(rejectedWindow, '模型划分：拒绝超出范围的窗口参数');

// 模型不老实就整份放弃，让上层回落 —— 不做半份计划
const badLlm: Llm = { ask: async () => '{"topics":[{"title":"","start":0}]}' };
let invalidMapRejected = false;
try { await agenticPlan(flatDoc, { name: '散记', depth: 2, size: 4000 }, badLlm); }
catch { invalidMapRejected = true; }
ok(invalidMapRejected, '二级聚合：局部输出不符合结构时拒绝生成计划');

// Split inside a Chinese character and a tool argument across streaming frames.
{
  const fetch = globalThis.fetch;
  const cfg = { apiKey: 'test', baseUrl: 'http://test.invalid/v1', model: 'stub', retries: 0 };
  const encoder = new TextEncoder();
  const frame = (delta: unknown, finish_reason?: string) => `data: ${JSON.stringify({ choices: [{ delta, finish_reason }] })}\r\n\r\n`;
  try {
    const toolCall = (args: string, name?: string) => ({ tool_calls: [{ index: 0,
      ...(name ? { id: 'read-1' } : {}), function: { name, arguments: args } }] });
    const wire = encoder.encode(frame({ content: '现场' }) + frame(toolCall('{"sectionId":"sec_', 'read_source'))
      + frame(toolCall('0123456789abcdef"}'), 'tool_calls') + 'data: [DONE]\n\n');
    const split = wire.indexOf(0xe7) + 1;
    globalThis.fetch = async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(wire.slice(0, split));
        controller.enqueue(wire.slice(split));
        controller.close();
      },
    }), { headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
    const streamed = await openAiLlm(cfg).tool!('system', [{ role: 'user', content: '目录' }], []);
    ok(streamed.text === '现场' && streamed.calls[0]?.name === 'read_source'
      && streamed.calls[0]?.arguments === '{"sectionId":"sec_0123456789abcdef"}',
      'SSE 跨网络片段保留 UTF-8 内容并拼回完整的工具参数');

    const requests: Array<{ stream?: boolean; stream_options?: unknown }> = [];
    requests.length = 0;
    globalThis.fetch = async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      requests.push(request);
      if (request.stream_options) return new Response('unsupported stream_options', { status: 400 });
      const delta = { tool_calls: [{ index: 0, id: 'read-1', function: {
        name: 'read_source', arguments: JSON.stringify({ sectionId: sortSectionId }),
      } }] };
      return new Response('data: ' + JSON.stringify({ choices: [{ delta, finish_reason: 'tool_calls' }] })
        + '\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
    };
    const fallbackTool = openAiLlm(cfg).tool!;
    const fallbackSpec = [{ name: 'read_source', description: '读取章节', parameters: { type: 'object' } }];
    const fallbackMessages = [{ role: 'user' as const, content: '目录' }];
    const streamedTool = await fallbackTool('system', fallbackMessages, fallbackSpec);
    await fallbackTool('system', fallbackMessages, fallbackSpec);
    ok(requests.length === 3 && !!requests[0].stream_options && requests[1].stream === true &&
      !requests[1].stream_options && requests[2].stream === true &&
      streamedTool.calls[0]?.arguments === JSON.stringify({ sectionId: sortSectionId }),
      'JIT 工具调用遇到用量流参数不兼容时降级为普通 SSE，始终保持流式');

    requests.length = 0;
    globalThis.fetch = async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      requests.push(request);
      return request.stream ? new Response('stream unsupported', { status: 422 })
        : Response.json({ choices: [{ message: { tool_calls: [] } }] });
    };
    const streamRequiredError = await openAiLlm(cfg).tool!('system', fallbackMessages, fallbackSpec)
      .then(() => '', (error: Error) => error.message);
    ok(requests.length === 1 && requests[0]?.stream === true
      && streamRequiredError.includes('HTTP 422'), 'JIT 不支持 SSE 时明确失败，不静默退化为同步生成');

    globalThis.fetch = async () => new Response(frame({ content: '半截回复' }), { headers: { 'content-type': 'text/event-stream' } });
    const error = await openAiLlm(cfg).ask('system', 'user').catch((err: Error) => err.message);
    ok(error.includes('模型输出流提前结束'), '断开的输出流不会作为完整模型回复交给出题器');
  } finally {
    globalThis.fetch = fetch;
  }
}

const originalFetch = globalThis.fetch;
const originalBase = serviceBase();
try {
  const calls: string[] = [];
  setServiceBase('http://stale-service.test');
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return Response.json({ ok: true, version: '0.9' });
  };
  const staleAccepted = await sendAnswers({ v: 2, bankId: 'words', events: [] });
  ok(!staleAccepted && calls.length === 1 && calls[0]!.endsWith('/api/health'),
    '旧服务即使接受了旧答题接口也不会确认并清除待同步记录');

  calls.length = 0;
  setServiceBase('http://current-service.test');
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return String(url).endsWith('/api/health')
      ? Response.json({ ok: true, apiVersion: 1 })
      : Response.json({ ok: true, written: 0 });
  };
  ok(await sendAnswers({ v: 2, bankId: 'words', events: [] }) && calls.length === 2
    && calls[0]!.endsWith('/api/health') && calls[1]!.endsWith('/api/answers'),
    '新服务通过 API 契约探测后才接收答题事件');

  let detailRequests = 0;
  let phase: 'offline' | 'running' | 'done' = 'offline';
  const job = { id: 'job-plan', taskType: 'plan', title: '目录解析', ms: 0, tail: '' };
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/api/jobs')) {
      return phase === 'offline' ? new Response(null, { status: 503 }) : Response.json([{ ...job, state: phase }]);
    }
    detailRequests++;
    return detailRequests === 1 ? new Response(null, { status: 503 })
      : Response.json({ ...job, state: phase, plan: { name: '测试计划' } });
  };
  let progressed = false;
  let settled = false;
  const watched = watchJob(job.id, (row) => { progressed = row.state === 'running'; })
    .then((result) => { settled = true; return result; });
  await tickJobs(0);
  ok(!settled, '分章等待遇到任务列表暂时不可用时继续等待');
  phase = 'running';
  await tickJobs(1000);
  ok(progressed && !detailRequests, '运行中的分章进度只从任务列表读取');
  phase = 'done';
  await tickJobs(2000);
  ok(!settled, '完成的分章遇到详情请求失败时继续等待');
  await tickJobs(3000);
  ok(settled && (await watched)?.plan?.name === '测试计划', '恢复连接后从详情取得分章结果');

} finally {
  globalThis.fetch = originalFetch;
  setServiceBase(originalBase);
}

for (const file of sectionFiles) unlinkSync(join(sectionDir, `${file.id}.md`));
rmdirSync(sectionDir);
process.exitCode = fails ? 1 : 0;
