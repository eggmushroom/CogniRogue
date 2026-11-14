/** 过幕与新机制的结构检查：`npm run stage`。 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename, dirname, join } from 'node:path';
import { BAL, FOES, MODES, POWERS, STAGES, STAGE_ROWS, effSummaryOf } from '../src/core/model';
import type { MapNode } from '../src/core/model';
import {
  EVENTS, G, answer, askCard, canAsk, canPay, cancelPanel, chooseEventOption, clearRun, defOf,
  dismissFeedback, endTurn, forgetCard, intentText, playBasic,
  runSaveInfo, skipReward, takeCard, startBattle, startTurn, upgradeCard, openReward, openPowerDrop,
  loadQuestionBank, PACK, startRun, ackPower, mergePacks, genStage, floorOf, LEGACY_CARD_IDS,
  allQuestions, stageMemOf, resetStageMemory, cardKind, enterStage, BASICS, drawBattleQuestions,
  cardGrade, gradeNeed, cardAskState, battleQuestionCount, playFree, takeQuestion, MAX_PICK_PER_RUN,
  openCardPick, statOf, isUpgraded, makeFoe, resumeRun, onceThisFight, restHeal,
  upGain, rulesOf, onceThisStage, onceThisRun, applyInstant, clearStageOnce, clearRunOnce,
  grantBlock, setBlock, loseHp, healHp, spendAp, gainAp, resetAp, drawCards, JUNK_ID,
  lastFeedback, onFx, effFace, planStrike, setScheduler, panelOf, buildSettlement,
  parseQuestionBank, shuffleOptions, SNAP_V, SAVE_KEY, drawEvent, MAP_COLS,
} from '../src/core';

// 结构检查用同步调度，core 的演出延时不会真的挂住测试。
setScheduler((_, fn) => fn());
const here = dirname(fileURLToPath(import.meta.url));
loadQuestionBank(mergePacks(
  [readFileSync(join(here, '..', 'packs', 'words.md'), 'utf8')],
  '英语单词表 · 临时题库',
));

let fails = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) fails += 1;
};
const panelKind = () => G.panel.k;

// ── 1. 怪物 ──
for (const s of STAGES) {
  const mine = FOES.filter((f) => f.stage === s.i);
  const n = mine.filter((f) => f.type === 'fight').length;
  const e = mine.filter((f) => f.type === 'elite').length;
  const b = mine.filter((f) => f.type === 'boss').length;
  ok(n >= 3 && e >= 2 && b === 1, `第 ${s.i} 幕 ${s.name}：${n} 普通 / ${e} 精英 / ${b} Boss`);
}
ok(new Set(FOES.map((f) => f.key)).size === FOES.length, `敌人 key 不重复（共 ${FOES.length} 种）`);

// ── 2. 地图 ──
const m = genStage(3);
ok(m.length === STAGE_ROWS, `一幕 ${m.length} 层`);
ok(m[0][0].type === 'fight', '第一层是战斗');
ok(m[STAGE_ROWS - 2].every((n) => n.type === 'rest'), 'Boss 前一层是复习点');
ok(m[STAGE_ROWS - 1][0].type === 'boss', '最后一层是 Boss');
ok(floorOf(3, 0) === 41 && floorOf(5, 19) === 100, '层号连续：第 3 幕第 1 层 = 41，第 5 幕末 = 100');

// 精英保底：一幕里一只精英都没有，等于这一局没有增益来源。
// 早先是"随机挑一个节点改成精英"，挑到复习点时静默失败 —— 这里把随机钉死成
// "永远抽不到精英"，再看保底是否补上一只、而且补在能改的那几行里。
{
  const realRandom = Math.random;
  // 0.5 落在 fight + event 之内（两幕配比最高 0.60），rollType 永远走不到精英那一支。
  Math.random = () => 0.5;
  try {
    const map = genStage(1);
    const elites = map.flat().filter((nd) => nd.type === 'elite');
    ok(elites.length === 1, `精英保底：随机一只都不给时仍然补 1 只（${elites.length}）`);
    ok(elites.every((nd) => nd.r >= 6 && nd.r <= STAGE_ROWS - 6),
      `精英补在第 6–${STAGE_ROWS - 6} 行（实际 ${elites.map((nd) => nd.r).join(',') || '无'}）`);
  } finally {
    Math.random = realRandom;
  }
}

// 形状：五个槽位装 1–4 个节点。3 列装不下岔路 —— 一行 2–3 个节点、
// 只允许跨一列时，走法必然退化成三条平行竖线。这一版把它拆成 5 列，
// 这些断言就是"别再退化回去"的尺子。
{
  const widths = m.map((row) => row.length);
  ok(widths.every((n) => n >= 1 && n <= MAP_COLS), `每行 1–${MAP_COLS} 个节点（${widths.join(',')}）`);
  ok(m.every((row) => row.every((nd) => nd.col >= 0 && nd.col < MAP_COLS)), '列号落在槽位内');
  ok(m.every((row) => new Set(row.map((nd) => nd.col)).size === row.length), '同一行不会有两个节点挤在同一列');
  ok(m.every((row) => row.every((nd, i) => i === 0 || nd.col > row[i - 1].col)), '同一行按列从左到右排');
  ok(m.every((row, r) => r === 0 || row.every((a) => m[r - 1].some((b) => Math.abs(a.col - b.col) <= 1))),
    '每个节点都挨着上一行的某个节点（边最多跨一列，不会有横贯的长斜线）');

  // 一次生成一张图时，这条约束曾经偶发失败（Boss 固定在中列，复习点那行偶尔
  // 离它两列）。连生成 200 张，把"偶尔"变成"每次"。
  let hop = 0;
  for (let i = 0; i < 200; i++) {
    const g = genStage(1 + (i % 5));
    if (!g.every((row, r) => r === 0 || row.every((a) => g[r - 1].some((b) => Math.abs(a.col - b.col) <= 1)))) {
      hop += 1;
    }
  }
  ok(hop === 0, `连生成 200 张图（五幕轮转），没有一张出现跨两列的边（${hop} 张失败）`);

  // 分叉与合流：只有竖线时这两个数都是 0。阈值取很松，只证明"结构在"，
  // 不锁死具体数量 —— 那是随机生成，不是常量表。
  const fork = m.flat().filter((nd) => (nd.next?.length ?? 0) >= 2).length;
  const indeg = new Map<string, number>();
  for (let r = 0; r < m.length - 1; r++) {
    for (const nd of m[r]) for (const j of nd.next) {
      const k = `${r + 1}:${j}`;
      indeg.set(k, (indeg.get(k) ?? 0) + 1);
    }
  }
  const join = [...indeg.values()].filter((n) => n >= 2).length;
  ok(fork >= 5, `地图有岔路可选（${fork} 处分叉）`);
  ok(join >= 2, `地图有路汇到一起（${join} 处合流）`);

  // 连通性：每个节点都走得出去，下一行的每个节点也都进得来
  let leak = 0;
  for (let r = 0; r < m.length - 1; r++) {
    if (m[r].some((nd) => !nd.next.length)) leak += 1;
    m[r + 1].forEach((_, j) => {
      if (!m[r].some((nd) => nd.next.includes(j))) leak += 1;
    });
  }
  ok(leak === 0, `没有走不出去的节点，也没有进不来的节点（漏 ${leak}）`);

  // 随机性：同一幕连生成两次，形状不该一样
  const sig = (g: MapNode[][]) => g.map((row) => row.map((nd) => `${nd.col}${nd.type[0]}`).join('|')).join('/');
  ok(sig(genStage(1)) !== sig(genStage(1)), '同一幕连续生成两张图，列位置与类型都不一样');
}

// 事件池：一局十几个事件节点，四个模板轮着来会变成补给站。
// 池子抽空之前不重复；模板数量本身也要够一局用。
{
  const kept = G.eventsSeen;
  G.eventsSeen = [];
  const seen = new Set<string>();
  let dup = 0;
  for (let i = 0; i < EVENTS.length; i++) {
    const ev = drawEvent();
    if (seen.has(ev.id)) dup += 1;
    seen.add(ev.id);
  }
  ok(dup === 0, `${EVENTS.length} 个事件模板，抽空之前不重复（重复 ${dup} 次）`);
  ok(EVENTS.length >= 12, `事件模板够一局用（${EVENTS.length} 个）`);
  G.eventsSeen = kept;
}

// ── 3. 过幕 ──
startRun();
const before = { maxHp: G.maxHp, stage: G.stage };
G.maxHp = 40;
G.hp = 9;

const bossNode: MapNode = { r: STAGE_ROWS - 1, i: 0, key: `${STAGE_ROWS - 1}:0`, col: 1, type: 'boss', next: [] };
G.node = bossNode;
G.enemy = {
  ...FOES.find((f) => f.stage === 1 && f.type === 'boss')!,
  maxHp: 10, hp: 1, block: 0, mv: 0, stage: 1,
};
G.enemy.hp = 0;
G.pending = 'win';
dismissFeedback();

ok(G.stage === 2, `过幕后进入第 ${G.stage} 幕`);
ok(G.hp === G.maxHp, `过幕回满血（${G.hp}/${G.maxHp}）`);
// 读 `rulesOf()` 而不是 `BAL`：茶会让这条规则比声明值大，卡面与结算都跟它走。
// 失败时打印三个数，一眼看得出是"没加"还是"加多了"。
const grown = rulesOf().stageMaxHp;
ok(G.maxHp === 40 + grown, `生命上限 +${grown}（40 → ${G.maxHp}）`);
ok(G.map.length === STAGE_ROWS && G.pos === null, '换了一张新图，位置在入口');
ok(G.screen === 'map', '过幕后回到地图而不是结算页');
ok(G.panel.k === 'powerdrop', '幕 Boss 掉一个增益（拾取即生效）');
ok(G.seen && Object.keys(G.seen).length === 0, '走过标记按幕清空');
const gotPower = G.powers.length;
ackPower();
ok(G.panel.k === 'none', '领完奖励回到地图');
ok(gotPower === 1, `过幕真的拿到一个增益（${gotPower} 个）`);
void before;

// ── 4. 终局 ──
G.stage = STAGES.length;
enterStage(G.stage);
G.node = { ...bossNode, r: STAGE_ROWS - 1 };
G.enemy = { ...FOES.find((f) => f.type === 'boss')!, maxHp: 10, hp: 0, block: 0, mv: 0 };
G.pending = 'win';
dismissFeedback();
ok(G.screen === 'report' && G.panel.k === 'report' && G.panel.data.win, '第五幕 Boss → 结算胜利');

// ── 5. 敌人机制 ──
function battle(stage: number, key: string) {
  startRun();
  G.stage = stage;
  G.map = genStage(stage);
  const nd: MapNode = { r: 3, i: 0, key: '3:0', col: 1, type: 'fight', next: [] };
  G.node = nd;
  startBattle(nd);
  const tpl = FOES.find((f) => f.key === key)!;
  // mechV 不会随 Object.assign 清除，必须显式覆盖。
  Object.assign(G.enemy!, { ...tpl, maxHp: 999, hp: 999, block: 0, mv: 0, mechV: tpl.mechV });
  // drawCut 要按换过的敌人重算，否则 fog 断言靠抽卡运气。
  const e = G.enemy!;
  G.drawCut = e.mech === 'fog' ? (e.mechV ?? BAL.mech.fog) : 0;
  // 保证手里至少有一张能答的牌。
  if (!G.hand.some((c) => canAsk(c) && canPay(defOf(c)))) {
    const k = PACK.cards.find((c) => c.kind === 'knowledge' && cardGrade(c) === 'B')!;
    G.hand[0] = k.id;
  }
  return e;
}

// fog：抽牌 -1
{
  battle(2, 'bookmoth');
  ok(G.drawCut === 1, '蠹蛾：本场抽牌 -1');
  // 再数一次手牌，确认减抽真的落到 drawTo。
  startTurn();
  ok(G.hand.length === BAL.drawPerTurn - 1, `蠹蛾：起手只有 ${G.hand.length} 张（应 ${BAL.drawPerTurn - 1} 张）`);
  G.drawCut = 0;
}

// thorns：反伤
{
  const e = battle(3, 'ghostprint');
  const before = G.hp;
  const i = G.hand.findIndex((c) => canAsk(c) && canPay(defOf(c)));
  if (i < 0) throw new Error('反伤测试：手里没有能答的牌');
  askCard(i);
  if (G.panel.k === 'question') answer(G.panel.view.answer);
  if (G.panel.k === 'feedback') dismissFeedback();
  ok(G.hp < before, `影印：反伤落地（${before} → ${G.hp}）`);
  void e;
}

// bulwark：叠甲
{
  const e = battle(4, 'leathercover');
  e.block = 0;
  const i = G.hand.findIndex((c) => canAsk(c) && canPay(defOf(c)));
  if (i >= 0) {
    askCard(i);
    if (G.panel.k === 'question') {
      const v = G.panel.view;
      answer((v.answer + 1) % v.options.length);
    }
    if (G.panel.k === 'feedback') dismissFeedback();
  }
  ok(e.block > 0, `皮革封面：答错后它叠了 ${e.block} 格挡`);
}

// siphon：未挡住时下回合行动力 -1
{
  const e = battle(5, 'whisperer');
  e.dmg = e.dmg * 2;
  e.moves = [{ k: 'atk' }];
  e.mv = 0;
  G.block = 0;
  G.apDown = 0;
  const apMax = G.apMax;
  endTurn();
  // 记账在挨打时，下一回合结算，所以读新回合的行动力。
  ok(G.ap === apMax - 1, `低语者：下一回合行动力 ${G.ap}/${apMax}`);
}

// haste：伤害递增
{
  const e = battle(4, 'stitchdoll');
  const d0 = e.dmg;
  endTurn();
  ok(e.dmg > d0, `缝线傀儡：攻击 ${d0} → ${e.dmg}`);
}

// leech：只吃答错，回血读 mechV，且不越血线上限。
{
  const e = battle(2, 'grubqueen');
  const cap = e.mechV ?? BAL.mech.leech;
  const card = PACK.cards.find((c) => c.kind === 'knowledge')!;

  const missOnce = () => {
    // 每轮先开新回合，清掉上一块答题面板。
    startTurn();
    G.ap = 9;                       // 别让"行动力不够"伪装成"机制没生效"
    G.hand[0] = card.id;
    const hp0 = e.hp;
    askCard(0);
    const p0 = G.panel;
    if (p0.k === 'question') answer((p0.view.answer + 1) % p0.view.options.length);
    const took = G.panel.k === 'feedback';
    if (took) dismissFeedback();
    if (!took) throw new Error('书蛀母：没弹出题');
    return e.hp - hp0;
  };

  e.hp = e.maxHp - 40;
  ok(missOnce() === cap, `书蛀母：答错回 ${cap} 点`);

  // 差 2 点满血时答错只补到满。
  e.hp = e.maxHp - 2;
  missOnce();
  ok(e.hp === e.maxHp, `书蛀母：回血不越上限（${e.hp}/${e.maxHp}）`);

  // 满血时答错不回血。
  e.hp = e.maxHp;
  ok(missOnce() === 0, '书蛀母：满血时答错不回血');

  // 答对不回血。
  e.hp = e.maxHp - 30;
  const hp1 = e.hp;
  G.ap = 9;
  G.hand[0] = card.id;
  askCard(0);
  if (G.panel.k === 'question') answer(G.panel.view.answer);
  if (G.panel.k === 'feedback') dismissFeedback();
  ok(e.hp <= hp1, `书蛀母：答对不回血（${hp1} → ${e.hp}）`);
}

// ── 6. 答错
// 答错即作废：不补格挡、不补抽，牌进弃牌堆。
function missGain(eff: string) {
  battle(1, 'examiner');
  const card = PACK.cards.find((c) => c.kind === 'knowledge' && c.eff === eff)!;
  G.hand[0] = card.id;
  const before = G.block;
  askCard(0);
  if (G.panel.k !== 'question') throw new Error(`「${eff}」那张牌没有弹题`);
  answer((G.panel.view.answer + 1) % G.panel.view.options.length);
  const gain = G.block - before;
  if (panelOf('feedback')) dismissFeedback();
  return gain;
}
{
  const noBlk = missGain('pierce');
  ok(noBlk === 0, `卡面没有格挡的牌答错不给格挡（实得 ${noBlk} 点）`);
  const hasBlk = missGain('guard');
  ok(hasBlk === 0, `本身有格挡的牌答错也不补（${hasBlk} 点）—— 垫子整个没了`);
}

// ── 6b. 答错代价
// 不补格挡、不补抽、错牌进弃牌堆。
{
  battle(1, 'examiner');
  const card = PACK.cards.find((c) => c.kind === 'knowledge' && c.eff === 'guard')!;
  G.hand[0] = card.id;
  const blocked = G.block;
  const handBefore = G.hand.length;
  const pileBefore = G.discard.length;
  askCard(0);
  if (G.panel.k !== 'question') throw new Error('那张牌没有弹题');
  answer((G.panel.view.answer + 1) % G.panel.view.options.length);
  const p = panelOf('feedback')!;
  const note = p.fb?.apNote ?? '';
  ok(G.block === blocked, `答错一格挡也不补（${blocked} → ${G.block}）`);
  ok(G.hand.length === handBefore - 1, `答错不补抽（手牌 ${handBefore} → ${G.hand.length}）`);
  ok(G.discard.length === pileBefore + 1, '答错的牌进了弃牌堆');
  ok(!G.draw.includes(card.id), '答错的牌不会回到抽牌堆');
  ok(note.includes('弃牌堆'), `说明写了牌的去向（${note}）`);
  dismissFeedback();
}

// ── 7. 取消
// 点开即扣题；取消不锁牌。
{
  battle(1, 'examiner');
  const card = PACK.cards.find((c) => c.kind === 'knowledge')!;
  G.hand[0] = card.id;
  G.ap = 9;
  const leftBefore = G.qLeft.length;
  askCard(0);
  ok(G.panel.k === 'question', `取消测试：题弹出来了（${G.panel.k}）`);
  ok(G.qLeft.length === leftBefore - 1, `点开就扣掉一道题（${leftBefore} → ${G.qLeft.length}）`);
  cancelPanel();
  askCard(0);
  ok(G.panel.k === 'question', '取消后同一张牌还能再点开（不再锁牌）');
  cancelPanel();
}

// ── 8. 多段反馈
// 反馈面板读 fb.parts，其和等于 fb.dmg。
{
  const e = battle(1, 'examiner');
  const chain = PACK.cards.find((c) => c.kind === 'knowledge' && c.eff === 'chain' && c.cost !== 'x')!;
  G.hand[0] = chain.id;
  G.ap = 3;
  e.block = 5;
  askCard(0);
  if (G.panel.k !== 'question') throw new Error('多段测试：没弹题');
  answer(G.panel.view.answer);
  // 答对不再画判定面板，但结果本身还在：段数/伤害从最近一次判定里读。
  const fb = lastFeedback();
  if (!fb) throw new Error('多段测试：没有判定结果');
  const raw = fb.hits.reduce((n: number, x: number) => n + x, 0);
  const parts = fb.parts.reduce((n: number, part: { d: number }) => n + part.d, 0);
  ok(raw > fb.dmg, `多段原始 ${raw} > 实际 ${fb.dmg}（有格挡）`);
  ok(parts === fb.dmg, `parts 相加 ${parts} = 实际 ${fb.dmg}`);
  dismissFeedback();
}

// ── 9. 增益上限 ──
{
  startRun();
  G.powers = POWERS.map((p) => p.id);
  openPowerDrop();
  ok(panelKind() === 'none', `${POWERS.length} 个拿齐后不再开掉落面板（${panelKind()}）`);
  ok(G.powers.length === POWERS.length, `已有的不会被重复塞进来（${G.powers.length} 个）`);
  // 精英战后照给知识卡，跳过增益，不开空面板。
  G.node = { r: 6, i: 0, key: '6:0', col: 1, type: 'elite' } as MapNode;
  openReward();
  skipReward();
  ok(panelKind() === 'none' && G.screen === 'map', '精英奖励走完就回地图，不会开空面板');
}

// ── 9b. 增益叠加 ──
{
  // 索引卡空手 +2，与板书叠加。
  startRun();
  G.powers = ['index'];
  ok(rulesOf({ handLeft: 2 }).draw === BAL.drawPerTurn + BAL.indexDraw,
    `索引卡：空手时抽牌 +${BAL.indexDraw}（${rulesOf({ handLeft: 2 }).draw}）`);
  G.powers = ['board', 'index'];
  ok(rulesOf({ handLeft: 2 }).draw === BAL.drawPerTurn + BAL.boardDraw + BAL.indexDraw,
    `索引卡 + 板书：两个来源叠加（${rulesOf({ handLeft: 2 }).draw}）`);

  // 账本：幕内第一次奖励多一张且直接精炼。
  startRun();
  G.powers = ['ledger'];
  G.onceStage = {};
  // 这里原来写的是 `type: 'battle'` 再套 `as unknown as MapNode`，而 NodeType 里
  // 根本没有 'battle'（是 'fight'）—— 断言让这个错值编译通过、一直没被发现。
  // 去掉断言后 tsc 立刻报出来，这就是「测试里的 as unknown as」的实际代价。
  G.node = { r: 1, i: 0, key: '1:0', col: 1, type: 'fight', next: [] };
  openReward();
  const rw = panelOf('reward')!;
  ok(rw.k === 'reward' && rw.ledger === true
    && rw.cards.length === BAL.rewardPicks + BAL.ledgerPicks,
    `账本：第一次奖励 ${rw.cards.length} 个选项，并标记精炼`);
  const before = G.deck.length;
  takeCard(0);
  ok(isUpgraded(G.deck[before]), `账本：选中的牌直接精炼（${G.deck[before]}）`);

  openReward();
  const rw2 = panelOf('reward')!;
  ok(rw2.k === 'reward' && rw2.ledger !== true,
    '账本：同一幕第二次奖励不再多给，也不再精炼');

  // 折角：第一回合多 2 张。
  battle(1, 'examiner');
  G.powers = ['dogear'];
  G.turn = 1;
  startTurn();
  ok(G.hand.length === BAL.drawPerTurn + BAL.dogearDraw,
    `折角：第一回合手牌 ${G.hand.length} 张（应 ${BAL.drawPerTurn + BAL.dogearDraw}）`);

  // 书签：第一次答对给格挡。
  battle(1, 'examiner');
  G.powers = ['bookmark'];
  G.ap = 9;
  G.block = 0;
  G.hand[0] = PACK.cards.find((c) => c.kind === 'knowledge' && c.blk > 0 && cardGrade(c) !== 'C')!.id;
  askCard(0);
  if (G.panel.k !== 'question') throw new Error('书签测试：没弹题');
  answer(G.panel.view.answer);
  ok(G.block >= BAL.bookmarkBlock, `书签：第一次答对补 ${BAL.bookmarkBlock} 点格挡（${G.block}）`);
  const fp = panelOf('feedback');
  if (fp) dismissFeedback();
}

// ── 10. 事件 ──
{
  // 长明灯廊：没有新卡可给时不扣血。
  startRun();
  PACK.cards.forEach((c) => { for (let i = 0; i < BAL.maxCopies; i++) G.deck.push(c.id); });
  const deckBefore = G.deck.length;
  G.hp = 50;
  G.panel = { k: 'event', ev: EVENTS.find((e) => e.id === 'lamp-hall')! };
  chooseEventOption(1);
  ok(G.hp === 50, `长明灯廊：没有新卡可给时不扣血（${G.hp}）`);
  ok(G.deck.length === deckBefore, `长明灯廊：也没多出牌（${G.deck.length} 张）`);
}

{
  // 索引卡：拿卡先付 8 点生命
  startRun();
  G.hp = 50;
  const before = G.deck.length;
  G.panel = { k: 'event', ev: EVENTS.find((e) => e.id === 'index-cards')! };
  chooseEventOption(0);
  ok(G.hp === 42, `索引卡：拿卡付 8 点生命（${G.hp}）`);
  ok(G.deck.length === before + 1 && isUpgraded(G.deck[G.deck.length - 1]),
    '索引卡：多一张已精炼的知识卡');
}

{
  // 旧笔记本：选牌时才扣血，取消不付。
  startRun();
  G.hp = 50;
  G.panel = { k: 'event', ev: EVENTS.find((e) => e.id === 'notebook')! };
  chooseEventOption(0);
  const p = panelOf('cardpick')!;
  ok(p.k === 'cardpick' && p.mode === 'up', `旧笔记本：打开精炼选牌（${p.k}/${p.mode}）`);
  ok(G.hp === 50, `旧笔记本：打开面板时还没扣血（${G.hp}）`);
  ok(G.pendingCost === 10, `旧笔记本：待付 10 点生命挂在面板上（${G.pendingCost}）`);
  if (p.k === 'cardpick') {
    const i = G.deck.findIndex((id) => !isUpgraded(id));
    if (i < 0) throw new Error('旧笔记本：没有可精炼的牌');
    upgradeCard(i);
    ok(isUpgraded(G.deck[i]), `旧笔记本：选中的那一张被精炼（${G.deck[i]}）`);
    ok(G.hp === 40, `旧笔记本：选完才付 10 点生命（${G.hp}）`);
    ok(G.pendingCost === 0, '旧笔记本：付完清账，不会重复扣');
  }
}

{
  // 取消 = 不付钱，并且回到事件本身；不能把节点空丢在半路。
  startRun();
  G.hp = 50;
  G.panel = { k: 'event', ev: EVENTS.find((e) => e.id === 'notebook')! };
  chooseEventOption(0);
  ok(G.pendingCost === 10, '取消测试：打开面板时挂着 10 点待付');
  cancelPanel();
  ok(panelKind() === 'event' && G.pendingCost === 0,
    `取消测试：回到事件、账也清了（${panelKind()} / ${G.pendingCost}）`);
  ok(G.hp === 50, `取消测试：一分血没扣（${G.hp}）`);
}

{
  // 旧笔记本的回血要等真的删掉一张才结算；取消不能白拿 10 点生命。
  startRun();
  G.hp = 50;
  G.node = { r: 1, i: 0, key: '1:0', col: 0, type: 'event', next: [] };
  G.pos = { r: 0, i: 0 };
  const floors0 = G.floors;
  G.panel = { k: 'event', ev: EVENTS.find((e) => e.id === 'notebook')! };
  chooseEventOption(1);
  ok(G.pendingHeal === 10, `旧笔记本取消测试：待回 10 点生命挂在面板上（${G.pendingHeal}）`);
  cancelPanel();
  ok(panelKind() === 'event' && G.pendingHeal === 0,
    `旧笔记本取消测试：回到事件、收益也清了（${panelKind()} / ${G.pendingHeal}）`);
  ok(G.hp === 50 && G.floors === floors0,
    `旧笔记本取消测试：没有白回血、没有推进层数（${G.hp} / ${G.floors}）`);

  chooseEventOption(1);
  const before = G.deck.length;
  forgetCard(0);
  ok(G.deck.length === before - 1, `旧笔记本：真的删掉一张（${before} → ${G.deck.length}）`);
  ok(G.hp === 60, `旧笔记本：删完才回 10 点生命（${G.hp}）`);
  ok(G.floors === floors0 + 1, `旧笔记本：节点收尾推进一层（${G.floors}）`);
}

// ── 10a. 基础牌
// 基础牌同样可以精炼与遗忘。
{
  startRun();
  const bi = G.deck.indexOf('base:strike');
  ok(bi >= 0, '牌组里有基础斩击');
  const atkBefore = statOf(G.deck[bi]).atk;
  G.panel = { k: 'event', ev: EVENTS.find((e) => e.id === 'notebook')! };
  chooseEventOption(0);
  const p = panelOf('cardpick')!;
  ok(p.k === 'cardpick' && p.mode === 'up', `基础牌可精炼：打开选牌（${p.k}/${p.mode}）`);
  upgradeCard(bi);
  ok(isUpgraded(G.deck[bi]) && statOf(G.deck[bi]).atk === atkBefore + 3,
    `基础斩击精炼后 ${atkBefore} → ${statOf(G.deck[bi]).atk} 伤`);

  startRun();
  const gi = G.deck.indexOf('base:guard');
  const deckBefore = G.deck.length;
  const blkBefore = statOf(G.deck[gi]).blk;
  G.panel = { k: 'event', ev: EVENTS.find((e) => e.id === 'keeper')! };
  chooseEventOption(0);
  forgetCard(gi);
  ok(G.deck.length === deckBefore - 1, `基础格挡可以被遗忘（${deckBefore} → ${G.deck.length}）`);
  void blkBefore;

  // 牌组删到 4 张为止。
  const deep = G.deck.length;
  G.deck = G.deck.slice(0, 4);
  ok(!openCardPick('rm'), `牌组 4 张时拒绝删牌（现在 ${G.deck.length}，删前 ${deep}）`);
}

{
  // 没牌可交时留在事件面板。
  startRun();
  G.deck = G.deck.slice(0, 4);
  G.hp = 50;
  G.panel = { k: 'event', ev: EVENTS.find((e) => e.id === 'keeper')! };
  chooseEventOption(0);
  ok(panelKind() === 'event' && G.hp === 50,
    `守夜人：没牌可交时留在事件面板（${panelKind()} / ${G.hp}）`);
}

{
  // 有牌可交时交给玩家选。
  startRun();
  const extra = PACK.cards.filter((c) => c.kind === 'knowledge').slice(0, 4);
  extra.forEach((c) => G.deck.push(c.id));
  G.hp = 50;
  const before = G.deck.length;
  G.panel = { k: 'event', ev: EVENTS.find((e) => e.id === 'keeper')! };
  chooseEventOption(0);
  const p = panelOf('cardpick')!;
  ok(p.k === 'cardpick' && p.mode === 'rm', `守夜人：打开移除选牌（${p.k}/${p.mode}）`);
  if (p.k === 'cardpick') {
    const i = G.deck.findIndex((e) => defOf(e).kind !== 'basic');
    forgetCard(i);
  }
  ok(G.deck.length === before - 1, `守夜人：玩家选的那张被移除（${before} → ${G.deck.length}）`);
  ok(G.hp === 50, '守夜人：不再随机抽卡，也不额外回血');
}

// 新事件的机制各不相同，每一条都要真的落到状态上。
// "写了选项但 run() 没接线"是这一块最容易出的错：面板照常关掉、日志照常有字，
// 只有状态没变，而测试里没有任何断言读 UI。
{
  // 复印机：复制手里的一张牌（同一份再来一张），付 6 点生命
  startRun();
  G.hp = 50;
  const before = G.deck.length;
  G.panel = { k: 'event', ev: EVENTS.find((e) => e.id === 'copier')! };
  chooseEventOption(0);
  ok(G.deck.length === before + 1, `复印机：牌组 +1（${before} → ${G.deck.length}）`);
  ok(G.hp === 44, `复印机：付 6 点生命（${G.hp}）`);
  const copies = new Map<string, number>();
  G.deck.forEach((id) => copies.set(id, (copies.get(id) ?? 0) + 1));
  ok([...copies.values()].some((n) => n >= 2), '复印机：真的有同一张牌的第二份');
}

{
  // 灯油：生命上限 +4，当前生命不动（不是"回满"）
  startRun();
  G.hp = 50;
  const maxBefore = G.maxHp;
  G.panel = { k: 'event', ev: EVENTS.find((e) => e.id === 'lamp-oil')! };
  chooseEventOption(0);
  ok(G.maxHp === maxBefore + 4, `灯油：生命上限 +4（${maxBefore} → ${G.maxHp}）`);
  ok(G.hp === 38, `灯油：失去 12 点生命、不会被回满（${G.hp}）`);
}

{
  // 错页：一半概率拿卡、一半概率掉血。把随机钉死，两边都要验 ——
  // 只验好的一边，"坏运分支写错了"会一直藏着。
  const real = Math.random;
  try {
    startRun();
    G.hp = 50;
    const n0 = G.deck.length;
    Math.random = () => 0.1;
    G.panel = { k: 'event', ev: EVENTS.find((e) => e.id === 'wrong-page')! };
    chooseEventOption(0);
    ok(G.deck.length === n0 + 1 && G.hp === 50,
      `错页（好运）：拿卡不掉血（${n0} → ${G.deck.length} / ${G.hp}）`);

    startRun();
    G.hp = 50;
    const n1 = G.deck.length;
    Math.random = () => 0.9;
    G.panel = { k: 'event', ev: EVENTS.find((e) => e.id === 'wrong-page')! };
    chooseEventOption(0);
    ok(G.deck.length === n1 && G.hp === 40,
      `错页（坏运）：掉 10 点血、不给卡（${G.hp} / ${G.deck.length}）`);
  } finally {
    Math.random = real;
  }
}

// ── 10b. 开局牌组 ──
{
  startRun();
  startRun();
  const ids = G.deck.slice();
  ok(G.deck.length === 10, `起手 10 张（实为 ${G.deck.length}）`);
  ok(ids.filter((id) => id === 'base:strike').length === 4, `基础斩击 ×4（实为 ${ids.filter((id) => id === 'base:strike').length}）`);
  ok(ids.filter((id) => id === 'base:guard').length === 4, `基础格挡 ×4（实为 ${ids.filter((id) => id === 'base:guard').length}）`);

  const knowledge = G.deck.filter((e) => cardKind(defOf(e)) === 'knowledge');
  ok(knowledge.length === 2, `随机知识卡 ×2（实为 ${knowledge.length}）`);
  ok(new Set(knowledge).size === 2, '两张随机知识卡不重复');
  ok(knowledge.every((id) => PACK.cards.some((c) => c.id === id)), '随机知识卡都来自 catalog（不含基础牌）');
  // 起手不给 A/S 级牌。
  ok(knowledge.every((id) => ['C', 'B'].includes(cardGrade(defOf(id)))),
    `起手知识卡都是 C/B 级（${knowledge.map((id) => cardGrade(defOf(id))).join('/')}）`);
  ok(!knowledge.some((id) => (defOf(id).cost ?? 1) === 3),
    '起手不会抽到 3 费的 S 级牌');

  // 基础牌不在 PACK，奖励与事件不会产出。
  ok(!PACK.cards.some((c) => c.id === 'base:strike' || c.id === 'base:guard'),
    '卡池里没有基础斩击 / 基础格挡（奖励与事件不会产出）');
  ok(BASICS.length === 8, `基础牌共 8 张（实为 ${BASICS.length}）`);
}

// ── 10c. 精炼
// 牌组是一串 id，精炼只换挑中的那个 id。
{
  startRun();
  const strikes = G.deck.filter((id) => id === 'base:strike');
  ok(strikes.length === 4, `牌组里有 4 张基础斩击（${strikes.length}）`);
  // 同名副本是同一个 id。
  ok(new Set(strikes).size === 1, '四张基础斩击是同一个 id（没有 per-copy 状态）');

  // 精炼只改挑中的一张。
  G.panel = { k: 'event', ev: EVENTS.find((e) => e.id === 'notebook')! };
  chooseEventOption(0);
  const idx = G.deck.indexOf('base:strike');
  upgradeCard(idx);
  ok(G.deck[idx] === 'base:strike+', `挑中的那一张换成精炼 id（${G.deck[idx]}）`);
  ok(statOf('base:strike+').atk === 7, `精炼后 7 伤（${statOf('base:strike+').atk}）`);
  ok(statOf('base:strike').atk === 4, `同名的另一张仍是 4 伤（${statOf('base:strike').atk}）`);
  const plain = G.deck.filter((id) => id === 'base:strike').length;
  ok(plain === 3, `另外三张基础斩击没被强化（${plain}/3 仍是白板）`);
  ok(defOf('base:strike+').name === '基础斩击', '精炼版仍能还原出同一张卡面');

  // 两张精炼版可以共存，不会叠成 ++。
  upgradeCard(G.deck.indexOf('base:strike'));
  ok(G.deck.filter((id) => id === 'base:strike+').length === 2, '第二张也能单独精炼');
  ok(!G.deck.some((id) => id.endsWith('++')), '精炼不会叠成 ++');

  G.deck.push('base:strike');
  ok(statOf('base:strike').atk === 4, '新增的同名卡是白板（精炼不按牌名传染）');
}

// ── 10d. 敌人成长：幕内每 5 层上一个台阶
// 血量成长是"每档 +hpStep 点"，不是比例。台阶写死成查表，玩家能算出
// "再走两层它会变厚"，也能自己核对厚了多少。
{
  const shard = FOES.find((f) => f.key === 'shard')!;
  const hpAt = (r: number) => {
    G.stage = 1;
    G.node = { r, i: 0, key: `${r}:0`, col: 1, type: 'fight', next: [] };
    return makeFoe(shard, floorOf(1, r)).maxHp;
  };
  let mono = true;
  for (let r = 1; r < STAGE_ROWS; r++) if (hpAt(r) < hpAt(r - 1)) mono = false;
  ok(mono, `幕内血量只增不减（第 1 层 ${hpAt(0)} → 第 20 层 ${hpAt(STAGE_ROWS - 1)}）`);
  ok(hpAt(STAGE_ROWS - 1) > hpAt(0),
    `幕末比幕初厚 ${hpAt(STAGE_ROWS - 1) - hpAt(0)} 点（每档 +${shard.hpStep}）`);
  ok(hpAt(5) - hpAt(4) === shard.hpStep, `第 6 层跳一档（+${hpAt(5) - hpAt(4)} 点）`);
  ok(hpAt(4) === hpAt(0) && hpAt(9) === hpAt(5), '同一个台阶内血量不变');

  // 伤害不随层数变：轻击 / 重击的差值是固定的几点，不是"后期连轻击都变重"。
  const d0 = makeFoe(shard, floorOf(1, 0)).dmg;
  const d19 = makeFoe(shard, floorOf(1, STAGE_ROWS - 1)).dmg;
  ok(d0 === d19 && d0 === shard.dmg, `伤害就是招式表上的数（${d0} 点，不随层数变）`);

  // 幕与幕之间：越靠后的幕，怪越厚。
  const thickest = (stage: number) => Math.max(
    ...FOES.filter((f) => f.stage === stage && f.type === 'fight').map((f) => f.hp),
  );
  ok(thickest(5) > thickest(1) * 2,
    `第五幕杂兵 ${thickest(5)} 血，是第一幕 ${thickest(1)} 的两倍以上`);

  const bossHp = (stage: number) => makeFoe(
    FOES.find((f) => f.stage === stage && f.type === 'boss')!,
    floorOf(stage, STAGE_ROWS - 1),
  ).maxHp;
  ok(bossHp(5) > bossHp(1) * 3, `第 5 幕 Boss ${bossHp(5)} 血，第一幕 ${bossHp(1)} 的三倍以上`);
}

// ── 10f. 精英 / Boss 比同幕杂兵厚
// 厚度直接写在 `FOES.hp` 上（不再乘倍率），所以这里验的是数据：
// 每一幕里最厚的杂兵，都比最薄的精英薄。
{
  for (const s of STAGES) {
    const mine = FOES.filter((f) => f.stage === s.i);
    const maxFight = Math.max(...mine.filter((f) => f.type === 'fight').map((f) => f.hp));
    const minHard = Math.min(...mine.filter((f) => f.type !== 'fight').map((f) => f.hp));
    ok(minHard > maxFight, `第 ${s.i} 幕：精英最低 ${minHard} 血 > 杂兵最高 ${maxFight} 血`);
  }
}

// ── 10e. 增益文案
// 说明不能写成一张牌，也不能有恒真描述。
{
  const cards = POWERS.map((p) => p.card);
  ok(new Set(cards).size === cards.length, `${POWERS.length} 个增益的规则两两不同（${cards.length} 条）`);
  ok(!POWERS.some((p) => /答错不花行动力/.test(p.card + p.desc)),
    '没有增益还在说"答错不花行动力"（那已经是全局规则）');
  ok(!POWERS.some((p) => /锁卡/.test(p.card + p.desc)),
    '没有增益还在提"锁卡"（那条规则已删）');
  // 增益不进牌组，说明里不指向自身。
  ok(!POWERS.some((p) => /打出这张|打出本张|牌位|牌组里/.test(p.card)),
    '增益的说明不再把它写成一张要打出的牌');
  // 荧光笔与双面镜不能逐字相同。
  const marker = POWERS.find((p) => p.id === 'marker')!;
  const mirror = POWERS.find((p) => p.id === 'mirrorcard')!;
  ok(marker.card !== mirror.card,
    `荧光笔与双面镜已分开：${marker.card} / ${mirror.card}`);
  // desc 只说 card 装不下的边界。逐字复述 card 的第二遍没有内容可装，
  // 最后一定长成"替设计解释理由"。
  const echo = POWERS.filter((p) => {
    if (!p.desc) return false;
    const norm = (s: string) => s.replace(/[。，、；：\s]/g, '');
    return norm(p.card).startsWith(norm(p.desc)) || norm(p.desc).startsWith(norm(p.card));
  });
  ok(!echo.length, `增益的 desc 不复述 card（${echo.length ? `复述：${echo.map((p) => p.name).join('、')}` : '全部是边界' }）`);
}

// ── 10e2. 卡面的数字跟着数值表走
//
// 增益文案里的数字全是手抄的：`BAL` 里改了数值，`card` 上那一句不会跟着变，
// 于是卡面长期在骗人 —— 不报错、断言看不见，只有玩家对不上账时才发现。
// 这里把「哪个数该出现在哪句话里」写成断言，模板串从 `BAL` 取，改数值即红。
// 中文数字（一半 / 三张变四张）没法从数值派生，单独走 `SEAL` 一条。
{
  const face: [string, string][] = [
    ['librarycard', `退回 ${BAL.refund} 点`],
    ['hourglass', `行动力 +${BAL.hourglassAp}`],
    ['index', `多抽 ${BAL.indexDraw} 张`],
    ['mirrorcard', `抽 ${BAL.answerDraw} 张`],
    ['lamp', `获得 ${BAL.lampBlock} 点格挡`],
    ['marker', `+${BAL.markerPlus}`],
    ['paperweight', `多 ${BAL.paperweightBlock} 点格挡`],
    ['dogear', `多抽 ${BAL.dogearDraw} 张`],
    ['bookmark', `获得 ${BAL.bookmarkBlock} 点格挡`],
    ['eraser', `补 ${BAL.eraserBlock} 点格挡`],
    ['syllabus', `获得 ${BAL.syllabusBlock} 点格挡`],
    ['scratch', `补抽 ${BAL.scratchDraw} 张`],
    ['margin', `多攒 ${BAL.marginCharge} 次免答`],
    ['corner', `多 ${BAL.cornerBlock} 点格挡`],
    ['mend', `${BAL.mendRest} 点生命`],
    ['press', `伤害 +${BAL.pressAtk}`],
    ['code', `格挡 +${BAL.codeBlk}`],
    ['nightlight', `伤害 -${BAL.nightCut}`],
    ['board', `多抽 ${BAL.boardDraw} 张`],
    ['tab', `保留 ${BAL.tabCarry} 点格挡`],
    ['stamp', `回复 ${BAL.stampHeal} 点生命`],
    ['tea', `额外 +${BAL.teaMaxHp}`],
    ['shelf', `上限 +${BAL.shelfCopies}`],
    ['polish', `+${BAL.polishUp}`],
    ['clip', `退回 ${BAL.clipRefund} 点行动力`],
    ['felt', `${BAL.feltJunk} 张杂念`],
    ['atlas', `额外回复 ${BAL.atlasHeal} 点生命`],
    ['wish', `${BAL.wishHp} 点生命`],
    ['spine', `最大生命 +${BAL.spineHp}`],
    ['exlibris', `获得 ${BAL.exlibrisCards} 张`],
    ['slim', `移除 ${BAL.slimRemove} 张`],
    ['feather', `获得 ${BAL.featherBlock} 点格挡`],
    ['ink', `第 ${BAL.inkAt} 张`],
    ['archive', `获得 ${BAL.archiveBlock} 点格挡`],
    ['pulse', `打出 ${BAL.pulseCards} 张`],
    ['varnish', `抽 ${BAL.varnishDraw} 张`],
    ['seed', `获得 ${BAL.seedBlock} 点格挡`],
    ['gluepot', '留在手里'],
    ['sticky', `三张变${['', '一', '二', '三', '四', '五'][BAL.rewardPicks + BAL.stickyChoice]}张`],
  ];
  const miss = face.filter(([id, phrase]) => {
    const p = POWERS.find((x) => x.id === id);
    if (!p) return true;
    return !`${p.card}${p.desc ?? ''}`.includes(phrase);
  });
  ok(!miss.length,
    `增益卡面的数字跟数值表一致（${miss.length ? `对不上：${miss.map(([id]) => id).join('、')}` : `${face.length} 条`}）`);

  // 封蜡的数值也走模板派生：卡面写 -8，代码里就得减 8。
  const seal = POWERS.find((p) => p.id === 'seal')!;
  ok(seal.card.includes(`-${BAL.sealCut}`),
    `封蜡是减 ${BAL.sealCut} 点，卡面与代码一致`);

  // 阈值也是规则的一部分：卡面写「第 N 张」，代码就得在第 N 张触发。
  const ink = POWERS.find((p) => p.id === 'ink')!;
  ok(ink.card.includes(`第 ${BAL.inkAt} 张`),
    `墨水瓶卡面写的第 ${BAL.inkAt} 张就是代码认的那一张`);
}

// ── 10e3. 打出来的数全是整数
//
// 源码层的守卫（`numeric/integer-only`）拦的是**字面量**里的小数，这里拦
// **算出来的**小数：某个 `Math.round` 被顺手删掉、某个系数被改回 0.5，
// 卡面就会出现「4.5 伤害」这种打不出去也读不懂的数。
// 覆盖面是玩家真正看得见的三个地方：全部卡面的每段伤害 / 格挡 / 回血、
// 每一只怪的血量与伤害、数值表里每一个标量。
{
  const frac: string[] = [];
  const int = (where: string, v: number) => {
    if (!Number.isInteger(v)) frac.push(`${where}=${v}`);
  };

  for (const c of [...PACK.cards, ...BASICS]) {
    const f = effFace(planStrike(c.id, { noBoost: true }));
    int(`${c.name}.每段`, f.per);
    int(`${c.name}.段数`, f.hits);
    int(`${c.name}.格挡`, f.blk);
    int(`${c.name}.回血`, f.healMax);
    int(`${c.name}.抽牌`, f.drawMax);
    int(`${c.name}.自伤`, f.selfHp);
    // X 费按点数复制段，每段的数值必须还是整数。
    planStrike(c.id, { noBoost: true, repeat: 3 }).hits.forEach((h, i) =>
      int(`${c.name}.X费第${i + 1}段`, h));
  }
  for (const t of FOES) {
    int(`${t.key}.血`, t.hp);
    int(`${t.key}.每档`, t.hpStep);
    int(`${t.key}.伤害`, t.dmg);
  }
  for (const [k, v] of Object.entries(BAL)) {
    if (typeof v === 'number') int(`BAL.${k}`, v);
  }
  ok(!frac.length, `打出来的数全是整数（${frac.length ? `有小数：${frac.slice(0, 6).join('、')}` : `${PACK.cards.length + BASICS.length} 张牌 / ${FOES.length} 只怪`}）`);
}

// ── 10f. 增益通道
// 每条增益都必须被结算层真的消费。
{
  const before = G.powers.slice();
  const turnBefore = G.turn;
  const deckBefore = G.deck.slice();
  const maxHpBefore = G.maxHp;
  const hpBefore = G.hp;
  G.turn = 1;

  // always：rulesOf() 至少一项与没有它时不同。
  G.powers = [];
  const base = JSON.stringify(rulesOf({ handLeft: 0, hard: true }));
  const silent: string[] = [];
  POWERS.filter((p) => p.scope === 'always').forEach((p) => {
    G.powers = [p.id];
    if (JSON.stringify(rulesOf({ handLeft: 0, hard: true })) === base) silent.push(p.name);
  });
  ok(!silent.length, `每张常驻牌都改了规则表的一项（${silent.length ? `没生效：${silent.join('、')}` : `${POWERS.filter((p) => p.scope === 'always').length} 张全部命中`}）`);

  // fight / stage / run：第一次 true，第二次 false。
  const miss: string[] = [];
  const check = (p: typeof POWERS[number], call: (id: typeof p.id) => boolean, reset: () => void) => {
    G.powers = [p.id];
    reset();
    const first = call(p.id);
    const second = call(p.id);
    if (!first || second) miss.push(p.name);
  };
  POWERS.filter((p) => p.scope === 'fight').forEach((p) => {
    check(p, onceThisFight, () => { G.onceUsed = {}; });
  });
  POWERS.filter((p) => p.scope === 'stage').forEach((p) => {
    check(p, onceThisStage, () => { clearStageOnce(); });
  });
  POWERS.filter((p) => p.scope === 'run').forEach((p) => {
    check(p, onceThisRun, () => { clearRunOnce(); });
  });
  ok(!miss.length, `一次性牌都是一次（${miss.length ? `账没接上：${miss.join('、')}` : '第一次 true / 第二次 false'}）`);

  // instant：拿到那一刻必须改底盘。
  const instantBad: string[] = [];
  POWERS.filter((p) => p.scope === 'instant').forEach((p) => {
    G.deck = BASICS.map((c) => c.id);
    G.maxHp = BAL.baseHp;
    G.hp = BAL.baseHp;
    G.upGrade = 0;
    G.powers = [p.id];
    const fp = () => JSON.stringify([G.maxHp, G.deck.length, G.deck.filter((id) => isUpgraded(id)).length, G.upGrade]);
    const a = fp();
    applyInstant(p.id);
    if (fp() === a) instantBad.push(p.name);
  });
  ok(!instantBad.length, `每张「拾取即结算」的牌都改了底盘（${instantBad.length ? `没生效：${instantBad.join('、')}` : '5 张全部命中'}）`);

  G.powers = before;
  G.turn = turnBefore;
  G.deck = deckBefore;
  G.maxHp = maxHpBefore;
  G.hp = hpBefore;
  G.upGrade = 0;
  G.onceUsed = {};
  clearStageOnce();
  clearRunOnce();
}

// 结算路径：装订线与荧光笔的效果要真的发生。
{
  // 装订线：答错时这一手照样打出去，伤害按费用削减。
  const e = battle(1, 'examiner');
  const plain = PACK.cards.find((c) => c.kind === 'knowledge' && c.eff === 'strike' && c.cost === 1)!;
  G.powers = ['binder'];
  G.ap = 9;
  G.hand[0] = plain.id;
  e.hp = 999;
  const hp0 = e.hp;
  askCard(0);
  if (panelKind() !== 'question') throw new Error('装订线测试：没弹题');
  const p = panelOf('question')!;
  // 取模：正确选项可能是最后一个，越界会被 answer() 忽略。
  answer((p.view.answer + 1) % p.view.options.length);
  const dealt = hp0 - e.hp;
  if (panelKind() === 'feedback') dismissFeedback();
  const plainPer = effFace(planStrike(plain.id, { noBoost: true })).per;
  const want = Math.max(0, plainPer - BAL.binderAtkCut);
  ok(dealt === want,
    `装订线：答错也打出削减后的伤害（${plainPer} − ${BAL.binderAtkCut} = ${want}，实际 ${dealt}）`);
  // 同一手里两个面板不能说两件相反的事：结算说明写「按一半结算（7 伤害）」，
  // 日志却说「效果作废」。日志只能读这一手到底产出了什么，不能读对错。
  const said = G.log[G.log.length - 1]?.msg ?? '';
  ok(!/效果作废/.test(said), `装订线：日志不再自相矛盾（${said.slice(0, 40)}…）`);

  // 格挡也要减半。
  {
    // 挑真正产生格挡的牌。
    const guard = PACK.cards.find((c) => c.kind === 'knowledge' && c.cost === 1 && c.eff === 'guard' && c.blk > 0)!;
    const blockOf = (powers: string[], wrong: boolean) => {
      battle(1, 'examiner');
      G.powers = powers as never;
      const foe = G.enemy!;
      foe.hp = 999;
      G.ap = 99;
      G.block = 0;
      G.hand[0] = guard.id;
      askCard(0);
      if (panelKind() !== 'question') throw new Error('装订线格挡测试：没弹题');
      const view = (panelOf('question')!).view;
      answer(wrong ? (view.answer + 1) % view.options.length : view.answer);
      const got = G.block;
      if (panelKind() === 'feedback') dismissFeedback();
      return got;
    };
    const full = blockOf([], false);
    const half = blockOf(['binder'], true);
    const wantBlk = Math.max(0, full - BAL.binderBlkCut);
    ok(full > 0 && half === wantBlk,
      `装订线：答错格挡按整数削减（${full} − ${BAL.binderBlkCut} = ${wantBlk}，实际 ${half}）`);
  }

  {
    // 削减必须落在所有加成之后。以前它乘在效果原型里，"续火 ×2"再乘一次，
    // 7 点的牌答错反而打出 8 点（0.5 先取整成 4，再翻倍）。
    const before = effFace(planStrike('c05', { noBoost: true })).per;
    const cut = BAL.binderAtkCut * 2;
    G.nextBoost = { mul: 2, add: 0, from: '续火' };
    const after = effFace(planStrike('c05', { cut: { atk: cut, blk: 0 } }));
    G.nextBoost = null;
    ok(after.per === Math.max(0, before * 2 - cut),
      `装订线：削减落在 ×2 之后（${before} ×2 = ${before * 2}，再减 ${cut} → ${after.per}）`);
  }

  {
  // 复习点的选牌取消后回到复习面板，不能把节点空丢在半路。
  startRun();
  G.node = { r: 1, i: 0, key: '1:0', col: 0, type: 'rest', next: [] };
  G.panel = { k: 'rest' };
  openCardPick('up', { k: 'rest' });
  ok(panelKind() === 'cardpick', `复习点：打开选牌（${panelKind()}）`);
  cancelPanel();
  ok(panelKind() === 'rest', `复习点：取消回到复习面板（${panelKind()}）`);
}

{
  // 装订线答错已经有伤害，演出不能再播“焰灭”（否则画面上是“没打出去”）。
  const e = battle(1, 'examiner');
  const plain = PACK.cards.find((c) => c.kind === 'knowledge' && c.eff === 'strike' && c.cost === 1 && c.atk > 0)!;
  G.powers = ['binder'];
  G.ap = 9;
  G.hand[0] = plain.id;
  e.hp = 999;
  const seen: string[] = [];
  const off = onFx((ev) => { if (ev.t === 'dmg' || ev.t === 'fizzle') seen.push(ev.t); });
  askCard(0);
  if (panelKind() !== 'question') throw new Error('装订线演出测试：没弹题');
  const view = (panelOf('question')!).view;
  answer((view.answer + 1) % view.options.length);
  off();
  if (panelKind() === 'feedback') dismissFeedback();
  ok(seen.includes('dmg') && !seen.includes('fizzle'),
    `装订线：半结算发光刃、不播焰灭（${seen.join('/') || '无事件'}）`);
}

{
  // 0 伤害的知识卡（纯防御）答对不发光刃，也不该演成答错。
  const e = battle(1, 'examiner');
  const zero = PACK.cards.find((c) => c.id === 'c96')!;
  G.powers = [];
  G.ap = 9;
  G.hand[0] = zero.id;
  e.hp = 999;
  e.block = 0;
  const seen: string[] = [];
  const off = onFx((ev) => { if (ev.t === 'dmg' || ev.t === 'fizzle') seen.push(ev.t); });
  askCard(0);
  if (panelKind() !== 'question') throw new Error('0 伤害测试：没弹题');
  answer((panelOf('question')!).view.answer);
  off();
  if (panelKind() === 'feedback') dismissFeedback();
  ok(!seen.includes('dmg') && !seen.includes('fizzle'),
    `纯防御知识卡：0 伤害不发光刃、不焰灭（${seen.join('/') || '无事件'}）`);
}

{
  // 压书石必须进答题面板文案。裸/带加成两次都走同一个 planStrike，
  // 只是 G.powers 不同：不存在「裸卡面」这个独立数值入口。
  const c = PACK.cards.find((x) => x.kind === 'knowledge' && x.cost === 1 && x.eff === 'strike' && x.atk > 0 && !x.mods?.selfHp)!;
  G.powers = [];
  const plainOut = planStrike(c.id, { noBoost: true });
  const plain = effSummaryOf(plainOut, c.eff);
  G.powers = ['press'];
  const out = planStrike(c.id, { noBoost: true });
  const buffed = effSummaryOf(out, c.eff);
  ok(buffed !== plain && effFace(out).per === effFace(plainOut).per + BAL.pressAtk,
    `压书石：答题面板文案 +${BAL.pressAtk}（${effFace(plainOut).per} → ${effFace(out).per}）`);
  G.powers = [];
}

{
  // 「续火 ×2」必须作用在这一手已经算好的每段伤害上。以前它乘在攻击底数里，
  // 串联原型再乘 0.52 并取整，atk 7 的串联牌只能从 4 变 7，翻倍名不副实。
  const c = PACK.cards.find((x) => x.eff === 'chain' && x.atk === 7)!;
  const plain = effFace(planStrike(c.id, { noBoost: true })).per;
  G.nextBoost = { mul: 2, add: 0, from: '续火' };
  const doubled = effFace(planStrike(c.id)).per;
  ok(doubled === plain * 2,
    `续火 ×2 落在结果层：串联 ${plain} → ${doubled}（应 ${plain * 2}）`);
  G.nextBoost = null;
}

{
  // 「续火」留的 ×2 只被**打得出伤害**的牌兑现。0 伤害的牌（合页 / 归零点 /
  // 没甲的铸甲为刃）以前会把加成悄悄吃掉，说明里还写着"已兑现"。
  battle(1, 'examiner');
  G.powers = [];
  G.nextBoost = null;
  G.cardPlays = {};
  G.cardsThisTurn = 0;
  G.enemy!.hp = 999;
  G.enemy!.block = 0;
  const plainPer = effFace(planStrike('c05', { noBoost: true })).per;

  buildSettlement('c85'); // 续火：给下一张留 ×2
  const zero = buildSettlement('c93'); // 合页：0 伤害
  ok(!!G.nextBoost && zero.hits.every((h) => h.raw === 0),
    '续火：0 伤害的牌不消耗 ×2，加成留给下一张');

  const hit = buildSettlement('c05');
  ok(!G.nextBoost && hit.hits[0].raw === plainPer * 2,
    `续火：下一张有伤害的牌才兑现（${plainPer} → ${hit.hits[0].raw}）`);
}

{
  // 段级执行：四段牌要发四次 dmg 事件，每次只写自己那一段，预演与落地一致。
  // 同步调度器下四段会连续落地，掉血总量仍必须等于 parts 之和。
  battle(1, 'examiner');
  G.powers = [];
  G.nextBoost = null;
  G.charge = {};
  G.hand[0] = 'c43';
  G.ap = 2;
  G.enemy!.hp = 999;
  G.enemy!.block = 0;
  const seen: number[] = [];
  const off = onFx((ev) => { if (ev.t === 'dmg') seen.push(ev.n); });
  askCard(0);
  // 和文件里其它答题断言一样走 panelKind()：直接读 G.panel.k 会被 tsc 按
  // 上一个块的赋值窄化成一个不可能的分支。
  if (panelKind() === 'question') {
    answer((panelOf('question')!).view.answer);
  }
  off();
  const fb = lastFeedback();
  const dropped = 999 - G.enemy!.hp;
  ok(!!fb && fb.hits.length === 4 && seen.length === 4
      && seen.join('+') === fb.parts.map((p) => p.d).join('+')
      && dropped === fb.dmg,
    `多段逐段落地：${fb?.hits.join('+')} / 事件 ${seen.join('+')} / 掉血 ${dropped}`);
  if (panelKind() === 'feedback') dismissFeedback();
}

{
  // 位置依赖是数据属性：题库显式写 ! 固定顺序 才不打乱；没声明的题在
  // 解析期就被拦下，而不是等出题时用正则猜「以上都对」。
  const body = '### 位置测试\nA) 甲\nB) 以上都对\n= B\n';
  const flagged = parseQuestionBank(body + '! 固定顺序\n');
  const missing = parseQuestionBank(body);
  const q = flagged.byTopic['未分类']?.[0];
  const normal = parseQuestionBank('### 普通题\nA) 甲\nB) 乙\n= B\n').byTopic['未分类']?.[0];
  ok(flagged.issues.length === 0 && missing.issues.length === 1
      && q?.noShuffle === true && shuffleOptions(q!).answer === 1
      && !normal?.noShuffle,
    `题库自描述：声明 ${flagged.issues.length} 条问题 / 未声明 ${missing.issues.length} 条 / 固定顺序答案 ${q ? shuffleOptions(q).answer : '-'}`);
}

{
  // 敌人侧与玩家侧共用同一个执行器：三段攻击发三次 enemyHit，每次事件发出时
  // 只掉了那一段血；回合推进排在所有段之后，不会在动画中途就抽好下一手牌。
  battle(1, 'examiner');
  G.powers = [];
  G.panel = { k: 'none' };
  G.pending = null;
  G.busy = false;
  G.turn = 2;
  G.block = 0;
  G.hp = 100;
  G.maxHp = 100;
  const e = G.enemy!;
  delete e.mech;
  delete e.mechV;
  e.dmg = 20;
  e.mv = 0;
  e.moves = [{ k: 'atk', times: 3 }];
  const seen: { n: number; hp: number }[] = [];
  const off = onFx((ev) => { if (ev.t === 'enemyHit') seen.push({ n: ev.n, hp: G.hp }); });
  endTurn();
  off();
  const per = seen[0]?.n ?? 0;
  ok(seen.length === 3 && per > 0
      && seen.every((x, i) => x.n === per && x.hp === 100 - per * (i + 1))
      && G.hp === 100 - per * 3 && G.turn === 3,
    `敌人三段逐段落地：${seen.map((x) => `${x.n}@${x.hp}`).join(' / ')} / 剩余 ${G.hp} / 回合 ${G.turn}`);
}

{
  // 本章统计只由答题累加，和 answers 环形缓冲脱钩。
  battle(1, 'examiner');
  G.powers = [];
  G.ap = 9;
  G.charge = {};
  G.hand[0] = 'c05';
  askCard(0);
  if (panelKind() !== 'question') throw new Error('本章统计测试：没弹题');
  answer((panelOf('question')!).view.answer);
  ok(G.stageOk === 1, `本章答对计数 +1（${G.stageOk}）`);
  if (panelKind() === 'feedback') dismissFeedback();

  G.charge = {};
  G.hand[0] = 'c06';
  askCard(0);
  if (panelKind() !== 'question') throw new Error('本章统计测试：第二次没弹题');
  const v2 = (panelOf('question')!).view;
  answer((v2.answer + 1) % v2.options.length);
  ok(G.stageBad === 1, `本章答错计数 +1（${G.stageBad}）`);
  if (panelKind() === 'feedback') dismissFeedback();
}

// 借书证：2 费答对退回 1 点。
  {
    const two = PACK.cards.find((c) => c.kind === 'knowledge' && c.cost === 2)!;
    const after = (powers: string[]) => {
      battle(1, 'examiner');
      G.powers = powers as never;
      G.ap = 3;
      G.charge = {};
      G.markerRefund = 0;
      G.okThisTurn = 0;
      G.hand[0] = two.id;
      askCard(0);
      if (panelKind() !== 'question') throw new Error('借书证测试：没弹题');
      answer((panelOf('question')!).view.answer);
      const left = G.ap;
      if (panelKind() === 'feedback') dismissFeedback();
      return left;
    };
    const without = after([]);
    const withCard = after(['librarycard']);
    ok(without === 1, `没有借书证：2 费答对净花 2 点（3 → ${without}）`);
    ok(withCard === 2, `借书证：2 费答对退回 1 点（3 → ${withCard}）`);
  }

  // 荧光笔：每回合第一次答对多退 1 点。
  battle(1, 'examiner');
  G.powers = ['marker', 'librarycard'];
  const card = PACK.cards.find((c) => c.kind === 'knowledge' && c.cost === 1)!;
  G.ap = 3;
  G.charge = {};
  G.markerRefund = 0;
  G.okThisTurn = 0;
  G.hand[0] = card.id;
  askCard(0);
  if (panelKind() !== 'question') throw new Error('荧光笔测试：没弹题');
  answer((panelOf('question')!).view.answer);
  if (panelKind() === 'feedback') dismissFeedback();
  ok(G.ap === 4, `荧光笔 + 借书证：1 费牌答对退 2 点（3 - 1 + 2 = ${G.ap}）`);
}

// ── 10b. 一场一次
// 八张牌共用 G.onceUsed，重点是只响一次且换场重来。
{
  const card = PACK.cards.find((c) => c.kind === 'knowledge' && c.cost === 1)!;
  const missAndReadBlock = () => {
    G.ap = 9;
    G.charge = {};
    G.hand[0] = card.id;
    G.block = 0;
    askCard(0);
    if (panelKind() !== 'question') throw new Error('一次性的账：没弹题');
    const p = panelOf('question')!;
    answer((p.view.answer + 1) % p.view.options.length);
    const got = G.block;
    if (panelKind() === 'feedback') dismissFeedback();
    return got;
  };

  battle(1, 'examiner');
  G.powers = ['eraser'];
  G.enemy!.hp = 999;
  ok(missAndReadBlock() === BAL.eraserBlock,
    `橡皮：第一次答错补 ${BAL.eraserBlock} 点格挡`);
  ok(missAndReadBlock() === 0,
    '橡皮：同一场第二次答错不再补 —— 一场一次真的只算一次');

  // 换一场后 startBattle 清账，必须重新可用。
  battle(1, 'examiner');
  G.powers = ['eraser'];
  G.enemy!.hp = 999;
  ok(missAndReadBlock() === BAL.eraserBlock,
    '橡皮：换一场之后重新可用（onceUsed 已在 startBattle 清空）');

  // 没这张牌时 onceThisFight 恒 false，且不写账。
  G.powers = [];
  G.onceUsed = {};
  ok(onceThisFight('eraser') === false, '没有橡皮时 onceThisFight 返回 false');
  ok(!G.onceUsed.eraser, '没这张牌时不会写账（以后拿到它仍然有效）');
}

// ── 10c. 书套 / 批注挂在活机制上
// 这两条增益原来挂在「稳固度 / 到期日」上，而那张表只写不读：卡面写着一条规则，
// 打起来什么也没发生。现在改挂错题簿与免答充能 —— 两个真的会改出题和出牌的东西，
// 所以它们也必须有断言，否则下次重构又只剩文案。
{
  const askMiss = (id: string) => {
    G.ap = 9;
    G.charge = {};
    G.hand[0] = id;
    askCard(0);
    if (panelKind() !== 'question') throw new Error('书套测试：没弹题');
    const p = panelOf('question')!;
    answer((p.view.answer + 1) % p.view.options.length);
    if (panelKind() === 'feedback') dismissFeedback();
  };
  const wrongTotal = () => Object.values(G.topicWrong).reduce((n, v) => n + v, 0);
  const oneCost = PACK.cards.find((c) => c.kind === 'knowledge' && c.cost === 1)!;

  battle(1, 'examiner');
  G.powers = ['slipcase'];
  G.topicWrong = {};
  askMiss(oneCost.id);
  ok(wrongTotal() === 0, `书套：这一场第一次答错不进错题簿（记了 ${wrongTotal()} 条）`);
  askMiss(oneCost.id);
  ok(wrongTotal() === 1, `书套：同一场第二次答错照记（记了 ${wrongTotal()} 条）`);

  battle(1, 'examiner');
  G.powers = [];
  G.topicWrong = {};
  askMiss(oneCost.id);
  ok(wrongTotal() === 1, `没有书套时第一次答错就记（记了 ${wrongTotal()} 条）`);

  const askRight = (id: string) => {
    G.ap = 9;
    G.hand[0] = id;
    askCard(0);
    if (panelKind() !== 'question') throw new Error('批注测试：没弹题');
    answer(panelOf('question')!.view.answer);
    if (panelKind() === 'feedback') dismissFeedback();
  };
  const heavy = PACK.cards.find((c) => c.kind === 'knowledge' && c.cost === 2)!;
  const light = PACK.cards.find((c) => c.kind === 'knowledge' && c.cost === 1)!;

  battle(1, 'examiner');
  G.powers = ['margin'];
  askRight(heavy.id);
  ok(G.charge[heavy.id] === 2,
    `批注：这一场第一道答对，2 费牌直接攒满免答（${G.charge[heavy.id]}/2）`);
  askRight(light.id);
  ok(G.charge[light.id] === 1,
    `批注：一场只多攒一次，第二道答对回到 1（${G.charge[light.id]}）`);
}

// ── 10g. 机制结算
// 规则表有改动不等于结算生效，每条通道跑一次真实结算。
{
  const plain = PACK.cards.find((c) => c.kind === 'knowledge' && c.eff === 'strike' && c.cost === 1)!;
  const panelAns = () => (panelOf('question')!).view;

  const hit = (powers: string[]) => {
    battle(1, 'examiner');
    G.powers = powers as never;
    const e = G.enemy!;
    e.hp = 999;
    e.block = 0;
    G.ap = 9;
    G.charge = {};
    G.hand[0] = plain.id;
    const before = e.hp;
    askCard(0);
    if (panelKind() !== 'question') throw new Error('压书石测试：没弹题');
    answer(panelAns().answer);
    const dealt = before - e.hp;
    if (panelKind() === 'feedback') dismissFeedback();
    return dealt;
  };
  const plainHit = hit([]);
  ok(hit(['press']) === plainHit + BAL.pressAtk,
    `压书石：同一张牌多打 ${BAL.pressAtk} 点（${plainHit} → ${plainHit + BAL.pressAtk}）`);

  const strikeBy = (powers: string[], dmg: number, turns = 1) => {
    battle(1, 'examiner');
    G.powers = powers as never;
    G.maxHp = 200;
    G.hp = 200;
    const e = G.enemy!;
    e.moves = [{ k: 'atk' }];
    e.mv = 0;
    e.dmg = dmg;
    e.mechV = 0;
    for (let i = 0; i < turns; i++) {
      G.block = 0;
      endTurn();
    }
    return 200 - G.hp;
  };
  ok(strikeBy(['nightlight'], 5) === strikeBy([], 5) - BAL.nightCut,
    `夜灯：5 点攻击少受 ${BAL.nightCut} 点`);

  {
    // 夜灯减的是**这一次攻击**，不是每一段：卡面写「每次受到攻击，伤害 -1」。
    // 原来那条 desc 写着"多段攻击的每一下都减"，代码和卡面都没这条规则 ——
    // 句子里编出来的规则比代码宽松，玩家会照着它算血。
    const multi = (powers: string[]) => {
      battle(1, 'examiner');
      G.powers = powers as never;
      G.maxHp = 200;
      G.hp = 200;
      const e = G.enemy!;
      e.moves = [{ k: 'atk', add: -6, times: 3 }];
      e.mv = 0;
      e.dmg = 12; // 每段 6，三段 18
      e.mechV = 0;
      G.block = 0;
      endTurn();
      return 200 - G.hp;
    };
    const plain = multi([]);
    const cut = multi(['nightlight']);
    ok(plain === 18 && cut === plain - BAL.nightCut,
      `夜灯：一次攻击只减 ${BAL.nightCut} 点，多段不叠加（${plain} → ${cut}）`);
  }

  // 封蜡只减第一次。
  const sealTwice = strikeBy(['seal'], 10, 2);
  ok(sealTwice === Math.max(0, 10 - BAL.sealCut) + 10,
    `封蜡：第一次 ${Math.max(0, 10 - BAL.sealCut)} 点，第二次 10 点（合计 ${sealTwice}）`);

  // 胶水壶：答错之后那张牌留在手里。
  const missAndCount = (powers: string[]) => {
    battle(1, 'examiner');
    G.powers = powers as never;
    G.enemy!.hp = 999;
    G.ap = 9;
    G.charge = {};
    G.hand[0] = plain.id;
    const before = G.hand.length;
    askCard(0);
    if (panelKind() !== 'question') throw new Error('胶水壶测试：没弹题');
    answer((panelAns().answer + 1) % panelAns().options.length);
    const after = G.hand.length;
    if (panelKind() === 'feedback') dismissFeedback();
    return { before, after };
  };
  const glued = missAndCount(['gluepot']);
  ok(glued.after === glued.before, `胶水壶：答错后还是 ${glued.after} 张（牌没有离开）`);
  const unglued = missAndCount([]);
  ok(unglued.after === unglued.before - 1, `没有胶水壶时会少一张（${unglued.before} → ${unglued.after}）`);

  // 课表：每回合第一张基础牌补 1 格挡，与题池无关。
  {
    battle(1, 'examiner');
    G.powers = ['syllabus'];
    G.enemy!.hp = 999;
    G.ap = 99;
    G.block = 0;
    G.qLeft = [];
    G.hand[0] = 'base:strike';
    playBasic(0);
    ok(G.block === 1, `课表：第一张基础牌补 1 点（${G.block}）`);

    G.hand[0] = 'base:strike';
    G.block = 0;
    playBasic(0);
    ok(G.block === 0, '课表：同一回合第二张基础牌不再补');

    G.turn += 1;
    startTurn();
    G.hand[0] = 'base:strike';
    G.block = 0;
    playBasic(0);
    ok(G.block === 1, '课表：下一回合重新生效');
  }

  // 许愿条：整局一次，第二次真的会死。
  battle(1, 'examiner');
  G.powers = ['wish'] as never;
  clearRunOnce();
  G.maxHp = 100;
  G.hp = 1;
  const e = G.enemy!;
  e.moves = [{ k: 'atk' }];
  e.mv = 0;
  e.dmg = 99;
  e.mechV = 0;
  endTurn();
  ok(G.hp > 0 && G.pending === null, `许愿条：致死的那一下活下来了（${G.hp}/${G.maxHp}）`);
  G.block = 0;
  endTurn();
  const second: string | null = G.pending;
  ok(second === 'dead', '许愿条：整局只有一次 —— 第二次真的死了');
  G.pending = null;
  G.screen = 'title';
  G.powers = [];
  clearRunOnce();
}

// ── 11. mechV ──
{
  const e = battle(1, 'examiner');
  e.dmg = 10;
  e.moves = [{ k: 'atk' }];
  e.mv = 0;
  e.mechV = 5;
  G.okThisTurn = 0;
  G.block = 0;
  G.turn = 2;
  G.hp = 70;
  endTurn();
  ok(70 - G.hp === 15, `复习官 mechV=5：实际结算 ${70 - G.hp}（10+5）`);

  const o = battle(5, 'oblivion');
  o.dmg = 10;
  o.moves = [{ k: 'atk' }];
  o.mv = 0;
  G.topicWrong = { '基础动词': 1 };
  G.topOkTopic = null;
  G.okThisTurn = 0;
  G.block = 0;
  G.turn = 2;
  G.hp = 70;
  endTurn();
  ok(70 - G.hp === 14, `遗忘：实际结算 ${70 - G.hp}（10+4）`);
}

// ── 12. 内化
// 内化按实际伤害回血，0 伤害不回。
{
  battle(1, 'examiner');
  const drain = PACK.cards.find(
    (c) => c.kind === 'knowledge' && c.eff === 'drain' && c.cost !== 'x',
  )!;

  const cast = () => {
    G.ap = 3;
    G.hand[0] = drain.id;
    // 清空本场计数，强制走弹题分支。
    G.charge = {};
    askCard(0);
    if (G.panel.k !== 'question') throw new Error('内化测试：没弹题');
    answer(G.panel.view.answer);
    const fb = lastFeedback();
    if (!fb) throw new Error('内化测试：没有判定结果');
    dismissFeedback();
    return fb;
  };

  G.hp = 40;
  const normal = cast();
  ok(normal.dmg > 0 && normal.heal > 0, `内化：${normal.dmg} 伤害回 ${normal.heal} 点`);

  startTurn();
  G.hp = 40;
  G.enemy!.block = 999;
  const blocked = cast();
  ok(blocked.dmg === 0 && blocked.heal === 0 && G.hp === 40,
    `内化：被全挡后 0 伤害回 ${blocked.heal} 点（血量 ${G.hp}）`);

  startTurn();
  G.enemy!.block = 0;
  G.hp = G.maxHp;
  const full = cast();
  ok(full.dmg > 0 && full.heal === 0 && G.hp === G.maxHp,
    `内化：满血时打出 ${full.dmg} 伤害，实回 ${full.heal} 点`);
}

// ── 13. 反伤
// 每次打出攻击都反伤，被格挡吃光也算；纯格挡不算。
{
  const e = battle(3, 'ghostprint');
  G.hp = 40;
  e.block = 999;
  const before = G.hp;
  const i = G.hand.findIndex((c) => canAsk(c) && canPay(defOf(c)));
  if (i < 0) throw new Error('反伤测试：手里没有能答的牌');
  askCard(i);
  const p1 = panelOf('question');
  if (!p1) throw new Error('反伤测试：没弹题');
  answer(p1.view.answer);
  if (panelKind() === 'feedback') dismissFeedback();
  const th = e.mechV ?? BAL.mech.thorns;
  ok(G.hp === before - th, `影印：攻击被全挡也反伤 ${th} 点（${before} → ${G.hp}）`);

  // 反伤可以致死；要挑一张不带回血的牌。
  const e2 = battle(3, 'ghostprint');
  const plain = PACK.cards.find(
    (c) => c.kind === 'knowledge' && c.eff === 'strike' && c.cost !== 'x',
  )!;
  G.hp = 1;
  e2.block = 0;
  G.ap = 9;
  G.hand[0] = plain.id;
  askCard(0);
  const p2 = panelOf('question');
  if (!p2) throw new Error('反伤致死测试：没弹题');
  answer(p2.view.answer);
  ok(G.hp <= 0 && (G.pending as string | null) === 'dead',
    `反伤致死：1 点血打影印 → ${G.hp}，判负`);
  if (panelKind() === 'feedback') dismissFeedback();

  // 击杀那一击不反伤。
  const e4 = battle(3, 'ghostprint');
  e4.hp = 1;
  e4.maxHp = 1;
  G.hp = 1;
  G.ap = 9;
  G.hand[0] = plain.id;
  askCard(0);
  const p4 = panelOf('question');
  if (!p4) throw new Error('反伤击杀测试：没弹题');
  answer(p4.view.answer);
  ok(G.hp === 1 && (G.pending as string | null) === 'clear',
    `击杀不反伤：血量 ${G.hp}，判定 ${G.pending}`);
  if (panelKind() === 'feedback') dismissFeedback();

  // 纯格挡基础牌不算一次攻击。
  const e3 = battle(3, 'ghostprint');
  G.hp = 40;
  e3.block = 999;
  G.hand[0] = 'base:guard';
  G.ap = 3;
  playBasic(0);
  ok(G.hp === 40, `基础格挡没有攻击段，不触发反伤（${G.hp}）`);
}

// ── 14. 意图
// 意图显示结算后的数。
{
  const e = battle(1, 'examiner');
  e.dmg = 10;
  e.moves = [{ k: 'atk' }];
  e.mv = 0;
  e.mechV = 5;
  G.okThisTurn = 0;
  ok(intentText(e).text === '15', `复习官意图：没答对时写 15（${intentText(e).text}）`);
  G.okThisTurn = 1;
  ok(intentText(e).text === '10', `复习官意图：答对后回到 10（${intentText(e).text}）`);

  const o = battle(5, 'oblivion');
  o.dmg = 10;
  o.moves = [{ k: 'atk' }];
  o.mv = 0;
  G.topicWrong = { '基础动词': 1 };
  G.topOkTopic = null;
  ok(intentText(o).text === '14', `遗忘意图：错题主题 +4 → 14（${intentText(o).text}）`);
  G.topOkTopic = '基础动词';
  ok(intentText(o).text === '11', `遗忘意图：该主题答对 -3 → 11（${intentText(o).text}）`);

  // 多段 + 修正时标签写总数。
  o.moves = [{ k: 'atk', add: -4, times: 2 }];
  o.mv = 0;
  ok(intentText(o).text === '13', `遗忘多段意图写总数 13（${intentText(o).text}）`);
  G.block = 0;
  G.hp = 70;
  G.turn = 2;
  endTurn();
  ok(70 - G.hp === 13, `遗忘：意图 13 与结算同源（实受 ${70 - G.hp}）`);
}

// ── 15. 卡 id
// 记忆表（稳固度 / 到期）已经删掉：它只写不读，`npm run sim` 连跑都不受影响。
// 留下的是 id 本身 —— 存档、牌组、免答计数都按它认牌，所以它必须是稳定短键。
{
  const ids = PACK.cards.map((c) => c.id);
  ok(ids.length === 101 && ids.every((id) => /^c\d{2,3}$/.test(id)), 'card id 是稳定短键，不含题干');
  ok(new Set(ids).size === ids.length, 'card id 不重复');
}

// ── 16. 存档
// 版本或形状对不上就当没有存档。
{
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as Storage;

  const base = {
    v: SNAP_V, stage: 1, mode: null, hp: 50, maxHp: 70,
    deck: ['base:strike'], powers: [],
    map: genStage(1), pos: null, seen: {}, eventsSeen: [], topicWrong: {},
    floors: 0, runOk: 0, runBad: 0, stageOk: 0, stageBad: 0, answerDraws: 0,
    qPicked: {}, onceStage: [], onceRun: [], upGrade: 0,
  };
  const put = (snap: unknown) => {
    clearRun();
    store.set(SAVE_KEY, JSON.stringify(snap));
  };

  put(base);
  ok(runSaveInfo()?.stage === 1, '合法存档可读');
  put({ ...base, v: SNAP_V - 1 });
  ok(runSaveInfo() === null, '旧版本号存档被拒绝');
  put({ ...base, qPicked: { q_demo: -1 } });
  ok(runSaveInfo() === null, '题目曝光计数为负的存档被拒绝');

  put({ ...base, mode: 'study' });
  ok(runSaveInfo()?.stage === 1, '带模式的存档可读');
  resumeRun();
  ok(G.mode === 'study', 'mode 随断点存回来');

  put({ ...base, qPicked: { q_demo: 2 }, stageOk: 3, stageBad: 1 });
  resumeRun();
  ok(G.qPicked.q_demo === 2, `题目曝光计数随断点存回来（${G.qPicked.q_demo}）`);
  ok(G.stageOk === 3 && G.stageBad === 1,
    `本章答题计数随断点存回来（${G.stageOk} / ${G.stageBad}）`);

  const oldId = Object.keys(LEGACY_CARD_IDS)[0];
  put({ ...base, deck: [oldId] });
  ok(runSaveInfo() !== null, '旧卡 id 存档迁移到新 card id');

  // 精炼后缀要能原样读回。
  put({ ...base, deck: ['base:strike+', 'base:strike'] });
  ok(runSaveInfo() !== null, '带精炼后缀的牌组可读');
  resumeRun();
  ok(G.deck[0] === 'base:strike+' && G.deck[1] === 'base:strike',
    `精炼状态随 id 存回来（${G.deck.join(' / ')}）`);
  ok(statOf(G.deck[0]).atk === 7 && statOf(G.deck[1]).atk === 4,
    `读档后只有精炼的那一张是 7 伤（${statOf(G.deck[0]).atk} / ${statOf(G.deck[1]).atk}）`);

  // 牌组里出现 pow: 是坏档。
  put({ ...base, deck: ['pow:hourglass+'] });
  ok(runSaveInfo() === null, '牌组里的 pow: 被拒绝');

  // 增益随断点存回来。
  put({ ...base, powers: ['hourglass', 'lamp'] });
  ok(runSaveInfo() !== null, '带增益的存档可读');
  resumeRun();
  ok(G.powers.length === 2 && G.powers[0] === 'hourglass' && G.powers[1] === 'lamp',
    `增益随断点存回来（${G.powers.join(' / ')}）`);
  put({ ...base, powers: ['hourglass', 'hourglass'] });
  ok(runSaveInfo() === null, '重复的增益被拒绝（每种只有一个）');
  put({ ...base, powers: ['nope'] });
  ok(runSaveInfo() === null, '未知增益 id 被拒绝');
  put({ ...base, powers: undefined });
  ok(runSaveInfo() === null, '缺 powers 字段的存档被拒绝（v5 形状）');

  // v7 的三个字段缺一即坏档。
  for (const key of ['onceStage', 'onceRun'] as const) {
    const bad: Record<string, unknown> = { ...base };
    delete bad[key];
    put(bad);
    ok(runSaveInfo() === null, `缺 ${key} 字段的存档被拒绝（v6 形状）`);
  }
  put({ ...base, onceRun: ['nope'] });
  ok(runSaveInfo() === null, '未知 id 的 onceRun 账被拒绝');
  put({ ...base, onceRun: ['wish'], upGrade: 2 });
  ok(runSaveInfo() !== null, '带「整局一次」账与精炼加成的存档可读');
  resumeRun();
  ok(G.onceRun.wish === true, '读档后许愿条仍然是"已经用掉"的状态');
  ok(upGain() === 3 + 2, `抛光布的加成随断点存回来（精炼 +${upGain()}）`);

  // 旧版本整份作废。
  put({ ...base, v: 2, upgraded: {} });
  ok(runSaveInfo() === null, 'v2 格式的存档被拒绝（格式变了就抬版本号）');
  put({ ...base, v: 1, deck: [{ id: 'base:strike', up: 0 }] });
  ok(runSaveInfo() === null, 'v1 格式的存档被拒绝');

  put({ ...base, stage: 2.5 });
  ok(runSaveInfo() === null, '小数 stage 被拒绝');

  put({ ...base, mode: 'foo' });
  ok(runSaveInfo() === null, '非法 mode 被拒绝');

  put({ ...base, map: [[{}]] });
  ok(runSaveInfo() === null, '坏地图被拒绝');

  const badLink = genStage(1);
  badLink[0][0].next = [99];
  put({ ...base, map: badLink });
  ok(runSaveInfo() === null, '越界的 map.next 被拒绝');

  put({ ...base, deck: ['__nope'] });
  ok(runSaveInfo() === null, '未知卡 id 被拒绝');

  // 牌组里出现杂念 id 一定是坏档：`defOf` 会把它解析成打不出去的牌。
  put({ ...base, deck: ['__junk'] });
  ok(runSaveInfo() === null, '牌组里的杂念被拒绝');

  put({ ...base, deck: ['pow:log', 'base:strike'] });
  ok(runSaveInfo() !== null, '旧存档里的错题本被迁移掉，不丢掉整局');

  const badKey = genStage(1);
  badKey[0][0].key = '9:9';
  put({ ...base, map: badKey });
  ok(runSaveInfo() === null, 'key 与坐标对不上的节点被拒绝');

  const badR = genStage(1);
  badR[0][0].r = 3;
  put({ ...base, map: badR });
  ok(runSaveInfo() === null, 'r 与行号对不上的节点被拒绝');

  const badCol = genStage(1);
  badCol[0][0].col = 9;
  put({ ...base, map: badCol });
  ok(runSaveInfo() === null, '越界的 col 被拒绝');
}

// ── 17. 阶段题库：每一幕切自己那一章，卡与题解耦 ─────────────
// 这条是给"每 stage 一个 bank"的契约：点开哪张牌不重要，重要的是当前幕。
{
  resetStageMemory();
  loadQuestionBank(mergePacks(
    [readFileSync(join(here, '..', 'packs', 'words.md'), 'utf8')],
    '阶段题库测试',
  ));
  startRun();
  G.node = G.map[0][0];
  startBattle(G.node);
  G.ap = 9;

  ok(allQuestions().length > 0 && allQuestions().every((q) => q.topic === '基础动词'),
    `第 1 幕题库只含「基础动词」（${allQuestions().length} 道）`);
  ok(allQuestions().every((q) => q.qid.startsWith('q_')), '每道题都有稳定题号');

  // 故意挑一张**不属于本章**的知识卡：卡和题解耦后，它照样问本章的题。
  // 起手只有 2 张随机知识卡，手牌里不一定有其它主题的；直接塞一张进手牌。
  const other = PACK.cards.find((c) => c.kind === 'knowledge' && c.topic !== '基础动词' && (c.cost ?? 1) === 1)!;
  G.hand[0] = other.id;
  const idx = 0;
  ok(idx >= 0, '手牌里有非本章主题的知识卡');
  const cardTopic = idx >= 0 ? defOf(G.hand[idx]).topic : '';
  askCard(idx);
  const p1 = panelOf('question')!;
  ok(p1.k === 'question' && p1.topic === '基础动词' && p1.topic !== cardTopic,
    `非本章卡问本章题（卡「${cardTopic}」→ 题「${p1.topic}」）`);
  ok(!!p1.qid && allQuestions().some((q) => q.qid === p1.qid), 'Panel 带题号，且题号属于当前阶段题库');
  answer(p1.view.answer);
  if (panelKind() === 'feedback') dismissFeedback();
  ok(stageMemOf('基础动词').ok > 0, '答题记进本章记忆（按题号，不按卡）');

  G.stage = 2;
  G.map = genStage(2);
  G.node = G.map[0][0];
  // 换幕之后要重新切题库、重新预抽本场的题：题池在开战时就算好了，
  // 只改 G.stage 的话面板里还是上一章的题。
  enterStage(2);
  drawBattleQuestions();
  G.ap = 9;
  // 起手只有 2 张知识卡，上一手已经打掉一张；换章之前先补一张进手牌，
  // 否则这里测的是"手里没牌"，不是"题库换了"。
  const anyK = PACK.cards.find((c) => c.kind === 'knowledge' && (c.cost ?? 1) === 1)!;
  G.hand[0] = anyK.id;
  G.charge = {};
  const idx2 = G.hand.findIndex((e) => cardKind(defOf(e)) === 'knowledge');
  askCard(idx2);
  const p2 = panelOf('question')!;
  ok(p2.k === 'question' && p2.topic === '生活名词',
    `换到第 2 幕后题目来自「生活名词」（实际「${p2.topic}」）`);
}

// ── 18. 题库可替换，卡牌和 card id 不动 ─────────────────────
// 这是给后面 agent 动态更新题库留的边界：BANK 是 let，PACK/CATALOG 是常量。
{
  const custom = `# Agent 题库

## 自定义主题

### 1+1=?
A) 1
B) 2
C) 3
= B
+ 二
`;
  const loaded = loadQuestionBank(custom);
  ok(loaded.ok, `外部题库可载入（${loaded.msg}）`);

  startRun();
  G.node = G.map[0][0];
  startBattle(G.node);
  G.ap = 9;
  const before = G.deck.join('|');
  // 起手 2 张知识卡可能都是 C 级（0 费），那就不出题；塞一张 B 级进去保证这一手要问。
  const bCard = PACK.cards.find((c) => cardGrade(c) === 'B')!;
  G.hand[0] = bCard.id;
  const i = G.hand.findIndex((e) => canAsk(e));
  if (i < 0) throw new Error('题库替换测试：没有可问的牌');
  askCard(i);
  const p = panelOf('question')!;
  ok(p.k === 'question' && p.q?.q === '1+1=?', '题目来自新题库');
  ok(G.deck.join('|') === before, '换题库不改变牌组/card id');
  ok(PACK.cards.length === 101, 'PACK 仍是 101 张固定卡（83 张卡池 + 4 张联动卡 + 14 张扩充卡）');
}

// ── 19. v0.5 四条新规则 ────────────────────────────────────
// 每条钉一个具体规则：答错不扣行动力、取消不锁牌、等级攒满免答、每题本局最多 3 次。
{
  loadQuestionBank(mergePacks(
    [readFileSync(join(here, '..', 'packs', 'words.md'), 'utf8')],
    'v05',
  ));
  startRun();
  G.node = G.map[0][0];
  startBattle(G.node);
  G.ap = 3;

  // (a) 等级：按费用分 C/B/A/S，需求 0/1/2/3
  const byCost = (c: number | 'x') => PACK.cards.find((x) => (x.cost ?? 1) === c)!;
  ok(cardGrade(byCost(0)) === 'C' && gradeNeed(byCost(0)) === 0, '0 费 = C，不用答题');
  ok(cardGrade(byCost(1)) === 'B' && gradeNeed(byCost(1)) === 1, '1 费 = B，答对 1 次免答');
  ok(cardGrade(byCost(2)) === 'A' && gradeNeed(byCost(2)) === 2, '2 费 = A，答对 2 次免答');
  ok(cardGrade(byCost(3)) === 'S' && gradeNeed(byCost(3)) === 3, '3 费 = S，答对 3 次免答');
  ok(cardGrade(byCost('x')) === 'S', 'X 费 = S');

  // (b) 开战预抽题：题量按牌组算，且不超过本局配额
  const want = battleQuestionCount(G.deck);
  ok(G.qLeft.length === want, `开战预抽 ${G.qLeft.length} 道题（应 ${want}）`);
  const picked = G.qLeft.map((q) => q.qid);
  ok(new Set(picked).size === picked.length, '预抽的题不重复');

  // (c) 答错：不扣行动力、不锁牌、消耗一道题
  const cb = PACK.cards.find((x) => cardGrade(x) === 'B')!;
  const qBefore = G.qLeft.length;
  const apBefore = G.ap;
  G.hand[0] = cb.id;
  /** 读当前题目视图；TS 在长脚本里会把 G.panel 窄化成上一步的形状，用显式形状接住。 */
  const qv = () => (panelOf('question')!).view;
  askCard(0);
  if (panelKind() !== 'question') throw new Error('v0.5：答错测试没弹题');
  answer((qv().answer + 1) % qv().options.length);
  if (panelKind() === 'feedback') dismissFeedback();
  ok(G.ap === apBefore, `答错不扣行动力（${apBefore} → ${G.ap}）`);
  ok(G.qLeft.length === qBefore - 1, `答错消耗一道题（${qBefore} → ${G.qLeft.length}）`);
  ok(!G.charge[cb.id], '答错不计入免答次数');

  // (d) 等级攒满：答对 X 次之后，这一场直接打、不再出题
  G.charge = {};
  for (let i = 0; i < gradeNeed(cb); i++) {
    G.ap = 3;
    G.hand[0] = cb.id;
    askCard(0);
    if (panelKind() !== 'question') throw new Error(`v0.5：第 ${i + 1} 次答题没弹题`);
    answer(qv().answer);
    if (panelKind() === 'feedback') dismissFeedback();
  }
  ok(G.charge[cb.id] === gradeNeed(cb), `B 级攒满 ${G.charge[cb.id]}/${gradeNeed(cb)} 次`);
  ok(cardAskState(cb.id) === 'free', '攒满之后这张牌是 free（不再出题）');
  const qBeforeFree = G.qLeft.length;
  const hpBefore = G.enemy!.hp;
  G.ap = 3;
  G.hand[0] = cb.id;
  playFree(0);
  ok(G.qLeft.length === qBeforeFree, '免答直打不消耗题目');
  ok(G.enemy!.hp < hpBefore, `免答直打照样结算伤害（${hpBefore} → ${G.enemy!.hp}）`);
  if (panelKind() === 'feedback') dismissFeedback();

  // (e) 每场战斗都在 startBattle 里清空等级计数；跨场不清就会变成永久免答
  G.node = G.map[0][0];
  startBattle(G.node);
  ok(!G.charge[cb.id], '新一场战斗清空免答计数');
  ok(G.qLeft.length === battleQuestionCount(G.deck), '新一场战斗重新预抽题目');

  // (f) 一道题本局最多被抽到 3 次
  G.qPicked = {};
  G.qLeft = [];
  const one = allQuestions()[0];
  for (let i = 0; i < 3; i++) { G.qLeft = [one]; takeQuestion(); }
  ok(G.qPicked[one.qid] === MAX_PICK_PER_RUN, `同一道题被抽到 ${G.qPicked[one.qid]} 次（上限 ${MAX_PICK_PER_RUN}）`);
  G.qLeft = [one];
  const over = takeQuestion();
  ok(over === null || over.qid !== one.qid, '第 4 次不再给出这道题');

  // (g) 新题用完之后不锁牌：池空时进入复用路径，知识卡仍然能点
  G.qLeft = [];
  const reuse = takeQuestion();
  ok(reuse !== null, '新题用完仍然能出题（复用本章问得最少的题）');
  const kb = PACK.cards.find((c) => cardGrade(c) === 'A')!;
  ok(cardAskState(kb.id) === 'ask', '新题用完，知识卡仍是 ask（不会锁牌）');

  // (h) C 级牌不占题量：10 张 C（0 点）+ 10 张 A（2 点）= 20 点 → round(12)+3 = 15
  const cC = PACK.cards.find((c) => cardGrade(c) === 'C')!;
  const aC = PACK.cards.find((c) => cardGrade(c) === 'A')!;
  const cDeck = [...Array(10).fill(cC.id), ...Array(10).fill(aC.id)];
  ok(battleQuestionCount(cDeck) === 15,
    `C 级不占题量（10 C + 10 A → ${battleQuestionCount(cDeck)} 道，应 15）`);
}

