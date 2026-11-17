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

const WEB_PORT = 5178;
const API_PORT = 7777;

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

const children = [];
let closing = false;

function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  for (const c of children) c.kill();
  process.exit(code);
}

function start(cmd) {
  // 传一整条命令给 shell：`npm.cmd` 在 Windows 上只能这么起（Node 20 起不许直接 spawn .cmd），
  // 而"参数数组 + shell"会触发 DEP0190，所以这里拼成一条命令。
  const p = spawn(cmd, { stdio: 'inherit', shell: true });
  // 半套环境最容易让人以为"代码坏了"：坏了一个就把另一个也收掉
  p.on('exit', (code) => { if (!closing && code) shutdown(code); });
  children.push(p);
}

if (!apiUp) start('npm run serve');
if (!webUp) start('npm run dev:web');

console.log('CogniRogue 开发模式');
console.log(`  游戏  http://localhost:${WEB_PORT}/      ${webUp ? '（已在跑，跳过）' : 'vite，改代码热更新'}`);
console.log(`  接口  http://127.0.0.1:${API_PORT}/api   ${apiUp ? '（已在跑，跳过）' : '题库服务'}`);
console.log('  页面里的 /api 会被转给服务：浏览器只认一个来源');

if (!children.length) process.exit(0);

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
