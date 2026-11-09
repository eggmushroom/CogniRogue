/**
 * 无头模拟：用同一套 core 规则跑几千局，把"手感"变成数字。
 *
 *   npm run sim
 *
 * 它回答两个问题：
 *   1. 水平更高的人，是不是一定赢更多？（这是验收标准，不是口号）
 *   2. 费用 + 答对退回 1 点 + 答对抽一张，这套节奏撑不撑得住？
 *      （押注、解锁、免答 ×1.5 都已经拿掉，这里只扫水平与强度旋钮）
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { BAL, MODES } from '../src/core/model';
import type { CardInst, RunMode } from '../src/core/model';
import {
  G, PACK, answer, availableNodes, bankQuestionCount, canAsk, canPay, chooseEventOption, defOf, dismissFeedback,
  endTurn, enterNode, loadQuestionBank, playBasic, playPower, resetMemory, restHeal,
  skipReward, startRun, takeCard, takePower, askCard, mergePacks,
} from '../src/core';

/**
 * 参数可覆盖，方便扫参：
 *   npm run sim -- --hp=1.2 --dmg=1.3 --ap=5 --hand=6
 * 试一个数值不该改源码。
 */
let RUNS = 300;
/** 战后是否拿奖励卡。默认不拿 —— 那是旧基线，留着才能对比 */
let TAKE = false;
/** 这一局按哪档答错价码跑。三种模式各自有一条技巧曲线，默认跑中间那档。 */
let MODE: RunMode = 'review';
/**
 * 每个水平开跑前清空记忆。
 *
 * 默认关：记忆跨局累积才是真实玩家的样子（第 20 局和第 1 局的牌组不一样）。
 * 但它会让四个水平跑的其实是四种记忆状态，所以另有这个开关做对照实验。
 */
let FRESH = false;
/** 每局都清空记忆：模拟"第一次打开这个题库"，学习期那档规则只在那种状态下才被真的走到 */
let FRESH_RUN = false;

for (const arg of process.argv.slice(2)) {
  const m = /^--(hp|dmg|ap|hand|runs|ad|cap|md|start|calm|take|rf|stab|fresh|freshrun|mode)=([\w.-]+)$/.exec(arg);
  if (!m) continue;
  const v = Number(m[2]);
  if (m[1] === 'runs') { RUNS = Math.round(v); continue; }
  if (m[1] === 'take') { TAKE = v > 0; continue; }
  if (m[1] === 'fresh') { FRESH = v > 0; continue; }
  if (m[1] === 'freshrun') { FRESH_RUN = v > 0; continue; }
  if (m[1] === 'mode') {
    MODE = (m[2] === 'learn' || m[2] === 'test') ? m[2] : 'review';
    continue;
  }
  if (m[1] === 'hp') BAL.hp = v;
  else if (m[1] === 'dmg') BAL.dmg = v;
  else if (m[1] === 'ap') { BAL.baseAp = v; }
  else if (m[1] === 'hand') BAL.drawPerTurn = v;
  else if (m[1] === 'ad') BAL.answerDraw = v;
  else if (m[1] === 'cap') BAL.answerDrawCap = v;
  else if (m[1] === 'md') { BAL.missDraw = v; if (!v) BAL.missDrawCap = 0; }
  else if (m[1] === 'start') BAL.startBlock = v;
  else if (m[1] === 'calm') BAL.calmFirstTurn = v > 0;
  else if (m[1] === 'rf') BAL.refund = v > 0 ? 1 : 0;
  else if (m[1] === 'stab') BAL.reviewStab = Math.max(1, v);
}

// 让"死亡后延迟结算"在模拟里同步发生，不然几千局会跑成几分钟
(globalThis as unknown as { setTimeout: (fn: () => void) => void }).setTimeout = (fn) => { fn(); };

const here = dirname(fileURLToPath(import.meta.url));
// 和浏览器里的内置题库完全相同：三份 md 走同一个 mergePacks，数值才可比
const md = mergePacks(
  ['algorithms.md', 'advanced.md', 'systems.md']
    .map((f) => readFileSync(join(here, '..', 'packs', f), 'utf8')),
  '计算机科学 · 精选题库',
);
const loaded = loadQuestionBank(md);
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
  /** 靠"答对"额外抽到的张数。它和 answers 一起说明"知识有没有真的变成选择" */
  draws: number;
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
  /** 答错了几次。价码由这一局的模式决定，不再按卡片阶段分两档 */
  misses: number;
  /** 一局里打出几张基础牌。它衡量"地板"被用得多不多 */
  basics: number;
}

