/**
 * 冒烟测试：真的开一个 Chrome、真的点鼠标，走一遍「标题 → 地图 → 出牌 → 选档 → 答题 → 继续 → 结束回合」。
 *
 *   npm run smoke
 *   SMOKE_CPU=6 npm run smoke   # 把渲染线程调慢，模拟慢机器 / 高负载
 *
 * 单元逻辑已经有 sim 覆盖，这里专门盯**命中区域**这一层：
 * canvas 上的点击是手写的矩形判定，改布局最容易在这里静默坏掉——
 * 画面看着对，但点不动，或者点到了旁边的按钮。
 *
 * 两件容易踩的事，这里都按状态判断、不按时间假设：
 *   1. 动画按 dt 推进，机器一慢，"睡 260ms 应该够了"就不够了 —— 等 `cog.handReady()`。
 *   2. 还在飞的牌不注册热区，所以"第几个 card 热区"不等于"第几张牌" —— 按 `idx` 点，
 *      并用 `cog.probe()` 确认这个位置真的属于它（牌多时会互相盖住）。
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
      const r = await fetch(u, { signal: AbortSignal.timeout(1200) });
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
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
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
 * 确保手牌里至少有一张**需要答题**的知识卡，返回它的下标。
 *
 * 两件事都要保证：
 *   1. 起手 10 张里只有 2 张随机知识卡，抽 5 张时可能一张都没摸到；
 *   2. C 级（0 费）知识卡不用答题，点下去直接打，测不出"出题"这条路径。
 * 所以缺牌时塞一张 B 级（1 费）知识卡进手牌，替换第 0 张，手牌数不变。
 */
