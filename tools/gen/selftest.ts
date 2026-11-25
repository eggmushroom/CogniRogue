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
  MERGE_MAX_PARTS, MERGE_PCT, agenticPlan, mergePlan, pageRange, planTocText, similarEnough, similarity,
  firstSentence, summarizePlan, tocPlan,
} from './plan';
import type { PlanTopic } from './plan';
import { appendPack, checkPack, knowledgeIdByQid, countByTopic, emitPack } from './emit';
import { parseQuestionBank } from '../../src/core/library/parse';
import { sendAnswers, serviceBase, setServiceBase } from '../../src/core/library/remote';
import { generateTopic } from './generate';
import { openAiLlm, type Llm } from './llm';
import { indexTopicMemory, memText, mergeSnapshot, newTopicMem, readMemorySection, sourceIndexText, sourceSectionId, topicIdOf } from './memory';

let fails = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) fails += 1;
};

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
ok(memText(answerMem).includes('正确选项 2') && memText(answerMem).includes('选项选择顺序（1-based）'), '记忆从逐题流水组装正确选项与作答顺序');
let feedbackPrompt = '';
const feedbackLlm: Llm = {
  ask: async (_system, user) => {
    feedbackPrompt = user;
    return JSON.stringify({ questions: [{
      knowledge: '第一章 复杂度/二分查找',
      stem: '二分查找每次比较后区间如何变化？',
      options: ['减半', '不变'], answer: 0,
    }] });
  },
};
const targeted = await generateTopic({
  topic: '第一章 复杂度',
  chunks: [{ path: ['第一章 复杂度'], text: '二分查找每次比较后区间减半。', part: 0, size: 20 }],
  toc: '第一章 复杂度',
  memory: memText(answerMem),
  per: 1,
  read: () => null,
}, feedbackLlm);
ok(feedbackPrompt.includes('玩家 0 对 1 错') && targeted.questions[0]?.knowledgeId.startsWith('k_'),
  '单主题增量生成读取重新纳入的答题记忆并允许生成新题号');
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

const qidMap = knowledgeIdByQid(packText);
ok(Object.keys(qidMap).length === 2 && Object.values(qidMap).includes('algo/sort-lower'),
  'qid → knowledgeId 映射能把逐题作答归并到知识点');

// ── 一个主题 = 一个子 agent：JIT 取数 + 校验 + 去重（全离线，假模型） ──
const asked: string[] = [];
let round = 0;
const fake: Llm = {
  ask: async (_sys, user) => {
    asked.push(user);
    round += 1;
    if (round === 1) return JSON.stringify({ read: [sortSectionId], questions: [] });
    return JSON.stringify({
      questions: [
        { knowledge: '二分查找最坏情况', stem: '二分查找最坏比几次？', options: ['O(1)', 'O(log n)'], answer: 1 },
        { knowledge: '二分查找最坏情况', stem: '二分查找最坏比几次？', options: ['甲', '乙'], answer: 0 },
        { knowledge: '比较排序下界', stem: '下界？', options: ['n', 'n log n', '以上都对'], answer: 1 },
        { knowledge: 'algo/bad', stem: '答案越界', options: ['甲', '乙'], answer: 5 },
      ],
    });
  },
};
const sortSectionId = indexed.sections!.find((section) => section.title === '1.2 排序')!.id;
const res = await generateTopic({
  topic: '复杂度',
  chunks: [],
  toc: `${sortSectionId} | 1.2 排序`,
  memory: '（这个主题还没有记忆）',
  per: 6,
  read: (id: string) => id === sortSectionId ? readMemorySection(indexed, sectionDir, id) : null,
}, fake);

ok(res.reads.includes(sortSectionId),
  `JIT：模型通过章节 ID 读取独立原文文件（${res.reads.join(' / ')}）`);
