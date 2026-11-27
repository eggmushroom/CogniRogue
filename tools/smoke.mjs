/**
 * 冒烟测试：真的开 Chrome、真的点鼠标，走一遍「标题 → 地图 → 出牌 → 答题 → 结束回合」。
 *
 *   npm run smoke
 *   SMOKE_CPU=6 npm run smoke   # 调慢渲染线程，模拟慢机器
 *
 * 专盯命中区域：canvas 的点击是手写矩形判定，改布局最容易在这里静默坏掉。
 * 两条时序约定：等状态（`handReady()`）不等固定 sleep；按 idx 点牌并用 `probe()` 确认。
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** 先确认开发服务器在跑：有的机器 vite 只监听 ::1，两个都探一下。 */
async function resolveUrl() {
  if (process.env.SMOKE_URL) return process.env.SMOKE_URL;
  for (const u of ['http://127.0.0.1:5178/', 'http://[::1]:5178/']) {
    try {
      // 5 秒不是随便给的：vite 第一次请求要现转译 main.ts，冷启动常超过 1 秒，
      // 窗口太窄会把"服务器其实在跑"判成连不上。
      const r = await fetch(u, { signal: AbortSignal.timeout(5000) });
      if (r.ok) return u;
    } catch { /* 换下一个 */ }
  }
  console.error('连不上 http://127.0.0.1:5178/ —— 先在另一个终端跑 `npm run dev`。');
  process.exit(2);
}

const URL_ = await resolveUrl();
const PORT = Number(process.env.SMOKE_PORT || 9333);

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
  console.error('找不到 Chrome / Edge，跳过冒烟测试');
  process.exit(2);
}

const profile = await mkdtemp(join(tmpdir(), 'cog-smoke-'));

const chrome = spawn(bin, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-proxy-server',
  '--hide-scrollbars',
  '--window-size=1600,900',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  URL_,
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 等 n 个真实的渲染帧。慢机器上"睡 40ms"可能一帧都没到，悬停抬升还没进热区。 */
const nextFrames = (n = 2) => evalJs(`new Promise((r) => {
  let k = ${n};
  const tick = () => { if (--k <= 0) r(true); else requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
})`);

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
const errors = [];

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) rej(new Error(msg.error.message));
    else res(msg.result);
    return;
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    errors.push(msg.params.exceptionDetails.exception?.description ?? '未知异常');
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    errors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
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
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}

async function boot(url = URL_) {
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url });
  for (let i = 0; i < 100; i++) {
    const ok = await evalJs('!!(window.cog && document.querySelector("#game"))').catch(() => false);
    if (ok) break;
    await sleep(150);
  }
  await sleep(600); // 等美术资源加载完、第一帧画出来
}

/**
 * 按标签点一次：拿当前帧的命中矩形，换算成屏幕坐标，发真实的鼠标按下/抬起。
 *
 * 移动和按下之间要留一帧：手牌悬停会整张抬起来，矩形跟着变。真实玩家移动和点击之间
 * 至少隔一次刷新，所以这里也让它先落定 —— 否则按下时取到的是抬起后的旧矩形。
 */
async function clickPoint(p) {
  const base = { x: p.x, y: p.y, button: 'left', clickCount: 1 };
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
  await sleep(40);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base });
  await sleep(70); // 真人不会在 0ms 内松手，帧一定会在这中间重画
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base });
  await sleep(140); // 等下一帧把状态画出来
}

/** 用逻辑画布坐标点一次，用于验证抽屉覆盖区。 */
async function clickLogical(x, y) {
  const point = await evalJs(`cog.toScreen(${x}, ${y})`);
  const before = await evalJs('(cog.lastClick() || { n: 0 }).n');
  await clickPoint(point);
  return waitClick(before);
}

/** 等一次"新鲜的"点击落地：n 比点之前大，才说明这一下真的被接受了。 */
async function waitClick(before, ms = 1200) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const c = await evalJs('cog.lastClick()');
    if (c && c.n > before) return c;
    await sleep(40);
  }
  return null;
}

async function clickLabel(label, nth = 0) {
  if (!await waitUnlocked()) throw new Error(`点「${label}」之前输入一直被锁着`);
  const hit = await evalJs(`(() => {
    const list = window.cog.hots().filter((h) => h.label === ${JSON.stringify(label)});
    const h = list[${nth}];
    if (!h) return null;
    const p = window.cog.toScreen(h.x + h.w / 2, h.y + h.h / 2);
    return { x: p.x, y: p.y };
  })()`);
  if (!hit) throw new Error(`画面上找不到「${label}」`);
  const before = await evalJs('(cog.lastClick() || { n: 0 }).n');
  await clickPoint(hit);
  const got = await waitClick(before);
  if (!got) throw new Error(`「${label}」点了没反应：` + JSON.stringify(await clickReport()));
  if (got.label !== label) throw new Error(`「${label}」点歪了，落到「${got.label}」`);
}

/** 发一次真实的按键：Escape 关面板、空格结束回合，键盘能做的事不该只有鼠标能测。 */
async function pressKey(key, code, vk) {
  const base = { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
  await send('Input.dispatchKeyEvent', { type: 'keyDown', ...base });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  await sleep(120);
}

/** 往当前焦点里敲字。单字符要带 `text`，浏览器才把它当字符而不是快捷键。 */
async function typeText(s) {
  for (const ch of s) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch, unmodifiedText: ch });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
  }
  await sleep(120);
}

/** 等手牌全部飞完并停稳。抽牌是按 dt 推的，慢机器上固定 sleep 一定不够。 */
async function waitHand(ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await evalJs('window.cog.handReady()')) return true;
    await sleep(50);
  }
  return false;
}

/**
 * 确保手牌里至少有一张知识卡，返回它的下标。
 *
 * 起手 10 张里只有 2 张随机知识卡，其余 8 张是基础牌 —— 抽 5 张时完全可能
 * 一张知识卡都没摸到。下面这些用例测的是"答题 / 答错"的规则，不是抽牌运气，
 * 所以缺牌时直接塞一张 1 费知识卡进手牌（替换第 0 张，手牌数不变）。
 */
/**
 * 确保手牌里有一张**需要答题**的知识卡，返回它的下标。
 * 起手 10 张里只有 2 张随机知识卡，抽 5 张可能一张都没有；答题要求 0 的牌又不答题。
 */
async function ensureKnowledge() {
  await ensureQuestions();
  const idx = await evalJs(`(() => {
    const h = cog.state.hand;
    return h.findIndex((id) => {
      if (id.startsWith('base:')) return false;
      const d = cog.pack.cards.find((x) => x.id === id);
      return !!d && (d.ask ?? 0) > 0;
    });
  })()`);
  if (idx >= 0) return idx;
  await evalJs(`(() => {
    const id = cog.pack.cards.find((c) => c.kind === 'knowledge' && c.cost === 1 && c.ask === 1).id;
    cog.state.hand[0] = id;
  })()`);
  return 0;
}

/**
 * 保证这一场还有新题可问。
 *
 * 题池是按牌组算出来的，一场只有 6–20 道；跑测试时如果前面的用例把新题答光了，
 * 后面"点牌 → 出题"会走复用路径（仍然能出题，但问的是本章问得最少的题）。
 * 这些用例要验的是"常规出题"那条路，所以开局先补几道新题，别让它们踩到边界。
 */
async function ensureQuestions(n = 12) {
  await evalJs(`(() => {
    const G = cog.state;
    if (G.qLeft.length >= 3) return;
    const bank = cog.bank;
    const pool = Object.values(bank.byTopic).flat();
    for (const q of pool.slice(0, ${n})) {
      if (!G.qLeft.some((x) => x.qid === q.qid)) G.qLeft.push(q);
    }
  })()`);
}
/**
 * 点手牌里下标为 idx 的那一张。
 * 不能拿"第 nth 个 card 热区"当下标（还在飞的牌不注册热区），
 * 也不能点矩形中心（牌多时相邻牌会盖住）。先按 idx 找矩形，再在内部找一个 probe 确认属于自己的点。
 */
async function clickCard(idx) {
  if (!await waitReady()) throw new Error('战斗指令还没法落地（输入锁 / 忙碌 / 面板挡着）');
  if (!await waitHand()) throw new Error('手牌没有停稳');

  /**
   * 在当前帧的热区里找一个 probe 确认属于 idx 的点，同时返回逻辑坐标和屏幕坐标。
   *
   * 每轮都重新读 `hots()`：悬停会把牌抬高 44px，热区跟着变，上一轮算出的点
   * 可能已经落进邻居的矩形。用当前帧的矩形重新挑点，下一次移动才会落在正确的地方。
   */
  const findPoint = () => evalJs(`(() => {
    const h = window.cog.hots().find((h) => h.label === 'card' && h.idx === ${idx});
    if (!h) return null;
    for (const fy of [0.5, 0.34, 0.66, 0.18, 0.82]) {
      for (let k = 0; k <= 24; k++) {
        const x = h.x + 4 + (h.w - 8) * (k / 24);
        const y = h.y + h.h * fy;
        const t = window.cog.probe(x, y);
        if (t && t.label === 'card' && t.idx === ${idx}) {
          const s = window.cog.toScreen(x, y);
          return { x: s.x, y: s.y, lx: x, ly: y };
        }
      }
    }
    return null;
  })()`);

  let p = null;
  // 先把指针移过去，等悬停抬起后再 probe 一次。通常一轮就稳；不稳就按当前热区
  // 重新挑点再移，最多三轮 —— 悬停是幂等的，第二轮之后位置不会再变。
  for (let attempt = 0; attempt < 3; attempt++) {
    p = await findPoint();
    if (!p) throw new Error(`手牌里第 ${idx} 张找不到能点到的位置`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
    await nextFrames(2);
    const now = await evalJs(`cog.probe(${p.lx}, ${p.ly})`);
    if (now && now.label === 'card' && now.idx === idx) break;
    if (attempt === 2) {
      throw new Error(`手牌第 ${idx} 张悬停后位置归属变了：` + JSON.stringify(now));
    }
  }

  const before = await evalJs('(cog.lastClick() || { n: 0 }).n');
  await clickPoint(p);
  const got = await waitClick(before);
  if (!got) throw new Error(`手牌第 ${idx} 张点了没反应：` + JSON.stringify(await clickReport()));
  if (got.label !== 'card' || got.idx !== idx) {
    throw new Error(`手牌第 ${idx} 张点歪了，落到 ${got.label}#${got.idx}`);
  }
}

/**
 * 等输入解锁。演出期间按下会被直接丢掉。
 * 只等 locked 不等 busy：反馈面板开着时 busy 恒为 true，但面板上的「继续」正该这时点。
 */
async function waitUnlocked(ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (!await evalJs('cog.locked()')) return true;
    await sleep(50);
  }
  return false;
}

/**
 * 等一条战斗指令能落地：输入解锁、没有面板、上一层动作已结算完。
 * 出牌器和「结束回合」的卫兵都是 `if (busy || panel) return`，不看这三样点击会被吞掉。
 */
async function waitReady(ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const st = await evalJs('({ busy: cog.state.busy, locked: cog.locked(), panel: cog.state.panel.k })');
    if (!st.busy && !st.locked && st.panel === 'none') return true;
    await sleep(50);
  }
  return false;
}

/** 上一次点击之后，屏幕上到底发生了什么。失败时用来说清楚"是被吞了还是点歪了"。 */
async function clickReport() {
  return evalJs(`(() => ({
    last: cog.lastClick(),
    busy: cog.state.busy,
    locked: cog.locked(),
    panel: cog.state.panel.k,
    ap: cog.state.ap,
  }))()`);
}

/** 等反馈面板出现。等不到时要把现场一并报出来 —— 光说"没出现"没法定位。 */
async function expectFeedback(what) {
  if (await waitFor('继续')) return;
  const st = await evalJs(`({
    panel: cog.state.panel.k,
    busy: cog.state.busy,
    locked: cog.locked(),
    last: cog.lastClick(),
    ap: cog.state.ap,
  })`);
  throw new Error(`${what} 反馈面板没出现：` + JSON.stringify(st));
}

const results = [];
async function step(name, fn, verify) {
  try {
    await fn();
    const ok = await verify();
    results.push({ name, ok });
  } catch (e) {
    results.push({ name, ok: false, err: e.message });
  }
}

/**
 * 等某个按钮真的画在屏幕上。
 * 答对之后反馈面板会推迟到打击动画演完才出现，这期间它不在命中表里 ——
 * 直接找坐标会扑空，所以要先等它画出来。
 */
/**
 * 等某个按钮真的画在屏幕上。反馈面板会推迟到打击演完才出现，这期间它不在命中表里。
 * 上限给得宽：状态一出现就立刻返回。
 */
async function waitFor(label, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const n = await evalJs(`cog.hots().filter((h) => h.label === ${JSON.stringify(label)}).length`);
    if (n > 0) return true;
    await sleep(60);
  }
  return false;
}

async function waitGone(label, ms = 3000) {
  const started = Date.now();
  while (Date.now() - started < ms) {
    if (!await evalJs(`cog.hots().some((h) => h.label === ${JSON.stringify(label)})`)) return true;
    await sleep(40);
  }
  return false;
}

/** 等开局三个模式里出现任意一个，返回它的完整 label（`mode:<id>`）。 */
async function waitBoon(ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const l = await evalJs(
      `(cog.hots().find((h) => h.label.startsWith('mode:')) || {}).label || ''`,
    );
    if (l) return l;
    await sleep(60);
  }
  return '';
}

/**
 * 选主题：点前两个，再开始。三处开局都走它 ——
 * 漏一处就会卡在选主题那一屏，而症状是"点开始没反应"，很难看出漏了哪。
 */
async function pickTopicsThenStart() {
  await clickLabel('topic:0');
  await clickLabel('topic:1');
  await clickLabel('开始这一局');
  // 本局题池由服务异步返回，点击落地不代表开局已经完成。
  const started = Date.now();
  while (Date.now() - started < 20000) {
    if (await S('cog.state.screen') === 'map' && await S('cog.state.panel.k') === 'none') return;
    await sleep(60);
  }
  throw new Error('开局未完成：' + JSON.stringify(await S('({ screen: cog.state.screen, panel: cog.state.panel })')));
}

const S = (path) => evalJs(`(${path})`);

/**
 * 调慢渲染线程，模拟慢机器。动画按 dt 推进，这一档用来提前发现固定 sleep 的坑。
 *
 *   SMOKE_CPU=6 npm run smoke
 */
const CPU_RATE = Number(process.env.SMOKE_CPU || 0);
if (CPU_RATE > 0) {
  await send('Emulation.setCPUThrottlingRate', { rate: CPU_RATE });
  console.log(`· 渲染节流 ×${CPU_RATE}`);
}

await boot();

await step('任务抽屉可交互，栏外点击关闭', async () => {
  await clickLabel('后台任务');
  if (!await waitFor('×')) throw new Error('任务侧栏没有打开');
  const inside = await clickLogical(1570, 800);
  if (inside?.label !== '任务抽屉面板') throw new Error('任务栏空白处未被抽屉拦截：' + JSON.stringify(inside));
  if (!await waitFor('×')) throw new Error('点击任务栏内部后抽屉意外关闭');
  const outside = await clickLogical(800, 80);
  if (outside?.label !== '任务抽屉遮罩') throw new Error('栏外点击没有触发任务抽屉关闭：' + JSON.stringify(outside));
  if (!await waitGone('任务抽屉遮罩')) throw new Error('栏外点击后任务抽屉没有关闭');
  await clickLabel('后台任务');
  if (!await waitFor('×')) throw new Error('任务侧栏无法重新打开');
  await clickLabel('×');
}, async () => !!(await waitFor('后台任务')) && !(await waitFor('×', 500)));

