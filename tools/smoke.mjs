/**
 * 冒烟测试：真的开一个 Chrome、真的点鼠标，走一遍「标题 → 地图 → 出牌 → 选档 → 答题 → 继续 → 结束回合」。
 *
 *   npm run smoke
 *
 * 单元逻辑已经有 sim 覆盖，这里专门盯**命中区域**这一层：
 * canvas 上的点击是手写的矩形判定，改布局最容易在这里静默坏掉——
 * 画面看着对，但点不动，或者点到了旁边的按钮。
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

/** 按标签点一次：拿当前帧的命中矩形，换算成屏幕坐标，发真实的鼠标按下/抬起。 */
async function clickLabel(label, nth = 0) {
  const hit = await evalJs(`(() => {
    const list = window.cog.hots().filter((h) => h.label === ${JSON.stringify(label)});
    const h = list[${nth}];
    if (!h) return null;
    const p = window.cog.toScreen(h.x + h.w / 2, h.y + h.h / 2);
    return { x: p.x, y: p.y };
  })()`);
  if (!hit) throw new Error(`画面上找不到「${label}」`);
  const base = { x: hit.x, y: hit.y, button: 'left', clickCount: 1 };
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hit.x, y: hit.y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base });
  await sleep(70); // 真人不会在 0ms 内松手，帧一定会在这中间重画
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base });
  await sleep(140); // 等下一帧把状态画出来
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
async function waitFor(label, ms = 2500) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const n = await evalJs(`cog.hots().filter((h) => h.label === ${JSON.stringify(label)}).length`);
    if (n > 0) return true;
    await sleep(60);
  }
  return false;
}

const S = (path) => evalJs(`(${path})`);

await boot();

await step('标题 → 开局', () => clickLabel('开始新的一局'), async () => (await S('cog.state.screen')) === 'map');
await step('地图 → 进节点', () => clickLabel('node'), async () => (await S('cog.state.screen')) === 'battle');
// 点牌就是出题：中间不该再有任何浮层。这一步挂了就说明又退回了"先选档再看题"
await step('点一张手牌 → 直接出题', async () => {
  // 开局的手牌是从牌堆飞进来的，飞行途中没有热区（点它等于点空气），必须等它落地
  if (!await waitFor('card')) throw new Error('手牌一直没落位');
  globalThis.__apBeforeAsk = await S('cog.state.ap');
  await clickLabel('card');
}, async () => {
  const p = await S('cog.state.panel');
  return p.k === 'question' && typeof p.qi === 'number';
});

// 押注机制已经整个拿掉：面板里只该有一道题 + 四个选项，不该再有任何"换档/押注"按钮。
// 这条断言是死的：只要有人把档位加回来，它就会红。
await step('答题面板里没有档位按钮', async () => {
  const n = await evalJs(`cog.hots().filter((h) => h.label === 'tier').length`);
  if (n !== 0) throw new Error(`还剩 ${n} 个档位按钮`);
}, async () => true);

// 答对才会触发打击动画，所以这里点「正确答案」而不是第一个选项
await step('选对 → 出反馈（此刻面板还没画出来）', async () => {
  const right = await evalJs(`(() => {
    const p = cog.state.panel;
    const inst = cog.state.hand[p.idx];
    const def = cog.pack.cards.find((c) => c.id === inst.id);
    return def.qs[p.qi].answer;
  })()`);
  await clickLabel('opt', right);
}, async () => {
  const k = await S('cog.state.panel.k');
  const btn = await evalJs(`cog.hots().filter((h) => h.label === '继续').length`);
  // 状态已经是 feedback，但按钮还没出现 —— 打击动画正在演，面板被推迟了
  return k === 'feedback' && btn === 0;
});

// 打击动画先演完，面板才弹出来：这一步专门盯"推迟"没有把按钮一起吞掉
await step('「继续」→ 回到战斗', async () => {
  if (!await waitFor('继续')) throw new Error('打击动画结束后「继续」没出现');
  await clickLabel('继续');
}, async () => (await S('cog.state.panel.k')) === 'none');

// 这一版唯一的经济规则：答对退还这一手的行动力。它要是坏了，整套节奏就塌了
// （行动力变成"出牌次数"而不是"犯错次数"，高手也没法多打），所以单独钉一条。
await step('答对 → 行动力一点没少', async () => {},
  async () => (await S('cog.state.ap')) === globalThis.__apBeforeAsk);