// ── 13. 资源写入的不变量 ──────────────────────────────────
// `infra/write.ts` 守的是三种资源各自的那条线。这些断言不是在测实现细节：
// 每一条都对应一次真出过、或者差点出现的 bug（X 费牌连开三张、满血飘 +N、
// 事件把人打死、纯攻牌凭空长甲）。
{
  G.maxHp = 70;
  G.hp = 50;
  ok(healHp(100) === 20 && G.hp === 70, 'healHp 封顶在 maxHp（50 + 100 → 70）');
  ok(healHp(5) === 0 && G.hp === 70, '满血时 healHp 返回 0，演出不会凭空飘 +5');

  G.hp = 10;
  ok(loseHp(3) === 3 && G.hp === 7, 'loseHp 直接扣');
  ok(loseHp(99) === 7 && G.hp === 0, 'loseHp 默认下限 0 —— 战斗里可以被这一下打死');

  G.hp = 1;
  ok(loseHp(99, 1) === 0 && G.hp === 1, 'loseHp(_, 1) 不致死 —— 事件代价不该终结一局');

  G.apMax = 10;
  G.ap = 10;
  ok(gainAp(5) === 0 && G.ap === 10, 'gainAp 夹在 apCap 上限（X 费牌答对不能连开）');
  ok(spendAp(99) === 10 && G.ap === 0, 'spendAp 夹在 0，不会变成负行动力');

  G.apMax = 4;
  G.ap = 0;
  resetAp();
  ok(G.ap === 4, 'resetAp 把行动力重置成上限（沙漏那 +1 能落地）');

  G.block = 0;
  ok(grantBlock(0) === 0 && G.block === 0, 'grantBlock(0) 不写 —— 纯攻牌不该凭空长甲');
  ok(grantBlock(5) === 5 && G.block === 5, 'grantBlock 是累加');
  setBlock(2);
  ok(G.block === 2, 'setBlock 是设值不是累加（回合开始的重置靠它）');
}