ok(!asked[0].includes('# 已读取的原文') && asked[0].includes('# 本主题的原文索引') && !asked[0].includes('渐进下界'),
  'JIT：首轮只注入目录和记忆，不注入任何正文');
const ungrounded = await generateTopic({
  topic: '复杂度', chunks: [], toc: '复杂度', memory: '', per: 1, read: () => null,
}, { ask: async () => JSON.stringify({ questions: [{ knowledge: 'algo/guess', stem: '猜测', options: ['甲', '乙'], answer: 0 }] }) });
ok(ungrounded.questions.length === 0, 'JIT：没有取到原文时不接受题目');
ok(asked.length === 2 && asked[1].includes('渐进下界'),
  '第二轮把读到的原文追加进了上下文');
// Tool-calling agent asks the service for one exact section; the untouched chapter never enters context.
const toolContexts: string[] = [];
let toolRound = 0;
const toolAgent: Llm = {
  ask: async () => '',
  tool: async (_system, messages, _tools) => {
    toolContexts.push(JSON.stringify(messages));
    toolRound++;
    if (toolRound === 1) return { text: '', calls: [{ id: 'read-1', name: 'read_source', arguments: JSON.stringify({ sectionId: sortSectionId }) }] };
    return { text: JSON.stringify({ questions: [{ knowledge: '排序下界', stem: '比较排序下界？', options: ['n', 'n log n'], answer: 1 }] }), calls: [] };
  },
};
const toolResult = await generateTopic({ topic: '复杂度', chunks: [], toc: `${sortSectionId} | 1.2 排序`, memory: '', per: 1, read: (id) => id === sortSectionId ? readMemorySection(indexed, sectionDir, id) : null }, toolAgent);
ok(toolResult.questions.length === 1 && toolResult.reads.length === 1,
  'agent 通过 read_source 工具按需取一节，得到题目');
ok(!toolContexts[0].includes('渐进下界') && toolContexts[1].includes('渐进下界') && !toolContexts[1].includes('归并排序'),
  'JIT 工具只把申请的小节加入上下文，没有预载整个主题');
ok(res.questions.length === 2, `合格的题被收下（${res.questions.length} 道）`);
ok(res.questions[1]?.noShuffle === true, '位置依赖的选项自动补上「! 固定顺序」声明');
ok(res.dropped.length === 2
  && res.dropped.some((d) => d.reason.includes('重复'))
  && res.dropped.some((d) => d.reason.includes('越界')),
  `不合格的题被扔下并说明原因（${res.dropped.map((d) => d.reason).join(' / ')}）`);

// 整条链路走一遍：假模型出的题 → 渲染 → 过游戏解析器 → 每题题号独立生成
const chain = emitPack('链路自检', [{ topic: '复杂度', questions: res.questions }]);
const chainChk = checkPack(chain);
ok(chainChk.ok && chainChk.count === 2, `假模型的一轮产物能直接载入游戏（${chainChk.count} 道）`);

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

// 摘要：有模型就调，没有就回落首句
const sumLlm: Llm = {
  ask: async () => '二分查找的做法与最坏比较次数。',
};
const summed = await summarizePlan(tocPlaned!, PLAN_DOC, sumLlm);
ok(summed.topics.every((t) => t.summarized === 'model' && t.summary.length > 0),
  '摘要：模型给的摘要写进了每一节');
const noModel = await summarizePlan(tocPlaned!, PLAN_DOC, null);
ok(noModel.topics.every((t) => t.summarized === 'none' && t.summary.length > 0)
  && noModel.notes.some((n) => n.includes('没有配模型')),
  '摘要：没有模型时回落首句，并在 notes 里说明');
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

// 相似度与合并：判据是整数，合并有上限
ok(similarity('二分查找每次折半比较', '二分查找每次折半') > MERGE_PCT,
  `相似度：几乎同义的两段（${similarity('二分查找每次折半比较', '二分查找每次折半')}%）`);
