/**
 * 文档 → 划分计划（JSON）。`npm run plan -- --src=doc.md --out=plan.json`
 *
 * 这是「从文档建题库」的第一步，服务端起它、把结果给玩家确认，再起 `npm run gen --plan=…`。
 * 它自己不写题库：切错了只影响一份 json，不会污染 `packs/`。
 *
 *   --mode=auto     优先按可用标题层级切分，否则按段落装箱（默认，不调用模型）
 *   --mode=toc      只按目录切；切不出来就退出码 1（交给调用方决定要不要问玩家）
 *   --mode=fixed    只按段落装箱
 *   --mode=agentic  逐块提取主题树并全局合并（要 GEN_API_KEY）
 *
 * --overlap 指定模型分章的重叠字符数，设为 0 时关闭重叠。
 * --no-merge 跳过全局合并；--no-summaries 保留首句摘要并跳过全局合并。
 */
import { basename, resolve } from 'node:path';
import { AGENTIC_OVERLAP_CHARS, AGENTIC_WINDOW, MAX_AGENTIC_WINDOW, MIN_AGENTIC_WINDOW } from '../../src/core/model/plan';
import { readFileSync } from 'node:fs';
import { commitFiles } from './files';
import { traced, tracedSync } from './trace';
import { prepareSections, sourceIndexFile } from './memory';
import { configFromEnv, openAiLlm } from './llm';
import type { Llm } from './llm';
import {
  PLAN_DEPTH, PLAN_SIZE, agenticPlan, firstSentence, fixedPlan, pageRange, planText, titledPlan, tocPlan,
} from './plan';
import type { Plan, PlanOpts } from './plan';

type Mode = 'auto' | 'toc' | 'fixed' | 'agentic';

interface Opts {
  src: string;
  out: string;
  mode: Mode;
  depth: number;
  size: number;
  agenticWindow: number;
  agenticOverlapChars: number;
  name: string;
  merge: boolean;
  summaries: boolean;
  complete?: string;
  memory?: string;
  sections?: string;
  document?: string;
}

const USAGE = `用法：npm run plan -- --src=<文档.md> [--out=plan.json] [--mode=auto|toc|fixed|agentic]
        [--depth=${PLAN_DEPTH}] [--size=${PLAN_SIZE}] [--window=${AGENTIC_WINDOW}] [--overlap=${AGENTIC_OVERLAP_CHARS}] [--name=显示名] [--no-merge] [--no-summaries]`;