// ── 14. 三个模式：初始能力 2 / 1 / 0 ─────────────────────
// 难度靠初始能力数量递进，而不是三个模式共用一个保底。
{
  ok(MODES.length === 3, `模式只有三个（${MODES.length}）`);

  startRun('study');
  ok(G.mode === 'study' && G.powers.length === 2
    && G.powers.includes('librarycard') && G.powers.includes('syllabus'),
    `学习：借书证 + 课表（${G.powers.join(' / ')}）`);

  startRun('review');
  ok(G.mode === 'review' && G.powers.length === 1 && G.powers[0] === 'librarycard',
    `复习：只带借书证（${G.powers.join(' / ')}）`);

  startRun('test');
  ok(G.mode === 'test' && G.powers.length === 0, '测试：没有初始能力');

  // 复习点回多少血，只认 `BAL.restHp`（+修书胶）：
  // 面板上写「回复 N 点」、结算里回 M 点，是这类固定点数最容易被改漏的一处。
  startRun('test');
  G.hp = 1;
  const plainRest = Math.min(G.maxHp - G.hp, BAL.restHp);
  restHeal();
  ok(G.hp - 1 === plainRest, `复习：回 ${BAL.restHp} 点（实际 ${G.hp - 1}）`);

  startRun('test');
  G.powers = ['mend'];
  G.hp = 1;
  const mendRest = Math.min(G.maxHp - G.hp, BAL.restHp + BAL.mendRest);
  restHeal();
  ok(G.hp - 1 >= mendRest - 1,
    `修书胶：复习回 ${BAL.restHp} + ${BAL.mendRest} 点（实际 ${G.hp - 1}）`);
}