await step('抽屉过渡：热区随动、退出停止响应、快速反向与减少动态效果', async () => {
  await evalJs(`(() => {
    window.__drawerXs = [];
    let frames = 0;
    const tick = () => {
      const close = cog.hots().find((h) => h.label === '×');
      if (close) __drawerXs.push(close.x);
      if (++frames < 60) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  })()`);
  const settle = () => evalJs(`new Promise((resolve) => {
    let frames = 0;
    const tick = () => {
      const x = cog.hots().find((h) => h.label === '×')?.x;
      if (x === 376 || ++frames >= 60) resolve(x === 376);
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  })`);
  await clickLabel('答题记录');
  if (!await settle()) throw new Error('抽屉未落位');
  const xs = await evalJs('__drawerXs');
  if (!xs.some((x) => x < 376) || xs.some((x, i) => i > 0 && x < xs[i - 1])) {
    throw new Error('抽屉热区没有沿入场方向平滑落位：' + JSON.stringify(xs));
  }
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await nextFrames(2);
  const exiting = await evalJs(`({
    button: cog.hots().some((h) => h.label === '×'),
    mask: cog.hots().some((h) => h.label === '答题记录遮罩'),
  })`);
  if (exiting.button || !exiting.mask) throw new Error('退场没有隔离点击：' + JSON.stringify(exiting));
  await clickLabel('答题记录');
  if (!await settle()) throw new Error('退出过程中反向打开未落位');
  await pressKey('Escape', 'Escape', 27);
  for (let n = 0; n < 20 && await evalJs('cog.hots().some((h) => h.label === "答题记录遮罩")'); n++) await nextFrames(2);
  if (await evalJs('cog.hots().some((h) => h.label === "答题记录遮罩")')) throw new Error('关闭后残留遮罩');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  try {
    await clickLabel('答题记录');
    if (await evalJs('cog.hots().find((h) => h.label === "×")?.x') !== 376) throw new Error('减少动态效果未立即打开抽屉');
    const hasShield = await evalJs(`new Promise((resolve) => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      requestAnimationFrame(() => resolve(cog.hots().some((h) => h.label === '答题记录遮罩')));
    })`);
    if (hasShield) throw new Error('减少动态效果未立即关闭抽屉');
  } finally {
    await send('Emulation.setEmulatedMedia', { features: [] });
  }
  await clickLabel('答题记录');
  if (!await settle()) throw new Error('答题记录抽屉未落位');
  const inside = await clickLogical(415, 800);
  if (inside?.label !== '答题记录面板') throw new Error('答题记录栏空白处未被抽屉拦截：' + JSON.stringify(inside));
  if (await evalJs('document.body.style.cursor') !== 'default') throw new Error('答题记录抽屉空白处仍显示可选择光标');
  if (!await waitFor('×')) throw new Error('点击答题记录栏内部后抽屉意外关闭');
  const outside = await clickLogical(800, 80);
  if (outside?.label !== '答题记录遮罩') throw new Error('栏外点击没有触发答题记录抽屉关闭：' + JSON.stringify(outside));
  if (!await waitGone('答题记录遮罩')) throw new Error('栏外点击后答题记录抽屉没有关闭');
}, async () => true);

/**
 * 首页只该有三个入口。这条同时守住"题库不再是一张单独的卡片"和
 * "玩法说明搬进设置"：多了少了都是版式回来了。
 */
await step('首页三个入口，设置能开能关', async () => {
  const want = ['开始游戏', '题库', '设置'];
  const got = await evalJs(`cog.hots().map((h) => h.label)`);
  for (const w of want) {
    if (!got.includes(w)) throw new Error(`首页没有「${w}」：${got.join(' / ')}`);
  }
  await clickLabel('设置');
  if (!await waitFor('玩法说明')) throw new Error('设置面板没打开');
  await pressKey('Escape', 'Escape', 27);
  if (await waitFor('玩法说明', 800)) throw new Error('Esc 关不掉设置面板');
}, async () => (await waitFor('开始游戏')) || (await waitFor('继续这一局')));

await step('菜单过渡：旧热区退场、落位后可操作，减少动态效果立即切换', async () => {
  const firstFrame = (kind, staleLabel) => evalJs(`new Promise((resolve) => {
    const deadline = performance.now() + 5000;
    const frame = () => {
      const labels = cog.hots().map((h) => h.label);
      if (cog.state.panel.k === ${JSON.stringify(kind)} && !labels.includes(${JSON.stringify(staleLabel)})) {
        resolve({ locked: cog.locked(), labels });
      } else if (performance.now() < deadline) requestAnimationFrame(frame);
      else resolve(null);
    };
    requestAnimationFrame(frame);
  })`).catch(() => null);
  const early = firstFrame('settings', '设置');
  await clickLabel('设置');
  const entry = await early;
  if (!entry?.locked || entry.labels.length) throw new Error('旧画面尚在时仍有可点击热区');
  if (!await waitFor('出题模型')) throw new Error('设置面板未交还输入');
  await nextFrames(4);
  const settingsClose = await S('cog.hots().find((h) => h.label === "×")');

  // 关页和采样放在同一个浏览器任务里，节流时 CDP 往返可能错过短暂的退场帧。
  const exit = await evalJs(`new Promise((resolve) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    requestAnimationFrame(() => resolve({
      kind: cog.state.panel.k, locked: cog.locked(), labels: cog.hots().map((h) => h.label),
    }));
  })`);
  if (exit.kind !== 'none' || !exit.locked || exit.labels.length) throw new Error('关闭设置后的首帧不该注册首页热区');
  if (!await waitFor('设置')) throw new Error('关闭后首页未交还输入');

  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  try {
    const immediate = firstFrame('pack', '题库');
    await clickLabel('题库');
    const pack = await immediate;
    if (!pack || pack.locked || !pack.labels.includes('×')) throw new Error('减少动态效果时仍等待转场');
    await nextFrames(2);
    const packClose = await S('cog.hots().find((h) => h.label === "×")');
    if (!settingsClose || !packClose
      || settingsClose.x !== packClose.x || settingsClose.y !== packClose.y
      || settingsClose.w !== packClose.w || settingsClose.h !== packClose.h) {
      throw new Error('题库和设置窗口尺寸不一致');
    }
    await pressKey('Escape', 'Escape', 27);
    if (!await waitFor('题库')) throw new Error('关闭后未返回首页');
  } finally {
    await send('Emulation.setEmulatedMedia', { features: [] });
  }
}, async () => true);

/**
 * 模型参数是画布里的输入框，按键必须先归它 —— 否则 Tab/空格会被当成快捷键，
 * 或者打进去的字落不到字段上。这一段用真按键驱动，断言"值确实变了"。
 */
await step('设置 › 出题模型：能打字、Esc 退一层', async () => {
  await clickLabel('设置');
  if (!await waitFor('玩法说明')) throw new Error('设置面板没打开');
  await clickLabel('出题模型');
  if (!await waitFor('保存')) throw new Error('模型表单没打开');
  if (await evalJs('cog.state.panel.form.connection')) throw new Error('连接设置默认没有折叠');
  const before = await evalJs('cog.state.panel.form.model.value');
  await typeText('abc');
  const after = await evalJs('cog.state.panel.form.model.value');
  if (after !== before + 'abc') throw new Error(`输入框没收到按键：${JSON.stringify(before)} → ${JSON.stringify(after)}`);
  await pressKey('Tab', 'Tab', 9);
  if (await evalJs('cog.state.panel.form.field') !== 2) throw new Error('Tab 没换到密钥');
  await pressKey('Tab', 'Tab', 9);
  if (await evalJs('cog.state.panel.form.field') !== 1) throw new Error('Tab 没跳过隐藏的接口地址');
  await clickLabel('连接设置');
  await pressKey('Tab', 'Tab', 9);
  await pressKey('Tab', 'Tab', 9);
  if (await evalJs('cog.state.panel.form.field') !== 0) throw new Error('展开后无法用 Tab 到接口地址');
  await clickLabel('连接设置');
  if (await evalJs('cog.state.panel.form.field') !== 1) throw new Error('收起后焦点留在隐藏输入框');
  await pressKey('Escape', 'Escape', 27);
  if (await waitFor('保存', 800)) throw new Error('Esc 退不出模型表单');
  if (!await waitFor('玩法说明')) throw new Error('Esc 之后没回到设置列表');
  await clickLabel('玩法说明');
  if (!await waitFor('返回') || await waitFor('×', 150)) throw new Error('玩法说明没有唯一的返回入口');
  await clickLabel('返回');
  if (!await waitFor('出题模型')) throw new Error('从玩法说明返回后没有回到设置列表');
  await clickLabel('出题模型');
  if (!await waitFor('返回')) throw new Error('模型表单没有返回入口');
  await clickLabel('返回');
  if (!await waitFor('玩法说明')) throw new Error('模型表单的返回按钮没有回到设置列表');
  await pressKey('Escape', 'Escape', 27);
  if (await waitFor('玩法说明', 800)) throw new Error('Esc 关不掉设置面板');
}, async () => !(await evalJs('!!cog.state.panel.form')));

const libraryHits = () => S('cog.hots().map((h) => h.label)');

await step('题库逐级打开：题库列表 → 主题 → 题目，逐级返回', async () => {
  await clickLabel('题库');
  if (!await waitFor('bank:words')) throw new Error('入口没有显示题库列表');
  let hits = await libraryHits();
  if (hits.some((label) => label.startsWith('topic:') || label.startsWith('q:'))) {
    throw new Error('题库列表提前显示了主题或题目');
  }
  await clickLabel('bank:words');
  if (!await waitFor('返回') || await waitFor('×', 150)) throw new Error('主题列表没有唯一的返回入口');
  const hitsAtHeader = await S('cog.hots()');
  const back = hitsAtHeader.find(h => h.label === '返回');
  const firstTopic = hitsAtHeader.find(h => h.label.startsWith('topic:'));
  if (!back || !firstTopic || back.x !== 264 || back.y + back.h >= firstTopic.y) {
    throw new Error('主题列表的返回按钮不在左上角');
  }
  hits = await libraryHits();
  const topics = hits.filter((label) => label.startsWith('topic:'));
  if (topics.length < 2 || hits.some((label) => label.startsWith('bank:') || label.startsWith('q:'))) {
    throw new Error('主题页的内容层级不正确');
  }
  await clickLabel(topics[1]);
  if (!await waitFor('返回')) throw new Error('题目列表没有返回入口');
  hits = await libraryHits();
  const first = hits.find((label) => label.startsWith('q:'));
  if (!first || hits.some((label) => label.startsWith('bank:') || label.startsWith('topic:'))) {
    throw new Error('题目页的内容层级不正确');
  }
  const height = (label) => S(`cog.hots().find((h) => h.label === ${JSON.stringify(label)})?.h ?? 0`);
  const initialHeight = await height(first);
  const trackHeight = () => evalJs(`(() => {
    const heights = window.__questionHeights = [];
    const sample = () => {
      if (heights !== window.__questionHeights) return;
      const h = cog.hots().find(h => h.label === ${JSON.stringify(first)})?.h;
      if (h !== undefined) heights.push(h);
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  })()`);
  await trackHeight();
  await clickLabel(first);
  await nextFrames(24);
  const fullHeight = await height(first);
  const opening = await S('window.__questionHeights');
  if (!opening.some(h => h > initialHeight && h < fullHeight)) throw new Error('题目展开没有经过中间高度');
  await trackHeight();
  await clickLabel(first);
  await nextFrames(24);
  const closing = await S('window.__questionHeights');
  await evalJs('delete window.__questionHeights');
  if ((await height(first)) !== initialHeight || !closing.some(h => h > initialHeight && h < fullHeight)) {
    throw new Error('题目没有平滑收起');
  }

  await pressKey('Escape', 'Escape', 27);
  if (!await waitFor(topics[0])) throw new Error('Esc 没有返回主题列表');
  await clickLabel(topics[0]);
  if (!await waitFor('返回')) throw new Error('另一个主题没有返回入口');
  if ((await libraryHits()).includes(first)) throw new Error('换主题后仍显示原题目');
  const t0 = topics[0].slice('topic:'.length);
  const hist = JSON.parse(await evalJs(`(async () => {
    const m = await import('/src/core/library/index.ts');
    const t = ${JSON.stringify(t0)};
    const qs = m.sourceBank().byTopic[t];
    for (let i = 0; i < 3; i++) m.recordAnswer({ stageTopic: t, qid: qs[0].qid, right: true, choice: qs[0].answer + 1 });
    m.recordAnswer({ stageTopic: t, qid: qs[1].qid, right: false, choice: qs[1].answer === 0 ? 2 : 1 });
    return JSON.stringify({ t, done: qs[0].qid, bad: qs[1].qid });
  })()`));
  await sleep(200);
  const order = await evalJs('cog.hots().filter((h) => h.label.startsWith("q:")).map((h) => h.label)');
  if (order[0] !== `q:${hist.bad}`) throw new Error(`答错的那道没排到最前：${order[0]}`);
  if (order.includes(`q:${hist.done}`)) throw new Error('已掌握的那道还留在前面');

  await clickLabel(`q:${hist.bad}`);
  if (!await waitFor(`reset:${hist.bad}`)) throw new Error('答过的题展开之后没有「重置」');
  await clickLabel(`reset:${hist.bad}`);
  const left = await evalJs(`(async () => {
    const m = await import('/src/core/library/index.ts');
    return m.rightCount(${JSON.stringify(hist.t)}, ${JSON.stringify(hist.bad)})
      + m.wrongCount(${JSON.stringify(hist.t)}, ${JSON.stringify(hist.bad)});
  })()`);
  if (left !== 0) throw new Error(`重置之后还留着 ${left} 次记录`);

  await clickLabel('返回');
  if (!await waitFor(topics[0])) throw new Error('返回按钮跳过了主题列表');
  await clickLabel('返回');
  if (!await waitFor('bank:words')) throw new Error('返回按钮没有回到题库列表');
  await pressKey('Escape', 'Escape', 27);
}, async () => (await waitFor('开始游戏')) || (await waitFor('继续这一局')));

await step('题库：超过一屏的长题目仍可展开和收起', async () => {
  await clickLabel('题库');
  await clickLabel('bank:words');
  const topic = (await libraryHits()).find((label) => label.startsWith('topic:'));
  await clickLabel(topic);
  if (!await waitFor('返回')) throw new Error('题目页没有返回入口');
  await nextFrames(12);
  const first = await evalJs('cog.hots().find((h) => h.label.startsWith("q:"))');
  const label = first.label;
  if (first.h > 48) await clickLabel(label);
  await evalJs(`(async () => {
    const m = await import('/src/core/library/index.ts');
    const q = Object.values(m.sourceBank().byTopic).flat().find((q) => 'q:' + q.qid === ${JSON.stringify(label)});
    globalThis.__menuLong = { q, old: { q: q.q, options: q.options, explain: q.explain } };
    q.q = ['请判断这段代码：', String.fromCharCode(96).repeat(3) + 'js',
      ...Array.from({ length: 32 }, (_, i) => '  console.log(' + i + ');'), String.fromCharCode(96).repeat(3)].join('\\n');
    q.options = q.options.map(() => '这个选项描述所有权转移后原变量能否继续使用。'.repeat(8));
    q.explain = '变量离开作用域后会释放其拥有的资源。'.repeat(16);
  })()`);
  try {
    await clickLabel(label);
    await nextFrames();
    const expanded = await evalJs(`cog.hots().find((h) => h.label === ${JSON.stringify(label)})`);
    if (!expanded || expanded.h <= 48) throw new Error('长题目展开后失去点击区域');
    if (expanded.y < 234 || expanded.y + expanded.h > 770) throw new Error('长题目热区越过列表边界');
    await clickLabel(label);
    await nextFrames(24);
    const collapsed = await evalJs(`cog.hots().find((h) => h.label === ${JSON.stringify(label)})`);
    if (!collapsed || collapsed.h !== 48) throw new Error('长题目无法收起');
  } finally {
    await evalJs('Object.assign(__menuLong.q, __menuLong.old); delete globalThis.__menuLong;');
    await clickLabel('返回');
    await clickLabel('返回');
    await clickLabel('×');
  }
}, async () => (await waitFor('开始游戏')) || (await waitFor('继续这一局')));

