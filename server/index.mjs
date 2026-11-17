/**
 * 本地服务：前端只查询显示，判断、记账、生成都在这里。
 *
 * 为什么放在 Node 而不是浏览器里：题目生成的模型调用、文档解析、题库落盘，
 * 都得有个能读写文件、能长期记账的地方。浏览器做不到，也不该拿到 key。
 *
 * **零运行时依赖**：只用 node:http / node:fs / node:child_process / node:path，
 * 和项目「dependencies 永远为空」保持一致。
 *
 * **只监听 127.0.0.1**：它服务的是本机浏览器，不是局域网。
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const PACKS = join(ROOT, 'packs');
/** 生成物、上传的文档、答题记录都在这儿：属于玩家侧数据，不进仓库。 */
const STORE = join(ROOT, 'data', 'service');
const GEN_BANKS = join(STORE, 'banks');
const DOCS = join(STORE, 'docs');
const PORT = Number(process.env.PORT ?? 7777);
const VERSION = '0.5';
/** 有的机器上 `python` 是 Microsoft Store 的占位程序，所以允许显式指定。 */
const PYTHON = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');

/* ── 工具 ─────────────────────────────────────────────────────── */

const cors = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-doc-name');
};

const json = (res, code, body) => {
  cors(res);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
};

const plain = (res, code, body) => {
  cors(res);
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(body);
};

const text = (res, code, body, type = 'text/plain; charset=utf-8') => {
  cors(res);
  res.writeHead(code, { 'Content-Type': type });
  res.end(body);
};

/** 题库名读 md 自己的第一行 `# 名字`；没有就退回文件名。 */
async function bankNameOf(file, id) {
  try {
    const head = await readFile(file, 'utf8');
    const m = /^#[ \t]+(.+?)[ \t]*\r?$/m.exec(head);
    return m ? m[1] : id;
  } catch {
    return id;
  }
}

async function listMd(dir) {
  if (!existsSync(dir)) return [];
  try {
    const files = await readdir(dir);
    return files.filter((f) => extname(f) === '.md').map((f) => join(dir, f));
  } catch {
    return [];
  }
}

/** packs/ 是随仓库的，data/service/banks/ 是生成出来的；同名时以后者为准（重新生成过）。 */
async function bankFiles() {
  const out = new Map();
  for (const f of await listMd(PACKS)) out.set(f, 'pack');
  for (const f of await listMd(GEN_BANKS)) out.set(f, 'generated');
  return [...out.entries()].map(([file, kind]) => ({
    file,
    kind,
    id: file.split(/[\\/]/).pop().replace(/\.md$/, ''),
  }));
}

/**
 * 清单行。**不数题目和主题** —— 「什么叫一道题」只有 `src/core/library/parse.ts` 说了算，
 * 在这儿写第二个正则，`### ` 与 `? ` 两种写法立刻对不上（第一次就是这么错的：
 * 进阶算法在服务端数出 26 道，浏览器解析出 78 道）。数数的事交给前端。
 */
async function bankRow({ file, kind, id }) {
  const bytes = await readFile(file);
  return { id, name: await bankNameOf(file, id), kind, bytes: bytes.length };
}

async function readBody(req, limit = 32 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new Error('请求体太大（上限 32 MB）');
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

const run = (cmd, args, opts = {}) => new Promise((done) => {
  const p = spawn(cmd, args, { cwd: ROOT, shell: process.platform === 'win32', ...opts });
  let out = '';
  let err = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { err += d; });
  p.on('close', (code) => done({ code, out, err }));
  p.on('error', (e) => done({ code: -1, out, err: err + String(e.message) }));
});

/* ── 生成任务 ─────────────────────────────────────────────────── */

const genConfigFile = join(STORE, 'gen.json');
const jobs = new Map();
let jobSeq = 0;

/** 模型配置：`data/service/gen.json` 写在本地，环境变量优先（CI / 一次性跑用环境变量）。 */
async function genConfig() {
  let file = {};
  try {
    file = JSON.parse(await readFile(genConfigFile, 'utf8'));
  } catch {
    file = {};
  }
  return {
    baseUrl: process.env.GEN_BASE_URL || file.baseUrl || '',
    key: process.env.GEN_API_KEY || file.key || '',
    model: process.env.GEN_MODEL || file.model || '',
  };
}

