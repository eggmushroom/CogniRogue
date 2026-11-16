/**
 * 依赖方向守卫：把「左边不 import 右边」从注释变成一次检查。
 *
 *   node tools/deps.mjs          （包含在 npm run check / npm run build 里）
 *
 * 它只做一件事：读 src 下每个 .ts 的 import 说明符，按包归类，然后拒绝
 * 「右边的包 import 了左边的包」。没有依赖、没有配置文件、没有缓存：
 * 因为这张图只有十来个节点，不值得为它装一个 dependency-cruiser，
 * 但也不能继续靠人记着。
 *
 * 两条硬规则：
 *   1. core 的七个包按 LAYERS 的顺序单向依赖（只许 import 左边的）；
 *   2. core 不认识表现层：core 里任何文件都不能 import gfx / scenes / input / main，
 *      也不能有谁 import 组合根 main.ts。
 *
 * 已知违规写在 EXEMPT 里，**只许减不许加**。加一条等于把守卫关掉一格。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const SRC = join(ROOT, 'src');

/** core 的七个工具包。顺序即依赖方向：任何包都只能 import 它**左边**的包。 */
const LAYERS = ['model', 'infra', 'cards', 'library', 'map', 'combat', 'journey'];

/**
 * 已知违规的显式豁免（只警告、不失败）。每一条都要写清楚它为什么存在、
 * 什么时候该删：豁免表一旦长起来，守卫就退化成装饰品。
 *
 * 现在是空的：combat → journey 的 settlePending 已经改成由 journey 注册回调，
 * 战斗层不再反向 import journey。
 */
const EXEMPT = [];

/** 表现层：不在 LAYERS 里，彼此可以自由引用，但不许被 core import。 */
const PRESENTATION = new Set(['gfx', 'scenes', 'input', 'main', 'dev']);

/**
 * 文件 → 所属包。
 *
 * **不认识的路径一律抛错，不许返回 null。** 早先这里是「查不到就 `return null`」，
 * 调用方 `if (!fromPkg) continue` —— 于是 `src/core/` 顶层新建一个文件，
 * 它就能 import 表现层而守卫照样输出「✓ 通过」（扫描数会 +1，import 数不动）。
 * 同样的洞还盖住了 `src/dev/`。守卫最容易的死法不是判错，是**静默少看一个文件**。
 *
 * 所以现在分两类：
 *   - core 顶层（`src/core/*.ts`）：barrel 与内置题库，天然要 import 所有包，
 *     顺序规则豁免，但**照样受「不许 import 表现层」约束**；
 *   - 其余归不出来的一律 `throw`，让新目录必须先在这里登记。
 */
function packageOf(rel) {
  const m = rel.match(/^src\/core\/(model|infra|cards|library|map|combat|journey)\//);
  if (m) return m[1];
  // core 顶层的任何 .ts 都算 core-root：不再靠 CORE_ROOT_FILES 手抄清单，
  // 新增一个顶层文件自动纳入，不用回来改守卫。
  if (/^src\/core\/[^/]+\.ts$/.test(rel)) return 'core-root';
  if (/^src\/gfx\//.test(rel)) return 'gfx';
  if (/^src\/scenes\//.test(rel)) return 'scenes';
  if (/^src\/dev\//.test(rel)) return 'dev';
  if (rel === 'src/input.ts') return 'input';
  if (rel === 'src/main.ts') return 'main';
  throw new Error(`依赖守卫不认识 ${rel} —— 在 tools/deps.mjs 的 packageOf() 里登记它属于哪个包`);
}

function walkTs(dir, out = []) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, ent.name);
    if (ent.isDirectory()) walkTs(path, out);
    else if (ent.name.endsWith('.ts')) out.push(path);
  }
  return out;
}

/** 去掉注释，免得被文档里举的例子当成真 import。 */
function stripComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * 相对说明符 → 磁盘上的 .ts 文件。
 * 解析不到的一律当作外部资源（.jpg、.md?raw、.css），与包结构无关。
 */
function resolveSpec(fromFile, spec) {
  if (!spec.startsWith('.')) return null;
  if (spec.includes('?')) return null;
  const base = resolve(dirname(fromFile), spec);
  for (const cand of [base + '.ts', join(base, 'index.ts')]) {
    if (existsSync(cand)) return cand;
  }
  return null;
}

const toRel = (abs) => abs.slice(ROOT.length + 1).replace(/\\/g, '/');

// ── 扫描 ──────────────────────────────────────────────────────

const files = walkTs(SRC);
const edges = [];
for (const file of files) {
  const fromRel = toRel(file);
  // packageOf 认不出的路径会直接抛错，所以这里不再有 `if (!fromPkg) continue` 的静默跳过。
  const fromPkg = packageOf(fromRel);
  const code = stripComments(readFileSync(file, 'utf8'));
  for (const m of code.matchAll(/\bfrom\s*'([^']+)'/g)) {
    const target = resolveSpec(file, m[1]);
    if (!target) continue;
    const toPkg = packageOf(toRel(target));
    edges.push({ fromPkg, toPkg, fromRel, toRel: toRel(target) });
  }
}