// ── 14b. 自伤卡与第四批节奏增益 ─────────────────────────────
// 这组测试不靠日志：自伤看真实血量，节拍器看真实行动力，亮油/墨水瓶看真实手牌，
// 档案盒看洗牌后的真实格挡。卡面数字和结算必须走同一条路，所以这里直接读 G。
{
  startRun('test');
  G.stage = 1;
  enterStage(1);
  const node: MapNode = { r: 0, i: 0, key: '0:0', col: 1, type: 'fight', next: [] };
  startBattle(node);
  // 固定一只没有反伤/回复机制的木桩，避免敌人机制污染“这张牌自己扣了多少”。
  G.enemy = { ...FOES.find((f) => f.key === 'shard')!, maxHp: 999, hp: 999, block: 0, mv: 0, stage: 1 };
  G.powers = [];
  G.onceUsed = {};
  G.charge = {};
  G.panel = { k: 'none' };
  G.busy = false;
  G.ap = 3;
  G.apMax = 3;
  G.block = 0;
  G.hp = 60;
  G.maxHp = 70;
  G.cardsThisTurn = 0;
  G.hand = [];
  G.draw = [];
  G.discard = [];

  const hurt = PACK.cards.find((c) => c.id === 'c87')!;
  G.hand = [hurt.id];
  G.charge[hurt.id] = gradeNeed(hurt);
  playFree(0);
  ok(G.hp === 57, `焚稿的自伤落到血量上（60 → ${G.hp}，应 57）`);

  // 节拍器：三张真正生效的牌之后退 1 点；三张都用 0 费，避免行动力本身干扰读数。
  G.powers = ['pulse'];
  G.onceUsed = {};
  G.hand = ['c93', 'c93', 'c93'];
  G.draw = [];
  G.discard = [];
  G.cardsThisTurn = 0;
  G.ap = 3;
  G.apMax = 3;
  G.block = 0;
  playFree(0);
  playFree(0);
  playFree(0);
  ok(G.ap === 4, `节拍器：第一次三连后退回 1 点（3 → ${G.ap}）`);

  // 亮油：第一张 0 费牌把下一张带出来。
  G.powers = ['varnish'];
  G.onceUsed = {};
  G.hand = ['c93'];
  G.draw = ['c04'];
  G.discard = [];
  G.cardsThisTurn = 0;
  G.ap = 3;
  G.apMax = 3;
  playFree(0);
  ok(G.hand.includes('c04'), '亮油：第一张 0 费牌抽到了下一张');

  // 墨水瓶：每回合第 3 张才抽，前两张不抽。
  G.powers = ['ink'];
  G.onceUsed = {};
  G.hand = ['c93', 'c93', 'c93'];
  G.draw = ['c04'];
  G.discard = [];
  G.cardsThisTurn = 0;
  G.ap = 3;
  G.apMax = 3;
  playFree(0);
  playFree(0);
  playFree(0);
  ok(G.hand.includes('c04'), '墨水瓶：第 3 张牌把下一张摸上来');

  // 一回合只数一次：卡面写的就是「一回合只数一次」，第 6 张不该再抽。
  G.hand = ['c93', 'c93', 'c93'];
  G.draw = ['c04'];
  G.discard = [];
  G.cardsThisTurn = 3;
  G.ap = 3;
  G.apMax = 3;
  playFree(0);
  playFree(0);
  playFree(0);
  ok(!G.hand.includes('c04'), '墨水瓶：一回合只数第 3 张，第 6 张不再抽');

  // 档案盒：洗牌时补 2 点格挡。直接制造“抽牌堆空、弃牌堆有牌”的洗牌条件。
  G.powers = ['archive'];
  G.onceUsed = {};
  G.hand = [];
  G.draw = [];
  G.discard = ['c04'];
  G.block = 0;
  const got = drawCards(1);
  ok(got === 1 && G.block === 2, `档案盒：洗牌后补 2 点格挡（抽到 ${got} 张 / ${G.block} 挡）`);

  // 羽毛：空手结束回合先补 2 挡，再看敌人这一下。用致死攻击留下 G.block 的读数，
  // 因为正常结束回合会进入下一回合并把格挡清掉。
  G.powers = ['feather'];
  G.onceUsed = {};
  G.hand = [];
  G.draw = [];
  G.discard = [];
  G.block = 0;
  G.hp = 1;
  G.turn = 2;
  G.pending = null;
  G.panel = { k: 'none' };
  G.busy = false;
  G.enemy = { ...FOES.find((f) => f.key === 'shard')!, hp: 999, maxHp: 999, block: 0, mv: 0, dmg: 100, stage: 1 };
  endTurn();
  ok(G.block === 2 && G.hp === 0, `羽毛：空手结束回合补 2 挡（${G.block} 挡 / ${G.hp} 血）`);

  // 种纸：第一张攻击牌补 2 点格挡；c05 自身 4 挡，所以应该是 6。
  G.powers = ['seed'];
  G.onceUsed = {};
  G.pending = null;
  G.panel = { k: 'none' };
  G.busy = false;
  G.screen = 'battle';
  G.hp = 60;
  const atk = PACK.cards.find((c) => c.id === 'c05')!;
  G.hand = [atk.id];
  G.charge[atk.id] = gradeNeed(atk);
  G.draw = [];
  G.discard = [];
  G.block = 0;
  G.cardsThisTurn = 0;
  playFree(0);
  ok(G.block === 6, `种纸：第一张攻击牌补 2 点格挡（4 + 2 = ${G.block}）`);

  // 种纸按**类别**判，不按"这一手有没有伤害段"：带伤害的防御牌不算攻击牌，
  // 0 伤的攻击牌也算。以前按伤害段判，长链壁垒（防御牌、7 伤）会白拿格挡。
  const plainBlk = (id: string) => {
    const keep = G.powers;
    G.powers = [];
    const n = effFace(planStrike(id, { noBoost: true })).blk;
    G.powers = keep;
    return n;
  };
  const seedBlk = (id: string) => {
    G.powers = ['seed'];
    G.onceUsed = {};
    G.panel = { k: 'none' };
    G.busy = false;
    G.block = 0;
    G.pending = null;
    G.enemy = {
      ...FOES.find((f) => f.key === 'shard')!,
      maxHp: 999, hp: 999, block: 0, mv: 0, dmg: 10, stage: 1,
    };
    return buildSettlement(id).budget.blk;
  };
  ok(seedBlk('c03') === plainBlk('c03'),
    `种纸：带伤害的防御牌不触发（长链壁垒 ${plainBlk('c03')} 挡）`);
  ok(seedBlk('c84') === plainBlk('c84') + BAL.seedBlock,
    `种纸：0 伤的攻击牌照样触发（铸甲为刃 ${plainBlk('c84')} + ${BAL.seedBlock}）`);
}