// 模拟任务只在这一页的内存里，后面的开局流程从正常首页开始。
await step('出题 Agent：首次出题、混合更新、显式选用与删除', async () => {
  await evalJs(`(() => {
    const fetch = window.fetch;
    window.__restoreTopicMocks = () => { window.fetch = fetch; canvas.fillText = fillText; };
    window.__topicRequests = [];
    window.__deleteRequests = [];
    let generated = false;
    let bankRead = false;
    let jobs = [];
    const doc = { docId: 'saved-doc-test', name: '已保存文档.md', kind: 'md', chars: 100,
      createdAt: '2026-11-20', planId: 'saved-plan', importedPlanId: 'saved-plan' };
    const topics = ['基础', '进阶', '附录'].map(title => ({ title, chars: 100, summary: '已保存的正文', summarized: 'none' }));
    const canvas = document.querySelector('canvas').getContext('2d');
    const fillText = canvas.fillText;
    const shown = new Set();
    canvas.fillText = function (text, ...args) {
      shown.add(text);
      fillText.call(this, text, ...args);
    };
    window.__topicShown = (text) => shown.has(text);
    window.__setTopicDraft = () => {
      const job = jobs.find(item => item.id === 'topic-job-0');
      job.activity = [{ kind: 'index', active: true, ms: 0 }, { kind: 'source', title: '基础定义', active: false, ms: 1000 }, { kind: 'draft', active: true, ms: 1001 }];
    };
    window.__setTopicReview = () => {
      const job = jobs.find(item => item.id === 'topic-job-0');
      job.progress = { phase: 'review', completed: 2, total: 3 };
      job.activity.push({ kind: 'review', total: 3, active: true, ms: 2000 });
    };
    window.__finishTopicJobs = () => {
      jobs = jobs.map(job => ({ ...job, state: 'done', progress: { phase: 'complete', completed: 1, total: 1, written: 3 },
        activity: job.activity && [...job.activity, { kind: 'reviewed', passed: 3, rejected: 0, pending: 0, active: false, ms: 3000 }] }));
      generated = true;
    };
    window.__topicBankRead = () => bankRead;
    window.fetch = (input, init) => {
      const path = new URL(String(input), location.href).pathname;
      const json = (data) => Promise.resolve(new Response(JSON.stringify(data)));
      if (path === '/api/health') return json({ ok: true, apiVersion: 1, canGenerate: true });
      if (path === '/api/docs') return json([doc]);
      if (path === '/api/docs/saved-doc-test') return json({ ...doc, plan: { topics, tier: 'toc', notes: [] } });
      if (path === '/api/banks') return json(generated ? [{ id: doc.docId, name: doc.name }] : []);
      if (path === '/api/banks/delete') {
        window.__deleteRequests.push(JSON.parse(init.body));
        return new Promise(resolve => {
          window.__finishDelete = () => { generated = false; resolve(json({ ok: true })); };
        });
      }
      if (path === '/api/banks/saved-doc-test') {
        bankRead = true;
        return Promise.resolve(new Response(
          '# 已保存文档\\n## 基础\\n### 示例题？\\nA) 正确\\nB) 错误\\n= A\\n'));
      }
      if (path === '/api/jobs') return json(jobs);
      if (path === '/api/generate') {
        const body = JSON.parse(init.body);
        window.__topicRequests.push(body);
        const prefix = window.__topicRequests.length === 1 ? 'topic-job-' : 'topic-update-';
        jobs = body.topics.map((topic, i) => ({ id: prefix + topic, topic, planId: doc.planId, title: topics[topic].title,
          bankId: doc.docId, state: i ? 'queued' : 'running', ms: 0, taskType: 'generate', traceId: String(topic + 1).repeat(32),
          tail: '', progress: { phase: 'topics', completed: 0, total: 1 } }));
        return json({ ok: true, jobs });
      }
      return fetch(input, init);
    };
    return true;
  })()`);
  try {
    await clickLabel('题库');
    const label = 'bank:saved-doc-test';
    await clickLabel(label);
    if (!await waitFor('select-topic:0', 5000)) throw new Error('已导入主题不可勾选');
    if (await waitFor('生成所选主题', 200)) throw new Error('未选择时可以提交');
    await clickLabel('全选');
    await clickLabel('取消全选');
    await clickLabel('select-topic:0');
    await clickLabel('select-topic:2');
    await clickLabel('生成所选主题');
    const [body] = await S('window.__topicRequests');
    if (!body || body.docId !== 'saved-doc-test' || body.plan !== 'saved-plan' || body.topics.join() !== '0,2') {
      throw new Error('批量提交未使用勾选的主题');
    }
    await nextFrames();
    const hits = await S('cog.hots().map((h) => h.label)');
    if (hits.includes('select-topic:0') || hits.includes('select-topic:2') || !hits.includes('select-topic:1')) {
      throw new Error('运行中和排队中的主题仍可重复勾选');
    }
    await clickLabel('出题中 ›');
    if (!await waitFor('返回') || !await S("window.__topicShown('出题') && window.__topicShown('审核') && window.__topicShown('入库')")) {
      throw new Error('文档主题页的任务侧栏未显示三个阶段');
    }
    await evalJs('window.__setTopicDraft(); true');
    const draftDeadline = Date.now() + 4000;
    const draftShown = "window.__topicShown('构思题目中') && window.__topicShown('已读《基础定义》')";
    while (Date.now() < draftDeadline && !await S(draftShown)) await sleep(60);
    if (!await S(draftShown)) throw new Error('任务详情没有显示本轮读过的章节与出题动作');
    await evalJs('window.__setTopicReview(); true');
    const reviewDeadline = Date.now() + 4000;
    const reviewShown = "window.__topicShown('审核中 · 2/3') && window.__topicShown('提交 3 道候选题审核')";
    while (Date.now() < reviewDeadline && !await S(reviewShown)) await sleep(60);
    if (!await S(reviewShown)) throw new Error('任务详情没有更新审核进度与工作记录');
    await clickLogical(610, 130);
    if (!await waitGone('任务抽屉遮罩') || !await waitFor('审核中 · 2/3 ›')) throw new Error('关闭侧栏后未返回文档主题');
    await pressKey('Escape', 'Escape', 27);
    await pressKey('Escape', 'Escape', 27);
    await clickLabel('后台任务');
    if (!await waitFor('任务:topic-job-0', 5000) || !await waitFor('任务:topic-job-2', 5000)) {
      throw new Error('后台任务缺少各主题的独立记录');
    }
    await clickLabel('任务:topic-job-0');
    await pressKey('Escape', 'Escape', 27);
    if (!await waitFor('任务:topic-job-0')) throw new Error('Esc 跳过了后台任务列表');
    await clickLabel('任务:topic-job-0');
    await evalJs('window.__finishTopicJobs(); true');
    for (let i = 0; i < 100 && !await S('window.__topicBankRead()'); i++) await sleep(60);
    if (!await S("window.__topicBankRead() && window.__topicShown('已入库 3 道')")) {
      // The bank fetch can finish before the next canvas frame paints the updated label.
      await nextFrames();
      if (!await S("window.__topicBankRead() && window.__topicShown('已入库 3 道')")) throw new Error('任务完成后未显示入库数量或刷新题库');
    }
    if (!await S("window.__topicShown('3 道通过 · 0 道拒绝')")) throw new Error('任务完成后没有保留审核结果');
    if (!await waitFor('复制 Trace ID') || !await waitFor('下载 Trace')) throw new Error('任务详情没有 Trace 入口');
    await evalJs(`(() => {
      const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function() {
        window.__downloadedTrace = { url: new URL(this.href).pathname, filename: this.download };
        HTMLAnchorElement.prototype.click = click;
      };
      return true;
    })()`);
    await clickLabel('下载 Trace');
    const trace = await S('window.__downloadedTrace');
    if (trace?.url !== '/api/traces/' + '1'.repeat(32) || trace?.filename !== 'trace-' + '1'.repeat(32) + '.jsonl') {
      throw new Error('下载链接没有指向当前任务的 Trace');
    }
    await clickLabel('返回');
    if (!await waitFor('任务:topic-job-0')) throw new Error('返回按钮跳过了后台任务列表');
    await clickLabel('×');
    await clickLabel('题库');
    await clickLabel(label);
    if (!await waitFor('文档主题', 5000)) throw new Error('生成结束后无法打开题库与文档主题');
    const active = () => evalJs(`import('/src/core/library/index.ts').then(m => ({
      id: m.activeBankId(), name: m.sourceBank().name, saved: localStorage.getItem('cognirogue.bank.active.v1')
    }))`);
    if (!await waitFor('选择此题库', 5000) || (await active()).id !== 'words') {
      throw new Error('打开生成题库时未显示选择按钮，或已经自动切换');
    }
    await clickLabel('topic:基础');
    if (!await waitFor('返回') || !await S('cog.hots().some(h => h.label.startsWith("q:"))')) {
      throw new Error('未选中的题库无法预览题目');
    }
    await clickLabel('返回');
    await clickLabel('返回');
    if ((await active()).id !== 'words' || (await active()).saved === 'saved-doc-test') {
      throw new Error('仅浏览题库就改变了当前使用或已保存的题库');
    }
    await clickLabel(label);
    if (!await waitFor('选择此题库', 5000)) throw new Error('重新打开题库后无法选择');
    const detailHits = await S('cog.hots()');
    const select = detailHits.find(h => h.label === '选择此题库');
    const detailBack = detailHits.find(h => h.label === '返回');
    // 转场期间两个热区共用同一个纵向偏移。
    if (!select || !detailBack || select.x + select.w !== 1312 || Math.abs(select.y - detailBack.y - 624) > 0.01) {
      throw new Error('题库选择按钮不在右下角');
    }
    await clickLabel('选择此题库');
    const selected = await active();
    if (selected.id !== 'saved-doc-test' || selected.name !== '已保存文档' || selected.saved !== selected.id
      || await waitFor('选择此题库', 200)) {
      throw new Error('确认后没有切换题源、保存选择或隐藏选择按钮');
    }
    await clickLabel('返回');
    await clickLabel('bank:words');
    if (!await waitFor('选择此题库', 5000) || (await active()).id !== selected.id) {
      throw new Error('内置题库不能预览并重新选用');
    }
    await clickLabel('选择此题库');
    if ((await active()).id !== 'words') throw new Error('确认后未切回内置题库');
    await clickLabel('返回');
    await clickLabel(label);
    if (!await waitFor('文档主题', 5000)) throw new Error('切回内置题库后不能再次打开生成题库');
    await clickLabel('文档主题');
    if (!await waitFor('select-topic:0', 5000)) throw new Error('生成结束后不能重新选择主题');
    await clickLabel('select-topic:0');
    await clickLabel('select-topic:1');
    await clickLabel('生成所选主题');
    const [, update] = await S('window.__topicRequests');
    if (update?.topics.join() !== '0,1') throw new Error('混合提交未使用勾选的主题');
    await evalJs('window.__finishTopicJobs(); true');
    await pressKey('Escape', 'Escape', 27);
    await clickLabel('删除生成题目');
    if (!await waitFor('确认删除', 5000)) throw new Error('删除入口没有打开确认页');
    if (await S('cog.hots().some(h => h.label.startsWith("bank:") || h.label === "文档主题")')) {
      throw new Error('确认页背后仍可切换题库或打开文档');
    }
    await pressKey('Enter', 'Enter', 13);
    await clickLabel('取消');
    if (!await waitFor('删除生成题目', 5000)) throw new Error('取消后没有回到原题库');
    await clickLabel('删除生成题目');
    await pressKey('Escape', 'Escape', 27);
    if (!await waitFor('删除生成题目', 5000)) throw new Error('Esc 后没有回到原题库');
    if ((await S('window.__deleteRequests')).length) throw new Error('确认前提交了删除请求');
    await clickLabel('删除生成题目');
    await clickLabel('确认删除');
    if (await waitFor('确认删除', 300)) throw new Error('提交中仍可重复确认');
    const deletes = await S('window.__deleteRequests');
    if (deletes.length !== 1 || deletes[0].id !== 'saved-doc-test') throw new Error('删除请求次数或题库编号不正确');
    await evalJs('window.__finishDelete(); true');
    if (!await waitFor(label, 5000)) throw new Error('删除后没有返回题库列表，或文档条目消失');
    if (await S('cog.hots().some(h => h.label === "删除题库" || h.label === "删除生成题目")')) {
      throw new Error('删除后没有回到内置题库');
    }
    await clickLabel(label);
    if (!await waitFor('select-topic:0', 5000)) throw new Error('删除题目后无法使用文档主题');
    await clickLabel('select-topic:0');
    if (!await waitFor('生成所选主题')) throw new Error('删除题目后不能重新出题');
    await pressKey('Escape', 'Escape', 27);
    await pressKey('Escape', 'Escape', 27);
  } finally {
    await evalJs('window.__restoreTopicMocks(); delete window.__restoreTopicMocks; delete window.__topicRequests; delete window.__finishTopicJobs; delete window.__setTopicReview; delete window.__setTopicDraft; delete window.__topicShown; delete window.__topicBankRead; delete window.__deleteRequests; delete window.__finishDelete; true');
  }
}, async () => (await waitFor('开始游戏')) || (await waitFor('继续这一局')));