// ── 判定 ──────────────────────────────────────────────────────

const failures = [];
const exemptionsHit = [];

for (const e of edges) {
  // 没人可以 import 组合根：那会立刻成环
  if (e.toPkg === 'main') {
    failures.push({ ...e, why: `main 是组合根，${e.fromPkg} 不许 import 它` });
    continue;
  }
  // core 不认识表现层
  if (e.fromPkg === 'core-root' || LAYERS.includes(e.fromPkg)) {
    if (PRESENTATION.has(e.toPkg)) {
      failures.push({ ...e, why: 'core 是纯逻辑层，不许 import 表现层（gfx / scenes / input / main）' });
      continue;
    }
  }
  // 顺序规则：只对 core 的七个包生效，barrel 豁免
  if (!LAYERS.includes(e.fromPkg) || !LAYERS.includes(e.toPkg)) continue;
  const fromIdx = LAYERS.indexOf(e.fromPkg);
  const toIdx = LAYERS.indexOf(e.toPkg);
  if (toIdx > fromIdx) {
    const exempt = EXEMPT.find((x) => x.from === e.fromPkg && x.to === e.toPkg);
    if (exempt) exemptionsHit.push({ ...e, why: exempt.why });
    else failures.push({ ...e, why: `${e.fromPkg} 在 ${e.toPkg} 左边，不能 import 右边的包` });
  }
}

// ── 输出 ──────────────────────────────────────────────────────

const uniq = (arr) => [...new Set(arr)];
const edgeCount = uniq(edges.map((e) => `${e.fromPkg}>${e.toPkg}`)).length;

console.log(`依赖方向检查 · 扫描 ${files.length} 个文件 / ${edges.length} 条 import / ${edgeCount} 组包间边`);
console.log(`允许方向 ${LAYERS.join(' → ')}（core 内部），表现层只能被 core 之外引用`);

// 空扫描必须失败：守卫最容易的死法是"什么都没扫到，于是全部通过"
if (!edges.length) {
  console.warn('✗ 没有解析到任何 import —— 守卫失效了（路径或正则被改坏了？）');
  process.exit(1);
}

if (exemptionsHit.length) {
  const pairs = uniq(exemptionsHit.map((e) => `${e.fromPkg} → ${e.toPkg}`));
  console.warn(`⚠ 豁免 ${pairs.length} 组：${pairs.join('、')}`);
  for (const p of uniq(exemptionsHit.map((e) => e.why))) console.warn(`  · ${p}`);
}

if (failures.length) {
  console.warn(`\n✗ ${failures.length} 处违规：`);
  for (const f of failures) {
    console.warn(`  ${f.fromRel} → ${f.toRel}`);
    console.warn(`    ${f.why}`);
  }
  console.warn('\n修法：把模块挪到它依赖的那一层，或改成从左往右注入（见 README「工程结构」）。');
  process.exit(1);
}

console.log('✓ 通过');
