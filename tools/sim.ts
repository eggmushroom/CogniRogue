/**
 * 无头模拟：用同一套 core 规则跑几千局，把"手感"变成数字。
 *
 *   npm run sim
 *
 * 它回答两个问题：
 *   1. 水平更高的人，是不是一定赢更多？（这是验收标准，不是口号）
 *   2. 一次出牌 1 点行动力、答对解锁 ×1.5 免答，这套节奏撑不撑得住？
 *      （押注机制已经拿掉，所以这里不再扫"押哪一档"，只扫水平与强度旋钮）
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { BAL } from '../src/core/data';
import {
  G, answer, availableNodes, canAsk, chooseEventOption, defOf, dismissFeedback,
  endTurn, enterNode, isUnlocked, loadPack, playPower, playUnlocked, resetMemory, restHeal,
  quickPlay, skipReward, startRun, takeCard, takePower, askCard,
} from '../src/core/game';

/**
 * 参数可覆盖，方便扫参：
 *   npm run sim -- --hp=1.2 --dmg=1.3 --ap=5 --hand=6
 * 试一个数值不该改源码。
 */
let RUNS = 300;
/** 战后是否拿奖励卡。默认不拿 —— 那是旧基线，留着才能对比 */
let TAKE = false;
/**
 * 每个水平开跑前清空记忆。
 *
 * 默认关：记忆跨局累积才是真实玩家的样子（第 20 局和第 1 局的牌组不一样）。
 * 但它会让四个水平跑的其实是四种记忆状态，所以另有这个开关做对照实验。
 */
let FRESH = false;
/** 每局都清空记忆：模拟"第一次打开这个知识包"，学习期那档规则只在种状态下才被真的走到 */
let FRESH_RUN = false;

for (const arg of process.argv.slice(2)) {
  const m = /^--(hp|dmg|ap|hand|runs|free|miss|start|calm|take|rf|learn|strict|stab|fresh|freshrun)=([\d.-]+)$/.exec(arg);
  if (!m) continue;
  const v = Number(m[2]);
  if (m[1] === 'runs') { RUNS = Math.round(v); continue; }
  if (m[1] === 'take') { TAKE = v > 0; continue; }
  if (m[1] === 'fresh') { FRESH = v > 0; continue; }
  if (m[1] === 'freshrun') { FRESH_RUN = v > 0; continue; }
  if (m[1] === 'hp') BAL.hp = v;
  else if (m[1] === 'dmg') BAL.dmg = v;
  else if (m[1] === 'ap') { BAL.baseAp = v; }
  else if (m[1] === 'hand') BAL.handSize = v;
  else if (m[1] === 'free') BAL.freeMult = v;
  else if (m[1] === 'miss') BAL.missBlock = v;
  else if (m[1] === 'start') BAL.startBlock = v;
  else if (m[1] === "calm") BAL.calmFirstTurn = v > 0;
  else if (m[1] === "rf") BAL.refundRight = v > 0;
  // 学习期 / 复习期这两档惩罚，可以单独关掉，用来量它们各自值多少胜率
  else if (m[1] === 'learn') BAL.learnForgive = v > 0;
  else if (m[1] === 'strict') BAL.reviewStrict = v > 0;
  else if (m[1] === 'stab') BAL.reviewStab = Math.max(1, v);
}

// 让"死亡后延迟结算"在模拟里同步发生，不然几千局会跑成几分钟
(globalThis as unknown as { setTimeout: (fn: () => void) => void }).setTimeout = (fn) => { fn(); };

const here = dirname(fileURLToPath(import.meta.url));
const md = readFileSync(join(here, '..', 'packs', 'algorithms.md'), 'utf8');
const loaded = loadPack(md);
if (!loaded.ok) {
  console.error(loaded.msg);
  process.exitCode = 1;
}

function bestNode(): string | null {
  const opts = availableNodes();
  if (!opts.length) return null;
  const rank: Record<string, number> = { rest: 0, fight: 1, event: 2, elite: 8, boss: -1 };
  let best: string | null = null;
  let bestScore = 99;
  for (const key of opts) {
    const [r, i] = key.split(':').map(Number);
    const nd = G.map[r][i];
    const score = rank[nd.type] ?? 5;
    if (score < bestScore) { bestScore = score; best = key; }
  }
  return best;
}