async function ensureKnowledge() {
  await ensureQuestions();
  const idx = await evalJs(`(() => {
    const h = cog.state.hand;
    return h.findIndex((id) => {
      if (id.startsWith('base:')) return false;
      const d = cog.pack.cards.find((x) => x.id === id);
      return !!d && cog.costOf(id) > 0;
    });
  })()`);
  if (idx >= 0) return idx;
  await evalJs(`(() => {
    const id = cog.pack.cards.find((c) => c.kind === 'knowledge' && c.cost === 1).id;
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
 *
 * 不能拿"第 nth 个 label=card 的热区"当下标 —— 还在飞的牌不注册热区，
 * 这个列表会整体错位（曾经因此点到隔壁的知识卡，直接把题目弹了出来）。
 * 也不能直接点矩形中心：牌多的时候相邻牌会盖住前一张的中心，点下去是上面那张。
 * 所以先按 idx 找到这张牌的矩形，再在它内部找一个 probe 确认属于自己的点。
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
 * 等输入解锁。演出期间（光刃还在飞、面板被推迟）按下会被直接丢掉，
 * 这时候点什么都等于点空气 —— 这是"点了没反应"最常见的原因。
 * 只等 locked，不等 busy：反馈面板开着的时候 busy 本来就是 true（防连答），
 * 但面板上的「继续」恰恰是这时候该点的东西。
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
 * 等"一条战斗指令能落地"：输入解锁、没有面板挡着、上一层动作已经结算完。
 * 出牌器和「结束回合」自己的卫兵都是 `if (busy || panel) return` —— 不看这三样，
 * 点击会被安静地吞掉（按钮画在屏幕上，但什么也不会发生）。
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
 * 等某个按钮真的画在屏幕上。答对之后反馈面板会推迟到打击动画演完才出现，
 * 这期间它不在命中表里 —— 直接找坐标会扑空，所以要先等它画出来。
 *
 * 上限给得宽：动画按 dt 推进，而 dt 被钳在 1/20 秒，机器一慢，"一秒的动画"
 * 在真实时间里就会变成好几秒。这里是轮询，出现了就立刻返回，宽上限不会拖慢正常情况。
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

const S = (path) => evalJs(`(${path})`);

/**
 * 把渲染线程调慢，模拟慢机器 / 高负载。动画都是按 dt 推进的，机器一慢，
 * 原来"睡 260ms 应该够了"的假设就会失效 —— 这一档专门用来提前发现这类问题。
 *
 *   SMOKE_CPU=6 npm run smoke
 */
const CPU_RATE = Number(process.env.SMOKE_CPU || 0);
if (CPU_RATE > 0) {
  await send('Emulation.setCPUThrottlingRate', { rate: CPU_RATE });
  console.log(`· 渲染节流 ×${CPU_RATE}`);
}

await boot();

await step('标题 → 选模式 → 开局', async () => {
  await clickLabel('开始新的一局');
  if (!await waitFor('mode:review')) throw new Error('模式选择没有出现');
  await clickLabel('mode:review');
}, async () => (await S('cog.state.screen')) === 'map' && (await S('cog.state.mode')) === 'review');
await step('地图 → 进节点', () => clickLabel('node'), async () => (await S('cog.state.screen')) === 'battle');
// 点牌就是出题：中间不该再有任何浮层。这一步挂了就说明又退回了"先选档再看题"
// 手牌里现在混着初始牌组（base:*），要挑一张知识卡点 —— 基础牌点下去不出题。
await step('点一张知识卡 → 直接出题', async () => {
  // 开局的手牌是从牌堆飞进来的，飞行途中没有热区（点它等于点空气），必须等它落地
  if (!await waitHand()) throw new Error('手牌一直没落位');
  globalThis.__apBeforeAsk = await S('cog.state.ap');
  // 优先挑 1 费的知识卡（这样"答对退回 1 点"正好抵消），挑不到就按实际费用断言 ——
  // 起手只带 2 张随机知识卡，手牌里不一定有，缺了就先补一张。
  globalThis.__askIdx = await ensureKnowledge();
  globalThis.__askCost = await evalJs(`cog.costOf(cog.state.hand[${globalThis.__askIdx}])`);
  await clickCard(globalThis.__askIdx);
}, async () => {
  const p = await S('cog.state.panel');
  return p.k === 'question' && typeof p.qid === 'string' && Array.isArray(p.view.options);
});

// 押注机制已经整个拿掉：面板里只该有一道题 + 四个选项，不该再有任何"换档/押注"按钮。
// 这条断言是死的：只要有人把档位加回来，它就会红。
await step('答题面板里没有档位按钮', async () => {
  const n = await evalJs(`cog.hots().filter((h) => h.label === 'tier').length`);
  if (n !== 0) throw new Error(`还剩 ${n} 个档位按钮`);
}, async () => true);

// 答对才会触发打击动画，所以这里点「正确答案」而不是第一个选项
await step('选对 → 出反馈（此刻面板还没画出来）', async () => {
  // 选项每次出题都会重新排，正确答案的位置只能从本次的 panel.view 里读
  const right = await evalJs('cog.state.panel.view.answer');
  await clickLabel('opt', right);
}, async () => {
  const k = await S('cog.state.panel.k');
  const btn = await evalJs(`cog.hots().filter((h) => h.label === '继续').length`);
  // 状态已经是 feedback，但按钮还没出现 —— 打击动画正在演，面板被推迟了
  return k === 'feedback' && btn === 0;
});

// 打击动画先演完，面板才弹出来：这一步专门盯"推迟"没有把按钮一起吞掉
await step('「继续」→ 回到战斗', async () => {
  await expectFeedback('打击动画结束后');
  await clickLabel('继续');
}, async () => (await S('cog.state.panel.k')) === 'none');

// 经济规则：答对退回 1 点（1 费牌因此等于免费）。它要是坏了，整套节奏就塌了
// （1 费牌的免费出手是"会的人一回合能打完手牌"的唯一来源），所以单独钉一条。
await step('答对 → 只退回 1 点（1 费牌因此一点没少）', async () => {},
  async () => (await S('cog.state.ap'))
    === globalThis.__apBeforeAsk - Math.max(0, globalThis.__askCost - 1));

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
  while (Date.now() - t0 < 8000) {
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

// 增益牌是唯一一种"点了不出题"的牌。它必须满足三件事：
// 不进弃牌堆（它已经离开牌组循环了）、不出题、本场生效状态 +1。
// 这条挂了就意味着它又退化成"一张打了没反应的普通牌"，或者更糟 —— 洗回去无限刷。
await boot(URL_ + '?dev=power');
await step('打出增益牌 → 不出题、不进弃牌堆、进入本场增益', async () => {
  // 把沙漏挪到手牌第 0 位。不靠"第几个热区"去猜 —— 下面按手牌下标点。
  await evalJs(`(() => {
    const i = cog.state.hand.indexOf('pow:hourglass');
    const [e] = cog.state.hand.splice(i, 1);
    cog.state.hand.unshift(e);
  })()`);
  // 挪没挪成要当场确认：失败的话这一条会变成"点了隔壁的知识卡"，报错却是增益没生效
  if (await S('cog.state.hand[0]') !== 'pow:hourglass') throw new Error('沙漏没挪到手牌第 0 位');
  if (!await waitHand()) throw new Error('手牌一直没落位');
  globalThis.__dcBeforePow = await S('cog.state.discard.length');
  await clickCard(0);
}, async () => {
  const st = await S('({ pw: cog.state.powers, panel: cog.state.panel.k, dc: cog.state.discard.length, ap: cog.state.ap, hand: cog.state.hand.slice() })');
  // 沙漏的即时效果是把这一手赚回来，所以行动力应该回到打出前的 3
  const ok = st.pw.length === 1 && st.pw[0] === 'hourglass'
    && st.panel === 'none' && st.dc === globalThis.__dcBeforePow && st.ap === 3;
  if (!ok) throw new Error('实际状态：' + JSON.stringify(st));
  return true;
});

// 答错的规则（v0.5）：这一手作废、不扣行动力、不锁这张牌；代价落在"本场新题少一道"上。
// 复习 / 测试会补抽 1 张（学习模式不补，见下面的学习用例），这里用复习模式验补抽。
await boot(URL_ + '?dev=battle&mode=review');
await step('复习模式答错 → 不扣行动力、补抽 1 张、本场新题少一道', async () => {
  if (!await waitHand()) throw new Error('手牌一直没落位');
  // 起手只带 2 张随机知识卡，抽 5 张时可能一张都没摸到；这条测的是答错规则，不是抽牌。
  const pick = await ensureKnowledge();
  globalThis.__missHand = await evalJs('cog.state.hand.length');
  globalThis.__missAp = await S('cog.state.ap');
  globalThis.__missQ = await S('cog.state.qLeft.length');
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
  })`);
  // 手牌数不变 = 打出去一张（那一手作废了）+ 补抽一张进来（复习模式）。
  // 不断言弃牌堆：补抽也可能抽到同一种，堆的计数会飘。
  const ok = st.hand === globalThis.__missHand
    && st.ap === globalThis.__missAp
    && st.bad === globalThis.__badBefore + 1
    && st.q === globalThis.__missQ - 1;
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
  // A 级牌要答对 2 次才免答，所以这一手一定会出题；顺手把计数清掉更稳。
  await evalJs(`(() => { const G = cog.state; G.hand[0] = ${JSON.stringify(id)}; G.ap = 3; G.charge = {}; })()`);
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
  await evalJs(`(() => { const G = cog.state; G.hand[0] = ${JSON.stringify(id)}; G.ap = 3; G.charge = {}; })()`);
  await clickCard(0);
  if (!await waitFor('opt')) throw new Error('X 费牌没有弹题');
  const right = await evalJs('cog.state.panel.view.answer');
  await clickLabel('opt', right);
  await expectFeedback('X 费牌答对');
}, async () => {
  const st = await S('({ ap: cog.state.ap, hits: cog.state.panel.k === "feedback" ? cog.state.panel.fb.hits.length : -1 })');
  return st.ap === 1 && st.hits === 3;   // 3 点全花，退回 1 点；效果结算 3 次
});