await boot();
await step('上传无目录文档：手动模型分章，导入主题后才可勾选', async () => {
  await evalJs(`(() => {
    const fetch = window.fetch;
    const click = HTMLInputElement.prototype.click;
    const canvas = document.querySelector('canvas').getContext('2d');
    const fillText = canvas.fillText;
    const shown = new Set();
    window.__importCaptionShown = (text) => shown.has(text);
    canvas.fillText = function (text, ...args) {
      shown.add(text);
      fillText.call(this, text, ...args);
    };
    window.__restoreImportMocks = () => {
      window.fetch = fetch;
      HTMLInputElement.prototype.click = click;
      canvas.fillText = fillText;
      delete window.__importCaptionShown;
    };
    const doc = { docId: 'new-doc-test', name: '无目录.md', kind: 'md', chars: 100, planId: '' };
    const requests = window.__importRequests = [];
    let savedPlan;
    const planJobs = [];
    const plans = {
      auto: { tier: 'fixed', topics: [{ title: '段落预览', chars: 100, summary: '原文首句', summarized: 'none' }] },
      agentic: { tier: 'agentic', agenticWindow: 9000, agenticOverlapChars: 1375, topics: [{ title: '模型主题', chars: 100,
        summary: '分章摘要', summarized: 'model', subtopics: [{ title: '子主题标题', summary: '子主题摘要', pageFrom: 2, pageTo: 3 }] }] },
    };
    HTMLInputElement.prototype.click = function() {
      if (this.type !== 'file') return click.call(this);
      const data = new DataTransfer();
      data.items.add(new File(['无目录的正文'], doc.name));
      this.files = data.files;
      this.dispatchEvent(new Event('change'));
    };
    window.fetch = (input, init) => {
      const path = new URL(String(input), location.href).pathname;
      const json = (data) => Promise.resolve(new Response(JSON.stringify(data)));
      if (path === '/api/health') return json({ ok: true, apiVersion: 1, canGenerate: true });
      if (path === '/api/docs' && init?.method === 'POST') {
        requests.push({ path });
        return json({ ok: true, ...doc });
      }
      if (path === '/api/docs') return json([doc]);
      if (path === '/api/banks') return json([]);
      if (path === '/api/docs/new-doc-test') return json({ ...doc, plan: savedPlan });
      if (path === '/api/docs/new-doc-test/topics') {
        const body = JSON.parse(init.body);
        requests.push({ path, body });
        doc.importedPlanId = body.plan;
        return json({ ok: true });
      }
      if (path === '/api/plan') {
        const body = JSON.parse(init.body);
        requests.push({ path, body });
        const job = { id: 'split-' + body.mode, taskType: 'plan', state: 'done', title: '目录解析', ms: 0, tail: '' };
        planJobs.push(job);
        return json({ ok: true, job: job.id, planId: body.mode + '-plan' });
      }
      if (path === '/api/jobs') return json(planJobs);
      if (path.startsWith('/api/jobs/split-')) {
        const job = planJobs.find((row) => '/api/jobs/' + row.id === path);
        const mode = path.slice('/api/jobs/split-'.length);
        savedPlan = { ...plans[mode], chars: 100, notes: [] };
        doc.planId = mode + '-plan';
        return json({ ...job, plan: savedPlan });
      }
      if (path === '/api/generate') {
        requests.push({ path, body: JSON.parse(init.body) });
        return json({ ok: false, error: '模拟生成请求' });
      }
      return fetch(input, init);
    };
    return true;
  })()`);
  try {
    await clickLabel('题库');
    await clickLabel('从文档建题库');
    if (!await waitFor('确认主题划分', 8000)) throw new Error('上传后没有出现划分确认');
    const fallback = await S('cog.state.panel.data');
    if (fallback.tier !== 'fixed' || !fallback.msg.includes('未识别到目录主题')) {
      throw new Error('没有标明目录解析回落');
    }
    if (await waitFor('select-topic:0', 200)) throw new Error('预览期间可以选择出题主题');
    if (fallback.agenticOverlapChars !== 800) throw new Error('默认重叠量应为 800 字符');
    await clickLabel('+');
    await clickLabel('重叠字符数');
    await typeText('1375');
    await clickLabel('模型分章');
    if (!await waitFor('确认主题划分', 8000)) throw new Error('模型分章后没有恢复划分确认');
    const prepared = await S('cog.state.panel.data');
    const requests = await S('window.__importRequests');
    if (prepared.tier !== 'agentic' || prepared.topics[0].title !== '模型主题'
        || prepared.agenticOverlapChars !== 1375 || requests.at(-1)?.body?.agenticOverlapChars !== 1375
        || requests.at(-1)?.body?.agenticWindow !== 9000
        || requests.map((r) => r.body?.mode ?? r.path).join() !== '/api/docs,auto,agentic') {
      throw new Error('预览阶段请求错误：' + JSON.stringify(requests));
    }
    if (!await S('window.__importCaptionShown("· 子主题标题  ·  第 2–3 页") && window.__importCaptionShown("子主题摘要")')) {
      throw new Error('分章预览未显示子主题及页码');
    }
    await clickLabel('确认主题划分');
    if (!await waitFor('select-topic:0', 5000)) throw new Error('确认后未直接进入主题勾选');
    const imported = await S('window.__importRequests.at(-1)');
    if (imported.path !== '/api/docs/new-doc-test/topics' || imported.body.plan !== 'agentic-plan'
        || await S('window.__importRequests.some((r) => r.path === "/api/generate")')) {
      throw new Error('导入没有保存主题，或意外启动了出题');
    }
    await pressKey('Escape', 'Escape', 27);
    if (!await waitFor('bank:new-doc-test', 5000)) throw new Error('确认主题后无法返回题库列表');
    await pressKey('Escape', 'Escape', 27);
  } finally {
    await evalJs('window.__restoreImportMocks(); delete window.__restoreImportMocks; delete window.__importRequests; true');
  }
}, async () => (await waitFor('开始游戏')) || (await waitFor('继续这一局')));

await step('划分计划：主题操作与退回', async () => {
  await evalJs(`(() => {
    cog.state.panel = { k: 'plan', data: {
      docId: 'words', name: '文档.md', tier: 'toc', chars: 100,
      topics: Array.from({ length: 12 }, (_, i) => ({ title: '主题 ' + (i + 1), chars: 100, summary: '内容摘要', summarized: 'model' })),
      notes: [], canAgentic: true, imported: true, selected: new Set(), busy: '', msg: '', ok: true, planId: 'existing-plan',
    } };
    return 1;
  })()`);
  for (const w of ['全选', 'select-topic:0']) {
    if (!await waitFor(w, 3000)) {
      const labels = await evalJs('cog.hots().map((h) => h.label)');
      throw new Error(`计划面板缺「${w}」：${labels.join(' / ')}`);
    }
  }
  const labels = await evalJs('cog.hots().map((h) => h.label)');
  if (labels.includes('按固定大小切')) throw new Error('技术切分选项仍暴露在界面上');
  const hits = await S('cog.hots()');
  const back = hits.find((h) => h.label === '返回');
  if (!back || hits.some((h) => h.label === '×')) throw new Error('划分面板没有唯一的返回入口');
  // 热区跟着浮层一起位移，按返回按钮推回面板原点。
  const listTop = back.y - 16 + 184;
  const buttons = hits.filter((h) => h.label.startsWith('select-topic:'));
  if (!buttons.length || buttons.some((h) => h.y < listTop - 0.01 || h.y + h.h > listTop + 404.01)) {
    throw new Error('屏幕外主题仍注册了选择热区：' + JSON.stringify({ listTop, buttons }));
  }
  await pressKey('Escape', 'Escape', 27);
  let k = await evalJs('cog.state.panel.k');
  for (let i = 0; i < 40 && k !== 'pack'; i++) { await sleep(80); k = await evalJs('cog.state.panel.k'); }
  if (k !== 'pack') throw new Error(`Esc 之后没退回题库面板：${k}`);
  await pressKey('Escape', 'Escape', 27);
}, async () => (await waitFor('开始游戏')) || (await waitFor('继续这一局')));

await step('取消选题后忽略迟到的题池', async () => {
  await evalJs(`(async () => {
    const library = await import('/src/core/library/index.ts');
    const fetch = window.fetch;
    window.__restoreRunPool = () => { window.fetch = fetch; delete window.__releaseRunPool; };
    window.fetch = (input, init) => {
      const path = new URL(String(input), location.href).pathname;
      if (path === '/api/health') return Promise.resolve(Response.json({ ok: true }));
      if (path === '/api/run-pool') return new Promise((resolve) => {
        const questions = library.sourceBank().byTopic[JSON.parse(init.body).topics[0]].slice(0, 1);
        window.__releaseRunPool = () => resolve(Response.json({ ok: true, questions }));
      });
      return fetch(input, init);
    };
    await library.refreshServiceInfo();
  })()`);
  try {
    await clickLabel('开始游戏');
    await clickLabel(await waitBoon());
    await clickLabel('topic:0');
    await clickLabel('topic:1');
    await clickLabel('开始这一局');
    if (!await waitFor('准备题目…') || !await S('!!window.__releaseRunPool')) throw new Error('题池请求未进入等待');
    if ((await libraryHits()).includes('topic:0')) throw new Error('等待题池时仍可修改所选主题');
    await pressKey('Escape', 'Escape', 27);
    if (!await waitBoon()) throw new Error('没有取消开局');
    await evalJs('window.__releaseRunPool()');
    await nextFrames();
    if (await S('cog.state.panel.k') !== 'boon') throw new Error('迟到的题池响应启动了新局');
    await pressKey('Escape', 'Escape', 27);
  } finally {
    await evalJs('window.__restoreRunPool()');
  }
}, () => waitFor('开始游戏'));

await step('标题 → 选模式 → 选两个主题 → 开局', async () => {
  await clickLabel('开始游戏');
  const label = await waitBoon();
  if (!label) throw new Error('开局选模式没有出现');
  await clickLabel(label);
  globalThis.__mode = label.slice('mode:'.length);
  await pickTopicsThenStart();
  // 退款现在是借书证给的，不再人人有；后面那条经济断言按这一局实际有没有它来算。
  globalThis.__refund = await evalJs('cog.state.powers.includes("librarycard") ? 1 : 0');
}, async () => {
  const st = await evalJs(`({
    screen: cog.state.screen, mode: cog.state.mode, powers: cog.state.powers,
    topics: cog.state.topics, queue: cog.state.runQueue.length,
  })`);
  // 模式必须真的兑现成初始能力：学习 2 张、复习 1 张、测试 0 张。
  const want = st.mode === 'study' ? 2 : st.mode === 'review' ? 1 : 0;
  // 选中的两个主题要真的变成这一局的临时题库，否则抽题会抽到没选的主题
  return st.screen === 'map' && st.mode === globalThis.__mode && st.powers.length === want
    && st.topics.length === 2 && st.queue > 0;
});
await step('地图 → 进节点', () => clickLabel('node'), async () => (await S('cog.state.screen')) === 'battle');
// 点牌就是出题：中间不该再有任何浮层。这一步挂了就说明又退回了"先选档再看题"
// 手牌里现在混着初始牌组（base:*），要挑一张知识卡点 —— 基础牌点下去不出题。
await step('点一张知识卡 → 直接翻成题面，落位后可作答', async () => {
  // 开局的手牌是从牌堆飞进来的，飞行途中没有热区（点它等于点空气），必须等它落地
  if (!await waitHand()) throw new Error('手牌一直没落位');
  globalThis.__apBeforeAsk = await S('cog.state.ap');
  // 固定一张会触发冲刺的 1 费知识卡，避免随机起手绕过答对后的攻击演出。
  await ensureQuestions();
  globalThis.__askIdx = 0;
  await evalJs('cog.state.hand[0] = "c02"');
  globalThis.__askId = await evalJs(`cog.state.hand[${globalThis.__askIdx}]`);
  globalThis.__askCost = await evalJs(`cog.costOf(cog.state.hand[${globalThis.__askIdx}])`);
  const entryFrames = evalJs(`new Promise((resolve) => {
    const values = [];
    const deadline = performance.now() + 12000;
    const frame = () => {
      if (cog.state.panel.k === 'question') {
        const quiz = cog.quiz();
        if (quiz.phase === 'ask') {
          const opts = cog.hots().some((h) => h.label === 'opt');
          values.push({ entry: quiz.entry, opts, locked: cog.locked() });
          if (quiz.entry === 'ready' && opts) { resolve(values); return; }
        }
        if (performance.now() >= deadline) { resolve(values); return; }
      } else if (performance.now() >= deadline) { resolve(values); return; }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  })`);
  await clickCard(globalThis.__askIdx);
  globalThis.__questionEntryFrames = await entryFrames;
}, async () => {
  const p = await S('cog.state.panel');
  const frames = globalThis.__questionEntryFrames ?? [];
  const phases = [...new Set(frames.map((frame) => frame.entry))];
  if (phases.join() !== 'front,question,ready'
      || frames.some((frame) => frame.entry !== 'ready' && (frame.opts || !frame.locked))) {
    throw new Error('题框入场顺序或输入锁异常：' + JSON.stringify(frames));
  }
  return p.k === 'question' && typeof p.qid === 'string' && Array.isArray(p.view.options) && frames.at(-1)?.opts;
});

// 押注机制已经整个拿掉：面板里只该有一道题 + 四个选项，不该再有任何"换档/押注"按钮。
// 这条断言是死的：只要有人把档位加回来，它就会红。
await step('答题面板里没有档位按钮', async () => {
  const n = await evalJs(`cog.hots().filter((h) => h.label === 'tier').length`);
  if (n !== 0) throw new Error(`还剩 ${n} 个档位按钮`);
}, async () => true);

await step('取消答题：关闭按钮与 Esc 都翻回原牌，退场期间不接收作答或回合输入', async () => {
  const snapshot = () => S('JSON.stringify({ hand: cog.state.hand, ap: cog.state.ap, turn: cog.state.turn })');
  const before = await snapshot();
  for (const exit of [() => clickLabel('×'), () => pressKey('Escape', 'Escape', 27)]) {
    const frames = evalJs(`new Promise(resolve => {
      const deadline = performance.now() + 12000;
      const seen = [];
      const frame = () => {
        if (cog.state.panel.k !== 'question' || performance.now() >= deadline) { resolve(seen); return; }
        const phase = cog.quiz().entry;
        if (phase !== 'ready') {
          const blocked = cog.locked() && !cog.hots().some(h => ['opt', 'card', 'endturn'].includes(h.label));
          seen.push({ phase, blocked });
          if (seen.length === 1) for (const key of ['1', 'Enter', 'Escape']) {
            window.dispatchEvent(new KeyboardEvent('keydown', { key }));
          }
        }
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    })`);
    await exit();
    const samples = await frames;
    const phases = [...new Set(samples.map(sample => sample.phase))];
    if (phases.join() !== 'question,front' || samples.some(sample => !sample.blocked)) {
      throw new Error('取消翻牌顺序或退场热区异常：' + JSON.stringify(samples));
    }
    if (await snapshot() !== before || !await waitHand()) throw new Error('取消后原手牌或行动力改变');
    await clickCard(globalThis.__askIdx);
    if (!await waitFor('opt')) throw new Error('归位后原牌不能重新打开题面');
  }
}, async () => await S('cog.state.panel.k === "question"'));

// 答对才会触发打击动画，所以这里点「正确答案」而不是第一个选项
await step('选对 → 判定面板一帧都不画出来', async () => {
  // 选项每次出题都会重新排，正确答案的位置只能从本次的 panel.view 里读
  const right = await evalJs('cog.state.panel.view.answer');
  await clickLabel('opt', right);
}, async () => {
  await nextFrames(2);
  const st = await evalJs(`({
    drawn: cog.quiz().drawn,
    cont: cog.hots().filter((h) => h.label === '继续').length,
    panel: cog.state.panel.k,
  })`);
  // 答对当场结算：屏幕上只有战场本身，没有面板、也没有「继续」按钮。
  // feedback 那一小段只是给打击演出锁输入用的，它不该被画出来。
  return st.drawn === false && st.cont === 0
    && (st.panel === 'feedback' || st.panel === 'none');
});

// 答对之后不该再要一次确认：演出演完，面板自己收掉，手牌立刻能继续打。
await step('答对 → 不用点「继续」，自己回到可以出牌的状态', async () => {
  if (!await waitReady(15000)) throw new Error('答对之后一直没回到可出牌的状态');
}, async () => (await S('cog.state.panel.k')) === 'none');

// 经济规则：有借书证时答对退回 1 点，没有就不退。它要是坏了，整套节奏就塌了
// （1 费牌的免费出手是"会的人一回合能打完手牌"的唯一来源），所以单独钉一条。
await step('答对 → 按借书证退回行动力', async () => {},
  async () => {
    const back = Math.min(globalThis.__askCost, globalThis.__refund);
    const actual = await S('cog.state.ap');
    const expected = globalThis.__apBeforeAsk - globalThis.__askCost + back;
    if (actual !== expected) throw new Error(JSON.stringify({
      card: globalThis.__askId, before: globalThis.__apBeforeAsk, cost: globalThis.__askCost,
      refund: back, expected, actual, powers: await S('cog.state.powers'),
    }));
    return true;
  });

await step('结束回合 → 回合数前进，敌人真的演了动作且输入被锁', async () => {
  if (!await waitReady()) throw new Error('上一步一直没结算完');
  await clickLabel('endturn');
}, async () =>
  (await S('cog.state.turn')) > 1
  && (await S('cog.fx().enemy')) > 0
  && (await S('cog.locked()')));