ok(similarity('二分查找每次折半', '哈希表用桶装冲突的键') === 0,
  '相似度：不相干的两段是 0');
ok(similarEnough('二分查找每次折半比较', '二分查找每次折半', MERGE_PCT)
  && !similarEnough('二分查找每次折半', '哈希表用桶装冲突的键', MERGE_PCT),
  '相似度：阈值判据与整数百分比同向');

const mkTopic = (title: string, summary: string, chars: number): PlanTopic => ({
  title, from: 0, to: 1, chars, summary, summarized: 'model',
});
const merged = mergePlan({
  ...tocPlaned!,
  topics: [
    mkTopic('甲', '二分查找每次折半比较，最坏 log n', 800),
    mkTopic('乙', '二分查找每次折半比较', 900),
    mkTopic('丙', '哈希表用桶装冲突的键', 700),
  ],
}, { pct: MERGE_PCT, maxChars: 8000, maxParts: 4 });
ok(merged.topics.length === 2 && merged.topics[0].merged === 2,
  `合并：相邻且相似的两节并成一节（剩 ${merged.topics.length} 节）`);
ok(merged.topics[0].title === '甲' && merged.topics[0].chars === 1700,
  '合并：留下前一节的名字，字数相加');
ok(merged.topics[1].title === '丙', '合并：不相似的那节没被并进去');

const tooBig = mergePlan({
  ...tocPlaned!,
  topics: [mkTopic('甲', '二分查找每次折半比较', 5000), mkTopic('乙', '二分查找每次折半比较', 4000)],
}, { pct: MERGE_PCT, maxChars: 8000, maxParts: 4 });
ok(tooBig.topics.length === 2, '合并：并起来超过 8000 字就不并');

const tooMany = mergePlan({
  ...tocPlaned!,
  topics: Array.from({ length: 6 }, (_, i) => mkTopic(`节${i}`, '二分查找每次折半比较', 100)),
}, { pct: MERGE_PCT, maxChars: 8000, maxParts: 4 });
ok(tooMany.topics.length === 2 && tooMany.topics[0].merged === 4,
  `合并：一节最多并 ${MERGE_MAX_PARTS} 节（${tooMany.topics.map((t) => t.merged ?? 1).join('+')}）`);

// 模型层：分窗、编号、窗首强制断一次。
// 每段都写到 300 字以上：太碎的节会被并进前一个（MIN_TOPIC），那是另一条路数。
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
    ok(user.includes('⟪1⟫') && user.includes('⟪3⟫'), '模型划分：每一窗的段落都带上了编号');
    return JSON.stringify({ topics: [{ title: '二分与哈希', start: 1 }, { title: '排序', start: 2 }] });
  },
};
const agented = (await agenticPlan(flatDoc, { name: '散记', depth: 2, size: 4000 }, agenticLlm))!;
ok(!!agented && agented.tier === 'agentic' && agented.topics.length === 2,
  `模型划分：按模型给的切点分成 ${agented.topics.length} 节`);
ok(agented.topics[0].title === '二分与哈希' && agented.topics[1].title === '排序',
  '模型划分：用模型给的标题');
ok(agented.topics.every((t, i, arr) => i === 0 || t.from === arr[i - 1].to),
  '模型划分：区间首尾相接（窗首由我们强制断开）');

// 模型不老实就整份放弃，让上层回落 —— 不做半份计划
const badLlm: Llm = { ask: async () => '{"topics":[{"title":"","start":0}]}' };
ok(await agenticPlan(flatDoc, { name: '散记', depth: 2, size: 4000 }, badLlm) === null,
  '模型划分：返回不合法就整份放弃（回落固定层）');

ok(planTocText(tocPlaned!).includes('1.1 二分查找') && planTocText(tocPlaned!).includes('字'),
  '计划能渲染成给模型的目录（JIT 索引）');