// ── 14. 资源写入只有一条通道 ───────────────────────────────
// `infra/write.ts` 是血 / 格挡 / 行动力的唯一写入口。绕过它不会立刻出错，
// 但会在很久以后表现为"某张 X 费牌答对之后能连开三张"：所以在这里当场红。
//
// 已知缺口：`Object.assign(G, {...})` 形式的整块复位（`save.ts` 的 resumeRun）
// 抓不到。那种写入只发生在"载入一份存档"，属于初始化而不是游戏过程中，
// 所以不在这条断言的守备范围内。
{
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.name.endsWith('.ts')) files.push(p);
    }
  };
  walk(join(here, '..', 'src', 'core'));

  // 只认"赋值 / 自增 / 自减"，不认比较（`G.hp <= 0`）。
  // `\b` 让 `G.apMax` 落到规则之外：上限不是资源本身。
  const re = /\bG\.(hp|block|ap)\b\s*(=[^=]|\+=|-=)/;
  const bad: string[] = [];
  for (const f of files) {
    if (f.endsWith(join('infra', 'write.ts'))) continue;
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      // 注释里会写到 `G.ap`（比如 write.ts 的文档被别处引用），不算写入
      if (/^\s*(\*|\/\/|\/\*)/.test(line)) return;
      if (re.test(line)) bad.push(`${basename(f)}:${i + 1}`);
    });
  }
  ok(bad.length === 0,
    `资源写入只有一条通道（${bad.length ? `裸写在 ${bad.join('、')}` : `${files.length} 个文件里没有裸写`}）`);
}