// 敌人回合以前是静默的：只有真掉血才发 hurt，被全挡下、举盾、塞杂念、变强、观察
// 全都是"数字变了但画面没动"。现在每个分支都发 enemyAct，这里盯两件事：
// 演出确实在画面上（fx().enemy > 0），以及演完之后飞行单元没残留在屏幕上。
await step('敌人演完 → 输入解锁、演出单元清空、新回合手牌飞回来', async () => {
  // 演出时长受机器负载影响（后台节流时能拖到好几秒），固定 sleep 一定会不够。
  // 用状态轮询：演出单元清零 + 输入解锁 + 手牌真的全部停稳，三件事同时成立才算演完。
  const t0 = Date.now();
  // 8 秒在正常机器上绰绰有余，CPU ×6 时敌人演出 + 五张牌依次飞回来会拖到
  // 十几秒。上限给宽不拖慢正常情况：状态一成立就立刻返回。
  while (Date.now() - t0 < 30000) {
    const st = await S('({ enemy: cog.fx().enemy, locked: cog.locked(), ready: cog.handReady() })');
    if (st.enemy === 0 && !st.locked && st.ready) return;
    await sleep(60);
  }
}, async () => {
  const st = await S('({ enemy: cog.fx().enemy, locked: cog.locked(), ready: cog.handReady(), hand: cog.state.hand.length })');
  if (!st.ready) throw new Error('手牌没有归位：' + JSON.stringify(st));
  return st.enemy === 0 && !st.locked;
});

await step('五种敌人意图各演一次 → 每种都产生演出单元', async () => {
  const counts = [];
  for (const k of ['atk', 'def', 'jam', 'buff', 'calm']) {
    await evalJs(`cog.enemyAct(${JSON.stringify(k)}, 0)`);
    await sleep(70);
    counts.push(await S('cog.fx().enemy'));
  }
  globalThis.__enemyCounts = counts;
}, async () => {
  const c = globalThis.__enemyCounts;
  return c.length === 5 && c.every((n) => n > 0);
});

await boot(URL_ + '?dev=battle');
await step('基础格挡与敌人防御 → 抬盾、合甲后恢复操作', async () => {
  await evalJs(`cog.state.hand[0] = 'base:guard'`);
  const block = await S('cog.state.block');
  // Sample the pose during the click rather than assuming the click helper returns mid-animation.
  const motion = evalJs(`new Promise((resolve) => {
    const deadline = performance.now() + 12000;
    const tick = () => {
      if (cog.state.block > ${block} && cog.guardPose().hero > 0.5) resolve(true);
      else if (performance.now() >= deadline) resolve(false);
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  })`);
  await clickCard(0);
  if (!await motion) throw new Error('Hero did not raise the book after gaining block');
  await evalJs('cog.enemyAct("def")');
  const deadline = Date.now() + 3500;
  while (!await S('cog.guardPose().enemy > 0.5')) {
    if (Date.now() >= deadline) throw new Error('Enemy did not close its ward panels');
    await nextFrames(1);
  }
  if (!await waitReady()) throw new Error('Defense animation did not release input');
}, async () => await S('cog.guardPose().hero < 0.5 && cog.guardPose().enemy < 0.5'));

await boot(URL_ + '?dev=battle');
await step('双方护盾：等命中后逐帧淡出，回合清除也不瞬间跳变', async () => {
  await evalJs(`Object.assign(cog.state.enemy, { block: 1, dmg: 12, mech: undefined, moves: [{ k: 'atk' }], mv: 0 });
    cog.state.turn = 2; cog.state.block = 1; cog.state.hand[0] = 'base:strike';`);
  if (!await waitHand()) throw new Error('手牌未就绪');
  const wardValue = (side) => S(`cog.wards().${side}`);
  async function waitFull(side) {
    const deadline = Date.now() + 10000;
    while (await wardValue(side) < 1 && Date.now() < deadline) await nextFrames(1);
    if (await wardValue(side) < 1) throw new Error(side + ' 护盾没出现');
  }
  async function verifyRelease(side, action, waitsForHit = true) {
    await waitFull(side);
    const sample = evalJs(`new Promise(resolve => {
      const deadline = performance.now() + 12000;
      const check = [];
      const tick = () => {
        const power = cog.wards().${side};
        const block = ${side === 'hero' ? 'cog.state.block' : 'cog.state.enemy.block'};
        if (!block) check.push(power);
        if ((check.length && power === 0) || performance.now() > deadline) resolve(check);
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    })`);
    await action();
    const values = await sample;
    if ((waitsForHit && values[0] !== 1) || new Set(values.filter((n) => n > 0 && n < 1)).size < 2 || values.at(-1) !== 0) {
      throw new Error(side + ' 护盾没有保留到命中并逐帧淡出：' + JSON.stringify(values));
    }
  }
  await verifyRelease('enemy', () => clickCard(0));
  if (!await waitReady()) throw new Error('打击演出没有结束');
  await verifyRelease('hero', () => clickLabel('endturn'));
  if (!await waitReady()) throw new Error('敌人演出没有结束');
  await evalJs(`cog.state.block = 5; cog.state.enemy.moves = [{ k: 'def', v: 0 }];`);
  await verifyRelease('hero', () => clickLabel('endturn'), false);
}, async () => await S('cog.wards().hero === 0 && cog.wards().enemy === 0'));

// 增益是**掉落**，不是牌。掉落面板只有确认按钮，不再有可点击的能力牌、
// 面板出现时它已经在生效列表里（掉落即生效，这一屏只是收据）。
// 这条挂了说明它又退化成"拿进牌组、要自己打出"，或者面板把玩家卡住
// （掉落没有"拒绝"的语义，所以连 × 都不该有）。
await boot(URL_ + '?dev=powerdrop');
await step('增益掉落 → 无卡牌热区、只有「知道了」、掉落即已生效', async () => {
  const st = await S('({ k: cog.state.panel.k, id: cog.state.panel.id, pw: cog.state.powers.slice() })');
  if (st.k !== 'powerdrop') throw new Error('没有打开掉落面板：' + JSON.stringify(st));
  if (st.id !== 'lamp') throw new Error('掉落的不是长明灯：' + st.id);
  // 关键：面板还开着的时候，它就已经在工作了 —— 不是"确认之后才开始生效"
  if (!st.pw.includes('lamp')) throw new Error('面板还开着，长明灯却不在生效列表里：' + st.pw.join(','));
  // 面板上只有"知道了"一个按钮 —— 多出来的那个会是"不要/跳过"这类不该存在的出口
  const labels = await evalJs('cog.hots().filter((h) => h.label && h.label !== "card").map((h) => h.label)');
  if (!labels.includes('知道了')) throw new Error('掉落面板上没有「知道了」：' + labels.join(','));
  if (labels.includes('powerdrop')) throw new Error('掉落面板仍有可点击的能力牌');
  if (labels.some((l) => /跳过|不要/.test(l))) throw new Error('掉落面板上出现了拒绝的出口：' + labels.join(','));
  globalThis.__pwBefore = st.pw.length;
  await clickLabel('知道了');
  await nextFrames(3);
}, async () => {
  const st = await S('({ k: cog.state.panel.k, pw: cog.state.powers.slice(), n: cog.state.powers.length })');
  if (st.k !== 'none') throw new Error('面板没关掉：' + st.k);
  // 关面板不该改变任何数值：它只是收据
  if (st.n !== globalThis.__pwBefore) throw new Error('关面板把增益数量改了：' + JSON.stringify(st));
  if (!st.pw.includes('lamp')) throw new Error('长明灯没了：' + st.pw.join(','));
  return true;
});

// 藏书：一次往牌组里塞几张随机知识卡。只飘一句「藏书 生效」的话，
// 玩家永远不知道是哪几张 —— 关掉增益面板之后必须把牌面摆出来。
await boot(URL_ + '?dev=powerdrop&id=exlibris');
await step('藏书 → 关掉增益后摆出拿到的牌', async () => {
  await clickLabel('知道了');
  const st = await S(`({
    k: cog.state.panel.k, ids: cog.state.panel.ids, deck: cog.state.deck,
  })`);
  if (st.k !== 'cardget') throw new Error('没有转到牌面，面板是 ' + st.k);
  // 张数由 stage 的 6y 按 BAL.exlibrisCards 钉住；这里只管"摆出来的都真的在牌组里"。
  if (!st.ids.length) throw new Error('面板上一张卡都没有');
  if (!st.ids.every((id) => st.deck.includes(id))) {
    throw new Error('摆出来的卡不在牌组里：' + JSON.stringify(st));
  }
  await clickLabel('知道了');
}, async () => {
  const st = await S('({ k: cog.state.panel.k })');
  if (st.k !== 'none') throw new Error('看过之后面板没收起：' + st.k);
  return true;
});

// 答错的规则：这一手作废、不扣行动力；不补格挡、不补抽，牌进弃牌堆。
// 题不是答错才扣的：点开牌时 `takeQuestion` 就扣了，答对答错都一样，
// 所以下面那条 `q -1` 断言验的是"点开时扣过"，不是"答错扣一道"。
await boot(URL_ + '?dev=battle');
await step('答错 → 不扣行动力、不补格挡、不补抽，牌进弃牌堆', async () => {
  if (!await waitHand()) throw new Error('手牌一直没落位');
  // 起手只带 2 张随机知识卡，抽 5 张时可能一张都没摸到；这条测的是答错规则，不是抽牌。
  const pick = await ensureKnowledge();
  globalThis.__missHand = await evalJs('cog.state.hand.length');
  globalThis.__missAp = await S('cog.state.ap');
  globalThis.__missQ = await S('cog.state.qLeft.length');
  globalThis.__missBlk = await S('cog.state.block');
  globalThis.__missDc = await S('cog.state.discard.length');
  await clickCard(pick);
  if (!await waitFor('opt')) throw new Error('点牌之后没有出题');
  const wrong = await evalJs(`(() => {
    const v = cog.state.panel.view;
    return { wrong: (v.answer + 1) % v.options.length };
  })()`);
  globalThis.__badBefore = await evalJs('cog.state.runBad');
  await clickLabel('opt', wrong.wrong);
  await expectFeedback('答错后');
}, async () => {
  const st = await evalJs(`({
    hand: cog.state.hand.length,
    ap: cog.state.ap,
    bad: cog.state.runBad,
    q: cog.state.qLeft.length,
    blk: cog.state.block,
    dc: cog.state.discard.length,
  })`);
  // 手牌少一张 = 打出去那手作废了，而且**没有补位** —— 这是这版规则的核心取舍。
  // 弃牌堆 +1 可以断言了：不补抽，就不会出现"抽到同一种把计数冲掉"的飘移。
  const ok = st.hand === globalThis.__missHand - 1
    && st.ap === globalThis.__missAp
    && st.bad === globalThis.__badBefore + 1
    && st.q === globalThis.__missQ - 1
    && st.blk === globalThis.__missBlk
    && st.dc === globalThis.__missDc + 1;
  if (!ok) throw new Error('实际状态：' + JSON.stringify(st));
  return true;
});

// 初始牌组：点基础牌不弹题，直接结算，并且扣 1 点行动力。
// 它是这一局的"地板"——答错之后至少还有牌能打。
// 10 张起手里 8 张是基础牌，抽 5 张时通常就有；这里直接塞一张进手牌，
// 测的是"点基础牌不走答题"，不是抽牌概率。
await boot(URL_ + '?dev=battle');
await step('基础牌 → 不出题，直接造成伤害并扣 1 点行动力', async () => {
  if (!await waitHand()) throw new Error('手牌一直没落位');
  await evalJs('cog.state.hand[0] = "base:strike"');
  if (await S('cog.state.hand[0]') !== 'base:strike') throw new Error('基础牌没塞进手牌');
  globalThis.__baseHp = await S('cog.state.enemy.hp');
  globalThis.__baseAp = await S('cog.state.ap');
  await clickCard(0);
}, async () => {
  const st = await S('({ hp: cog.state.enemy.hp, ap: cog.state.ap, panel: cog.state.panel.k })');
  // 基础斩击是 4 点伤害：不出题、敌人掉血、行动力 -1
  return st.panel === 'none' && st.hp === globalThis.__baseHp - 4 && st.ap === globalThis.__baseAp - 1;
});

// ── 费用 ───────────────────────────────────────────────────
// 费用是这一版新增的经济维度。三条边界都得钉住：2 费答对只退 1 点、付不起的牌
// 连题都弹不出来、X 费牌按耗掉的点数结算。任何一条翻了，费用就退化成了装饰。
await boot(URL_ + '?dev=battle');
await step('2 费牌答对 → 只退回 1 点，净花 1 点', async () => {
  if (!await waitHand()) throw new Error('手牌一直没落位');
  await ensureQuestions();
  const id = await evalJs('cog.pack.cards.find((c) => c.cost === 2).id');
  // 这张 2 费牌的答题要求是 2 次，所以这一手一定会出题；顺手把计数清掉更稳。
  await evalJs(`(() => { const G = cog.state; G.powers = ['librarycard']; G.hand[0] = ${JSON.stringify(id)}; G.ap = 3; G.charge = {}; })()`);
  await clickCard(0);
  if (!await waitFor('opt')) throw new Error('付得起的 2 费牌没有弹题');
  const right = await evalJs('cog.state.panel.view.answer');
  await clickLabel('opt', right);
}, async () => (await S('cog.state.ap')) === 2);   // 3 - 2 + 1

await boot(URL_ + '?dev=battle');
await step('付不起的 3 费牌 → 点不出题、行动力不动', async () => {
  if (!await waitHand()) throw new Error('手牌一直没落位');
  const id = await evalJs('cog.pack.cards.find((c) => c.cost === 3).id');
  await evalJs(`(() => { const G = cog.state; G.hand[0] = ${JSON.stringify(id)}; G.ap = 2; })()`);
  await clickCard(0);
}, async () => {
  const st = await S('({ ap: cog.state.ap, panel: cog.state.panel.k })');
  return st.ap === 2 && st.panel === 'none';
});

await boot(URL_ + '?dev=battle');
await step('X 费牌 → 吃光行动力，按点数结算 3 次', async () => {
  if (!await waitHand()) throw new Error('手牌一直没落位');
  await ensureQuestions();
  // 试答之刺：X 费 + 洞察 + 单段 —— 3 点行动力就该打 3 段
  const id = await evalJs('cog.pack.cards.find((c) => c.cost === "x" && c.eff === "pierce").id');
  await evalJs(`(() => { const G = cog.state; G.powers = ['librarycard']; G.hand[0] = ${JSON.stringify(id)}; G.ap = 3; G.charge = {}; })()`);
  await clickCard(0);
  if (!await waitFor('opt')) throw new Error('X 费牌没有弹题');
  const right = await evalJs('cog.state.panel.view.answer');
  await clickLabel('opt', right);
  if (!await waitReady(15000)) throw new Error('X 费牌答对之后没有结算完');
}, async () => {
  // 答对不再弹面板：段数从「最近一次判定」读，那里记着这一手完整的结算结果。
  const st = await S('({ ap: cog.state.ap, hits: cog.lastAnswer() ? cog.lastAnswer().hits.length : -1 })');
  return st.ap === 1 && st.hits === 3;   // 3 点全花，退回 1 点；效果结算 3 次
});

// 回归：手牌打空、行动力归零时，「结束回合」必须仍然可点。
// 这里曾经用「还有没有牌可打」决定要不要注册热区，于是唯一还能前进的局面被彻底锁死 ——
// 按钮画在屏幕上，点下去却没有任何反应。战斗里没有任何东西能替代这个按钮，必须守住。
await step('手牌与行动力都归零 → 结束回合仍然生效', async () => {
  // 上一手答对之后面板会自己收掉，这里只要等它真的闲下来。
  if (!await waitReady()) throw new Error('上一手一直没闲下来');
  // X 费牌 3 段可能已经把敌人打死（pending=clear），那样 endTurn 本来就该被挡住 ——
  // 这里测的是"手牌空 + 行动力 0 时按钮还能按"，所以先把战斗恢复成进行中。
  await evalJs(`(() => {
    const G = cog.state;
    G.pending = null;
    if (G.enemy) G.enemy.hp = Math.max(1, G.enemy.maxHp);
    G.screen = 'battle';
    G.hand.length = 0; G.ap = 0;
  })()`);
  globalThis.__turnBefore = await S('cog.state.turn');
  await clickLabel('endturn');
  // 多段攻击会跨 tick 结算；点击被接受不代表下一回合已经开始。
  if (!await waitReady()) throw new Error('敌方回合未结算完');
}, async () => (await S('cog.state.turn')) === globalThis.__turnBefore + 1);

