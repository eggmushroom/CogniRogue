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
  MERGE_MAX_PARTS, MERGE_PCT, agenticPlan, mergePlan, planTocText, similarEnough, similarity,
  summarizePlan, tocPlan,
} from './plan';
import type { PlanTopic } from './plan';
import { checkPack, conceptByQid, emitPack } from './emit';
import { generateTopic } from './generate';
import type { Llm } from './llm';

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
const paths = doc.toc.map((e) => e.path.join(' > '));

ok(doc.title === '第一章 复杂度', `一级标题当书名（${doc.title}）`);
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
    { concept: 'algo/binary-worst', stem: '二分最坏比较几次？', options: ['O(1)', 'O(log n)'], answer: 1, explain: '每次折半。' },
    { concept: 'algo/sort-lower', stem: '比较排序的下界？', options: ['n log n', 'n', '以上都对'], answer: 0, noShuffle: true },
  ],
}]);
const chk = checkPack(packText);
ok(chk.ok && chk.count === 2, `渲染出的题库能过游戏自己的解析器（${chk.count} 道，${chk.issues.length} 条问题）`);
ok(packText.includes('~ algo/binary-worst') && packText.includes('= B'),
  '概念行与答案字母都由代码写出来，不靠模型拼');

const qidMap = conceptByQid(packText);
ok(Object.keys(qidMap).length === 2 && Object.values(qidMap).includes('algo/sort-lower'),
  'qid → 概念 的映射能把玩家数据对回概念');

// ── 一个主题 = 一个子 agent：JIT 取数 + 校验 + 去重（全离线，假模型） ──
const asked: string[] = [];
let round = 0;
const fake: Llm = {
  ask: async (_sys, user) => {
    asked.push(user);
    round += 1;
    if (round === 1) return JSON.stringify({ read: ['第一章 复杂度 > 1.2 排序'], questions: [] });
    return JSON.stringify({
      questions: [
        { concept: 'algo/binary-worst', stem: '二分查找最坏比几次？', options: ['O(1)', 'O(log n)'], answer: 1 },
        { concept: 'algo/binary-worst', stem: '重复概念的那道', options: ['甲', '乙'], answer: 0 },
        { concept: 'algo/sort-lower', stem: '下界？', options: ['n', 'n log n', '以上都对'], answer: 1 },
        { concept: 'algo/bad', stem: '答案越界', options: ['甲', '乙'], answer: 5 },
      ],
    });
  },
};
const doc2 = chunkMarkdown(BOOK);
const res = await generateTopic({
  topic: '复杂度',
  chunks: doc2.chunks.filter((c) => c.path.join('>') === '第一章 复杂度'),
  toc: tocText(doc2),
  memory: '（这个主题还没有记忆）',
  per: 6,
  read: (p: string[]) => readSection(BOOK, p),
}, fake);

ok(res.reads.includes('第一章 复杂度 > 1.2 排序'),
  `JIT：模型申请的节真的读给了它（${res.reads.join(' / ')}）`);
ok(asked.length === 2 && asked[1].includes('渐进下界'),
  '第二轮把读到的原文追加进了上下文');
ok(res.questions.length === 2, `合格的题被收下（${res.questions.length} 道）`);
ok(res.questions[1]?.noShuffle === true, '位置依赖的选项自动补上「! 固定顺序」声明');
ok(res.dropped.length === 2
  && res.dropped.some((d) => d.reason.includes('重复'))
  && res.dropped.some((d) => d.reason.includes('越界')),
  `不合格的题被扔下并说明原因（${res.dropped.map((d) => d.reason).join(' / ')}）`);

// 整条链路走一遍：假模型出的题 → 渲染 → 过游戏解析器 → 题号按概念派生
const chain = emitPack('链路自检', [{ topic: '复杂度', questions: res.questions }]);
const chainChk = checkPack(chain);
ok(chainChk.ok && chainChk.count === 2, `假模型的一轮产物能直接载入游戏（${chainChk.count} 道）`);

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
process.exitCode = fails ? 1 : 0;