console.log(fails ? `\n✗ ${fails} 项失败` : '\n✓ 生成工具自检通过');
// Split inside a Chinese character and an SSE frame; keep the response open until the first output is observed.
{
  const fetch = globalThis.fetch;
  const cfg = { apiKey: 'test', baseUrl: 'http://test.invalid/v1', model: 'stub', retries: 0 };
  const encoder = new TextEncoder();
  const content = (text: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\r\n\r\n`;
  try {
    let release!: () => void;
    const first = new Promise<void>((resolve) => { release = resolve; });
    const events: Array<{ call: number; phase: string; text: string; inputTokens?: number; outputTokens?: number }> = [];
    const wire = encoder.encode(content('现'));
    const split = wire.indexOf(0xe7) + 1;
    globalThis.fetch = async () => new Response(new ReadableStream({
      async start(controller) {
        controller.enqueue(wire.slice(0, split));
        controller.enqueue(wire.slice(split));
        await Promise.race([first, new Promise<void>((_, reject) => {
          const timeout = AbortSignal.timeout(1000);
          timeout.addEventListener('abort', () => reject(timeout.reason), { once: true });
        })]);
        controller.enqueue(encoder.encode(content('场')
          + 'data: {"choices":[],"usage":{"prompt_tokens":31,"completion_tokens":2}}\n\n'
          + 'data: [DONE]\n\n'));
        controller.close();
      },
    }), { headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
    const streamed = await openAiLlm(cfg, (event) => {
      events.push(event);
      if (event.phase === 'live') release();
    }).ask('system', 'user');
    ok(events[1]?.call === 1 && events[1]?.phase === 'live' && events[1]?.text === '现' && events[1].outputTokens === undefined,
      '模型尚未结束时已发布真实输出，UTF-8 跨片段不乱码，也不估算 token');
    ok(events.at(-2)?.phase === 'live' && events.at(-2)?.text === '现场',
      '流结束时刷新尚未到节流间隔的最后一段文本');
    ok(streamed === '现场' && events.at(-1)?.call === 1 && events.at(-1)?.inputTokens === 31 && events.at(-1)?.outputTokens === 2,
      'SSE 拼回完整回复，最终用量来自服务商');

    let releaseTool!: () => void;
    const toolStarted = new Promise<void>((resolve) => { releaseTool = resolve; });
    const toolEvents: Array<{
      phase: string;
      text: string;
      toolCalls?: Array<{ id: string; name: string; arguments: string; state: string; detail?: string }>;
    }> = [];
    const toolFrame = (delta: unknown, finish_reason: string | null = null) => `data: ${JSON.stringify({ choices: [{ delta, finish_reason }] })}\n\n`;
    globalThis.fetch = async () => new Response(new ReadableStream({
      async start(controller) {
        controller.enqueue(encoder.encode(toolFrame({ tool_calls: [{ index: 0, id: 'read-1', function: { name: 'read_source', arguments: '{"sectionId":"sec_' } }] })));
        await Promise.race([toolStarted, new Promise<void>((_, reject) => {
          const timeout = AbortSignal.timeout(1000);
          timeout.addEventListener('abort', () => reject(timeout.reason), { once: true });
        })]);
        const finalToolFrame = toolFrame({ tool_calls: [{ index: 0, function: { arguments: '0123456789abcdef"}' } }] }, 'tool_calls');
        controller.enqueue(encoder.encode(finalToolFrame + 'data: [DONE]\n\n'));
        controller.close();
      },
    }), { headers: { 'content-type': 'text/event-stream' } });
    const toolAgentStream = openAiLlm(cfg, (event) => {
      toolEvents.push(event);
      if (event.phase === 'live' && event.toolCalls?.some((call) => call.name === 'read_source')) releaseTool();
    });
    const toolReply = await toolAgentStream.tool!('system', [{ role: 'user', content: '目录' }], [
      { name: 'read_source', description: '读目录中的小节', parameters: { type: 'object' } },
    ]);
    ok(toolEvents.some((event) => event.phase === 'live' && event.toolCalls?.some((call) =>
      call.name === 'read_source' && call.arguments.includes('{"sectionId":"sec_') && call.state === 'streaming')),
      '工具名与参数作为独立结构在模型流中途推送到任务详情');
    ok(toolEvents.some((event) => event.phase === 'live' && event.toolCalls?.some((call) =>
      call.arguments === '{"sectionId":"sec_0123456789abcdef"}' && call.state === 'streaming')),
      '工具流结束前刷新最后一段参数');
    ok(toolReply.calls[0]?.arguments === '{"sectionId":"sec_0123456789abcdef"}', '流式工具参数被完整拼接后交给 JIT 执行器');
    toolReply.reportToolResult?.('read-1', { ok: true, detail: '已读取 20 字符' });
    ok(toolEvents.at(-1)?.phase === 'tools' && toolEvents.at(-1)?.toolCalls?.[0]?.state === 'complete',
      '工具执行结果单独更新步骤状态，而不拼进模型消息');

    const requests: Array<{ stream?: boolean; stream_options?: unknown }> = [];
    globalThis.fetch = async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      requests.push(request);
      if (request.stream_options) return new Response('unsupported stream_options', { status: 400 });
      if (request.stream) return new Response('stream not supported', { status: 422 });
      return Response.json({ choices: [{ message: { content: '完整回复' } }] });
    };
    const fallbackEvents: Array<{ call: number; phase: string }> = [];
    const batch = openAiLlm(cfg, (event) => fallbackEvents.push({ call: event.call, phase: event.phase }));
    const batchText = await batch.ask('system', 'user');
    await batch.ask('system', 'user');
    ok(batchText === '完整回复' && requests.length === 4 && requests[0].stream_options !== undefined &&
      requests[1].stream === true && requests[1].stream_options === undefined && !requests[2].stream && !requests[3].stream &&
      !fallbackEvents.some((event) => event.phase === 'live') && fallbackEvents.some((event) => event.phase === 'batch') &&
      new Set(fallbackEvents.map((event) => event.call)).size === 2,
      '不支持流式用量或流式输出时逐级降级，非流式回复不冒充实时输出');

    requests.length = 0;
    globalThis.fetch = async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      requests.push(request);
      if (request.stream_options) return new Response('unsupported stream_options', { status: 400 });
      if (request.stream) return new Response('stream not supported', { status: 422 });
      return Response.json({ choices: [{ message: { tool_calls: [{ id: 'read-1', function: {
        name: 'read_source', arguments: JSON.stringify({ sectionId: sortSectionId }),
      } }] } }] });
    };
    const fallbackTool = openAiLlm(cfg, () => {}).tool!;
    const fallbackSpec = [{ name: 'read_source', description: '读取章节', parameters: { type: 'object' } }];
    const fallbackMessages = [{ role: 'user' as const, content: '目录' }];
    const batchTool = await fallbackTool('system', fallbackMessages, fallbackSpec);
    await fallbackTool('system', fallbackMessages, fallbackSpec);
    ok(requests.length === 4 && !!requests[0].stream_options && requests[1].stream === true &&
      !requests[1].stream_options && !requests[2].stream && !requests[3].stream &&
      batchTool.calls[0]?.arguments === JSON.stringify({ sectionId: sortSectionId }),
      '工具调用兼容无用量流和非流式响应，并缓存可用模式');

    globalThis.fetch = async () => new Response(content('半截回复'), { headers: { 'content-type': 'text/event-stream' } });
    const error = await openAiLlm(cfg, () => {}).ask('system', 'user').catch((err: Error) => err.message);
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
} finally {
  globalThis.fetch = originalFetch;
  setServiceBase(originalBase);
}

for (const file of sectionFiles) unlinkSync(join(sectionDir, `${file.id}.md`));
rmdirSync(sectionDir);
process.exitCode = fails ? 1 : 0;
