/**
 * 文档配图：真的开一个 Chrome，把 README 里引用的那几张图重新拍一遍。
 *
 *   npm run shots
 *
 * 为什么要有这个脚本：README 里的截图一旦和界面脱节，比没有截图更糟 ——
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
  // 有断点时的首页：多一条「继续这一局」，下面才是"开始新的一局"。
  // 存档不是手写的 JSON —— 先在第三幕里走几行，让 cog.save() 真的写一份，
  // 刷新之后拍的才是真实存档能长出来的那一屏。
  ['titlesave', '?dev=map&stage=3', `(() => {
    const s = cog.state;
    for (let r = 0; r < 8; r++) for (const nd of s.map[r]) s.seen[nd.key] = true;
    const nd = s.map[8][0];
    s.pos = { r: 8, i: nd.i };
    s.floors = 8;
    s.maxHp = 70 + 14 * 2;
    s.hp = 86;
    cog.save();
    setTimeout(() => location.replace(location.origin + '/'), 30);
  })()`, 2600],
  // 开局三选一能力卡。文件名沿用 mode.jpg —— README 里那张图的位置没变，内容换了。
  ['mode', '?dev=boon', null, 600],
  // 五幕各有自己的色相与物种：同一张地图换一幕，光柱、幕名和节点底色都跟着换。
  // （map3 / map5 两张图删了：README 只用到第一幕那张，多拍的没人看，还会被当成文档签入。）
  ['map', '?dev=map', null, 600],
  // 幕 Boss 的专属立绘：换皮先过一眼，别让"新怪"其实还是旧图
  ['boss1', '?dev=foe:cataloguer', `(() => {
    cog.state.enemy.maxHp = cog.state.enemy.hp = 9999;
  })()`, 700],
  ['boss2', '?dev=foe:devourer', `(() => {
    cog.state.enemy.maxHp = cog.state.enemy.hp = 9999;
  })()`, 700],
  ['boss3', '?dev=foe:imprinter', `(() => {
    cog.state.enemy.maxHp = cog.state.enemy.hp = 9999;
  })()`, 700],
  ['boss4', '?dev=foe:bound', `(() => {
    cog.state.enemy.maxHp = cog.state.enemy.hp = 9999;
  })()`, 700],
  ['screenshot', '?dev=battle', null, 500],
  ['deck', '?dev=deck', null, 500],
  // 精炼面板：牌组里 4 张基础斩击要显示成 4 格，每格都写"选完是多少伤"。
  // 玩家报过"精炼看不到效果"，这一屏就是那条反馈的证据。
  ['refine', '?dev=refine', null, 500],
  ['reward', '?dev=reward', null, 500],
  ['rest', '?dev=rest', null, 400],
  ['event', '?dev=event', null, 400],
  ['ask', '?dev=question', null, 400],
  // 答对之后面板要等打击演出演完才出来，所以多等一会。
  // prep 里停掉软自动推进：它是「没人动就 4.2s 自己走」，截图脚本正好是"没人动"，
  // 不等这一下，两张文档图会拍成判定面板已经收掉的空战斗画面。
  ['feedback', '?dev=answer', 'cog.pauseAuto()', 1400],
  // 答错那一屏：学习模式的价码写在反馈面板里
  ['wrong', '?dev=wrong', 'cog.pauseAuto()', 1400],
  // 光刃飞出去的那一瞬：0.18s 左右正好在半路
  ['strike', '?dev=battle', 'cog.strike()', 180],
  // 敌人回合：真的走一次 endTurn（?dev=foe:xxx 把招式固定成单招循环），
  // 所以血条、格挡、弃牌堆和头顶意图都是真的，不是只盖一层特效。
  ['enemyatk', '?dev=foe:atk', 'cog.endTurn()', 150],
  ['enemyblock', '?dev=foe:atk', `(() => {
    cog.state.block = 99;
    cog.endTurn();
  })()`, 270],
  ['enemyjam', '?dev=foe:jam', 'cog.endTurn()', 260],
  ['powers', '?dev=powerdrop', null, 500],
  ['powerafter', '?dev=power', null, 700],
  ['report', '?dev=report', null, 700],
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