interface Stat {
  wins: number; floors: number; answers: number; right: number; runs: number;
  /** 免答出牌的次数。和 answers 一起决定"这一局还有多少时间在答题" */
  free: number;
  /** 结束时的牌组张数，看"构筑"到底有没有发生 */
  deck: number;
  /** 一局里见过的不同卡种数 */
  kinds: number;
  /** 战斗场数与总回合数 —— 一场打几个回合，决定"解锁节奏"有没有地方展开 */
  battles: number;
  turns: number;
  /** 一局里打出增益牌的次数，以及结局牌组里有几张增益牌 */
  powers: number;
  powerCards: number;
  /** 答错落在学习期 / 复习期各几次。同一个错误两种价码，得分开看 */
  learnMiss: number;
  reviewMiss: number;
}

function runOne(p: number, st: Stat) {
  if (FRESH_RUN) resetMemory();
  startRun();
  let guard = 0;
  let answers = 0;
  let right = 0;
  let free = 0;
  let wasBattle = false;
  let battles = 0;
  let turns = 0;
  let plays = 0;

  while (guard++ < 6000) {
    const panel = G.panel;

    if (panel.k === 'question') {
      const card = defOf(G.hand[panel.idx]);
      const q = card.qs[panel.qi];
      const ok = Math.random() < p;
      answers += 1;
      if (ok) right += 1;
      const wrong = (q.answer + 1 + Math.floor(Math.random() * (q.options.length - 1))) % q.options.length;
      answer(ok ? q.answer : wrong);
      continue;
    }
    if (panel.k === 'feedback') { dismissFeedback(); continue; }
    if (panel.k === 'reward') {
      // TAKE：真的往后拿牌，用来验"牌组变厚到底是变强还是稀释"
      if (TAKE && panel.cards.length) takeCard(0); else skipReward();
      continue;
    }
    if (panel.k === 'power') { takePower(panel.pool[0].id); continue; }
    if (panel.k === 'rest') { restHeal(); continue; }
    if (panel.k === 'event') { chooseEventOption(panel.ev.opts.length - 1); continue; }
    if (panel.k === 'report') break;

    // 进入战斗的那一帧记一场（必须放在 map 分支之前：那个分支会 continue）
    if (!wasBattle && G.screen === 'battle') battles += 1;
    wasBattle = G.screen === 'battle';

    if (G.screen === 'map') {
      const key = bestNode();
      if (!key) break;
      enterNode(key);
      continue;
    }

    if (G.screen === 'battle') {
      if (G.ap > 0 && G.hand.length) {
        // 增益牌先打：它花 1 点行动力，但本场剩下每回合都在还。
        // 不先打的话，这张牌在手里就是一张废纸，模拟会把它的价值算成 0。
        const pw = G.hand.findIndex((c) => !!defOf(c).power);
        if (pw >= 0) { playPower(pw); plays += 1; continue; }
        // 再解锁（投资），没得答了再用已解锁的卡收割。这就是这套机制的标准打法：
        // 前两回合建库，后面用 ×1.5 的免答牌把它花掉。
        const ask = G.hand.findIndex((c) => canAsk(c));
        if (ask >= 0) { askCard(ask); continue; }
        const ready = G.hand.findIndex((c) => !c.junk && isUnlocked(c.id));
        if (ready >= 0) { free += 1; playUnlocked(ready); continue; }
        // 手里只剩打不出的牌（答错锁住的、复习期作废的）时，真人是会快攻的：
        // 半额伤害也是伤害，总比把行动力扔掉好。不模拟这一手，会把惩罚算得比实际更狠。
        const dead = G.hand.findIndex((c) => !c.junk && !defOf(c).power);
        if (dead >= 0) { quickPlay(dead); continue; }
      }
      endTurn();
      turns += 1;
      continue;
    }
    break;
  }

  const rep = G.panel.k === 'report' ? G.panel.data : null;
  st.runs += 1;
  if (rep?.win) st.wins += 1;
  st.floors += rep ? rep.floor : 0;
  st.answers += answers;
  st.right += right;
  st.free += free;
  st.deck += G.deck.length;
  st.kinds += new Set(G.deck.map((e) => e.id)).size;
  st.battles += battles;
  st.turns += turns;
  st.powers += plays;
  st.powerCards += G.deck.filter((e) => e.id.startsWith('pow:')).length;
  st.learnMiss += G.learnMiss;
  st.reviewMiss += G.reviewMiss;
}

const LEVELS = [
  { name: '新手', p: 0.35 },
  { name: '入门', p: 0.55 },
  { name: '熟练', p: 0.72 },
  { name: '精通', p: 0.88 },
];