/** 白名单解析：认不出的参数直接退出，不许静默忽略。 */
function parseArgs(argv: string[]): Opts | null {
  const known = new Set(['src', 'out', 'mode', 'depth', 'size', 'window', 'overlap', 'name', 'complete', 'memory', 'sections', 'document']);
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
  const window = num('window', AGENTIC_WINDOW);
  if (window < MIN_AGENTIC_WINDOW || window > MAX_AGENTIC_WINDOW) {
    throw new Error(`--window 必须在 ${MIN_AGENTIC_WINDOW} 到 ${MAX_AGENTIC_WINDOW} 之间`);
  }

  const overlap = val.overlap ?? String(AGENTIC_OVERLAP_CHARS);
  if (!/^\d+$/.test(overlap) || Number(overlap) > window) {
    throw new Error(`--overlap 必须是 0 到 ${window} 的整数（字符数）`);
  }

  return {
    src: val.src,
    out: val.out ?? 'plan.json',
    mode,
    depth: num('depth', PLAN_DEPTH),
    size: num('size', PLAN_SIZE),
    agenticWindow: window,
    agenticOverlapChars: Number(overlap),
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
  const planOpts: PlanOpts = {
    name: opts.name, depth: opts.depth, size: opts.size,
    agenticWindow: opts.agenticWindow, agenticOverlapChars: opts.agenticOverlapChars,
  };

  const cfg = configFromEnv();
  const llm: Llm | null = cfg.apiKey ? openAiLlm(cfg) : null;
  const notes: string[] = [];
  let planningSteps = 1;
  const progress = (phase: string, completed: number, label: string) => {
    console.log('@@progress ' + JSON.stringify({ phase, completed, total: planningSteps + 2, label }));
  };

  let plan: Plan | null = null;
  if (opts.mode === 'toc' || opts.mode === 'auto') {
    plan = opts.mode === 'auto' ? titledPlan(md, planOpts) : tocPlan(md, planOpts);
    if (!plan) {
      if (opts.mode === 'toc') {
        console.error(`✗ 源文档里没有第 ${opts.depth} 级标题，切不出目录划分。`);
        process.exitCode = 1;
        return;
      }
      notes.push('没有可用的章节标题，按段落装箱；模型分章需手动选择。');
    }
  }
  if (!plan && opts.mode === 'agentic') {
    if (!llm) {
      console.error('✗ 模型划分要 GEN_API_KEY。先配模型，或改用 --mode=fixed。');
      process.exitCode = 1;
      return;
    }
    const model = llm;
    plan = await traced('plan.agentic', { window: opts.agenticWindow, overlapChars: opts.agenticOverlapChars }, () =>
      agenticPlan(md, planOpts, model, {
        merge: opts.merge && opts.summaries,
        onProgress: ({ phase, completed, total, label }) => {
          planningSteps = total;
          progress(phase, completed, label);
        },
      }));
    if (!plan) {
      throw new Error('这份文档没有可供模型划分的段落。');
    }
  }
  if (!plan) plan = fixedPlan(md, planOpts);
  if (!plan.topics.length) {
    console.error('✗ 这份文档切不出任何一节（没有正文）。');
    process.exitCode = 1;
    return;
  }
  progress('index', planningSteps, `已划分 ${plan.topics.length} 个主题，正在建立原文索引`);

  const annotate = <T extends Plan['topics'][number]>(topic: T): T => ({
    ...topic,
    ...(topic.summarized === 'none' || !opts.summaries
      ? { summary: firstSentence(planText(md, topic)), summarized: 'none' } : {}),
    ...(plan?.tier === 'agentic' ? {} : pageRange(md, topic.from, topic.to)),
  });
  plan.topics = plan.topics.map((topic) => ({
    ...annotate(topic),
    ...(topic.subtopics ? { subtopics: topic.subtopics.map(annotate) } : {}),
  }));
  plan.notes.push(...notes);

  const out = resolve(opts.out);
  const files: Array<{ target: string; content: string }> = [];
  const source = resolve(opts.src);
  const sectionDir = opts.sections ?? (opts.memory ? resolve(opts.memory, 'sections') : `${out}.sections`);
  const sections = prepareSections(plan, source, md);
  files.push(...sections.map((section) => ({
      target: resolve(sectionDir, `${section.id}.md`), content: section.content,
  })));
  if (opts.memory) for (const topic of plan.topics) {
    files.push(sourceIndexFile(opts.memory, { topicId: topic.id!, topic: topic.title, source, sections: topic.sections }));
  }
  files.push({ target: out, content: JSON.stringify(plan, null, 2) + '\n' });
  if (opts.document) {
    const document = JSON.parse(readFileSync(opts.document, 'utf8'));
    document.planId = basename(out, '.json');
    files.push({ target: resolve(opts.document), content: JSON.stringify(document, null, 2) + '\n' });
  }
  progress('commit', planningSteps + 1, '正在保存划分计划与主题记忆');
  tracedSync('plan.commit', { topics: plan.topics.length, sections: sections.length }, () =>
    commitFiles(out, files, opts.complete ? resolve(opts.complete) : undefined));

  console.log(`源文档 ${opts.src}｜${tierName(plan)}｜${plan.chars} 字 → ${plan.topics.length} 节`);
  for (const t of plan.topics) {
    const extra = t.merged && t.merged > 1 ? `（合并 ${t.merged} 个片段）` : '';
    const pages = t.pageFrom ? `｜第 ${t.pageFrom}${t.pageTo !== t.pageFrom ? `-${t.pageTo}` : ``} 页` : ``;
    console.log(`  ${t.title}｜${t.chars} 字${pages}${extra}｜${t.summary.slice(0, 40)}`);
  }
  for (const n of plan.notes) console.log(`  ! ${n}`);
  console.log(`✓ 写入 ${opts.out}`);
  progress('complete', planningSteps + 2, '划分与主题记忆已保存');
}

main().catch((err: unknown) => {
  console.error(`✗ ${(err as Error).message}`);
  process.exitCode = 1;
});