await step('结束回合 → 回合数前进，敌人真的演了动作且输入被锁', () => clickLabel('endturn'), async () =>
  (await S('cog.state.turn')) > 1
  && (await S('cog.fx().enemy')) > 0
  && (await S('cog.locked()')));

// 敌人回合以前是静默的：只有真掉血才发 hurt，被全挡下、举盾、塞杂念、变强、观察
// 全都是"数字变了但画面没动"。现在每个分支都发 enemyAct，这里盯两件事：
// 演出确实在画面上（fx().enemy > 0），以及演完之后飞行单元没残留在屏幕上。
await step('敌人演完 → 输入解锁、演出单元清空、新回合手牌飞回来', async () => {
  await sleep(1400);
}, async () => {
  const st = await S('({ enemy: cog.fx().enemy, locked: cog.locked(), cards: cog.hots().filter((h) => h.label === "card").length })');
  if (st.cards < 5) throw new Error('手牌没有归位：' + JSON.stringify(st));
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
  // 把沙漏挪到手牌第 0 位：命中区域的顺序就是手牌下标，这样点第一个 card 就是它
  await evalJs(`(() => {
    const i = cog.state.hand.findIndex((c) => c.id === 'pow:hourglass');
    const [e] = cog.state.hand.splice(i, 1);
    cog.state.hand.unshift(e);
  })()`);
  if (!await waitFor('card')) throw new Error('手牌一直没落位');
  // 手牌重排是平滑动画：热区每帧按当前落笔位置注册，位置没停稳就去点会点到邻居身上
  await sleep(450);
  globalThis.__dcBeforePow = await S('cog.state.discard.length');
  await clickLabel('card', 0);
}, async () => {
  const st = await S('({ pw: cog.state.powers, panel: cog.state.panel.k, dc: cog.state.discard.length, ap: cog.state.ap, hand: cog.state.hand.map((c) => c.id) })');
  // 沙漏的即时效果是把这一手赚回来，所以行动力应该回到打出前的 3
  const ok = st.pw.length === 1 && st.pw[0] === 'hourglass'
    && st.panel === 'none' && st.dc === globalThis.__dcBeforePow && st.ap === 3;
  if (!ok) throw new Error('实际状态：' + JSON.stringify(st));
  return true;
});

// 免答出牌是新机制唯一的点击路径：解锁之后点牌不该再出题，而是直接结算。
// 用 dev=battle 开局（10 张牌全是不同卡种，正常打不到重复），再手动全解锁。
await boot(URL_ + '?dev=battle');
await step('免答出牌 → 不出题，只扣 1 点行动力', async () => {
  await evalJs('cog.unlockAll()');
  if (!await waitFor('card')) throw new Error('手牌一直没落位');
  globalThis.__apBefore = await S('cog.state.ap');
  await clickLabel('card', 0);
}, async () => {
  const ap = await S('cog.state.ap');
  const k = await S('cog.state.panel.k');
  return k === 'none' && ap === globalThis.__apBefore - 1;
});

// 回归：手牌打空、行动力归零时，「结束回合」必须仍然可点。
// 这里曾经用「还有没有牌可打」决定要不要注册热区，于是唯一还能前进的局面被彻底锁死 ——
// 按钮画在屏幕上，点下去却没有任何反应。战斗里没有任何东西能替代这个按钮，必须守住。
await step('手牌与行动力都归零 → 结束回合仍然生效', async () => {
  await evalJs('(() => { const G = cog.state; G.hand.length = 0; G.ap = 0; })()');
  globalThis.__turnBefore = await S('cog.state.turn');
  await clickLabel('endturn');
}, async () => (await S('cog.state.turn')) === globalThis.__turnBefore + 1);