// 答错也要有演出，但**不能是攻击**：提灯焰一暗、屑在原地散掉，没有任何东西飞向敌人。
// 这一步盯两件事：敌人一滴血不掉（不该有 dmg），以及"推迟"没把面板吞掉
// —— 一旦 panelHold 卡住不归零，玩家就再也看不到解析。
await boot(URL_ + '?dev=battle');
await step('答错 → 没有攻击、敌人不掉血，反馈面板迟到但一定会来', async () => {
  if (!await waitHand()) throw new Error('手牌一直没落位');
  globalThis.__foeHp = await S('cog.state.enemy.hp');
  // 记住这张牌是谁：下一步要查它到底回了牌堆还是进了弃牌堆。
  // 必须挑知识卡 —— 基础牌不出题。
  globalThis.__missIdx = await ensureKnowledge();
  globalThis.__missId = await S(`cog.state.hand[${globalThis.__missIdx}]`);
  globalThis.__learnMissHand = await evalJs('cog.state.hand.length');
  await clickCard(globalThis.__missIdx);
  // 先确认题目真的出来了，再去读选项 —— 否则读到的是上一屏的 undefined
  if (!await waitFor('opt')) throw new Error('点牌之后没有出题');
  // 挑一个「本次视图里」的错误选项：题库里的原始答案位置已经被打乱了
  const pick = await evalJs(`(() => {
    const v = cog.state.panel.view;
    return { wrong: (v.answer + 1) % v.options.length };
  })()`);
  // 从选错前开始采样，避免错过解析出现前误播的飞行。
  await evalJs(`(() => {
    const { x, y, w, h } = cog.quiz().geom;
    const center = { x: x + w / 2, y: y + h / 2 };
    const before = cog.state.discard.length;
    window.__missFlight = new Promise((resolve) => {
      const frames = [];
      let early = false;
      let gap = false;
      const deadline = performance.now() + 10000;
      const tick = () => {
        const quiz = cog.quiz();
        const closed = cog.state.panel.k === 'none';
        if (cog.fx().discard > 0 && cog.lastClick()?.label !== '继续') early = true;
        if (!closed && quiz.flipAt) {
          frames.push({ at: quiz.flipAt, face: quiz.entry, locked: cog.locked(), buttons: cog.hots().some(h => h.label === '继续') });
        } else if (frames.length && !closed) {
          gap = true;
        }
        if (closed || performance.now() >= deadline) resolve({ center, frames, before, early, gap });
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  })()`);
  await clickLabel('opt', pick.wrong);
}, async () => {
  // 面板此刻还没画出来（在等演出），但必须在两秒半之内出现
  await expectFeedback('答错后');
  const hp = await S('cog.state.enemy.hp');
  return (await S('cog.state.panel.k')) === 'feedback'
    && (await S('cog.state.panel.fb.right')) === false
    && hp === globalThis.__foeHp;
});

await step('继续 → 解析框连续翻成牌面，落入弃牌堆', async () => {
  if (await S('cog.state.panel.k') !== 'feedback') throw new Error('解析已被提前关闭');
  await clickLabel('继续');
  const { center, frames, before, early, gap } = await evalJs('window.__missFlight');
  if (early) throw new Error('还在显示解析时就播放了弃牌飞行');
  const first = frames[0];
  const last = frames.at(-1);
  if (gap || !first || first.face !== 'question' || last.face !== 'front'
    || first.at.x !== center.x || first.at.y !== center.y
    || frames.some((f, i) => !f.locked || f.buttons
      || (i > 0 && (f.at.x > frames[i - 1].at.x || f.at.y < frames[i - 1].at.y)))) {
    throw new Error('解析退场没有连续翻成牌面：' + JSON.stringify({ center, frames, gap }));
  }
  globalThis.__missDiscardBefore = before;
}, async () => {
  const st = await evalJs(`({
    fx: cog.fx().discard,
    added: cog.state.discard.slice(${globalThis.__missDiscardBefore}),
    hand: cog.state.hand.length,
  })`);
  return st.fx === 0 && st.added.length === 1 && st.added[0] === globalThis.__missId
    && st.hand === globalThis.__learnMissHand - 1;
});

// ── 第二阶段：三个弹层各自点一次，确认按钮真的能按 ──
await boot(URL_ + '?dev=rest');
await step('复习点 → 休息回血', async () => {
  // 满血时休息不会回血，先把血扣下去，才测得出"点了真的生效"
  await evalJs('cog.state.hp = 30');
  await clickLabel('休息');
  globalThis.__hpBefore = 30;
}, async () => {
  const hp = await S('cog.state.hp');
  return (await S('cog.state.panel.k')) === 'none' && hp > globalThis.__hpBefore;
});

// 带「便签」的四选一：张数最多的那一屏。曾经四张 280px 卡算出来 1222px，
// 比 1220px 的面板还宽，卡片左右各压出边框 1px。这里既测点击，也钉住留白。
await boot(URL_ + '?dev=reward&sticky=1');
await step('战后选卡（便签四选一不贴边）→ 牌组 +1', async () => {
  globalThis.__deckBefore = await S('cog.state.deck.length');
  globalThis.__rewardBoxes = await S(
    "cog.hots().filter(h => h.label === 'rewardcard').map(h => ({ x: h.x, w: h.w }))",
  );
  await clickLabel('rewardcard', 0);
}, async () => {
  const bs = globalThis.__rewardBoxes;
  // 奖励面板固定 x=190..1410；四张时左右各至少留 40px，不许再压到框上
  const left = Math.min(...bs.map((b) => b.x));
  const right = Math.max(...bs.map((b) => b.x + b.w));
  const inFrame = bs.length === 4 && left - 190 >= 40 && 1410 - right >= 40;
  return inFrame && (await S('cog.state.deck.length')) === globalThis.__deckBefore + 1;
});

// ── 地图要能上下拖 ─────────────────────────────────────────
// 玩家报的原文："关卡选择不能上下拖动，所有的图标挤到一起"。
// 要钉住的是两件不同的事：滚轮/拖动真的能翻动地图，以及**拖动之后松手不算点击**
//（否则拖着找路，一松手就把镜头底下那个节点点进去了）。
//
// 断言读 `cog.mapCam()` 而不是节点热区：镜头一离开当前层，屏幕上就一个可点节点都没有，
// 热区列表根本读不出"翻没翻"。
await boot(URL_ + '?dev=map&stage=3');
await step('地图 → 滚轮能把镜头翻上去', async () => {
  globalThis.__cam0 = await evalJs('cog.mapCam().cam');
  for (let i = 0; i < 6; i++) {
    await send('Input.dispatchMouseEvent', {
      type: 'mouseWheel', x: 800, y: 400, deltaX: 0, deltaY: -220, button: 'none', clickCount: 0,
    });
    await sleep(60);
  }
}, async () => {
  // 等镜头滑到位；这是状态，不是固定时长
  for (let i = 0; i < 40; i++) {
    const c = await evalJs('cog.mapCam()');
    if (c.manual && c.cam > globalThis.__cam0 + 1) return true;
    await sleep(60);
  }
  throw new Error('滚轮没有翻动地图：' + JSON.stringify(await evalJs('cog.mapCam()')));
});

await step('地图 → 按住拖动也能翻，而且松手不算点击', async () => {
  // 上一把已经把镜头顶到上限，所以这一把往**下**拖（cam 变小），那里有的是空位。
  globalThis.__cam1 = await evalJs('cog.mapCam().cam');
  const x = 800;
  const y0 = 700;
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: y0 });
  await sleep(40);
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x, y: y0, button: 'left', buttons: 1, clickCount: 1,
  });
  // 分几帧走完：一次跳到底，dragY 只有一个样本，看不出拖动
  for (let i = 1; i <= 6; i++) {
    await send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x, y: y0 - i * 34, button: 'left', buttons: 1,
    });
    await sleep(40);
  }
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x, y: y0 - 204, button: 'left', buttons: 0, clickCount: 1,
  });
}, async () => {
  if ((await S('cog.state.screen')) !== 'map') throw new Error('拖动被当成了点击，画面进了节点');
  for (let i = 0; i < 40; i++) {
    const c = await evalJs('cog.mapCam()');
    // 把地图往上推 = 露出下面那几层 = cam 变小（cam 是"屏幕底部那一行"的层号）
    if (c.cam < globalThis.__cam1 - 1) return true;
    await sleep(60);
  }
  throw new Error('拖动没有翻动地图：' + JSON.stringify(await evalJs('cog.mapCam()')));
});

// 手动翻过之后走一步：镜头必须回到当前层，否则玩家会"走到看不见的地方"。
// 这里不动 `screen`（点了节点就进战斗，地图不再重画，也就测不到镜头）：
// 直接把 `pos` 挪到上面几层的一格，等价于"刚走完一个节点"。
await step('地图 → 走一步之后镜头回到当前层', async () => {
  // 先滚回底部，让当前层的节点重新出现在屏幕上
  for (let i = 0; i < 12; i++) {
    await send('Input.dispatchMouseEvent', {
      type: 'mouseWheel', x: 800, y: 400, deltaX: 0, deltaY: 260, button: 'none', clickCount: 0,
    });
    await sleep(50);
  }
  if (!(await evalJs('cog.mapCam().manual'))) throw new Error('滚到底之后手动标记已经没了');
  // 往塔上走 4 层，并把这一格标成已走过 —— 这一步模拟"刚打完一个节点"
  await evalJs(`(() => {
    const s = cog.state;
    const nd = s.map[4][0];
    s.seen[nd.key] = true;
    s.pos = { r: 4, i: nd.i };
    s.floors = 4;
  })()`);
}, async () => {
  for (let i = 0; i < 40; i++) {
    const c = await evalJs('cog.mapCam()');
    // 走了一步 = 手动标记清掉，镜头自己跟到当前层（第 4 层附近）
    if (!c.manual && c.cam >= 1 && c.cam <= 6) return true;
    await sleep(60);
  }
  throw new Error('走了新的一层，镜头没有跟回来：' + JSON.stringify(await evalJs('cog.mapCam()')));
});

// ── 精炼：只改挑中的那一张，而且看得见效果 ──────────────────
// 两条都是玩家报过的：
//   1. "精炼看不到效果" —— 面板上画的必须是**选完之后**的数值（预览即结果）；
//   2. "精炼只针对单张卡，不能是一类卡" —— 牌组里四张基础斩击要各占一格，
//      点哪一个格子就只有那一张变成 7 伤，另外三张还是 4 伤。
await boot(URL_ + '?dev=rest');
await step('复习点 → 精炼面板：每份副本各一格，且只改挑中的那一张', async () => {
  await clickLabel('精炼一张卡');
  // 面板打开是状态，不是动画：等 panel.k，不睡固定时间。
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) {
    if ((await S('cog.state.panel.k')) === 'cardpick') break;
    await sleep(60);
  }
  if ((await S('cog.state.panel.k')) !== 'cardpick') throw new Error('没有打开精炼选牌面板');
  // 牌组里 4 张基础斩击 = 4 个可点的格子，而不是 1 个"×4"
  globalThis.__upSlots = await evalJs(`(() => {
    const h = cog.hots().filter((x) => x.label === 'pick');
    return { n: h.length, deck: cog.state.deck.length };
  })()`);
  if (globalThis.__upSlots.n !== globalThis.__upSlots.deck) {
    throw new Error('精炼面板的格子数 != 牌组张数：' + JSON.stringify(globalThis.__upSlots));
  }
  // 点第一个格子。不假设它是哪一张 —— 断言只关心"只有一张变强了"。
  globalThis.__upBefore = await evalJs(`(() => {
    const d = cog.state.deck;
    return { len: d.length, up: d.filter((id) => id.endsWith('+')).length };
  })()`);
  // 点第一个格子 → 进入预览态（不直接精炼）。面板仍是 cardpick，
  // 但多了一个 pick 下标；牌组这时必须一张没变。
  await clickLabel('pick', 0);
  await (async () => {
    const t = Date.now();
    while (Date.now() - t < 10000) {
      const s = await evalJs(`({ k: cog.state.panel.k, pick: cog.state.panel.pick })`);
      if (s.k === 'cardpick' && s.pick !== undefined) return;
      await sleep(60);
    }
    throw new Error('点了牌没有进入精炼预览');
  })();
  const mid = await evalJs(`({
    deck: cog.state.deck,
    up: cog.state.deck.filter((id) => id.endsWith('+')).length,
  })`);
  if (mid.up !== globalThis.__upBefore.up) {
    throw new Error('预览态就把牌改了：' + JSON.stringify(mid));
  }
  // 确认精炼。
  await clickLabel('确认精炼');
}, async () => {
  const st = await evalJs(`({
    deck: cog.state.deck,
    panel: cog.state.panel.k,
    up: cog.state.deck.filter((id) => id.endsWith('+')),
  })`);
  // 牌组张数不变、正好多出一张带 + 的牌，而且它**只有一张** ——
  // 这正是"精炼只针对单张卡"：同名的其余副本仍然是白板。
  const ok = st.panel === 'none'
    && st.deck.length === globalThis.__upBefore.len
    && st.up.length === globalThis.__upBefore.up + 1;
  if (!ok) {
    throw new Error('实际状态：' + JSON.stringify({
      panel: st.panel, len: st.deck.length, before: globalThis.__upBefore, up: st.up,
    }));
  }
  return true;
});

/*
 * 精炼的第二态：待选列表只画**原样**，点中之后才画精炼后的样子。
 * 这条断言看的是两件事：列表里没有一张卡带 `+`、以及预览里的数值确实变了。
 */
await boot(URL_ + '?dev=rest');
await step('精炼面板：待选列表画原样，点开才显示精炼后', async () => {
  await clickLabel('精炼一张卡');
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) {
    if ((await S('cog.state.panel.k')) === 'cardpick') break;
    await sleep(60);
  }
  if ((await S('cog.state.panel.k')) !== 'cardpick') throw new Error('没有打开精炼选牌面板');

  // 列表态：面板上没有"确认精炼"按钮，也没有 pick 下标。
  const listState = await evalJs(`({
    pick: cog.state.panel.pick,
    hasConfirm: cog.hots().some((x) => x.label === '确认精炼'),
    slots: cog.hots().filter((x) => x.label === 'pick').length,
  })`);
  if (listState.pick !== undefined) throw new Error('列表态不该有 pick 下标');
  if (listState.hasConfirm) throw new Error('列表态不该有确认按钮');
  if (!listState.slots) throw new Error('列表里没有可点的牌');

  // 点进去：出现确认按钮，牌组还没改。
  await clickLabel('pick', 0);
  const t1 = Date.now();
  while (Date.now() - t1 < 10000) {
    if (await evalJs(`cog.hots().some((x) => x.label === '确认精炼')`)) break;
    await sleep(60);
  }
  const hasConfirm = await evalJs(`cog.hots().some((x) => x.label === '确认精炼')`);
  if (!hasConfirm) throw new Error('预览态没有确认按钮');
  const upNow = await evalJs(`cog.state.deck.filter((id) => id.endsWith('+')).length`);
  if (upNow !== 0) throw new Error('预览态不该改牌组');

  // 返回：回到列表，牌组仍是一张没变。
  await clickLabel('返回');
  const t2 = Date.now();
  while (Date.now() - t2 < 10000) {
    if (!(await evalJs(`cog.hots().some((x) => x.label === '确认精炼')`))) break;
    await sleep(60);
  }
  const back = await evalJs(`({
    pick: cog.state.panel.pick,
    k: cog.state.panel.k,
    up: cog.state.deck.filter((id) => id.endsWith('+')).length,
  })`);
  if (back.k !== 'cardpick' || back.pick !== undefined) {
    throw new Error('返回后应回到列表态：' + JSON.stringify(back));
  }
  if (back.up !== 0) throw new Error('返回后牌组不该被改：' + JSON.stringify(back));
}, async () => {
  // 断言都在上面走完了：列表无确认按钮、点开有、返回不改牌组。
  // 这里再确认一次终端状态，防止上面的 if 被删掉而这条测试仍然"通过"。
  const fin = await evalJs(`({
    k: cog.state.panel.k,
    pick: cog.state.panel.pick,
    up: cog.state.deck.filter((id) => id.endsWith('+')).length,
  })`);
  return fin.k === 'cardpick' && fin.pick === undefined && fin.up === 0;
});