// 回归：手牌打空、行动力归零时，「结束回合」必须仍然可点。
// 这里曾经用「还有没有牌可打」决定要不要注册热区，于是唯一还能前进的局面被彻底锁死 ——
// 按钮画在屏幕上，点下去却没有任何反应。战斗里没有任何东西能替代这个按钮，必须守住。
await step('手牌与行动力都归零 → 结束回合仍然生效', async () => {
  // 再往前几步打完的那一手还停在反馈面板上（面板开着时 busy 恒为 true）——
  // 那期间 endTurn 会被自己的守卫挡掉，看起来就是"按钮画着却点不动"。
  // 这一步测的是空场下的结束回合，先把上一手收干净，再等它真的闲着。
  await evalJs('(() => { const G = cog.state; if (G.panel.k === "feedback") G.panel = { k: "none" }; G.busy = false; })()');
  if (!await waitReady()) throw new Error('上一步一直没闲下来');
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
  await clickLabel('opt', pick.wrong);
}, async () => {
  // 面板此刻还没画出来（在等演出），但必须在两秒半之内出现
  await expectFeedback('答错后');
  const hp = await S('cog.state.enemy.hp');
  return (await S('cog.state.panel.k')) === 'feedback'
    && (await S('cog.state.panel.fb.right')) === false
    && hp === globalThis.__foeHp;
});

