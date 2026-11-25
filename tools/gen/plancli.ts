/**
 * 文档 → 划分计划（JSON）。`npm run plan -- --src=doc.md --out=plan.json`
 *
 * 这是「从文档建题库」的第一步，服务端起它、把结果给玩家确认，再起 `npm run gen --plan=…`。
 * 它自己不写题库：切错了只影响一份 json，不会污染 `packs/`。
 *
 *   --mode=auto     有第 --depth 级标题就按目录切，否则按段落装箱（默认，不调用模型）
 *   --mode=toc      只按目录切；切不出来就退出码 1（交给调用方决定要不要问玩家）
 *   --mode=fixed    只按段落装箱
 *   --mode=agentic  让模型按段落分章（要 GEN_API_KEY）；失败回落到 fixed 并记 notes
 *
 * 摘要与合并：有模型就每节一次调用生成摘要，再按摘要相似度合并相邻节；
 * 没有模型（或加了 --no-summaries）就用首句代替，且**不合并** —— 首句不像摘要，
 * 拿它比相似度会把两节不相干的东西并到一起。
 */
import { basename, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { commitFiles } from './files';
import { memFile, prepareSections, readTopicMem } from './memory';
import { configFromEnv, openAiLlm } from './llm';
import type { Llm } from './llm';
import {
  MERGE_PCT, PLAN_DEPTH, PLAN_SIZE, agenticPlan, fixedPlan, mergePlan, pageRange, summarizePlan, tocPlan,
} from './plan';
import type { Plan, PlanOpts } from './plan';

type Mode = 'auto' | 'toc' | 'fixed' | 'agentic';

interface Opts {
  src: string;
  out: string;
  mode: Mode;
  depth: number;
  size: number;
  name: string;
  merge: boolean;
  summaries: boolean;
  complete?: string;
  memory?: string;
  sections?: string;
  document?: string;
}

const USAGE = `用法：npm run plan -- --src=<文档.md> [--out=plan.json] [--mode=auto|toc|fixed|agentic]
        [--depth=${PLAN_DEPTH}] [--size=${PLAN_SIZE}] [--name=显示名] [--no-merge] [--no-summaries]`;

/** 白名单解析：认不出的参数直接退出，不许静默忽略。 */
function parseArgs(argv: string[]): Opts | null {
  const known = new Set(['src', 'out', 'mode', 'depth', 'size', 'name', 'complete', 'memory', 'sections', 'document']);
  const flags = new Set(['no-merge', 'no-summaries']);
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
  if (!val.src) { console.log(USAGE); return null; }

  const num = (k: string, d: number) => {
    if (val[k] === undefined) return d;
    const n = Number(val[k]);
    if (!Number.isInteger(n) || n <= 0) throw new Error(`--${k} 要正整数，拿到 ${val[k]}`);
    return n;
  };
  const mode = (val.mode ?? 'auto') as Mode;
  if (!['auto', 'toc', 'fixed', 'agentic'].includes(mode)) throw new Error(`--mode 只能是 auto / toc / fixed / agentic`);

  return {
    src: val.src,
    out: val.out ?? 'plan.json',
    mode,
    depth: num('depth', PLAN_DEPTH),
    size: num('size', PLAN_SIZE),
    name: (val.name || basename(val.src)).slice(0, 80),
    merge: !on.has('no-merge'),
    summaries: !on.has('no-summaries'),
    ...(val.complete ? { complete: val.complete } : {}),
    ...(val.memory ? { memory: val.memory } : {}),
    ...(val.sections ? { sections: val.sections } : {}),
    ...(val.document ? { document: val.document } : {}),
  };
}

function tierName(p: Plan): string {
  return p.tier === 'toc' ? `目录（第 ${p.depth} 级标题）`
    : p.tier === 'agentic' ? '模型分章'
      : `固定 ${p.size} 字`;
}

async function main(): Promise<void> {
  let parsed: Opts | null;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`✗ ${(err as Error).message}\n${USAGE}`);
    process.exitCode = 2;
    return;
  }
  if (!parsed) return;
  const opts = parsed;

  const md = readFileSync(resolve(opts.src), 'utf8');
  if (!md.trim()) {
    console.error('✗ 源文档是空的。');
    process.exitCode = 1;
    return;
  }
  const planOpts: PlanOpts = { name: opts.name, depth: opts.depth, size: opts.size };

  const cfg = configFromEnv();
  const llm: Llm | null = cfg.apiKey ? openAiLlm(cfg) : null;
  const notes: string[] = [];

  let plan: Plan | null = null;
  if (opts.mode === 'toc' || opts.mode === 'auto') {
    plan = tocPlan(md, planOpts);
    if (!plan) {
      if (opts.mode === 'toc') {
        console.error(`✗ 源文档里没有第 ${opts.depth} 级标题，切不出目录划分。`);
        process.exitCode = 1;
        return;
      }
      notes.push(`没有第 ${opts.depth} 级标题，按段落装箱；模型分章需手动选择。`);
    }
  }
  if (!plan && opts.mode === 'agentic') {
    if (!llm) {
      console.error('✗ 模型划分要 GEN_API_KEY。先配模型，或改用 --mode=fixed。');
      process.exitCode = 1;
      return;
    }
    plan = await agenticPlan(md, planOpts, llm, (s) => console.log(`  ${s}`));
    if (!plan) {
      notes.push('模型没有给出可用的分章，回落到段落装箱。');
      plan = fixedPlan(md, planOpts);
    }
  }
  if (!plan) plan = fixedPlan(md, planOpts);
  if (!plan.topics.length) {
    console.error('✗ 这份文档切不出任何一节（没有正文）。');
    process.exitCode = 1;
    return;
  }
  console.log('@@progress ' + JSON.stringify({ phase: 'split', completed: 1, total: 4, label: `已划分 ${plan.topics.length} 个主题` }));

  // 摘要：模型给的就靠它合并；没有模型就只留首句，并且不合并
  const useModel = !!llm && opts.summaries && opts.mode === `agentic`;
  plan = await summarizePlan(plan, md, useModel ? llm : null, (s) => console.log(`  ${s}`));
  console.log('@@progress ' + JSON.stringify({ phase: 'summary', completed: 2, total: 4, label: '主题摘要已完成' }));
  if (useModel && opts.merge) {
    const before = plan.topics.length;
    plan = mergePlan(plan);
    if (plan.topics.length < before) {
      console.log(`  合并：${before} 节 → ${plan.topics.length} 节（相似度 ≥ ${MERGE_PCT}%）`);
    }
  }
  plan.topics = plan.topics.map((topic) => {
    const pages = pageRange(md, topic.from, topic.to);
    return pages ? { ...topic, ...pages } : topic;
  });
  plan.notes.push(...notes);
  console.log('@@progress ' + JSON.stringify({ phase: 'index', completed: 3, total: 4, label: '页码索引已完成' }));

  const out = resolve(opts.out);
  const files: Array<{ target: string; content: string }> = [];
  const source = resolve(opts.src);
  const sectionDir = opts.sections ?? (opts.memory ? resolve(opts.memory, 'sections') : `${out}.sections`);
  const sections = prepareSections(plan, source, md);
  files.push(...sections.map((section) => ({
      target: resolve(sectionDir, `${section.id}.md`), content: section.content,
  })));
  if (opts.memory) for (const topic of plan.topics) {
    const existing = resolve(memFile(opts.memory, topic.id!));
    const mem = readTopicMem(opts.memory, topic.title, source, topic.id!);
    mem.sections = topic.sections;
    files.push({ target: existing, content: JSON.stringify(mem, null, 2) + '\n' });
  }
  files.push({ target: out, content: JSON.stringify(plan, null, 2) + '\n' });
  if (opts.document) {
    const document = JSON.parse(readFileSync(opts.document, 'utf8'));
    document.planId = basename(out, '.json');
    files.push({ target: resolve(opts.document), content: JSON.stringify(document, null, 2) + '\n' });
  }
  commitFiles(out, files, opts.complete ? resolve(opts.complete) : undefined);

  console.log(`源文档 ${opts.src}｜${tierName(plan)}｜${plan.chars} 字 → ${plan.topics.length} 节`);
  for (const t of plan.topics) {
    const extra = t.merged && t.merged > 1 ? `（并了 ${t.merged} 节，像 ${t.sim}%）` : '';
    const pages = t.pageFrom ? `｜第 ${t.pageFrom}${t.pageTo !== t.pageFrom ? `-${t.pageTo}` : ``} 页` : ``;
    console.log(`  ${t.title}｜${t.chars} 字${pages}${extra}｜${t.summary.slice(0, 40)}`);
  }
  for (const n of plan.notes) console.log(`  ! ${n}`);
  console.log(`✓ 写入 ${opts.out}`);
  console.log('@@progress ' + JSON.stringify({ phase: 'complete', completed: 4, total: 4, label: '划分与主题记忆已保存' }));
}

main().catch((err: unknown) => {
  console.error(`✗ ${(err as Error).message}`);
  process.exitCode = 1;
});
