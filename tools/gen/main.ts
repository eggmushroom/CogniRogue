/**
 * 题库生成器（构建期）。**不进游戏、不进构建、不联网运行时**。
 *
 *   npm run gen -- --src=book.md --out=packs/gen.md
 *   npm run gen -- --src=book.md --feedback=cognirogue-study.json --force
 *
 * 半自动是刻意的：它只**写文件**，不提交、不覆盖已有题库（除非 `--force`），
 * 也不改课程表。生成物进 git，diff 由人 review —— 模型给的内容必须过一次人眼，
 * 这一步不能自动化，因为"题目好不好"没有断言能验。
 *
 * 环境变量：GEN_API_KEY（必填）、GEN_BASE_URL、GEN_MODEL、GEN_VERBOSE=1。
 * Key 只从环境读，不接受命令行参数：命令行会进 shell 历史。
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DEFAULT_BUDGET, chunkMarkdown, readSection, splitText, tocText } from './chunk';
import { planText, planTocText } from './plan';
import type { Plan } from './plan';
import { emitPack, checkPack, conceptByQid } from './emit';
import type { GenTopic } from './emit';
import { generateTopic } from './generate';
import { configFromEnv, openAiLlm } from './llm';
import { mergeSnapshot, memText, readTopicMem, writeTopicMem } from './memory';
import type { StudySnapshot, TopicMem } from './memory';

interface Opts {
  src: string;
  out: string;
  depth: number;
  per: number;
  budget: number;
  memory: string;
  feedback?: string;
  /** 划分计划 json（`npm run plan` 的产物）。给了就不再看标题层级。 */
  plan?: string;
  dryRun: boolean;
  force: boolean;
}

/** 白名单解析：认不出的 `--xxx` 直接退出，不许静默忽略。 */
function parseArgs(argv: string[]): Opts | null {
  const known = new Set(['src', 'out', 'depth', 'per', 'budget', 'memory', 'feedback', 'plan']);
  const flags = new Set(['dry-run', 'force']);
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
      '       [--budget=6000] [--memory=gen/memory] [--feedback=<导出的错题.json>] [--dry-run] [--force]');
    return null;
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
    feedback: val.feedback,
    ...(val.plan ? { plan: val.plan } : {}),
    dryRun: on.has('dry-run'),
    force: on.has('force'),
  };
}

/**
 * 更新记忆：这一轮出了哪些题记进 `gen` 与 `stem`，
 * 老概念保留（题库会被整份重写，记忆不跟着重写）。
 */