await boot(URL_ + '?dev=refine');
await step('精炼面板：滚轮能滚动列表', async () => {
  if (!await waitFor('pick')) throw new Error('精炼面板没有打开');
  // 开局 10 张刚好两排、不用滚；补到 14 张，列表才会真的溢出（max > 0）
  await evalJs(`(() => {
    const d = cog.state.deck;
    while (d.length < 14) d.push('base:guard');
  })()`);
  await nextFrames(3);
  const cells = () => evalJs(
    `JSON.stringify(cog.hots().filter((h) => h.label === 'pick').map((h) => Math.round(h.y)))`,
  );
  globalThis.__pick0 = await cells();
  const p = JSON.parse(await evalJs('JSON.stringify(cog.toScreen(800, 450))'));
  await send('Input.dispatchMouseEvent', {
    type: 'mouseWheel', x: p.x, y: p.y, deltaX: 0, deltaY: 420, pointerType: 'mouse',
  });
  await nextFrames(4);
  globalThis.__pick1 = await cells();
}, async () => {
  // 玩家报过"精炼 / 遗忘的时候滚轮卡住"：面板画在地图之上，而地图每帧先把滚轮
  // 增量取走再判断有没有面板挡着 —— 取走之后 overlay 永远拿到 0，列表就死了。
  if (globalThis.__pick0 === globalThis.__pick1) {
    throw new Error('滚了一格，列表一动没动：' + globalThis.__pick0);
  }
  return true;
});

// ── 同名副本：点哪一份，动的是哪一份 ────────────────────────
await boot(URL_ + '?dev=battle');
await step('三张同名卡：点第 3 张，被拿走的就是第 3 张', async () => {
  await evalJs(`(() => {
    cog.state.hand = ['base:strike', 'base:strike', 'base:strike', 'base:guard'];
    cog.state.ap = 3;
    window.__splices = [];
  })()`);
  if (!await waitHand()) throw new Error('手牌没有落位');
  // 手牌只存 id，三张基础斩击在规则上完全等价 ——「拿走的是第几份」从手牌内容
  // 上看不出来。给 G.hand 套一层 Proxy，记下核心真正 splice 掉的下标。
  await evalJs(`(() => {
    const real = cog.state.hand;
    cog.state.hand = new Proxy(real, {
      get(t, p) {
        if (p === 'splice') {
          return (...a) => { window.__splices.push(a[0]); return Array.prototype.splice.apply(t, a); };
        }
        const v = Reflect.get(t, p);
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
  })()`);
  await clickCard(2);
  globalThis.__playIdx = await evalJs('window.__splices.slice()');
}, async () => {
  const s = globalThis.__playIdx;
  if (!s.length) throw new Error('点了之后手牌一张都没少');
  // 以前一律走 `indexOf(id)`，点哪张都 splice 0：被拿走、飞出去的永远是
  // 最左边那张，玩家读作"用的不是我点的这张"。
  if (s[0] !== 2) throw new Error(`点的是第 3 张，被拿走的却是第 ${s[0] + 1} 张`);
  return true;
});

// ── 回合结束：没打出的牌飞进弃牌堆 ──────────────────────────
await boot(URL_ + '?dev=battle');
await step('结束回合 → 上一轮没打出的牌飞进弃牌堆（同名牌还躺在牌堆里也一样）', async () => {
  await evalJs(`(() => {
    const G = cog.state;
    G.hand = ['base:strike'];
    // 关键：抽牌堆里留着**同种牌的另一份**，而且抽完 5 张之后它还在堆里 ——
    // 牌是从尾部 pop 的，所以把它放在第 0 位。表现层早先拿 G.draw.includes(id) 判去处，
    // id 是牌种不是副本，于是这张进弃牌堆的斩击会被画成飞回抽牌堆 ——
    // 玩家看到的就是"这一轮没打出的牌没有回到弃牌堆"。
    // 注意别让抽牌堆见底：见底会把弃牌堆整个洗回来，那张牌就真的回牌堆了。
    G.draw = ['base:strike', 'base:guard', 'base:guard', 'base:guard', 'base:guard', 'base:guard'];
  })()`);
  if (!await waitHand()) throw new Error('手牌没有落位');
  // 逐帧收集"正在飞的牌各去哪"。弃牌动画只有 0.3 秒，点完再读会正好错过。
  await evalJs(`(() => {
    window.__modes = [];
    window.__stop = false;
    const tick = () => {
      for (const m of cog.fx().discardModes) if (!window.__modes.includes(m)) window.__modes.push(m);
      if (!window.__stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    cog.endTurn();
  })()`);
  await nextFrames(8);
  globalThis.__turnModes = await evalJs('(window.__stop = true, window.__modes)');
}, async () => {
  const m = globalThis.__turnModes ?? [];
  if (!m.includes('discard')) throw new Error('结束回合后一张牌都没飞进弃牌堆：' + m.join(','));
  if (m.some((x) => x !== 'discard' && x !== 'junk')) {
    throw new Error('有牌被画成不该有的方向：' + m.join(','));
  }
  return true;
});

// 上面那条只放 1 张牌，验的是「方向」；这条验「张数」。
// 抽牌堆里留同名牌，新手牌会和旧手牌 id 重合：表现层早先按 id 对齐，把这些
// 副本认成「没动过」，于是只有 1 张牌飞向弃牌堆 —— 玩家读作「有的牌没回去」。
await boot(URL_ + '?dev=battle');
await step('结束回合 → 3 张没打出的牌一张不落地全飞进弃牌堆', async () => {
  await evalJs(`(() => {
    const G = cog.state;
    G.hand = ['base:strike', 'base:guard', 'c01'];
    G.draw = ['base:guard', 'base:guard', 'base:guard', 'base:guard', 'base:guard', 'base:strike'];
    G.discard = ['c02'];
    G.enemy.hp = 9999; G.enemy.maxHp = 9999; G.hp = 999; G.maxHp = 999;
    G.pending = null; G.busy = false; G.panel = { k: 'none' };
  })()`);
  if (!await waitHand()) throw new Error('手牌没有落位');
  // 逐帧取同时在飞的弃牌张数峰值：动画只有 0.3 秒，点完再读一定错过。
  await evalJs(`(() => {
    window.__peak = 0;
    window.__stop = false;
    const tick = () => {
      window.__peak = Math.max(window.__peak, cog.fx().discard);
      if (!window.__stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    cog.endTurn();
  })()`);
  await sleep(900);
  globalThis.__turnPeak = await evalJs('(window.__stop = true, window.__peak)');
  globalThis.__turnDiscard = await S('cog.state.discard.slice()');
}, async () => {
  const peak = globalThis.__turnPeak ?? 0;
  if (peak < 3) throw new Error(`3 张旧手牌只飞出去 ${peak} 张：有牌没回弃牌堆`);
  const pile = globalThis.__turnDiscard ?? [];
  for (const id of ['base:strike', 'base:guard', 'c01']) {
    if (!pile.includes(id)) throw new Error(`${id} 没进弃牌堆`);
  }
  return true;
});

await boot(URL_ + '?dev=event');
await step('事件 → 选一个选项', () => clickLabel('eventopt', 0), async () =>
  (await S('cog.state.panel.k')) !== 'event');

// 事件白送的卡：选项上只能写「获得一张随机知识卡」，卡名要到选完才知道；
// 而只报一个名字，玩家仍然不知道它打出来是几点。这一屏必须把牌面本身摆出来。
await boot(URL_ + '?dev=event&ev=index-cards');
await step('事件拿卡 → 摆出牌面，看过才回地图', async () => {
  globalThis.__deckBefore = await S('cog.state.deck.length');
  await clickLabel('eventopt', 0);
  const st = await S(`({
    k: cog.state.panel.k, ids: cog.state.panel.ids, deck: cog.state.deck,
  })`);
  if (st.k !== 'cardget') throw new Error('没有摆出卡面，面板是 ' + st.k);
  if (st.deck.length !== globalThis.__deckBefore + 1) {
    throw new Error('卡没进牌组：' + st.deck.length);
  }
  // 摆出来的必须就是刚进牌组的那一张 —— 不是"某一张长得差不多的"。
  if (st.ids.length !== 1 || st.ids[0] !== st.deck[st.deck.length - 1]) {
    throw new Error('摆出来的不是刚进牌组的那一张：' + JSON.stringify(st));
  }
  await clickLabel('知道了');
}, async () => {
  const st = await S(`({ k: cog.state.panel.k, deck: cog.state.deck.length })`);
  if (st.k !== 'none') throw new Error('看过之后面板没收起：' + st.k);
  if (st.deck !== globalThis.__deckBefore + 1) throw new Error('牌组不对：' + st.deck);
  return true;
});

// 选牌类事件（旧笔记本：精炼一张，失去 10 点生命）打开面板后取消，
// 必须回到事件本身、一分血不扣、也不白拿收益 —— 这条路径以前会把节点空丢在半路。
await boot(URL_ + '?dev=event&ev=notebook');
await step('事件选牌 → 取消回到事件，代价一起清掉', async () => {
  const before = await S('cog.state.hp');
  globalThis.__hpBefore = before;
  await clickLabel('eventopt', 0);
  if ((await S('cog.state.panel.k')) !== 'cardpick') throw new Error('没有打开选牌面板');
  if ((await S('cog.state.pendingCost')) !== 10) throw new Error('待付代价没挂上');
  await clickLabel('返回');
}, async () => {
  const st = await S(`({
    panel: cog.state.panel.k, cost: cog.state.pendingCost,
    heal: cog.state.pendingHeal, hp: cog.state.hp,
  })`);
  const ok = st.panel === 'event' && st.cost === 0 && st.heal === 0 && st.hp === globalThis.__hpBefore;
  if (!ok) throw new Error('实际状态：' + JSON.stringify(st));
  return true;
});

// 同一个面板再走一次键盘出口：Esc 和左上角的返回必须等价。
await step('事件选牌 → Esc 也能取消，回到事件', async () => {
  await clickLabel('eventopt', 0);
  if ((await S('cog.state.panel.k')) !== 'cardpick') throw new Error('第二次没打开选牌面板');
  await pressKey('Escape', 'Escape', 27);
}, async () => {
  const st = await S(`({ panel: cog.state.panel.k, cost: cog.state.pendingCost, hp: cog.state.hp })`);
  const ok = st.panel === 'event' && st.cost === 0 && st.hp === globalThis.__hpBefore;
  if (!ok) throw new Error('实际状态：' + JSON.stringify(st));
  return true;
});

// ── 断点 ───────────────────────────────────────────────────
// 100 层的一局接近一小时，存档不是附加功能，是"这局能不能玩完"的一部分。
// 这里走完整条路：写一份断点 → 真的刷新一次 → 首页出现「继续这一局」
// → 点它回到同一幕同一层，血、牌组、走过的路都还在。
// 刷新的那一次走的是没有 dev 参数的首页 —— 除了「继续」按钮，`saveRun()` 在
// 别的画面上一个字都不会写。
await boot(URL_ + '?dev=map&stage=3');
globalThis.__snap = await evalJs(`(() => {
  const s = cog.state;
  const nd = s.map[6][0];
  s.pos = { r: 6, i: nd.i };
  s.floors = 6;
  s.hp = 41;
  cog.save();
  // 不抄版本号：存档 key 带版本后缀，版本一升这里就读成 null。按前缀扫。
  let raw = null;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('cognirogue.run.')) raw = localStorage.getItem(k);
  }
  return { len: raw ? raw.length : 0, deck: s.deck.length, hp: s.hp };
})()`);
await boot(URL_);
await step('断点：刷新之后首页能「继续这一局」，回到同一幕同一层', async () => {
  if (!globalThis.__snap.len) throw new Error('cog.save() 什么都没写进去');
  // 首页的两个按钮是"有存档 / 没存档"两套版式，位置不同 —— 按标签找，不猜坐标
  if (!await waitFor('继续这一局')) throw new Error('刷新后首页没有「继续这一局」');
  await clickLabel('继续这一局');
}, async () => {
  const st = await S(`({
    screen: cog.state.screen, stage: cog.state.stage,
    r: cog.state.pos ? cog.state.pos.r : -1,
    hp: cog.state.hp, deck: cog.state.deck.length,
    panel: cog.state.panel.k, pending: cog.state.pending,
  })`);
  const ok = st.screen === 'map' && st.stage === 3 && st.r === 6
    && st.hp === globalThis.__snap.hp && st.deck === globalThis.__snap.deck
    && st.panel === 'none' && st.pending === null;
  if (!ok) throw new Error('实际状态：' + JSON.stringify(st));
  return true;
});

// 开新局必须把断点清掉，否则死了以后首页会举着一个「继续」骗人点进去 ——
// 点进去还是那座已经塌了的塔。这里走真实的清档路径（startRun 第一行就 clearRun）。
await boot(URL_);
await step('开新的一局 → 断点清掉，再刷新首页不再提「继续」', async () => {
  if (!await waitFor('开始新的一局')) throw new Error('首页没有「开始新的一局」');
  await clickLabel('开始新的一局');
  const bl = await waitBoon();
  if (!bl) throw new Error('开局选模式没有出现');
  await clickLabel(bl);
  await pickTopicsThenStart();
  if ((await S('cog.state.screen')) !== 'map') throw new Error('没有进入地图');
  // 再刷一次：首页应该退回"没有存档"的那套版式
  await boot(URL_);
}, async () => {
  const n = await evalJs(`cog.hots().filter((h) => h.label === '继续这一局').length`);
  return n === 0 && (await S('cog.state.screen')) === 'title';
});

/* ── 机制联动回归：前一张牌真的改变后一张牌的数值 ──────────────
 * 这里验的是规则，不是演出：伤害数字必须随抽牌数 / 护甲 / 上一张牌 /
 * 同名卡累计次数真实变化，卡面、答题面板、结算读的是同一份 liveStatOf。
 * ─────────────────────────────────────────────────────────────── */

/**
 * 真实打出一张联动牌并返回敌人掉了多少血。
 * 同名卡第一次答对就攒满 1 次答题要求、这一场剩下的免答（既有规则），
 * 所以第二次点它走的是 playFree：不 panel、不判对错，但照样结算、照样记账。
 * 两条路都要能走，grow 才验得到"第二次"。
 */
async function playRight(idx) {
  const hp = await S('cog.state.enemy.hp');
  await clickCard(idx);
  if ((await S('cog.state.panel.k')) === 'question') {
    if (!await waitFor('opt')) throw new Error('联动牌没有出题');
    const right = await S('cog.state.panel.view.answer');
    await clickLabel('opt', right);
    // 答对没有判定面板要点，直接等这一手结算完。
    if (!await waitReady()) throw new Error('联动牌答对之后没有结算完');
  } else if (!await waitReady()) {
    throw new Error('免答的联动牌一直没结算完');
  }
  return hp - (await S('cog.state.enemy.hp'));
}

