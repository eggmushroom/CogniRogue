import type { JobActivityEvent } from '../../src/core/library/remote';
/**
 * 题库生成器（构建期）。**不进游戏、不进构建、不联网运行时**。
 *
 *   npm run gen -- --src=book.md --out=packs/gen.md
 *   npm run gen -- --src=book.md --feedback=cognirogue-study.json
 *
 * 半自动是刻意的：它只写文件；已有题库作为基底，只追加新概念的题，
 * 也不改课程表。生成物进 git，diff 由人 review —— 模型给的内容必须过一次人眼，
 * 这一步不能自动化，因为"题目好不好"没有断言能验。
 *
 * 环境变量：GEN_API_KEY（必填）、GEN_BASE_URL、GEN_MODEL；审核可用 REVIEW_* 单独覆盖，留空时沿用生成模型配置。
 * Key 只从环境读，不接受命令行参数：命令行会进 shell 历史。
 */
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { DEFAULT_BUDGET, chunkMarkdown, splitText, tocText } from './chunk';
import { planText, tocPlan } from './plan';
import type { Plan } from './plan';
import { appendPack, emitPack, checkPack, knowledgeIdByQid } from './emit';
import type { GenTopic } from './emit';
import { generateTopic } from './generate';
import { configFromEnv, openAiLlm, reviewConfigFromEnv } from './llm';
import { reviewQuestions } from './review';
import { traceIdentity, traced, tracedSync } from './trace';
import {
  MEM_V, changedTopicMemFiles, mergeSnapshot, memText, prepareSections, readMemorySection,
  readTopicMem, recordApprovedQuestions, sourceIndexText, syncBankQuestions, topicIdOf,
  type StudySnapshot, type TopicMem,
} from './memory';
import { parseQuestionBank } from '../../src/core/library/parse';
import { atomicWrite, commitFiles } from './files';

function checkpointPath(outPath: string): string { return `${outPath}.checkpoint.json`; }

interface Opts {
  src: string;
  out: string;
  depth: number;
  per: number;
  budget: number;
  memory: string;
  sections: string;
  feedback?: string;
  /** 划分计划 json（`npm run plan` 的产物）。给了就不再看标题层级。 */
  plan?: string;
  /** 只生成划分计划中的一个主题（从 0 开始）。 */
  topic?: number;
  /** 服务按稳定主题 ID 单独调度的生成任务。 */
  topicId?: string;
  /** 服务任务的完成回执路径；只在所有文件提交后写。 */
  complete?: string;
  dryRun: boolean;
}

/** 白名单解析：认不出的 `--xxx` 直接退出，不许静默忽略。 */
function parseArgs(argv: string[]): Opts | null {
  const known = new Set(['src', 'out', 'depth', 'per', 'budget', 'memory', 'sections', 'feedback', 'plan', 'topic', 'topic-id', 'complete']);
  const flags = new Set(['dry-run']);
  const val: Record<string, string> = {};
  const on = new Set<string>();

  for (const a of argv) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a);
    if (!m) throw new Error(`认不出的参数：${a}`);
    const [, key, v] = m;
    if (flags.has(key)) { on.add(key); continue; }
    if (!known.has(key)) throw new Error(`认不出的参数：--${key}`);
    if (v === undefined) throw new Error(`--${key} 需要值，写法是 --${key}=…`);
    val[key] = v;
  }
  if (!val.src) {
    console.log('用法：npm run gen -- --src=<源文档.md> [--out=packs/gen.md] [--depth=2] [--per=6]\n' +
      '       [--budget=6000] [--memory=gen/memory] [--feedback=<导出的错题.json>] [--dry-run]');
    return null;
  }
  if (val['topic-id'] !== undefined && !/^t_[a-f0-9]{24}$/.test(val['topic-id'])) {
    throw new Error(`--topic-id 要求有效的 t_ 主题 ID，拿到 ${val['topic-id']}`);
  }
  if (val.topic !== undefined && val['topic-id'] !== undefined) throw new Error('--topic 与 --topic-id 不能同时使用');
  if (val.topic !== undefined && !/^\d+$/.test(val.topic)) {
    throw new Error(`--topic 要从 0 开始的非负整数，拿到 ${val.topic}`);
  }
  const num = (k: string, d: number) => {
    if (val[k] === undefined) return d;
    const n = Number(val[k]);
    if (!Number.isInteger(n) || n <= 0) throw new Error(`--${k} 要正整数，拿到 ${val[k]}`);
    return n;
  };
  return {
    src: val.src,
    out: val.out ?? 'packs/generated.md',
    depth: num('depth', 2),
    per: num('per', 6),
    budget: num('budget', DEFAULT_BUDGET),
    memory: val.memory ?? 'gen/memory',
    sections: val.sections ?? (val.plan && !val.memory ? `${val.plan}.sections` : `${val.memory ?? 'gen/memory'}/sections`),
    feedback: val.feedback,
    ...(val.plan ? { plan: val.plan } : {}),
    ...(val.topic !== undefined ? { topic: Number(val.topic) } : {}),
    ...(val['topic-id'] ? { topicId: val['topic-id'] } : {}),
    ...(val.complete ? { complete: val.complete } : {}),
    dryRun: on.has('dry-run'),
  };
}

