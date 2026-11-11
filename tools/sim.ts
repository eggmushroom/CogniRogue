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
import { BAL, MODES, POWERS } from '../src/core/model';
import type { CardDef, CardId, RunMode } from '../src/core/model';
import {
  G, PACK, answer, availableNodes, bankQuestionCount, canPay, cardAskState, chooseEventOption, defOf, dismissFeedback,
  endTurn, enterNode, forgetCard, isPowerId, loadQuestionBank, openCardPick, playBasic, playFree, playPower, resetMemory, restHeal,
  skipReward, startRun, takeCard, takePower, askCard, mergePacks, upgradeCard, cardKind, cardGrade,
  moveOf, cancelPanel, isUpgraded, JUNK_ID,
} from '../src/core';

/**
 * 参数可覆盖，方便扫参：
 *   npm run sim -- --hp=1.2 --dmg=1.3 --ap=5 --hand=6
 * 试一个数值不该改源码。
 */
/**
 * 每档跑多少局。默认 800。
 *
 * 这个数由**验收断言**倒推，不是拍出来的：断言要能分辨"精通比新手强"，
 * 而单格胜率的标准误是 48/sqrt(n) 个百分点。300 局时一格 2.8 个点，
 * 学习模式的真实跨度只有 9 个点上下，10 次里会误报 3 次（实测）。
 * 800 局把单格误差压到 1.7 个点，断言改成"上两档 vs 下两档"（见文件末尾），
 * 每边 1600 个样本、噪声 1.1 个点，对 8 个点的真实差距是 5 倍信噪比。
 * 跑一遍约 50 秒。
 */
let RUNS = 800;
/**
 * 战后是否拿奖励卡。默认拿 —— 验证要走玩家真实路径；
 * 旧基线（跳过奖励）用 `--take=0` 复现。
 */
let TAKE = true;
/**
 * 目标牌组上限。真实玩家不会每场都拿牌：牌组超过这个数就跳过奖励。
 * 默认 20 张（3 基础 + 10 知识 + 约 6 张增益 + 少量替换），
 * 用 `--deck=N` 扫"牌组厚度"这个变量。
 */
let DECK_MAX = 20;
/** 旧路径对照：绕开精英、事件一律离开、跳过战后奖励。只用于看"真实路径"改变了多少。 */
let OLD_PATH = false;
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
/**
 * 复习点怎么用：血低于这个比例就休息，否则精炼一张牌。
 *
 * 100 层是长局，"回血"和"变强"必须抢同一个格子 —— 一直回血的人打不到第五幕，
 * 一直精炼的人第三幕就死了。默认按 0.55 这条线切换，`--smart=0` 退回"只回血"
 * 的老基线（8 层时那样跑是对的，那时牌组根本长不到需要精炼）。
 */
let SMART = true;

for (const arg of process.argv.slice(2)) {
  const m = /^--(hp|dmg|ap|hand|runs|ad|cap|md|start|calm|take|deck|path|rf|fresh|freshrun|mode|rest|sm|smart|ht)=([\w.-]+)$/.exec(arg);
  if (!m) continue;
  const v = Number(m[2]);
  if (m[1] === 'runs') { RUNS = Math.round(v); continue; }
  if (m[1] === 'take') { TAKE = v > 0; continue; }
  if (m[1] === 'deck') { DECK_MAX = Math.max(10, Math.round(v)); continue; }
  if (m[1] === 'path') { OLD_PATH = m[2] === 'old'; continue; }
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
  else if (m[1] === 'smart') { SMART = v > 0; }
  else if (m[1] === 'rest') BAL.restPct = v;
  else if (m[1] === 'sm') BAL.stageMaxHp = v;
  else if (m[1] === 'ht') BAL.hpType = v;
}
if (OLD_PATH) TAKE = false;

// 让"死亡后延迟结算"在模拟里同步发生，不然几千局会跑成几分钟
(globalThis as unknown as { setTimeout: (fn: () => void) => void }).setTimeout = (fn) => { fn(); };