// 弃牌动画：牌离手后要飞向牌堆，然后自己清掉。清不掉的话画面左下角会永远
// 停着一张牌，而且每出一张牌就多留一张 —— 是那种"看起来没事、玩十分钟才花屏"的漏。
//
// 这一步同时钉住学习模式的分档规则：刚开的新浏览器默认是学习模式，
// 答错之后牌应该**回到抽牌堆**（下一回合就抽回来），而不是进弃牌堆。
await step('学习模式答错 → 牌回抽牌堆、不补抽', async () => {
  await sleep(900); // 飞行 0.3s + 落地淡出，留一倍余量
}, async () => {
  const st = await evalJs(`({
    fx: cog.fx().discard,
    dc: cog.state.discard.length,
    back: cog.state.draw.includes(${JSON.stringify(globalThis.__missId)}),
    hand: cog.state.hand.length,
  })`);
  // 学习模式不补抽：打出去的牌从手牌消失后不会补一张回来。
  return st.fx === 0 && st.dc === 0 && st.back
    && st.hand === globalThis.__learnMissHand - 1;
});

// 复习模式那一档：把这一局切到复习模式，再答错一次。
// 它必须**进弃牌堆**（这一场不再自动回来），而且要能被数出来。
await boot(URL_ + '?dev=battle');
await step('复习模式答错 → 牌进弃牌堆，不再自动回来', async () => {
  if (!await waitHand()) throw new Error('手牌一直没落位');
  const idx = await ensureKnowledge();
  globalThis.__revIdx = idx;
  globalThis.__revId = await S(`cog.state.hand[${idx}]`);
  globalThis.__revHand = await evalJs('cog.state.hand.length');
  await evalJs("cog.state.mode = 'review'");
  globalThis.__dcBeforeRev = await S('cog.state.discard.length');
  await clickCard(idx);
  // 先确认题目真的出来了，再去读选项 —— 否则读到的是上一屏的 undefined
  if (!await waitFor('opt')) throw new Error('点牌之后没有出题');
  // 挑一个「本次视图里」的错误选项：题库里的原始答案位置已经被打乱了
  const pick = await evalJs(`(() => {
    const v = cog.state.panel.view;
    return { wrong: (v.answer + 1) % v.options.length };
  })()`);
  globalThis.__missAtAsk = await evalJs('cog.state.runBad');
  await clickLabel('opt', pick.wrong);
  await expectFeedback('复习模式答错后');
}, async () => {
  const st = await evalJs(`({
    dc: cog.state.discard.length,
    miss: cog.state.runBad,
    back: cog.state.draw.includes(${JSON.stringify(globalThis.__revId)}),
    hand: cog.state.hand.length,
  })`);
  // 复习模式只进弃牌堆，不回牌堆；答错补抽 1 张，所以手牌数不变。
  const ok = st.dc === globalThis.__dcBeforeRev + 1 && st.miss === globalThis.__missAtAsk + 1
    && st.back === false && st.hand === globalThis.__revHand;
  if (!ok) throw new Error('实际状态：' + JSON.stringify(st));
  return true;
});