/** 出牌会让整排左移、抽牌还会往末尾塞新牌，所以按牌种找下标，不写死位置。 */
async function playRightId(id) {
  const idx = await evalJs(`cog.state.hand.indexOf(${JSON.stringify(id)})`);
  if (idx < 0) throw new Error(`手牌里没有 ${id}`);
  return playRight(idx);
}

await boot(URL_ + '?dev=links');
await step('联动：四张牌的数值由战场状态现算，不是印死的', async () => {
  await waitHand();
}, async () => {
  const L = await S('cog.links()');
  return L.live.c83 === 3 + L.drawn   // 本回合每抽 1 张 +1
    && L.live.c84 === L.block        // 当前护甲等额
    && L.live.c85 === 3
    && L.live.c86 === 4;
});

await step('联动：真的抽一张牌，「博览强记」的伤害当场 +1', async () => {
  globalThis.__linkBefore = await S('cog.links()');
  // c04「扩容远见」：0 费专注牌，先把它本场的答题要求攒满，点它才会直接抽 1 张。
  await evalJs(`cog.state.charge.c04 = 1`);
  await clickCard(await evalJs(`cog.state.hand.indexOf('c04')`));
}, async () => {
  const L = await S('cog.links()');
  return L.drawn === globalThis.__linkBefore.drawn + 1
    && L.live.c83 === globalThis.__linkBefore.live.c83 + 1;
});

await step('联动：打出「续火」后，下一张牌的伤害真的翻倍', async () => {
  globalThis.__dmg85 = await playRightId('c85');   // 自身 3 伤，留 ×2
}, async () => {
  const L = await S('cog.links()');
  return globalThis.__dmg85 === 3
    && L.next && L.next.mul === 2 && L.next.from === '续火'
    && L.live.c86 === 8;                     // 4 × 2
});

await step('联动：下一张吃到 ×2 打 8 点，同名卡开始按本场次数累加', async () => {
  globalThis.__dmg86a = await playRightId('c86');  // 第一张 c86，吃到 ×2
}, async () => {
  const L = await S('cog.links()');
  return globalThis.__dmg86a === 8
    && L.next === null                       // 倍率已被这一手消耗
    && L.plays.c86 === 1
    && L.live.c86 === 7;                     // 4 + 1×3
});

await step('联动：同一张「叠章」再打一次，7 点落地、下次底数涨到 10', async () => {
  globalThis.__dmg86b = await playRightId('c86');  // 第二张 c86
}, async () => {
  const L = await S('cog.links()');
  return globalThis.__dmg86b === 7
    && L.plays.c86 === 2
    && L.live.c86 === 10;                    // 4 + 2×3
});

await step('联动：护甲与抽牌数变化立刻改写攻击底数', async () => {
  const b = await S('cog.links()');
  globalThis.__linkB = b;
  await evalJs('(() => { cog.state.block += 6; cog.state.drawnThisTurn += 4; })()');
}, async () => {
  const L = await S('cog.links()');
  return L.live.c84 === globalThis.__linkB.live.c84 + 6
    && L.live.c83 === globalThis.__linkB.live.c83 + 4;
});

await boot(URL_ + '?dev=battle');
// 判定面板现在只在答错时出现（答对不再打断战场），这三步盯着它：
// 同一块面板、几何不跳、没有闪断。解析从正确答案起读，不沿用答题时的滚动位置。
await step('答错 → 判定：同一块面板，几何不跳、没有闪断', async () => {
  await waitHand();
  const idx = await ensureKnowledge();
  await clickCard(idx);
  if (!await waitFor('opt')) throw new Error('没有出题');
  await evalJs(`(() => {
    const p = cog.state.panel;
    const fence = String.fromCharCode(96).repeat(3);
    const code = [fence + 'js', ...Array.from({ length: 28 }, (_, i) => '  console.log(' + i + ');'), fence].join('\\n');
    p.q = { ...p.q, q: '**输出是什么？**\\n' + code, explain: code };
  })()`);
  await nextFrames();
  globalThis.__quizGeom = await S('cog.quiz().geom');
  const v = await S('cog.state.panel.view');
  if (await S('cog.hots().some(h => h.label === "opt")')) throw new Error('不可见选项仍可点击');
  const pt = await S(`(() => {
    const thumb = cog.hots().find(h => h.label === 'scroll:quiz-body');
    return thumb && cog.toScreen(thumb.x + thumb.w / 2, thumb.y + thumb.h / 2);
  })()`);
  if (!pt) throw new Error('长代码题没有滚动滑块');
  const bottom = await S('cog.quiz().optionBottom');
  const end = await S(`cog.toScreen(cog.quiz().geom.x, ${bottom - 1})`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: end.y, button: 'left', buttons: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: end.y, button: 'left', clickCount: 1 });
  await nextFrames();
  const options = await S('cog.hots().filter(h => h.label === "opt")');
  if (options.length !== v.options.length || options.some((h) => h.y + h.h > bottom)) {
    throw new Error('长代码题滚动后选项不可达，或热区越过内容区：' + JSON.stringify({ options, expected: v.options.length, pt }));
  }
  // 把判定演出拉长，好稳定地验"面板没消失、结果还没展开"这一帧
  await evalJs('cog.holdQuiz(2.2)');
  await clickLabel('opt', (v.answer + 1) % v.options.length);
}, async () => {
  const q = await S('cog.quiz()');
  if (JSON.stringify(q.geom) !== JSON.stringify(globalThis.__quizGeom)) {
    throw new Error('判定面板几何变了：' + JSON.stringify(q));
  }
  const cont = await evalJs(`cog.hots().filter((h) => h.label === '继续').length`);
  const opts = await evalJs(`cog.hots().filter((h) => h.label === 'opt').length`);
  return q.phase === 'settle' && cont === 0 && opts === 0;
});

await step('判定演出结束 → 解析共用答题面板尺寸与位置', async () => {
  if (!await waitFor('继续', 45000)) throw new Error('结果区没有展开');
}, async () => {
  const q = await S('cog.quiz()');
  return q.phase === 'result' && JSON.stringify(q.geom) === JSON.stringify(globalThis.__quizGeom)
    && !await S('cog.hots().some(h => h.label === "opt")');
});

await step('长代码解析 → 正确答案与所选答案分开，继续按钮才退出', async () => {
  if (!await waitUnlocked()) throw new Error('输入还锁着');
  const p = await evalJs(`(() => {
    const g = cog.quiz().geom;
    return cog.toScreen(g.x + 60, g.y + 130);
  })()`);
  await clickPoint(p);
  if (await S('cog.state.panel.k') !== 'feedback') throw new Error('点击解析正文关闭了答错页');
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
  await nextFrames();
  const review = await S('cog.quiz()');
  const fb = await S('cog.state.panel.fb');
  if (!review.manual || !review.review?.explained || review.review.answer !== fb.answer || review.review.choice !== fb.choice) {
    throw new Error('长题解析未显示正确答案、所选答案和滚动区');
  }
  await clickLabel('继续');
}, async () => waitReady());

await boot(URL_ + '?dev=wrong');
await step('短解析也保留，直到玩家点击继续', async () => {
  await expectFeedback('答错后');
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
  await sleep(4900); // 越过旧版的自动关闭时限，确认读题不被打断。
  if (!await S('cog.state.panel.k === "feedback" && !!cog.quiz().review')) throw new Error('解析被提前关闭');
  await clickLabel('继续');
}, async () => waitReady());

await boot(URL_ + '?dev=report');
await step('结算 → 再来一局 → 重新选模式', async () => {
  globalThis.__floorBefore = await S('cog.state.floors');
  await clickLabel('再来一局');
  const label = await waitBoon();
  if (!label) throw new Error('再来一局没有回到模式选择');
  await clickLabel(label);
  await pickTopicsThenStart();
  globalThis.__mode2 = label.slice('mode:'.length);
}, async () => {
  const st = await evalJs(`({ p: cog.state.panel.k, floor: cog.state.floors, mode: cog.state.mode })`);
  return st.p === 'none' && st.floor === 0 && st.mode === globalThis.__mode2;
});

await step('答题记录和任务只在首页出现', async () => {
  for (const scene of ['boon', 'map', 'battle', 'question', 'report']) {
    await boot(URL_ + '?dev=' + scene);
    const leaked = await evalJs(`cog.hots().some((h) => ['答题记录', '后台任务', '答题记录遮罩', '任务抽屉遮罩'].includes(h.label))`);
    if (leaked) throw new Error(`${scene} 仍有首页工具热区`);
  }
  await boot(URL_);
  if (!await waitFor('答题记录') || !await waitFor('后台任务')) throw new Error('首页工具没有恢复');
}, async () => true);

await step('首页答题记录：可查看、手动归档，结算不自动归档', async () => {
  const created = await evalJs(`(async () => {
    const m = await import('/src/core/library/index.ts');
    const j = await import('/src/core/journey/index.ts');
    const topic = Object.keys(cog.bank.byTopic)[0];
    const q = cog.bank.byTopic[topic][0];
    const qid = q.qid;
    const correct = q.answer + 1;
    const wrong = correct === 1 ? 2 : 1;
    // 通过真实开局路径生成 runId，避免测试绕过游戏状态初始化。
    j.startRun(null, [], [topic], [], 'words');
    const otherRunId = cog.state.runId;
    m.recordAnswer({ stageTopic: topic, qid, right: true, choice: correct });
    const other = m.answerHistory().at(-1).id;
    j.startRun(null, [], [topic], [], 'words');
    const runId = cog.state.runId;
    m.recordAnswer({ stageTopic: topic, qid, right: true, choice: correct });
    const first = m.answerHistory().at(-1).id;
    m.recordAnswer({ stageTopic: topic, qid, right: false, choice: wrong });
    const second = m.answerHistory().at(-1).id;
    j.backToTitle();
    return { runId, otherRunId, clientIds: { other, first, second } };
  })()`);
  // 同步确认后浏览器会删掉临时事件，归档应检查服务端的记录。
  let remote = null;
  const syncStarted = Date.now();
  while (!remote && Date.now() - syncStarted < 10000) {
    const found = await evalJs(`(async () => {
      const m = await import('/src/core/library/index.ts');
      const rows = await m.remoteAnswerRuns(false);
      return rows?.filter((r) => r.runId === ${JSON.stringify(created.runId)}) ?? [];
    })()`);
    remote = found.length === 1 ? found : null;
    if (!remote) await sleep(100);
  }
  if (!remote) throw new Error('同局答题事件没有形成服务端局摘要');

  const target = await evalJs(`(async () => { const m = await import('/src/core/library/index.ts'); return m.remoteAnswerRun('words', ${JSON.stringify(created.runId)}); })()`);
  if (target.length !== 2) throw new Error('目标局答题明细没有找到');
  const row = `答题局:words:${created.runId}`;
  const otherRow = `答题局:words:${created.otherRunId}`;
  await clickLabel('答题记录');
  if (!await waitFor(row)) throw new Error('左侧记录列表没有显示刚玩的那局');
  const otherY = () => evalJs(`cog.hots().find(h => h.label === ${JSON.stringify(otherRow)})?.y`);
  const folded = await otherY();
  await clickLabel(row);
  if (await otherY() !== folded + 104) throw new Error('同局两道题没有一起展开');
  await clickLabel(row);
  if (await otherY() !== folded) throw new Error('同局两道题没有一起收起');
  const buttonIndex = await evalJs(`(() => {
    const hits = cog.hots();
    const group = hits.find(h => h.label === ${JSON.stringify(row)});
    return hits.filter(h => h.label === '归档本局').findIndex(h => Math.abs(h.y - group.y - 12) < 1);
  })()`);
  if (buttonIndex < 0) throw new Error('归档按钮没有独立热区');
  await clickLabel('归档本局', buttonIndex);
  let archived = null;
  const archiveStarted = Date.now();
  while ((!archived || !archived.archived) && Date.now() - archiveStarted < 5000) {
    archived = await evalJs(`(async () => {
      const m = await import('/src/core/library/index.ts');
      const archived = (await m.remoteAnswerRuns(true))?.some((r) => r.runId === ${JSON.stringify(created.runId)});
      const pending = (await m.remoteAnswerRuns(false))?.some((r) => r.runId === ${JSON.stringify(created.otherRunId)});
      return { archived, otherStillPending: pending };
    })()`);
    if (!archived.archived) await sleep(100);
  }
  if (!archived.archived || !archived.otherStillPending) throw new Error('归档本局后记录状态不正确：' + JSON.stringify(archived));
  await clickLabel('已归档');
  if (!await waitFor(row)) throw new Error('归档记录没有出现在已归档列表');
  await pressKey('Escape', 'Escape', 27);
  if (!await waitFor('已归档')) throw new Error('Esc 跳过了未归档列表');
  await clickLabel('已归档');
  await clickLabel('返回');
  if (!await waitFor('已归档')) throw new Error('返回按钮跳过了未归档列表');

  const autoArchived = await evalJs(`(async () => {
    const m = await import('/src/core/library/index.ts');
    const j = await import('/src/core/journey/index.ts');
    const topic = Object.keys(cog.bank.byTopic)[0];
    const q = cog.bank.byTopic[topic][0];
    j.startRun(null, [], [topic], [], 'words');
    m.recordAnswer({ stageTopic: topic, qid: q.qid, right: false, choice: q.answer === 0 ? 2 : 1 });
    const id = m.answerHistory().at(-1).id;
    j.endRun(false);
    return m.answerHistory().find((r) => r.id === id).archived;
  })()`);
  if (autoArchived) throw new Error('游戏结束时自动归档了答题记录');
}, async () => true);

await boot(URL_ + '?dev=battle');
await step('击败敌人 → 最后一击与退场播完后才显示奖励', async () => {
  if (!await waitHand()) throw new Error('手牌一直没落位');
  await evalJs(`(() => {
    const G = cog.state;
    G.hand[0] = 'base:strike';
    G.enemy.hp = 1;
    G.enemy.block = 0;
    G.node.type = 'fight';
  })()`);
  const transition = evalJs(`new Promise((resolve, reject) => {
    const frames = [];
    const deadline = performance.now() + 12000;
    const tick = () => {
      const v = cog.victory();
      if (v.exit !== null) {
        frames.push(v.exit);
        if (v.exit < 1 && (cog.state.screen !== 'battle' || cog.state.panel.k !== 'none')) {
          reject(new Error('奖励在敌人退场前覆盖了战场'));
          return;
        }
      }
      const cards = cog.hots().filter((h) => h.label === 'rewardcard').length;
      if (cog.state.panel.k === 'reward' && cards > 0) {
        resolve({ panel: cog.state.panel.k, frames, cards });
      } else if (performance.now() > deadline) {
        reject(new Error('击败敌人后没有进入奖励面板'));
      } else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  })`);
  await clickCard(0);
  globalThis.__victoryTransition = await transition;
}, async () => {
  const v = globalThis.__victoryTransition;
  if (v.panel !== 'reward' || !v.cards || v.frames.length < 2 || v.frames.at(-1) <= v.frames[0]) {
    throw new Error(JSON.stringify(v));
  }
  return true;
});

ws.close();
chrome.kill();
await rm(profile, { recursive: true, force: true }).catch(() => {});

let bad = 0;
for (const r of results) {
  if (r.ok) console.log(`  ✓ ${r.name}`);
  else { bad += 1; console.log(`  ✗ ${r.name}${r.err ? ` — ${r.err}` : '（状态不对）'}`); }
}
if (errors.length) {
  bad += 1;
  console.log('\n运行时报错：');
  errors.forEach((e) => console.log('  ' + e.split('\n')[0]));
}
console.log(bad ? `\n✗ 冒烟测试失败：${bad} 项` : `\n✓ 冒烟通过：${results.length} 步`);
process.exit(bad ? 1 : 0);
