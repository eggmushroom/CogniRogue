/**
 * 开发模式：一条命令，把「题库服务」和「开发服务器」都起来。
 *
 *   npm run dev     → 服务（7777）+ vite（5178），浏览器开 5178
 *   npm run serve   → 只要服务；它同时也发 dist/index.html
 *
 * 两个都起，是因为改代码时只用得上 5178：vite 把 `/api` 转给 7777，
 * 浏览器里始终只有一个来源，前端也只剩一处地址要算。
 *
 * 已经在跑的就不再起一遍 —— 端口被别的进程占着时，明说一句比默默再起一份、
 * 然后在浏览器里连到不知道哪个实例上要好。
 */
import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { startService } from './service.mjs';

const WEB_PORT = Number(process.env.WEB_PORT ?? 5178);
const API_PORT = Number(process.env.API_PORT ?? 7777);

/** 端口有没有人在听。vite 默认只绑 `::1`，所以两个地址都要问。 */
function taken(port) {
  return new Promise((done) => {
    let pending = 2;
    let hit = false;
    for (const host of ['127.0.0.1', '::1']) {
      const s = connect({ port, host });
      const finish = (v) => {
        s.destroy();
        if (v) hit = true;
        if (--pending === 0) done(hit);
      };
      s.on('connect', () => finish(true));
      s.on('error', () => finish(false));
      s.setTimeout(500, () => finish(false));
    }
  });
}

const webUp = await taken(WEB_PORT);
const apiUp = await taken(API_PORT);

if (apiUp) {
  let apiVersion;
  try {
    const response = await fetch(`http://127.0.0.1:${API_PORT}/api/health`, { signal: AbortSignal.timeout(1500) });
    if (response.ok) apiVersion = (await response.json()).apiVersion;
  } catch {}
  if (apiVersion !== 1) {
    console.error(`端口 ${API_PORT} 已被占用，但不是兼容的题库服务（需要 API v1，检测到 ${apiVersion ?? '未知服务'}）。请先停止占用该端口的旧进程，再运行 npm run dev。`);
    process.exit(1);
  }
}

const children = [];
let closing = false;

function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  for (const c of children) c.kill();
  process.exit(code);
}

function track(p) {
  // 半套环境最容易让人以为"代码坏了"：坏了一个就把另一个也收掉
  p.on('exit', (code) => { if (!closing && code) shutdown(code); });
  children.push(p);
}

function start(cmd) {
  track(spawn(cmd, { stdio: 'inherit', shell: true, env: process.env }));
}

if (!apiUp) track(startService(API_PORT));
if (!webUp) start('npm run dev:web');

console.log('CogniRogue 开发模式');
console.log(`  游戏  http://localhost:${WEB_PORT}/      ${webUp ? '（已在跑，跳过）' : 'vite，改代码热更新'}`);
console.log(`  服务  ${apiUp ? '本机服务已在运行' : '本机题库服务已启动'}（页面的 /api 由 Vite 转发）`);
console.log('  浏览器只需打开游戏地址');

if (!children.length) process.exit(0);

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
