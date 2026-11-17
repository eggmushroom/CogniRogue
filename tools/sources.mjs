/**
 * 语料 → markdown。清单在 `data/sources/sources.json`。
 *
 *   npm run sources
 *
 * 三件事按顺序做，任何一步失败就停：**下载 → 校验 sha256 → 抽文字**。
 * 校验放在抽文字之前，是因为"抽出来不对"和"下载到一半断了"从结果上分不开，
 * 而后者用一个哈希就能排除。
 *
 * 为什么抽文字用 Python：`pdf2md.py` 要 pymupdf，而仓库的约定是运行时零依赖、
 * devDependencies 只有 vite + typescript。这是**换语料时才跑一次**的开发期工具，
 * 不进产物、不进 package.json。装不上就明确告诉你装什么，不静默降级。
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const here = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const root = resolve(here, '..');
const manifestPath = join(root, 'data', 'sources', 'sources.json');
const cacheDir = join(root, '.cache', 'sources');
const outDir = join(root, 'data', 'sources');

/** 有的机器上 `python` 是 Microsoft Store 的占位程序，所以允许显式指定。 */
const PYTHON = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const sha = (buf) => createHash('sha256').update(buf).digest('hex').toUpperCase();

function run(cmd, args) {
  return new Promise((res) => {
    const p = spawn(cmd, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => res({ code, out, err }));
    p.on('error', (e) => res({ code: -1, out: '', err: String(e.message) }));
  });
}

async function pdfOf(src) {
  const pdfPath = join(cacheDir, `${src.id}.pdf`);
  if (existsSync(pdfPath)) {
    const have = sha(await readFile(pdfPath));
    if (have === src.sha256) return pdfPath;
    console.log(`  · ${src.id}：缓存哈希不符，重新下载`);
  }
  const res = await fetch(src.url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}：${src.url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const have = sha(buf);
  if (have !== src.sha256) {
    throw new Error(
      `${src.id} 的 sha256 对不上。\n  清单：${src.sha256}\n  实际：${have}\n`
      + '  上游换了版本就把 sources.json 里的 sha256 与 bytes 一起更新，别跳过校验。',
    );
  }
  await mkdir(cacheDir, { recursive: true });
  await writeFile(pdfPath, buf);
  console.log(`  · ${src.id}：下载 ${(buf.length / 1048576).toFixed(2)} MB，哈希吻合`);
  return pdfPath;
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
await mkdir(outDir, { recursive: true });

for (const src of manifest.sources) {
  console.log(`· ${src.id}`);
  const pdf = await pdfOf(src);
  const dst = join(outDir, `${src.id}.md`);
  const r = await run(PYTHON, [join(here, 'pdf2md.py'), pdf, dst]);
  if (r.code !== 0) {
    if (/No module named 'pymupdf'/.test(r.err + r.out)) {
      throw new Error(`缺少 pymupdf。先跑：${PYTHON} -m pip install pymupdf\n  也可以用 PYTHON=<解释器路径> npm run sources 指定解释器。`);
    }
    throw new Error(`抽文字失败（${PYTHON}）：\n${r.err || r.out}`);
  }
  process.stdout.write(r.out.replace(/^/gm, '  '));
}

console.log('\n✓ 语料就绪：' + manifest.sources.map((s) => `data/sources/${s.id}.md`).join('、'));