/**
 * 文件名 → id。**只留 ASCII**：id 会进 URL、进文件名，中文名直接拼进去后
 * 一旦链路上有一处按 ASCII 编码，取文件就 404 了（第一次就是这么踩的）。
 * 全被替换掉的中文名要靠短哈希区分，否则两个中文文档会撞成同一个 id。
 */
const slug = (s) => {
  const base = String(s)
    .replace(/\.(md|markdown|txt|pdf)$/i, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'doc';
  const h = createHash('sha1').update(String(s)).digest('hex').slice(0, 8);
  return `${base}-${h}`;
};

/* ── 路由 ─────────────────────────────────────────────────────── */

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;

  if (req.method === 'OPTIONS') {
    cors(res);
    res.writeHead(204).end();
    return;
  }

  try {
    if (req.method === 'GET' && path === '/api/health') {
      const rows = await Promise.all((await bankFiles()).map(bankRow));
      const cfg = await genConfig();
      return json(res, 200, {
        ok: true,
        version: VERSION,
        banks: rows.length,
        generated: rows.filter((r) => r.kind === 'generated').length,
        // 只有"能不能生成"这件事需要告诉前端，key 本身永远不出这个进程
        canGenerate: !!cfg.key,
        model: cfg.model,
      });
    }

    if (req.method === 'GET' && path === '/api/banks') {
      const rows = await Promise.all((await bankFiles()).map(bankRow));
      rows.sort((a, b) => (a.kind === b.kind ? a.id.localeCompare(b.id) : a.kind === 'pack' ? -1 : 1));
      return json(res, 200, rows);
    }

    /** 原文。解析器在浏览器那侧（`core/library/parse.ts`），服务端不重复实现一套 DSL。 */
    const mBank = /^\/api\/banks\/([^/]+)$/.exec(path);
    if (req.method === 'GET' && mBank) {
      const id = decodeURIComponent(mBank[1]);
      const hit = (await bankFiles()).find((b) => b.id === id);
      if (!hit) return text(res, 404, `没有这份题库：${id}`);
      return text(res, 200, await readFile(hit.file, 'utf8'), 'text/markdown; charset=utf-8');
    }

    /** 模型配置：前端把 { baseUrl, key, model } POST 进来，服务存本地。 */
    if (req.method === 'POST' && path === '/api/config') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const cfg = {
        baseUrl: String(body.baseUrl ?? '').trim(),
        key: String(body.key ?? '').trim(),
        model: String(body.model ?? '').trim(),
      };
      await mkdir(STORE, { recursive: true });
      await writeFile(genConfigFile, JSON.stringify(cfg, null, 2));
      return json(res, 200, { ok: true, canGenerate: !!cfg.key, model: cfg.model });
    }

    /**
     * 上传一份文档。md / txt 直接用；pdf 先在服务里过 `tools/pdf2md.py` 抽出文字。
     *
     * 抽 PDF 要 pymupdf —— 和 `npm run sources` 一样**故意不进 package.json**：
     * 它不是运行时依赖，缺了就直说装什么。
     */
    if (req.method === 'POST' && path === '/api/docs') {
      const raw = await readBody(req);
      const name = decodeURIComponent(req.headers['x-doc-name'] ?? 'doc.md');
      const ext = extname(name).toLowerCase();
      const id = slug(name) + '-' + Date.now().toString(36);
      await mkdir(DOCS, { recursive: true });

      if (ext === '.pdf') {
        const pdf = join(DOCS, id + '.pdf');
        const md = join(DOCS, id + '.md');
        await writeFile(pdf, raw);
        const r = await run(PYTHON, [join(ROOT, 'tools', 'pdf2md.py'), pdf, md]);
        if (!existsSync(md)) {
          return json(res, 400, {
            ok: false,
            error: r.err.includes('pymupdf') || r.code !== 0
              ? `抽 PDF 文字失败（${PYTHON}）。先装：${PYTHON} -m pip install pymupdf，或用 PYTHON=<解释器> npm run serve 指定解释器。\n${r.err || r.out}`
              : '抽出来是空的 —— 这份 PDF 可能是扫描件（没有文字层）。',
          });
        }
        const body = await readFile(md, 'utf8');
        return json(res, 200, { ok: true, docId: id, name, kind: 'pdf', chars: body.length });
      }

      const body = raw.toString('utf8');
      if (!body.trim()) return json(res, 400, { ok: false, error: '这份文件是空的。' });
      await writeFile(join(DOCS, id + '.md'), body);
      return json(res, 200, { ok: true, docId: id, name, kind: 'md', chars: body.length });
    }

    /** 起一个生成任务：`npm run gen -- --src=<doc> --out=<bank> --per=N`。 */
    if (req.method === 'POST' && path === '/api/generate') {
      const { docId, per = 20 } = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const src = join(DOCS, String(docId) + '.md');
      if (!existsSync(src)) return json(res, 404, { ok: false, error: '没有这份文档，可能已经清理掉了。' });

      const cfg = await genConfig();
      if (!cfg.key) {
        return json(res, 400, {
          ok: false,
          error: '服务还没有模型配置。用 GEN_BASE_URL / GEN_API_KEY / GEN_MODEL 起服务，或者把配置 POST 到 /api/config。',
        });
      }

      const id = 'job-' + (++jobSeq);
      // docId 本身就是 ASCII id（上传时就归一过了），题库文件名直接用它：
      // 文件名就是题库 id，前端取 `/api/banks/<id>` 才对得上
      const bankId = String(docId);
      const out = join(GEN_BANKS, bankId + '.md');
      const job = { id, state: 'running', lines: [], bankId, started: Date.now() };
      jobs.set(id, job);

      const env = {
        ...process.env,
        GEN_API_KEY: cfg.key,
        GEN_BASE_URL: cfg.baseUrl,
        GEN_MODEL: cfg.model,
      };
      const args = ['run', 'gen', '--', `--src=${src}`, `--out=${out}`, `--per=${Math.max(1, Math.min(40, Number(per) || 20))}`, '--force'];
      const p = spawn('npm', args, { cwd: ROOT, shell: process.platform === 'win32', env });
      const push = (d) => {
        for (const line of String(d).split(/\r?\n/)) {
          if (line.trim()) job.lines.push(line.trim());
        }
        if (job.lines.length > 200) job.lines.splice(0, job.lines.length - 200);
      };
      p.stdout.on('data', push);
      p.stderr.on('data', push);
      p.on('close', (code) => {
        job.state = code === 0 && existsSync(out) ? 'done' : 'fail';
        job.ms = Date.now() - job.started;
        mkdir(GEN_BANKS, { recursive: true }).catch(() => {});
      });
      p.on('error', (e) => {
        job.state = 'fail';
        push(String(e.message));
      });

      return json(res, 200, { ok: true, job: id });
    }

    if (req.method === 'GET' && path === '/api/jobs') {
      return json(res, 200, [...jobs.values()].map((j) => ({
        id: j.id, state: j.state, bankId: j.bankId, ms: j.ms ?? Date.now() - j.started,
      })));
    }

    const mJob = /^\/api\/jobs\/([^/]+)$/.exec(path);
    if (req.method === 'GET' && mJob) {
      const job = jobs.get(decodeURIComponent(mJob[1]));
      if (!job) return json(res, 404, { ok: false, error: '没有这个任务' });
      return json(res, 200, {
        id: job.id,
        state: job.state,
        bankId: job.bankId,
        ms: job.ms ?? Date.now() - job.started,
        tail: job.lines.slice(-6).join('\n'),
      });
    }

    /** 局末答题记录。前端只负责交，怎么用是服务端的事。 */
    if (req.method === 'POST' && path === '/api/answers') {
      const raw = (await readBody(req)).toString('utf8');
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        return json(res, 400, { ok: false, error: '不是 JSON' });
      }
      await mkdir(STORE, { recursive: true });
      const file = join(STORE, 'answers.jsonl');
      const line = JSON.stringify({ at: new Date().toISOString(), ...payload }) + '\n';
      const prev = existsSync(file) ? await readFile(file, 'utf8') : '';
      await writeFile(file, prev + line);
      return json(res, 200, { ok: true, bytes: line.length });
    }

    plain(res, 404, `不认识这条路由：${req.method} ${path}`);
  } catch (err) {
    json(res, 500, { ok: false, error: String(err && err.message ? err.message : err) });
  }
});

await mkdir(GEN_BANKS, { recursive: true });
await mkdir(DOCS, { recursive: true });
server.listen(PORT, '127.0.0.1', () => {
  console.log(`题库服务 http://127.0.0.1:${PORT}`);
  console.log(`  packs/          ${PACKS}`);
  console.log(`  data/service/   ${STORE}`);
});