// 答错也要有演出，但**不能是攻击**：提灯焰一暗、屑在原地散掉，没有任何东西飞向敌人。
// 这一步盯两件事：敌人一滴血不掉（不该有 dmg），以及"推迟"没把面板吞掉
// —— 一旦 panelHold 卡住不归零，玩家就再也看不到解析。
await boot(URL_ + '?dev=battle');
await step('答错 → 没有攻击、敌人不掉血，反馈面板迟到但一定会来', async () => {
  if (!await waitFor('card')) throw new Error('手牌一直没落位');
  globalThis.__foeHp = await S('cog.state.enemy.hp');
  // 记住这张牌是谁：下一步要查它到底回了牌堆还是进了弃牌堆
  globalThis.__missId = await S('cog.state.hand[0].id');
  await clickLabel('card');
  const pick = await evalJs(`(() => {
    const p = cog.state.panel;
    const inst = cog.state.hand[p.idx];
    const def = cog.pack.cards.find((c) => c.id === inst.id);
    const t = def.qs[p.qi];
    return { wrong: (t.answer + 1) % t.options.length };
  })()`);
  await clickLabel('opt', pick.wrong);
}, async () => {
  // 面板此刻还没画出来（在等演出），但必须在两秒半之内出现
  if (!await waitFor('继续')) throw new Error('答错后反馈面板没出现');
  const hp = await S('cog.state.enemy.hp');
  return (await S('cog.state.panel.k')) === 'feedback'
    && (await S('cog.state.panel.fb.right')) === false
    && hp === globalThis.__foeHp;
});

// 弃牌动画：牌离手后要飞向牌堆，然后自己清掉。清不掉的话画面左下角会永远
// 停着一张牌，而且每出一张牌就多留一张 —— 是那种"看起来没事、玩十分钟才花屏"的漏。
//
// 这一步同时钉住新的分档规则：刚开的新浏览器没有任何记忆，所以每张卡都在「学习期」，
// 答错之后牌应该**回到抽牌堆**（下一回合就抽回来），而不是进弃牌堆。
await step('学习期答错 → 牌回抽牌堆，不进弃牌堆', async () => {
  await sleep(900); // 飞行 0.3s + 落地淡出，留一倍余量
}, async () => {
  const st = await evalJs(`({
    fx: cog.fx().discard,
    dc: cog.state.discard.length,
    back: cog.state.draw.some((c) => c.id === ${JSON.stringify(globalThis.__missId)}),
  })`);
  return st.fx === 0 && st.dc === 0 && st.back;
});

// 复习期那一档：先把这个卡种的稳固度顶到门槛以上，再答错一次。
// 它必须**进弃牌堆**（这一场不再自动回来），而且要能被数出来。
await boot(URL_ + '?dev=battle');
await step('复习期答错 → 牌进弃牌堆，不再自动回来', async () => {
  if (!await waitFor('card')) throw new Error('手牌一直没落位');
  globalThis.__revId = await evalJs('cog.state.hand[0].id');
  await evalJs(`cog.markMem(${JSON.stringify(globalThis.__revId)}, 6)`);
  globalThis.__dcBeforeRev = await S('cog.state.discard.length');
  await clickLabel('card', 0);
  const pick = await evalJs(`(() => {
    const p = cog.state.panel;
    const inst = cog.state.hand[p.idx];
    const def = cog.pack.cards.find((c) => c.id === inst.id);
    const t = def.qs[p.qi];
    return { wrong: (t.answer + 1) % t.options.length };
  })()`);
  globalThis.__phaseAtAsk = await evalJs('cog.state.reviewMiss');
  await clickLabel('opt', pick.wrong);
  if (!await waitFor('继续')) throw new Error('复习期答错后反馈面板没出现');
}, async () => {
  const st = await evalJs(`({
    dc: cog.state.discard.length,
    rev: cog.state.reviewMiss,
    learn: cog.state.learnMiss,
    back: cog.state.draw.some((c) => c.id === ${JSON.stringify(globalThis.__revId)}),
    forgotten: !!cog.state.forgotten[${JSON.stringify(globalThis.__revId)}],
  })`);
  // 默认档只进弃牌堆（BAL.reviewStrict 关着）；开着的时候才整场作废
  const ok = st.dc === globalThis.__dcBeforeRev + 1 && st.rev === globalThis.__phaseAtAsk + 1
    && st.back === false;
  if (!ok) throw new Error('实际状态：' + JSON.stringify(st));
  return true;
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

await boot(URL_ + '?dev=event');
await step('事件 → 选一个选项', () => clickLabel('eventopt', 0), async () =>
  (await S('cog.state.panel.k')) !== 'event');

await boot(URL_ + '?dev=report');
await step('结算 → 再来一局', async () => {
  globalThis.__floorBefore = await S('cog.state.floors');
  await clickLabel('再来一局');
}, async () => {
  const p = await S('cog.state.panel.k');
  const floor = await S('cog.state.floors');
  return p === 'none' && floor === 0;
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