async function main(): Promise<void> {
  let parsedOpts: Opts | null;
  try {
    parsedOpts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    process.exitCode = 2;
    return;
  }
  if (!parsedOpts) return;
  const opts = parsedOpts;

  const srcPath = resolve(opts.src);
  const srcLabel = srcPath;
  const planData = opts.plan ? readFileSync(resolve(opts.plan), 'utf8') : '';
  let source: string | undefined;
  const loadSource = () => source ??= readFileSync(srcPath, 'utf8');

  /**
   * 这一轮要跑的几个主题。两种来路：
   *   · `--plan=`（`npm run plan` 的产物）—— 玩家确认过的划分，切点、名字、合并都由它定；
   *   · 不给计划 —— 老路：第 `--depth` 级标题各算一个主题。
   *
   * 服务下发的计划已经带章节文件索引，只有 CLI 和旧计划需要读原文准备索引。
   */
  const plan: Plan | null = opts.plan
    ? (JSON.parse(planData) as Plan)
    : tocPlan(loadSource(), { name: chunkMarkdown(loadSource(), opts.budget).title || opts.src, depth: opts.depth, size: opts.budget });
  if (plan && plan.v !== 2) {
    const files = prepareSections(plan, srcLabel, loadSource());
    for (const file of files) atomicWrite(resolve(opts.sections, `${file.id}.md`), file.content);
    if (opts.plan) atomicWrite(resolve(opts.plan), JSON.stringify(plan, null, 2) + '\n');
  }
  const allJobs = plan?.topics ?? [];

  const sectionParts = (topic: string, text: string) =>
    splitText(text, opts.budget).map((part, index) => ({ path: [topic], text: part, part: index, size: part.length }));

  if (opts.topic !== undefined && (!Number.isInteger(opts.topic) || opts.topic < 0)) {
    console.error('✗ --topic 要从 0 开始的非负整数。');
    process.exitCode = 2;
    return;
  }
  if (opts.topic !== undefined && !opts.plan) {
    console.error('✗ --topic 只适用于带 --plan 的生成任务。');
    process.exitCode = 2;
    return;
  }
  if (opts.topic !== undefined && opts.topic >= allJobs.length) {
    console.error(`✗ 主题序号 ${opts.topic} 不存在；计划共有 ${allJobs.length} 节。`);
    process.exitCode = 2;
    return;
  }
  if (opts.topicId !== undefined && !opts.plan) {
    console.error('✗ --topic-id 只适用于带 --plan 的生成任务。');
    process.exitCode = 2;
    return;
  }
  const topicById = opts.topicId === undefined ? undefined : allJobs.find((job) => job.id === opts.topicId);
  if (opts.topicId !== undefined && !topicById) {
    console.error(`✗ 主题 ID ${opts.topicId} 不在当前计划中。`);
    process.exitCode = 2;
    return;
  }
  const jobs = opts.topicId !== undefined ? [topicById!] : opts.topic === undefined ? allJobs : [allJobs[opts.topic]];

  if (!jobs.length) {
    console.error(opts.plan
      ? '✗ 计划里一节都没有。先跑 `npm run plan` 看看切分结果。'
      : `✗ 源文档里没有第 ${opts.depth} 级标题，切不出主题。先看看目录：\n${tocText(chunkMarkdown(loadSource())).slice(0, 600)}`);
    process.exitCode = 1;
    return;
  }

  const outPath = resolve(opts.out);
  // 已有题库是增量更新的基底，成功生成后只追加新题。
  const oldPack = existsSync(outPath) ? readFileSync(outPath, 'utf8') : '';
  const oldBank = parseQuestionBank(oldPack);
  const oldQids = new Set(Object.values(oldBank.byTopic).flat().map((question) => question.qid));
  const feedback = opts.feedback ? readFileSync(resolve(opts.feedback), 'utf8') : null;
  const snapshot = feedback === null ? null : JSON.parse(feedback) as StudySnapshot;

  const cfg = configFromEnv();
  if (!opts.dryRun && !cfg.apiKey) {
    console.error('✗ 没有 GEN_API_KEY。先设置环境变量：\n' +
      '  PowerShell:  $env:GEN_API_KEY="sk-…"; $env:GEN_BASE_URL="https://api.deepseek.com"\n' +
      '  bash:        export GEN_API_KEY=sk-…');
    process.exitCode = 1;
    return;
  }
  const llm = openAiLlm(cfg);
  const reviewCfg = reviewConfigFromEnv();
  const reviewer = openAiLlm({ ...reviewCfg, timeoutMs: 45_000, retries: 1 });
  if (!opts.dryRun) console.log(`题目审核：${reviewCfg.model}${process.env.REVIEW_MODEL?.trim() ? '（独立配置）' : '（沿用生成模型）'}`);

  console.log(`源文档 ${opts.src}｜主题 ${jobs.length} 个${opts.topic !== undefined ? `（计划第 ${opts.topic + 1} 节）` : opts.topicId !== undefined ? `（主题 ID ${opts.topicId}）` : ''}（${plan ? `计划：${plan.tier}` : `第 ${opts.depth} 级标题`}）｜每主题 ${opts.per} 道`);
  if (snapshot) console.log(`答题增量 ${opts.feedback}：${snapshot.v === 3 ? snapshot.records.length : Object.keys(snapshot.topics).length} 条`);
  if (opts.dryRun) console.log('（--dry-run：只切分，不调模型、不写文件）');

  const checkpoint = checkpointPath(outPath);
  const saved = existsSync(checkpoint)
    ? JSON.parse(readFileSync(checkpoint, 'utf8')) as { key: string; results: GenTopic[]; memories: TopicMem[]; reviewRun?: string }
    : { key: '', results: [], memories: [] };
  const digest = (text: string) => createHash('sha256').update(text).digest('hex');
  const runKey = JSON.stringify({
    v: MEM_V, generation: 'model-review-v2', srcLabel, source: jobs.every((topic) => topic.sections?.length) ? '' : digest(loadSource()), plan: digest(opts.plan ? readFileSync(resolve(opts.plan), 'utf8') : planData),
    feedback: feedback === null ? '' : digest(feedback),
    memory: resolve(opts.memory), sections: resolve(opts.sections), depth: opts.depth, topic: opts.topic ?? opts.topicId ?? null, per: opts.per,
    // 服务重启恢复会重用同一回执；用户重试会获得新回执，不能复用空结果检查点。
    complete: opts.complete ? resolve(opts.complete) : null,
    reviewer: `${reviewCfg.baseUrl}|${reviewCfg.model}`,
  });
  const resumable = saved.key === runKey;
  const reviewRun = (resumable && saved.reviewRun) || randomUUID();
  const completed = new Map<string, { result: GenTopic; memory: TopicMem }>(
    resumable ? saved.results.map((result, i) => [saved.memories[i].topicId, { result, memory: saved.memories[i] }]) : [],
  );
  const results: GenTopic[] = [];
  // 记忆先攒着：题库没过校验就整份不写，记忆也不能先记一笔 "出过这些题"。
  const memories: TopicMem[] = [];
  let mergedAll = 0;
  let orphanAll = 0;
  let candidateCount = 0;
  console.log('@@progress ' + JSON.stringify({ phase: 'topics', completed: completed.size, total: jobs.length, label: '按主题生成题目' }));

  for (let index = 0; index < jobs.length; index += 1) {
    const section = jobs[index];
    const topic = section.title;
    const topicId = section.id ?? topicIdOf(srcLabel, planData || loadSource(), section);
    if (opts.dryRun) {
      const text = planText(loadSource(), section);
      const parts = sectionParts(topic, text);
      console.log(`  ${topic}｜${text.trim().length} 字｜${parts.length} 块｜` +
        `最大 ${parts.length ? Math.max(...parts.map((p) => p.size)) : 0} 字`);
      continue;
    }
    const cached = completed.get(topicId);
    const mem = cached?.memory ?? readTopicMem(opts.memory, topic, srcLabel, topicId);
    if (section.sections?.length) {
      mem.sections = section.sections;
    }
    const oldQuestions = oldBank.byTopic[topicId] ?? oldBank.byTopic[topic] ?? [];
    syncBankQuestions(mem, oldQuestions);

    // 检查点已合并这份快照，恢复时直接使用当时的记忆。
    if (snapshot && !cached) {
      const r = mergeSnapshot(mem, snapshot, knowledgeIdByQid(oldQuestions));
      mergedAll += r.merged;
      orphanAll += r.orphan;
      if (r.merged || r.orphan) {
        console.log(`  ${topic}：并进 ${r.merged} 个概念的战绩${r.orphan ? `，${r.orphan} 个 qid 对不上概念（跳过）` : ''}`);
      }
    }

    if (cached) {
      results.push(cached.result);
      for (const q of cached.result.questions) oldQids.add(q.qid);
      memories.push(mem);
      tracedSync('topic.resume', { topicId, reviewRun, passed: cached.result.questions.length }, () => {});
      console.log(`阶段 ${index + 1}/${jobs.length} 已从检查点恢复：${topic}`);
      continue;
    }

    const activity = (event: JobActivityEvent) => {
      console.log('@@activity ' + JSON.stringify(event));
    };
    const sectionTitles = new Map((mem.sections ?? []).map(({ id, title }) => [id, title]));
    const job = {
      topic,
      topicId,
      toc: sourceIndexText(mem),
      memory: memText(mem, opts.per),
      per: opts.per,
      read: (sectionId: string) => tracedSync('source.read', { sectionId: /^sec_[a-f0-9]{16}$/.test(sectionId) ? sectionId : undefined }, (finish) => {
        const text = readMemorySection(mem, opts.sections, sectionId);
        if (text) activity({ kind: 'source', title: sectionTitles.get(sectionId) ?? topic, active: false });
        finish(text ? 'ok' : 'missing', { chars: text?.length ?? 0 });
        return text;
      }),
      onModelRequest: (hasSource: boolean) => activity({ kind: hasSource ? 'draft' : 'index', active: true }),
    };

    const r = await traced('topic.generate', { topicId }, async (finish) => {
      const result = await generateTopic(job, llm);
      finish(result.questions.length ? 'ok' : 'empty', { rounds: result.rounds, candidates: result.questions.length, dropped: result.dropped.length });
      return result;
    });
    const candidates = r.questions.filter((q) => !oldQids.has(q.qid));
    candidateCount += candidates.length;
    const reviewProgress = (completed: number) => console.log('@@progress ' + JSON.stringify({
      phase: 'review', completed, total: candidates.length, label: topic,
    }));
    if (candidates.length) {
      reviewProgress(0);
      activity({ kind: 'review', total: candidates.length, active: true });
    }
    const verdicts = await traced('topic.review', { topicId, candidates: candidates.length }, () =>
      reviewQuestions(reviewer, candidates.map((q) => ({
        ...q, sources: q.sectionIds.map((sectionId) => ({ sectionId, text: r.sources.get(sectionId)! })),
      })), 4, reviewProgress));
    const reviewed = candidates.map((question, index) => ({ question, ...verdicts[index]! }));
    const fresh = reviewed.filter((r) => r.verdict === 'pass').map(({ question }) => question);
    const rejected = reviewed.filter((r) => r.verdict === 'reject').length;
    const awaiting = reviewed.length - fresh.length - rejected;
    if (reviewed.length) activity({ kind: 'reviewed', passed: fresh.length, rejected, pending: awaiting, active: false });
    const report = resolve(opts.memory, 'reviews', reviewRun, `${topicId}.json`);
    tracedSync('review.report', { topicId, reviewRun }, () => atomicWrite(report, JSON.stringify({
      ...traceIdentity(), topic, topicId, reviewRun, reviewer: reviewCfg.model, reviewedAt: new Date().toISOString(),
      reviewed, dropped: r.dropped, duplicates: r.questions.length - candidates.length,
    }, null, 2) + '\n'));
    for (const q of fresh) oldQids.add(q.qid);
    const got: GenTopic = { topic, topicId, questions: fresh };
    recordApprovedQuestions(mem, fresh);
    memories.push(mem);
    results.push(got);
    const checkpointData = {
      key: runKey,
      reviewRun,
      results: [...results],
      memories,
    };
    atomicWrite(checkpoint, JSON.stringify(checkpointData, null, 2) + '\n');
    if (index + 1 < jobs.length) {
      console.log(`@@progress ${JSON.stringify({ phase: 'topics', completed: index + 1, total: jobs.length, label: topic })}`);
    }

    const tag = fresh.length ? '✓' : '✗';
    console.log(`  ${tag} ${topic}：${fresh.length}/${opts.per} 道` +
      (r.reads.length ? `，JIT 读了 ${r.reads.length} 节（${r.reads.join(' / ')}）` : ', 没取数') +
      `；模型拒绝 ${rejected} 道，待审 ${awaiting} 道，格式/去重跳过 ${r.dropped.length + r.questions.length - candidates.length} 条`);
    console.log(`  审核报告：${report}`);
    for (const d of r.dropped.slice(0, 4)) console.log(`      · ${d.reason}${d.stem ? `：${d.stem.slice(0, 40)}` : ''}`);
  }

  if (opts.dryRun) return;

  const newCount = results.reduce((n, t) => n + t.questions.length, 0);
  if (!newCount) {
    tracedSync('bank.commit', { candidates: candidateCount }, (finish) => finish('skipped', { written: 0 }));
    // 整轮已跑完，清掉空检查点，避免下次原样恢复一个没有新题的结果。
    unlinkSync(checkpoint);
    console.error(candidateCount
      ? `\n✗ 候选题均未通过审核或仍待审核；题库和主题记忆均未改动。`
      : `\n✗ 生成器没有产出可审核的新题；请查看上方 JIT 读取与模型输出诊断。题库和主题记忆均未改动。`);
    process.exitCode = 1;
    return;
  }

  // 空主题不写进题库：写个只有标题的章节，玩家那一幕会抽不到题
  const delta = emitPack(plan?.name || '生成的题库', results.filter((t) => t.questions.length));
  const pack = oldPack.trim() ? appendPack(oldPack, delta) : delta;
  const check = checkPack(pack);
  if (!check.ok) {
    tracedSync('bank.commit', {}, (finish) => finish('invalid-bank', { written: 0, issues: check.issues.length }));
    console.error(`\n✗ 生成的题库没通过游戏自己的解析器（${check.issues.length} 处），没有写入：`);
    for (const i of check.issues.slice(0, 10)) console.error(`  ${i}`);
    process.exitCode = 1;
    return;
  }

  const files = [{ target: outPath, content: pack }, ...memories.flatMap((mem) => changedTopicMemFiles(opts.memory, mem))];
  console.log('@@progress ' + JSON.stringify({ phase: 'commit', completed: jobs.length, total: jobs.length, label: '正在提交题库与主题记忆', written: newCount }));
  tracedSync('bank.commit', { files: files.length }, (finish) => {
    commitFiles(outPath, files, opts.complete ? resolve(opts.complete) : undefined);
    finish('ok', { written: newCount, qids: results.flatMap((topic) => topic.questions.map((q) => q.qid)) });
  });
  unlinkSync(checkpoint);

  console.log(`\n✓ 写入 ${opts.out}：${newCount} 道题 / ${results.filter((t) => t.questions.length).length} 个主题，` +
    `已过 parse.ts 校验（${check.count} 道可载入）`);
  if (snapshot) console.log(`  记忆并进 ${mergedAll} 个概念${orphanAll ? `，${orphanAll} 个 qid 没有对应概念` : ''}`);
  console.log('  下一步：看 diff（git diff ' + opts.out + '），跑 npm run verify，满意了再提交。');
  console.log('@@progress ' + JSON.stringify({ phase: 'complete', completed: jobs.length, total: jobs.length, label: '文件已完整写入', written: newCount }));
}

main().catch((err: unknown) => {
  console.error(`✗ ${(err as Error).message}`);
  process.exitCode = 1;
});
