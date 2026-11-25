/**
 * 文档配图：真的开一个 Chrome，把 README 里引用的那几张图重新拍一遍。
 *
 *   npm run shots
 *
 * 为什么要有这个脚本：README 里的截图一旦和界面脱节，比没有截图更糟：
 * 读者会照着图里的文案去找一个已经不存在的东西（"答题解锁"改成两档之后就是这样）。
 * 拍图和冒烟测试共用同一套 CDP 管道，只是这里点击少、等待多。
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function resolveUrl() {
  if (process.env.SHOTS_URL) return process.env.SHOTS_URL;
  for (const u of ['http://127.0.0.1:5178/', 'http://[::1]:5178/']) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(1200) });
      if (r.ok) return u;
    } catch { /* 换下一个 */ }
  }
  console.error('连不上 http://127.0.0.1:5178/ —— 先在另一个终端跑 `npm run dev`。');
  process.exit(2);
}

const URL_ = await resolveUrl();
const PORT = Number(process.env.SHOTS_PORT || 9334);

const CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];
const bin = CANDIDATES.find((p) => existsSync(p));
if (!bin) {
  console.error('找不到 Chrome / Edge，拍不了图');
  process.exit(2);
}

const profile = await mkdtemp(join(tmpdir(), 'cog-shots-'));

const chrome = spawn(bin, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-proxy-server',
  '--hide-scrollbars',
  '--force-device-scale-factor=1',
  '--window-size=1600,900',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  URL_,
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pageTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json());
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch { /* 还没起来 */ }
    await sleep(150);
  }
  throw new Error('Chrome 调试端口没开');
}

const target = await pageTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let seq = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) rej(new Error(msg.error.message));
    else res(msg.result);
  }
};

function send(method, params = {}) {
  const id = ++seq;
  return new Promise((res, rej) => {
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evalJs(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
}

async function boot(url) {
  await send('Page.navigate', { url });
  for (let i = 0; i < 120; i++) {
    const ok = await evalJs('!!(window.cog && document.querySelector("#game"))').catch(() => false);
    if (ok) break;
    await sleep(120);
  }
  // 立绘是异步加载的：不等它，"战斗界面"就会拍到一张没有敌人的图
  await sleep(900);
}

async function shoot(name) {
  const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 88 });
  await writeFile(join('docs', `${name}.jpg`), Buffer.from(r.data, 'base64'));
  console.log(`  ✓ docs/${name}.jpg`);
}

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: 1600, height: 900, deviceScaleFactor: 1, mobile: false,
});

/** 每一张图 = 一次导航 + 可选的一段准备动作。 */
const SHOTS = [
  ['title', '', null, 400],
  ['screenshot', '?dev=battle', null, 500],
];
console.log('拍图中…');
for (const [name, q, prep, wait] of SHOTS) {
  await boot(URL_ + q);
  if (prep) await evalJs(prep);
  await sleep(wait);
  await shoot(name);
}

ws.close();
chrome.kill();
await rm(profile, { recursive: true, force: true }).catch(() => {});
console.log('完成。');