// 测试模式那一档：不给垫子、牌进弃牌堆，但答错仍然补抽 1 张。
// （学习模式也不给垫子，但牌回牌堆、且不补抽；测试是"错不起"的那档。）
await boot(URL_ + '?dev=battle');
await step('测试模式答错 → 不补任何格挡', async () => {
  if (!await waitHand()) throw new Error('手牌一直没落位');
  const idx = await ensureKnowledge();
  globalThis.__testIdx = idx;
  globalThis.__testId = await S(`cog.state.hand[${idx}]`);
  await evalJs("cog.state.mode = 'test'");
  globalThis.__blkBeforeTest = await S('cog.state.block');
  await clickCard(idx);
  if (!await waitFor('opt')) throw new Error('点牌之后没有出题');
  const pick = await evalJs(`(() => {
    const v = cog.state.panel.view;
    return { wrong: (v.answer + 1) % v.options.length };
  })()`);
  globalThis.__missBeforeTest = await evalJs('cog.state.runBad');
  await clickLabel('opt', pick.wrong);
  await expectFeedback('测试模式答错后');
}, async () => {
  const st = await evalJs(`({
    blk: cog.state.block,
    miss: cog.state.runBad,
    dc: cog.state.discard.length,
  })`);
  return st.blk === globalThis.__blkBeforeTest
    && st.miss === globalThis.__missBeforeTest + 1 && st.dc >= 1;
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

await boot(URL_ + '?dev=reward');
await step('战后选卡 → 牌组 +1', async () => {
  globalThis.__deckBefore = await S('cog.state.deck.length');
  await clickLabel('rewardcard', 0);
}, async () => (await S('cog.state.deck.length')) === globalThis.__deckBefore + 1);

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
  await clickLabel('pick', 0);
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

await boot(URL_ + '?dev=event');
await step('事件 → 选一个选项', () => clickLabel('eventopt', 0), async () =>
  (await S('cog.state.panel.k')) !== 'event');

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
  const raw = localStorage.getItem('cognirogue.run.v3');
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
  if (!await waitFor('mode:review')) throw new Error('模式选择没有出现');
  await clickLabel('mode:review');
  if ((await S('cog.state.screen')) !== 'map') throw new Error('没有进入地图');
  // 再刷一次：首页应该退回"没有存档"的那套版式
  await boot(URL_);
}, async () => {
  const n = await evalJs(`cog.hots().filter((h) => h.label === '继续这一局').length`);
  return n === 0 && (await S('cog.state.screen')) === 'title';
});

await boot(URL_ + '?dev=report');
await step('结算 → 再来一局 → 重新选模式', async () => {
  globalThis.__floorBefore = await S('cog.state.floors');
  await clickLabel('再来一局');
  if (!await waitFor('mode:review')) throw new Error('再来一局没有回到模式选择');
  await clickLabel('mode:review');
}, async () => {
  const p = await S('cog.state.panel.k');
  const floor = await S('cog.state.floors');
  const mode = await S('cog.state.mode');
  return p === 'none' && floor === 0 && mode === 'review';
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