console.log(`\nCogniRogue 无头模拟 · 每组 ${RUNS} 局 · ${md.split('### ').length - 1} 张卡\n`);

const header = ['水平', '基础正确率', '胜率', '平均到层', '答题/局', '实际正确率', '免答/局', '答题占比', '答错 学/复'];
const widths = [8, 12, 9, 11, 10, 12, 9, 10, 13];
const fmt = (row: string[]) => row.map((c, i) => pad(c, widths[i])).join(' ');

function pad(s: string, w: number) {
  // 中文字符占两格，终端里才对得齐
  let n = 0;
  for (const ch of s) n += /[\u4e00-\u9fa5]/.test(ch) ? 2 : 1;
  return s + ' '.repeat(Math.max(0, w - n));
}

console.log(fmt(header));
console.log(widths.map((w) => '─'.repeat(w)).join(' '));

const summary: Array<{
  level: string; p: number; win: number; deck: number; kinds: number;
  turns: number; battles: number; powers: number; powerCards: number;
  learnMiss: number; reviewMiss: number;
}> = [];

for (const lv of LEVELS) {
  if (FRESH) resetMemory();
  const st: Stat = {
    wins: 0, floors: 0, answers: 0, right: 0, runs: 0, free: 0,
    deck: 0, kinds: 0, battles: 0, turns: 0, powers: 0, powerCards: 0,
    learnMiss: 0, reviewMiss: 0,
  };
  for (let i = 0; i < RUNS; i++) runOne(lv.p, st);
  const win = (st.wins / st.runs) * 100;
  const acc = st.answers ? (st.right / st.answers) * 100 : 0;
  summary.push({
    level: lv.name, p: lv.p, win,
    deck: st.deck / st.runs, kinds: st.kinds / st.runs,
    turns: st.turns / Math.max(1, st.battles), battles: st.battles / st.runs,
    powers: st.powers / st.runs, powerCards: st.powerCards / st.runs,
    learnMiss: st.learnMiss / st.runs, reviewMiss: st.reviewMiss / st.runs,
  });
  console.log(fmt([
    lv.name,
    `${Math.round(lv.p * 100)}%`,
    `${win.toFixed(0)}%`,
    (st.floors / st.runs).toFixed(2),
    (st.answers / st.runs).toFixed(1),
    `${acc.toFixed(0)}%`,
    (st.free / st.runs).toFixed(1),
    `${(100 * st.answers / Math.max(1, st.answers + st.free)).toFixed(0)}%`,
    `学${(st.learnMiss / st.runs).toFixed(1)}/复${(st.reviewMiss / st.runs).toFixed(1)}`,
  ]));
}

const mid = summary.find((r) => r.level === '熟练');
if (mid) {
  console.log('');
  console.log(`构筑：熟练结局 ${mid.deck.toFixed(1)} 张 / ${mid.kinds.toFixed(1)} 种`);
  console.log(`节奏：${mid.battles.toFixed(1)} 场 × ${mid.turns.toFixed(1)} 回合`);
  console.log(`增益：结局牌组 ${mid.powerCards.toFixed(1)} 张 · 一局打出 ${mid.powers.toFixed(1)} 次`
    + `（${(mid.powers / Math.max(0.1, mid.battles)).toFixed(1)} 次/场）`);
  console.log(`答错：学习期 ${mid.learnMiss.toFixed(1)} 次/局 · 复习期 ${mid.reviewMiss.toFixed(1)} 次/局`
    + `（学习期 ${BAL.learnForgive ? '牌回牌堆' : '进弃牌堆'}，复习期 ${BAL.reviewStrict ? '整场作废' : '只进弃牌堆'}`
    + `，稳固度 ${BAL.reviewStab} 起算复习期）`);
  console.log(`取卡：${TAKE ? '战后拿卡' : '战后跳过'}（--take=1 打开）` + ` · 记忆：${FRESH_RUN ? '每局重置' : FRESH ? '每个水平重置' : '跨局累积'}`);
}

// 验收标准：水平越高胜率必须严格更高
let violated = false;
for (let i = 1; i < summary.length; i++) {
  if (summary[i].win < summary[i - 1].win - 1) {
    violated = true;
    console.log(`✗ ${summary[i - 1].level} 胜率反而高于 ${summary[i].level}`);
  }
}
console.log(violated ? '✗ 验收失败：水平更高没有赢更多' : '✓ 验收通过：水平更高，胜率更高');