const here = dirname(fileURLToPath(import.meta.url));
// 和浏览器里的内置题库完全相同：同一个 mergePacks 读同一份单词表，数值才可比
const md = mergePacks(
  [readFileSync(join(here, '..', 'packs', 'words.md'), 'utf8')],
  '英语单词表 · 临时题库',
);
const loaded = loadQuestionBank(md);
if (!loaded.ok) {
  console.error(loaded.msg);
  process.exitCode = 1;
}

function bestNode(): string | null {
  const opts = availableNodes();
  if (!opts.length) return null;
  // 真实玩家不会永远绕开精英：血线够时精英是增益牌的主要来源；
  // 血线低了才把复习点排到最前。旧路径对照保留原排序。
  const hp = G.hp / G.maxHp;
  const rank: Record<string, number> = OLD_PATH
    ? { rest: 0, fight: 1, event: 2, elite: 8, boss: -1 }
    : {
      boss: -1,
      elite: hp > 0.7 ? 1 : 7,
      rest: hp < 0.55 ? 0 : 5,
      fight: 2,
      event: 3,
    };
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

/**
 * 粗略的"这张牌值不值得占一个牌位"：攻/挡是主体，低费优先，
 * 穿透 / 回血 / 抽牌加分。只用于模拟玩家的取卡选择，不是游戏规则。
 */
function cardScore(c: CardDef): number {
  const cost = c.cost === 'x' ? 2 : (c.cost ?? 1);
  let score = (c.atk || 0) + (c.blk || 0) * 0.8;
  if (c.eff === 'pierce') score += 2;
  if (c.eff === 'drain') score += 1.5;
  if (c.eff === 'focus') score += 1;
  if (c.eff === 'guard') score += 0.8;
  if (c.eff === 'chain') score += 0.5;
  return score - cost * 1.2;
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
  /**
   * 免答直打的次数（本场攒满等级之后不出题）。这是"A/S 免答到底兑不兑现"的证据：
   * 一场只打两回合的话，需 2/3 次的 A/S 根本攒不满，这个数会全被 B 档占掉。
   */
  free: number;
  /** 其中 A / S 档的免答次数 —— 只有这两档才是"通关率杠杆" */
  freeSA: number;
}

/** 第 idx 张手牌该怎么打：知识卡→答题 / 已免答直打，基础牌→直接打。 */
function advance(idx: number) {
  const id = G.hand[idx];
  if (!id) return;
  const k = cardKind(defOf(id));
  if (k === 'basic') playBasic(idx);
  else if (k === 'knowledge' && cardAskState(id) === 'free') playFree(idx);
  else if (k === 'knowledge' && cardAskState(id) === 'ask') askCard(idx);
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
  let freePlays = 0;
  let freeSA = 0;

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
      // 真实玩家会拿牌，但不会每场都拿：给还没到手的增益牌留出牌位，
      // 拿的时候也不瞎点第一张，挑一张对当前牌组最划算的。
      const ownedPowers = G.deck.filter((id) => isPowerId(id)).length;
      const room = DECK_MAX - Math.max(0, POWERS.length - ownedPowers);
      if (TAKE && G.deck.length < room && panel.cards.length) {
        const best = panel.cards.reduce((a, b) => (cardScore(b) > cardScore(a) ? b : a));
        takeCard(panel.cards.indexOf(best));
      } else skipReward();
      continue;
    }
    if (panel.k === 'power') { takePower(panel.pool[0].id); continue; }
    if (panel.k === 'rest') {
      // 复习点：血线够就精炼，不够就休息。精炼是这一版唯一的"变强"路径 ——
      // 卡面 +3 攻/+3 挡，一副 15 张牌精炼一半，输出就翻了半倍。
      const upg = G.deck.findIndex((id) => {
        const k = cardKind(defOf(id));
        return k !== 'basic' && k !== 'power' && !isUpgraded(id);
      });
      if (SMART && G.hp > G.maxHp * 0.55 && upg >= 0) { openCardPick('up'); continue; }
      restHeal();
      continue;
    }
    if (panel.k === 'cardpick') {
      // 事件也会把面板交给 cardpick（精炼 / 移除）；不能一律当复习点的精炼处理。
      if (panel.mode === 'rm') {
        // 移除时挑当前牌组里评分最低的一张，而不是随便删第一张。
        let rm = -1;
        let worst = Infinity;
        G.deck.forEach((id, i) => {
          const k = cardKind(defOf(id));
          if (k === 'basic' || k === 'power') return;
          const s = cardScore(defOf(id));
          if (s < worst) { worst = s; rm = i; }
        });
        if (rm >= 0) { forgetCard(rm); continue; }
        // 没有可删的知识卡（牌组只有基础牌）时取消：取消会把事件挂着的
        // 待付款项一起丢掉，不白扣血（见 combat/play.ts 的 cancelPanel）。
        cancelPanel();
        continue;
      }
      let upg = -1;
      let best = -Infinity;
      G.deck.forEach((id, i) => {
        const k = cardKind(defOf(id));
        if (k === 'basic' || k === 'power' || isUpgraded(id)) return;
        const s = cardScore(defOf(id));
        if (s > best) { best = s; upg = i; }
      });
      if (upg >= 0) upgradeCard(upg); else cancelPanel();
      continue;
    }
    if (panel.k === 'event') {
      if (OLD_PATH) { chooseEventOption(panel.ev.opts.length - 1); continue; }
      // 真实玩家不会永远点"离开"：按血线、牌组厚度和事件 id 选一个收益项。
      // 选项没被消费（返回 null）时，退到最后一个"离开"选项，避免原地死循环。
      const ev = panel.ev;
      const low = G.hp < G.maxHp * 0.6;
      let idx = low ? ev.opts.length - 1 : 0;
      if (ev.id === 'index-cards') idx = low || G.deck.length >= DECK_MAX ? 1 : 0;
      else if (ev.id === 'notebook') idx = low ? 1 : 0;
      else if (ev.id === 'keeper') idx = 0;
      else if (ev.id === 'lamp-hall') idx = G.hp < G.maxHp * 0.8 ? 0 : 1;
      chooseEventOption(idx);
      if (G.panel.k === 'event') chooseEventOption(G.panel.ev.opts.length - 1);
      continue;
    }
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
      const pay = (id: CardId) => canPay(defOf(id));
      if (G.ap > 0 && G.hand.length) {
        // 挡不挡得住，是这个游戏每一回合真正的决定。机器人必须会挡 ——
        // 只会打输出的话，模拟出来的"掉血量"是半个玩家，数值就全被带偏了。
        const mv = G.enemy ? moveOf(G.enemy) : null;
        const inc = mv && mv.k === 'atk' ? Math.round(G.enemy!.dmg * (mv.m ?? 1)) * (mv.times ?? 1) : 0;
        if (inc - G.block >= 6) {
          const gd = G.hand.findIndex((id) => {
            const d = defOf(id);
            if (id === JUNK_ID || !pay(id) || d.power) return false;
            const k = cardKind(d);
            // 免答的防御牌也算数：以前这里写的是 `eff === 'guard' && canAsk(id)`，
            // 于是"已经攒满、可以免答"的格挡牌被机器人当成不存在 —— 免答一多就不挡，
            // 死亡全是机器人自己造成的（`--charge=stage` 那一轮胜率被这条压到个位数）。
            if (k === 'knowledge') return d.eff === 'guard' && pay(id);
            return k === 'basic' && (d.blk || 0) > 0;
          });
          if (gd >= 0) { advance(gd); continue; }
        }
        // 增益牌先打：它花行动力，但本场剩下每回合都在还。
        // 不先打的话，这张牌在手里就是一张废纸，模拟会把它的价值算成 0。
        const pw = G.hand.findIndex((id) => !!defOf(id).power && pay(id));
        if (pw >= 0) { playPower(pw); plays += 1; continue; }
        // 先打增益（本场持续），再答题出牌。
        // 等级攒满的知识卡直接打（playFree），还欠答题的走 askCard。
        const ask = G.hand.findIndex((id) => cardAskState(id) === 'ask' && pay(id));
        if (ask >= 0) { askCard(ask); continue; }
        // 免答的知识卡：输出和答对一样，只是不出题。机器人不选它，
        // 等于把"攒等级"这条线整个从模拟里删掉 —— 胜率会塌到 1% 以下。
        // 这里顺手记下"这张牌是攒满之后直接打的"，并按档位分开统计：
        // A/S 能不能兑现，是这个数值框架的核心问题（见 tools/sim.ts 顶部说明）。
        const freeIdx = G.hand.findIndex((id) => cardAskState(id) === 'free' && pay(id));
        if (freeIdx >= 0) {
          const g = cardGrade(defOf(G.hand[freeIdx]!));
          freePlays += 1;
          if (g === 'A' || g === 'S') freeSA += 1;
          advance(freeIdx);
          continue;
        }
        // 基础牌：不答题、不可退款，但总比让行动力烂掉好。
        // 它是这一局的地板，模拟不打出它，会把低水平的胜率算得比实际更狠。
        const bas = G.hand.findIndex((id) => id !== JUNK_ID && defOf(id).kind === 'basic' && pay(id));
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
  st.kinds += new Set(G.deck).size;
  st.battles += battles;
  st.turns += turns;
  st.powers += plays;
  st.powerCards += G.deck.filter((id) => isPowerId(id)).length;
  st.basics += basics;
  st.misses += G.runBad;
  st.free += freePlays;
  st.freeSA += freeSA;
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
  misses: number; basics: number; free: number; freeSA: number;
}> = [];

for (const lv of LEVELS) {
  if (FRESH) resetMemory();
  const st: Stat = {
    wins: 0, floors: 0, answers: 0, right: 0, runs: 0, draws: 0,
    deck: 0, kinds: 0, battles: 0, turns: 0, powers: 0, powerCards: 0,
    misses: 0, basics: 0, free: 0, freeSA: 0,
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
    free: st.free / st.runs, freeSA: st.freeSA / st.runs,
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
  // A/S 免答是"通关率杠杆"，但它要在一场之内攒 2/3 次才兑现 —— 场次太短就等于没有。
  // 这一行就是为了让这件事可测：`freeSA` 接近 0 说明杠杆是空的。
  console.log(`免答：${mid.free.toFixed(1)} 次/局（其中 A/S 档 ${mid.freeSA.toFixed(1)} 次`
    + `，每场 ${(mid.free / Math.max(0.01, mid.battles)).toFixed(2)} 次）`);
  console.log(`初始牌组：一局打出 ${mid.basics.toFixed(1)} 张基础牌`
    + `（另 ${mid.powers.toFixed(1)} 次增益牌）`);
  console.log(`答错：${MODES[MODE].name}模式 ${mid.misses.toFixed(1)} 次/局`
    + `（${MODES[MODE].cardLabel}；稳固度答错 ×${MODES[MODE].stabDrop}，答对 ×${MODES[MODE].stabGain}）`);
  console.log(`路径：${OLD_PATH ? '旧基线' : '真实'} · 取卡：${TAKE ? `战后拿卡（目标 ≤${DECK_MAX} 张）` : '战后跳过'}` + ` · 记忆：${FRESH_RUN ? '每局重置' : FRESH ? '每个水平重置' : '跨局累积'}`);
}

// 验收标准：水平越高胜率必须更高。
//
// 容差不能是拍出来的固定值 —— 它应该等于**采样噪声**。每档 n 局、胜率 p 在 0.3 附近时，
// 每一格的标准误是 100·sqrt(p(1-p)/n) ≈ 48/sqrt(n) 个百分点：800 局约 1.7 个点，
// 2000 局约 1.1 个点。写死"允许差 1 个点"在小样本上必然误报，写死一个宽松的数
// 又会在大样本上放跑真的回归。所以容差按样本量算。
//
// 三个模式现在都随水平上升，但底部不一样：
//   · 复习 / 测试：四档单调，容差 = 2 倍标准误。
//   · 学习：取消了答错垫子和补抽，低水平基本通关不了（800 局实测 13 / 25 / 31 / 35），
//     但它仍然随水平上升。这一档放宽到 3 倍标准误 —— 练习场允许更宽的波动，
//     不是靠断言把它判成"平"。
const sePct = 48 / Math.sqrt(RUNS);
const TOL: Record<RunMode, number> = { review: sePct * 2, test: sePct * 2, learn: sePct * 3 };
let violated = false;
for (let i = 1; i < summary.length; i++) {
  if (summary[i].win < summary[i - 1].win - TOL[MODE]) {
    violated = true;
    console.log(`✗ ${summary[i - 1].level} 胜率反而高于 ${summary[i].level}`
      + `（${summary[i - 1].win.toFixed(1)}% → ${summary[i].win.toFixed(1)}%，容差 ${TOL[MODE].toFixed(1)}）`);
  }
}
// 「精通比新手强」这句话在 800 局上仍然偏紧：三个模式的真实跨度约 10–22 个点，
// 而"两个估计值之差"的噪声是 √2 × 1.7 ≈ 2.4 个点 —— 门槛 5.1 个点，误报 1/6（实测）。
//
// 所以不比最上面一格，比**上两档 vs 下两档**。它问的是同一件事（"高水平的赢得多"），
// 但每边有 2n 个样本，理论噪声 1.2 个点。更细的相邻两档差异交给上面那条容差检查，
// 那一条本来就只判"有没有倒挂"。
//
// 门槛取 1.5 倍噪声而不是 2 倍：实测 8 次 800 局的差距是
// 7 / 6 / 6.5 / 3.4 / 5 / 8 / 7.5 / 5.5（均值 6.1，标准差 1.5），
// 2 倍门槛（3.4）落在均值下方 1.8σ 处，约 3% 的概率误报 —— 一个每次跑都可能红的
// 门槛等于没有门槛。1.5 倍（2.6）落在 2.4σ，误报 0.8%，同时 6 个点的真实跨度
// 仍有 2 倍余量。真的红了，先用 `--runs=2000` 复跑一次再判断。
const nTop = Math.max(1, Math.floor(summary.length / 2));
const lo = summary.slice(0, nTop);
const hi = summary.slice(summary.length - nTop);
const avg = (xs: typeof summary) => xs.reduce((s, r) => s + r.win, 0) / xs.length;
const gap = avg(hi) - avg(lo);
const gapSe = (48 / Math.sqrt(RUNS * nTop)) * Math.SQRT2;
const gapNeed = gapSe * 1.5;
if (gap < gapNeed) {
  violated = true;
  console.log(`✗ 上两档（${avg(hi).toFixed(1)}%）相对下两档（${avg(lo).toFixed(1)}%）`
    + `只高 ${gap.toFixed(1)} 个点（要求 ≥${gapNeed.toFixed(1)} = ${RUNS}×2 局下的 1.5 倍噪声）`
    + ' —— 先用 --runs=2000 复跑再判断是不是真的塌了');
}
if (RUNS < 800) {
  console.log(`· ${RUNS} 局只够分辨"有没有变好"，不足以分辨具体差几个点；`
    + '验收断言是按默认 800 局标定的');
}
// 分级免答的"兑现率"也要守：A/S 档低于 0.2 次/局，说明一场战斗短到根本攒不满
// （一场 2.0 回合时是 0.1；精英 / Boss 加厚之后是 0.7）。门槛写在 AGENTS 里，
// 但只有断言能拦住回归 —— 否则它只是文档里的一句话。
if (RUNS >= 400 && mid && mid.freeSA < 0.2) {
  violated = true;
  console.log(`✗ A/S 档免答只有 ${mid.freeSA.toFixed(2)} 次/局（要求 ≥0.20）：`
    + '分级免答在空转。先看「节奏」那行的回合数 —— 一场打不到 3 回合，2/3 次就攒不满');
}
if (MODE === 'learn' && !violated) {
  console.log(`· 学习模式四档胜率 ${summary.map((r) => r.win.toFixed(0)).join(' / ')}：`
    + '底部低是设计（不补垫子、不补抽，练习场基本通关不了），顶端仍随水平上升');
}
console.log(violated
  ? '✗ 验收失败：水平更高没有赢更多'
  : MODE === 'learn'
    ? '✓ 验收通过：学习模式也随水平上升（底部低是设计，不是回归）'
    : '✓ 验收通过：水平更高，胜率更高');