function runOne(p: number, st: Stat) {
  if (FRESH_RUN) resetMemory();
  startRun(MODE);
  let guard = 0;
  let answers = 0;
  let right = 0;
  let wasBattle = false;
  let battles = 0;
  let turns = 0;
  let plays = 0;
  let basics = 0;

  while (guard++ < 6000) {
    const panel = G.panel;

    if (panel.k === 'question') {
      // 模拟「这个水平的玩家」也必须按本次打乱后的视图作答，
      // 否则读题库里的原始答案会全部判错，技巧曲线就塌了。
      const view = panel.view;
      const ok = Math.random() < p;
      answers += 1;
      if (ok) right += 1;
      const wrong = (view.answer + 1 + Math.floor(Math.random() * (view.options.length - 1))) % view.options.length;
      answer(ok ? view.answer : wrong);
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
      // 费用之后，"手里有牌"不再等于"出得去"：3 费牌在只剩 1 点行动力时
      // 连题都点不开。所有候选都要过一遍 canPay，否则模拟会卡在原地点同一张牌。
      const pay = (c: CardInst) => canPay(defOf(c));
      if (G.ap > 0 && G.hand.length) {
        // 增益牌先打：它花行动力，但本场剩下每回合都在还。
        // 不先打的话，这张牌在手里就是一张废纸，模拟会把它的价值算成 0。
        const pw = G.hand.findIndex((c) => !!defOf(c).power && pay(c));
        if (pw >= 0) { playPower(pw); plays += 1; continue; }
        // 先打增益（本场持续），再答题出牌。答题没有"之后就能免答"这回事了 ——
        // 每次出知识卡都要重新答，所以机器人的策略就是"能答就答"。
        const ask = G.hand.findIndex((c) => canAsk(c) && pay(c));
        if (ask >= 0) { askCard(ask); continue; }
        // 基础牌：不答题、不可退款，但总比让行动力烂掉好。
        // 它是这一局的地板，模拟不打出它，会把低水平的胜率算得比实际更狠。
        const bas = G.hand.findIndex((c) => !c.junk && defOf(c).kind === 'basic' && pay(c));
        if (bas >= 0) { basics += 1; playBasic(bas); continue; }
        // 手里只剩打不出的牌（答错锁住的、测试模式作废的、付不起的）→ 结束回合。
        // 快攻取消之后，剩下的行动力就是扔掉的，这是这一版的正常代价。
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
  st.draws += G.answerDraws;
  st.deck += G.deck.length;
  st.kinds += new Set(G.deck.map((e) => e.id)).size;
  st.battles += battles;
  st.turns += turns;
  st.powers += plays;
  st.powerCards += G.deck.filter((e) => e.id.startsWith('pow:')).length;
  st.basics += basics;
  st.misses += G.runBad;
}

const LEVELS = [
  { name: '新手', p: 0.35 },
  { name: '入门', p: 0.55 },
  { name: '熟练', p: 0.72 },
  { name: '精通', p: 0.88 },
];

console.log(`\nCogniRogue 无头模拟 · 每组 ${RUNS} 局 · ${MODES[MODE].name}模式 · 内置 ${PACK.cards.length} 张卡 / 题库 ${bankQuestionCount()} 道题\n`);

const header = ['水平', '基础正确率', '胜率', '平均到层', '答题/局', '实际正确率', '答对抽牌/局', '答错/局'];
const widths = [8, 12, 9, 11, 10, 12, 14, 13];
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
  misses: number; basics: number;
}> = [];

for (const lv of LEVELS) {
  if (FRESH) resetMemory();
  const st: Stat = {
    wins: 0, floors: 0, answers: 0, right: 0, runs: 0, draws: 0,
    deck: 0, kinds: 0, battles: 0, turns: 0, powers: 0, powerCards: 0,
    misses: 0, basics: 0,
  };
  for (let i = 0; i < RUNS; i++) runOne(lv.p, st);
  const win = (st.wins / st.runs) * 100;
  const acc = st.answers ? (st.right / st.answers) * 100 : 0;
  summary.push({
    level: lv.name, p: lv.p, win,
    deck: st.deck / st.runs, kinds: st.kinds / st.runs,
    turns: st.turns / Math.max(1, st.battles), battles: st.battles / st.runs,
    powers: st.powers / st.runs, powerCards: st.powerCards / st.runs,
    misses: st.misses / st.runs, basics: st.basics / st.runs,
  });
  console.log(fmt([
    lv.name,
    `${Math.round(lv.p * 100)}%`,
    `${win.toFixed(0)}%`,
    (st.floors / st.runs).toFixed(2),
    (st.answers / st.runs).toFixed(1),
    `${acc.toFixed(0)}%`,
    (st.draws / st.runs).toFixed(1),
    (st.misses / st.runs).toFixed(1),
  ]));
}

const mid = summary.find((r) => r.level === '熟练');
if (mid) {
  console.log('');
  console.log(`构筑：熟练结局 ${mid.deck.toFixed(1)} 张 / ${mid.kinds.toFixed(1)} 种`);
  console.log(`节奏：${mid.battles.toFixed(1)} 场 × ${mid.turns.toFixed(1)} 回合`);
  console.log(`初始牌组：一局打出 ${mid.basics.toFixed(1)} 张基础牌`
    + `（另 ${mid.powers.toFixed(1)} 次增益牌）`);
  console.log(`答错：${MODES[MODE].name}模式 ${mid.misses.toFixed(1)} 次/局`
    + `（${MODES[MODE].cardLabel}；稳固度答错 ×${MODES[MODE].stabDrop}，答对 ×${MODES[MODE].stabGain}）`);
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