// ── 15. 回合结束：手牌一张不留，洗牌只发生在抽牌堆见底 ──────────
// 以前杂念会「原地散去」，同 id 的副本在表现层又被认成没动过，玩家看到的是
// 「一回合结束，有的牌没回弃牌堆」。这里把规则和洗牌时机一起钉住。
{
  const e = battle(1, 'examiner');
  // 用一举盾招式，避免敌人往弃牌堆塞杂念干扰计数。
  e.moves = [{ k: 'def', v: 1 }];
  e.mv = 0;
  G.powers = [];
  G.drawCut = 0;
  G.panel = { k: 'none' };
  G.busy = false;
  G.pending = null;
  G.hp = 999;
  G.maxHp = 999;

  // 抽牌堆还够抽：弃牌堆里原有的牌不许被洗走，旧手牌 4 张（含杂念）全进去。
  G.hand = ['base:strike', 'base:guard', 'c01', JUNK_ID];
  G.draw = ['base:guard', 'base:guard', 'base:guard', 'base:guard', 'base:guard', 'base:strike'];
  G.discard = ['c02', 'c03'];
  const kept = G.discard.slice();
  endTurn();
  ok(G.hand.length === BAL.drawPerTurn,
    `回合结束：旧手牌全清，重新抽满 ${BAL.drawPerTurn} 张（实到 ${G.hand.length}）`);
  ok(kept.every((id) => G.discard.includes(id)), '抽牌堆没见底：弃牌堆里原有的牌没被洗走');
  ok(G.discard.filter((id) => id === JUNK_ID).length === 1, '打不出去的杂念也回弃牌堆');
  ok(['base:strike', 'base:guard', 'c01'].every((id) => G.discard.includes(id)),
    '没打出去的 3 张牌全部回弃牌堆');
  ok(G.draw.length > 0, '抽牌堆还有牌：这一回合没有触发洗牌');

  // 抽牌堆见底：这时才允许把弃牌堆洗回来，且一张牌都不能凭空少。
  G.pending = null;
  G.panel = { k: 'none' };
  G.busy = false;
  G.hand = ['base:strike', 'base:guard'];
  G.draw = [];
  G.discard = ['c02', 'c03', 'c04', 'c05', 'c06', 'c07'];
  const total = G.hand.length + G.discard.length;
  endTurn();
  ok(G.discard.length === 0, '抽牌堆见底：弃牌堆整堆洗回抽牌堆');
  ok(G.hand.length + G.draw.length + G.discard.length === total,
    `洗牌不丢牌（${G.hand.length + G.draw.length + G.discard.length}/${total}）`);

  // 战斗在这一回合结束、不再开新回合时，手牌也不能留在手里。
  G.pending = null;
  G.panel = { k: 'none' };
  G.busy = false;
  G.hand = ['base:strike', JUNK_ID];
  G.draw = ['base:guard', 'base:guard'];
  G.discard = [];
  G.enemy!.hp = 0;
  endTurn();
  ok(G.hand.length === 0 && G.discard.includes('base:strike') && G.discard.includes(JUNK_ID),
    '战斗在回合结束时分出胜负：手牌照样全进弃牌堆');
}

console.log(fails ? `\n✗ ${fails} 项失败` : '\n✓ 结构检查通过');
process.exitCode = fails ? 1 : 0;