function commitMemory(mem: TopicMem, got: GenTopic): void {
  for (const q of got.questions) {
    const c = mem.concepts[q.concept];
    if (c && c.stem === q.stem) {
      c.gen += 1;
    } else if (c) {
      // 概念还在、问法变了：算重出一次，战绩不清零
      c.stem = q.stem;
      c.gen += 1;
    } else {
      mem.concepts[q.concept] = { stem: q.stem, gen: 1, ok: 0, bad: 0 };
    }
  }
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
  const source = readFileSync(srcPath, 'utf8');
  const srcLabel = opts.src.replace(/\\/g, '/');

  const doc = chunkMarkdown(source, opts.budget);

  /**
   * 这一轮要跑的几个主题。两种来路：
   *   · `--plan=`（`npm run plan` 的产物）—— 玩家确认过的划分，切点、名字、合并都由它定；
   *   · 不给计划 —— 老路：第 `--depth` 级标题各算一个主题。
   *
   * 两种来路都落成 `{ topic, text }`：本节**连同子节**的全文。
   * 只取 `doc.chunks` 里属于本节的那些块会拿到空串 —— 书的章常常只有一行标题，
   * 内容全在 `###` 子节里，这一步错得很安静：模型照样会出题，只是凭空编。
   */
  const plan: Plan | null = opts.plan
    ? (JSON.parse(readFileSync(resolve(opts.plan), 'utf8')) as Plan)
    : null;
  const jobs: Array<{ topic: string; text: string }> = plan
    ? plan.topics.map((t) => ({ topic: t.title, text: planText(source, t) }))
    : doc.toc
      .filter((e) => e.path.length === opts.depth)
      .map((e) => ({ topic: e.path[e.path.length - 1], text: readSection(source, e.path) ?? '' }));

  if (!jobs.length) {
    console.error(plan
      ? '✗ 计划里一节都没有。先跑 `npm run plan` 看看切分结果。'
      : `✗ 源文档里没有第 ${opts.depth} 级标题，切不出主题。先看看目录：\n${tocText(doc).slice(0, 600)}`);
    process.exitCode = 1;
    return;
  }

  /** 本节正文按预算切块（块只影响喂模型时的分片粒度，不改变内容）。 */
  const sectionParts = (topic: string, text: string) =>
    splitText(text, opts.budget)
      .map((t, i) => ({ path: [topic], text: t, part: i, size: t.length }));

  /** JIT 取数：计划模式下按节名取，老路按标题路径取。 */
  const readBy = plan
    ? (path: string[]) => {
      const hit = plan.topics.find((t) => t.title === path[path.length - 1]);
      return hit ? planText(source, hit) : null;
    }
    : (path: string[]) => readSection(source, path);

  /** 给模型看的"这本书有什么"：计划模式用它自己的节名 + 摘要。 */
  const tocForPrompt = plan ? planTocText(plan) : tocText(doc);

  const outPath = resolve(opts.out);
  if (existsSync(outPath) && !opts.force && !opts.dryRun) {
    console.error(`✗ ${opts.out} 已存在。生成器不覆盖题库：确认要重写就加 --force。`);
    process.exitCode = 1;
    return;
  }

  // 玩家导出的错题：先按「当前题库的 qid → 概念」映射进记忆，再生成
  const oldPack = existsSync(outPath) ? readFileSync(outPath, 'utf8') : '';
  const snapshot = opts.feedback
    ? (JSON.parse(readFileSync(resolve(opts.feedback), 'utf8')) as StudySnapshot)
    : null;
  const map = snapshot ? conceptByQid(oldPack) : {};

  const cfg = configFromEnv();
  if (!opts.dryRun && !cfg.apiKey) {
    console.error('✗ 没有 GEN_API_KEY。先设置环境变量：\n' +
      '  PowerShell:  $env:GEN_API_KEY="sk-…"; $env:GEN_BASE_URL="https://api.deepseek.com"\n' +
      '  bash:        export GEN_API_KEY=sk-…');
    process.exitCode = 1;
    return;
  }
  const llm = openAiLlm(cfg);

  console.log(`源文档 ${opts.src}｜主题 ${jobs.length} 个（${plan ? `计划：${plan.tier}` : `第 ${opts.depth} 级标题`}）｜每主题 ${opts.per} 道`);
  if (snapshot) console.log(`错题快照 ${opts.feedback}：${Object.keys(snapshot.topics).length} 个主题有记录`);
  if (opts.dryRun) console.log('（--dry-run：只切分，不调模型、不写文件）');

  const results: GenTopic[] = [];
  // 记忆先攒着：题库没过校验就整份不写，记忆也不能先记一笔 "出过这些题"。
  const pending: Array<{ mem: TopicMem; topic: string }> = [];
  let mergedAll = 0;
  let orphanAll = 0;

  for (const { topic, text } of jobs) {
    const mem = readTopicMem(opts.memory, topic, srcLabel);

    if (snapshot) {
      const r = mergeSnapshot(mem, snapshot, map);
      mergedAll += r.merged;
      orphanAll += r.orphan;
      if (r.merged || r.orphan) {
        console.log(`  ${topic}：并进 ${r.merged} 个概念的战绩${r.orphan ? `，${r.orphan} 个 qid 对不上概念（跳过）` : ''}`);
      }
    }

    if (opts.dryRun) {
      const parts = sectionParts(topic, text);
      console.log(`  ${topic}｜${text.trim().length} 字｜${parts.length} 块｜` +
        `最大 ${parts.length ? Math.max(...parts.map((p) => p.size)) : 0} 字`);
      continue;
    }

    const job = {
      topic,
      chunks: sectionParts(topic, text),
      toc: tocForPrompt,
      memory: memText(mem),
      per: opts.per,
      read: readBy,
    };

    // 块只决定分片粒度，不改请求内容：一节的所有块会一起进同一次请求。
    // 目录层的一节可能是一整章（几万字），这里至少让人看见它有多长。
    if (text.length > 30000) {
      console.log(`  ! ${topic}：${text.length} 字，这一次请求很长；用 npm run plan 可以把一节切小`);
    }

    const r = await generateTopic(job, llm);
    const got: GenTopic = { topic, questions: r.questions };
    commitMemory(mem, got);
    pending.push({ mem, topic });
    results.push(got);

    const tag = r.questions.length ? '✓' : '✗';
    console.log(`  ${tag} ${topic}：${r.questions.length}/${opts.per} 道` +
      (r.reads.length ? `，JIT 读了 ${r.reads.length} 节（${r.reads.join(' / ')}）` : ', 没取数') +
      (r.dropped.length ? `，丢 ${r.dropped.length} 条` : ''));
    for (const d of r.dropped.slice(0, 4)) console.log(`      · ${d.reason}${d.stem ? `：${d.stem.slice(0, 40)}` : ''}`);
  }

  if (opts.dryRun) return;

  // 空主题不写进题库：写个只有标题的章节，玩家那一幕会抽不到题
  const pack = emitPack(doc.title || plan?.name || '生成的题库', results.filter((t) => t.questions.length));
  const check = checkPack(pack);
  if (!check.ok) {
    console.error(`\n✗ 生成的题库没通过游戏自己的解析器（${check.issues.length} 处），没有写入：`);
    for (const i of check.issues.slice(0, 10)) console.error(`  ${i}`);
    process.exitCode = 1;
    return;
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, pack, 'utf8');
  for (const p of pending) writeTopicMem(opts.memory, p.mem);

  const written = results.reduce((n, t) => n + t.questions.length, 0);
  console.log(`\n✓ 写入 ${opts.out}：${written} 道题 / ${results.filter((t) => t.questions.length).length} 个主题，` +
    `已过 parse.ts 校验（${check.count} 道可载入）`);
  if (snapshot) console.log(`  记忆并进 ${mergedAll} 个概念${orphanAll ? `，${orphanAll} 个 qid 没有对应概念` : ''}`);
  console.log('  下一步：看 diff（git diff ' + opts.out + '），跑 npm run verify，满意了再提交。');
}

main().catch((err: unknown) => {
  console.error(`✗ ${(err as Error).message}`);
  process.exitCode = 1;
});
