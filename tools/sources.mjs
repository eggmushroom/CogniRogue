/**
 * 语料 → markdown。清单在 `data/sources/sources.json`。
 *
 *   npm run sources
 *
 * 两种来源，两条路：
 *   · `format: "pdf"`    —— 下载 → 校验 sha256 → `tools/pdf2md.py` 抽文字
 *   · `format: "mdbook"` —— 按 SUMMARY.md 的清单抓 md 仓库，合并成一份（钉 commit）
 *
 * 校验放在抽文字之前，是因为"抽出来不对"和"下载到一半断了"从结果上分不开，
 * 而后者用一个哈希就能排除。mdbook 没有单份产物可哈希，所以改成钉 commit ——
 * 不钉的话同一份清单明天跑出不同的语料，题库就对不上号。
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

/** 网络在这台机器上不稳，取一次失败不代表源没了 —— 退避重试四次再报错。 */
async function get(url, tries = 4) {
  let last = '';
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(45_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    } catch (e) {
      last = String(e.message);
      await new Promise((res) => setTimeout(res, 800 * (i + 1)));
    }
  }
  throw new Error(`取不到 ${url}（重试 ${tries} 次）：${last}`);
}

/* ── PDF ──────────────────────────────────────────────────── */

async function pdfSource(src) {
  const pdfPath = join(cacheDir, `${src.id}.pdf`);
  if (existsSync(pdfPath)) {
    if (sha(await readFile(pdfPath)) === src.sha256) return pdfPath;
    console.log(`  · ${src.id}：缓存哈希不符，重新下载`);
  }
  const r = await fetch(src.url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(180_000) });
  if (!r.ok) throw new Error(`下载失败 HTTP ${r.status}：${src.url}`);
  const buf = Buffer.from(await r.arrayBuffer());
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

async function pdfToMarkdown(src) {
  const pdf = await pdfSource(src);
  const dst = join(outDir, `${src.id}.md`);
  const r = await run(PYTHON, [join(here, 'pdf2md.py'), pdf, dst]);
  if (r.code !== 0) {
    if (/No module named 'pymupdf'/.test(r.err + r.out)) {
      throw new Error(`缺少 pymupdf。先跑：${PYTHON} -m pip install pymupdf\n  也可以用 PYTHON=<解释器路径> npm run sources 指定解释器。`);
    }
    throw new Error(`抽文字失败（${PYTHON}）：\n${r.err || r.out}`);
  }
  process.stdout.write(r.out.replace(/^/gm, '  '));
  return dst;
}

/* ── mdbook 仓库 ──────────────────────────────────────────── */

/**
 * 节里的标题整体降一级（章是 `##`，节的内容要在它下面）。
 *
 * **代码块里的 `#` 不是标题。** mdbook 用行首 `# ` 表示"这一行在渲染时隐藏"，
 * Rust 书里到处都是；不加围栏判断的话，`# enum IpAddrKind {` 会被改成
 * `## enum IpAddrKind {`，再被当成二级标题 —— 上一版就是这么把 627 行代码
 * 变成标题的，切分出来的主题里混进了半截代码。
 */
function demoteHeadings(body) {
  const out = [];
  let fence = null;
  for (const line of body.split('\n')) {
    const m = /^\s*(`{3,}|~{3,})/.exec(line);
    if (m) {
      const mark = m[1];
      if (!fence) fence = mark;
      else if (mark[0] === fence[0] && mark.length >= fence.length) fence = null;
      out.push(line);
      continue;
    }
    out.push(!fence && /^#{1,5} /.test(line) ? `#${line}` : line);
  }
  return out.join('\n');
}

/**
 * 只认 mdbook 那一套：`SUMMARY.md` 里用 `- [标题](文件.md)` 列清单，缩进表示层级。
 * Rust 官方那几本书都是这个结构，所以这条规则够用；换成别的文档站（Hugo / MDX）
 * 就得另写一个适配器 —— 文档站没有共同的骨架。
 */
async function mdbookToMarkdown(src) {
  const base = `https://raw.githubusercontent.com/${src.repo}/${src.ref}/${src.dir}/`;
  const summary = await get(base + 'SUMMARY.md');
  const items = [];
  for (const line of summary.split('\n')) {
    const m = /^(\s*)[-*]\s+\[(.+?)\]\((.+?\.md)\)/.exec(line);
    if (m) items.push({ indent: m[1].length, title: m[2], file: m[3] });
  }
  if (!items.length) throw new Error(`${src.repo} 的 SUMMARY.md 里没有 md 条目`);

  // 顶层条目 = 章，缩进更深的 = 节；章成为 `##`（主题），节降一级成 `###`
  const chapters = [];
  for (const it of items) {
    if (it.indent === 0) chapters.push({ title: it.title, files: [] });
    else if (chapters.length) chapters[chapters.length - 1].files.push(it);
  }
  const real = chapters.filter((c) => c.files.length);

  const out = [`# ${src.title}`, ''];
  let sections = 0;
  let failed = 0;
  for (const ch of real) {
    out.push(`## ${ch.title}`, '');
    for (const sec of ch.files) {
      let md;
      try { md = await get(base + sec.file, 2); } catch { failed++; continue; }
      const body = md
        .replace(/^---\n[\s\S]*?\n---\n/, '')
        .split('\n')
        .filter((l) => !/^<a id=/.test(l))
        .join('\n')
        .trim()
        .split('\n')
        // 节文件自己的标题已经在目录里了，去掉第一行标题避免和 `##` 重复
        .filter((l, i) => !(i === 0 && l.startsWith('#')))
        .join('\n')
        .trim();
      // 标题整体降一级：章是 `##`，节的内容要在它下面
      out.push(demoteHeadings(body), '');
      sections++;
    }
  }

  const dst = join(outDir, `${src.id}.md`);
  await writeFile(dst, out.join('\n'));
  const chars = out.join('\n').length;
  console.log(`  · ${src.id}：${real.length} 章 / ${sections} 节 / ${chars} 字`
    + `（${failed} 节取不到，已跳过）· 钉在 ${src.ref.slice(0, 8)}`);
  return dst;
}

/* ── 主流程 ───────────────────────────────────────────────── */

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
await mkdir(outDir, { recursive: true });

for (const src of manifest.sources) {
  console.log(`· ${src.id}`);
  if (src.format === 'mdbook') await mdbookToMarkdown(src);
  else if (src.format === 'pdf' || src.sha256) await pdfToMarkdown(src);
  else throw new Error(`${src.id} 没写 format（pdf / mdbook）`);
}

console.log('\n✓ 语料就绪：' + manifest.sources.map((s) => `data/sources/${s.id}.md`).join('、'));
