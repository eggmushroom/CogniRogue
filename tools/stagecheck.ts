/**
 * 过幕/新机制的结构检查。不是端到端测试，只回答三个问题：
 *   1. 打死幕 Boss 会换图、回满血、上限 +N，而不是直接通关；
 *   2. 只有第五幕的 Boss 会真的结束这一局；
 *   3. 五幕各自的怪都取得到，且每条新机制在结算里真的发生了。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { BAL, FOES, POWERS, STAGES, STAGE_ROWS } from '../src/core/model';
import type { MapNode } from '../src/core/model';
import {
  EVENTS, G, answer, askCard, canAsk, canPay, cancelPanel, chooseEventOption, clearRun, defOf,
  dismissFeedback, endTurn, forgetCard, intentText, openBossReward, parseMem, playBasic,
  powerCardId, runSaveInfo, skipReward, startBattle, startTurn, upgradeCard,
  loadQuestionBank, PACK, startRun, takePower, mergePacks, genStage, floorOf, LEGACY_CARD_IDS,
  allQuestions, stageMemOf, resetStageMemory, cardKind, enterStage, BASICS, drawBattleQuestions,
  cardGrade, gradeNeed, cardAskState, battleQuestionCount, playFree, takeQuestion, MAX_PICK_PER_RUN,
  openCardPick, statOf, isUpgraded, makeFoe, resumeRun,
} from '../src/core';

(globalThis as unknown as { setTimeout: (fn: () => void) => void }).setTimeout = (fn) => { fn(); };
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
/** TS 在长测试里会把 G.panel 窄化成上一步的类型；断言只看运行时字符串。 */
const panelKind = () => (G.panel as { k: string }).k;

// ── 1. 每幕都有怪，且三个档位齐全 ───────────────────────────
for (const s of STAGES) {
  const mine = FOES.filter((f) => f.stage === s.i);
  const n = mine.filter((f) => f.type === 'fight').length;
  const e = mine.filter((f) => f.type === 'elite').length;
  const b = mine.filter((f) => f.type === 'boss').length;
  ok(n >= 3 && e >= 2 && b === 1, `第 ${s.i} 幕 ${s.name}：${n} 普通 / ${e} 精英 / ${b} Boss`);
}
ok(new Set(FOES.map((f) => f.key)).size === FOES.length, `敌人 key 不重复（共 ${FOES.length} 种）`);

// ── 2. 地图：20 层，入口是战斗、倒数第二层复习、最后一层 Boss ──
const m = genStage(3);
ok(m.length === STAGE_ROWS, `一幕 ${m.length} 层`);
ok(m[0][0].type === 'fight', '第一层是战斗');
ok(m[STAGE_ROWS - 2].every((n) => n.type === 'rest'), 'Boss 前一层是复习点');
ok(m[STAGE_ROWS - 1][0].type === 'boss', '最后一层是 Boss');
ok(floorOf(3, 0) === 41 && floorOf(5, 19) === 100, '层号连续：第 3 幕第 1 层 = 41，第 5 幕末 = 100');

// ── 3. 过幕：血回满、上限 +N、换图、幕号 +1，且没结束这一局 ──
startRun('review');
const before = { maxHp: G.maxHp, stage: G.stage };
G.maxHp = 40;
G.hp = 9;

// 直接把玩家送到幕 Boss 面前：造一个 boss 节点，打死它
const bossNode: MapNode = { r: STAGE_ROWS - 1, i: 0, key: `${STAGE_ROWS - 1}:0`, col: 1, type: 'boss', next: [] };
G.node = bossNode;
G.enemy = {
  ...FOES.find((f) => f.stage === 1 && f.type === 'boss')!,
  maxHp: 10, hp: 1, block: 0, mv: 0, stage: 1,
};
// 用基础牌之外的路子打死它：直接改血再走一次判定
G.enemy.hp = 0;
G.pending = 'win';
dismissFeedback();

ok(G.stage === 2, `过幕后进入第 ${G.stage} 幕`);
ok(G.hp === G.maxHp, `过幕回满血（${G.hp}/${G.maxHp}）`);
ok(G.maxHp === 40 + BAL.stageMaxHp, `生命上限 +${BAL.stageMaxHp}`);
ok(G.map.length === STAGE_ROWS && G.pos === null, '换了一张新图，位置在入口');
ok(G.screen === 'map', '过幕后回到地图而不是结算页');
ok(G.panel.k === 'power', '幕 Boss 给一次增益牌奖励');
ok(G.seen && Object.keys(G.seen).length === 0, '走过标记按幕清空');
takePower((G.panel as { pool: { id: string }[] }).pool[0].id);
ok(G.panel.k === 'none', '领完奖励回到地图');
void before;

// ── 4. 终局：第五幕 Boss 才结算胜利 ─────────────────────────
G.stage = STAGES.length;
enterStage(G.stage);
G.node = { ...bossNode, r: STAGE_ROWS - 1 };
G.enemy = { ...FOES.find((f) => f.type === 'boss')!, maxHp: 10, hp: 0, block: 0, mv: 0 };
G.pending = 'win';
dismissFeedback();
ok(G.screen === 'report' && G.panel.k === 'report' && G.panel.data.win, '第五幕 Boss → 结算胜利');

// ── 5. 新机制真的生效 ──────────────────────────────────────
function battle(stage: number, key: string) {
  startRun('review');           // 一手完整的牌组，才能真的点开一张牌
  G.stage = stage;
  G.map = genStage(stage);
  const nd: MapNode = { r: 3, i: 0, key: '3:0', col: 1, type: 'fight', next: [] };
  G.node = nd;
  startBattle(nd);
  const tpl = FOES.find((f) => f.key === key)!;
  // mechV 必须显式覆盖：Object.assign 不会删掉上一只怪留下的 mechV，
  // 否则随机抽到 mechV=10 的怪再换成 mechV 未定义的怪，测试会读错 10。
  Object.assign(G.enemy!, { ...tpl, maxHp: 999, hp: 999, block: 0, mv: 0, mechV: tpl.mechV });
  // `drawCut` 是 startBattle 按"它自己那一刻抽到的怪"写下的，换怪发生在之后 ——
  // 不跟着重算，下面 fog 那条断言就变成了"开局抽到谁"的掷硬币（抽到别的怪就红）。
  const e = G.enemy!;
  G.drawCut = e.mech === 'fog' ? (e.mechV ?? BAL.mech.fog) : 0;
  // 起手只有 2 张随机知识卡，抽 5 张时可能一张都没抽到；下面这些机制测试都要求
  // "手里至少有一张**会出题**的牌"。只要求"有知识卡"不够：C 级（0 费）牌不答题
  // （`cardAskState` 直接是 free），抽到它会让 `findIndex((c) => canAsk(c))` 返回 -1，
  // 于是整段测试静默跳过、断言读到 0 —— 看起来像机制没生效，其实是这条没跑到。
  if (!G.hand.some((c) => canAsk(c) && canPay(defOf(c)))) {
    const k = PACK.cards.find((c) => c.kind === 'knowledge' && cardGrade(c) === 'B')!;
    G.hand[0] = k.id;
  }
  return e;
}

// fog：本场每回合少抽
{
  battle(2, 'bookmoth');
  ok(G.drawCut === 1, '蠹蛾：本场抽牌 -1');
  // 字段只是记账，真正的后果是"每回合手上少一张"。再起一回合数一下手牌 ——
  // 只断言 drawCut 等于 1 的话，drawTo 里那个减法写错也照样绿。
  startTurn();
  ok(G.hand.length === BAL.drawPerTurn - 1, `蠹蛾：起手只有 ${G.hand.length} 张（应 ${BAL.drawPerTurn - 1} 张）`);
  G.drawCut = 0;
}

// thorns：答对打出攻击牌，自己被反伤
{
  const e = battle(3, 'ghostprint');
  const before = G.hp;
  const i = G.hand.findIndex((c) => canAsk(c) && canPay(defOf(c)));
  // 不要静默跳过：抽不到能答的牌时这条断言会读到"没掉血"，看起来像机制坏了。
  if (i < 0) throw new Error('反伤测试：手里没有能答的牌');
  askCard(i);
  if (G.panel.k === 'question') answer(G.panel.view.answer);
  if (G.panel.k === 'feedback') dismissFeedback();
  ok(G.hp < before, `影印：反伤落地（${before} → ${G.hp}）`);
  void e;
}

// bulwark：答错它叠甲
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

// siphon：挨打后下回合行动力 -1 —— 没挡住才会记账
{
  const e = battle(5, 'whisperer');
  e.moves = [{ k: 'atk', m: 2 }];
  e.mv = 0;
  G.block = 0;
  G.apDown = 0;
  const apMax = G.apMax;
  endTurn();
  // 记账在挨打时，结账在下一回合的 startTurn —— 所以看的是新回合的行动力
  ok(G.ap === apMax - 1, `低语者：下一回合行动力 ${G.ap}/${apMax}`);
}

// haste：每回合更硬
{
  const e = battle(4, 'stitchdoll');
  const d0 = e.dmg;
  endTurn();
  ok(e.dmg > d0, `缝线傀儡：攻击 ${d0} → ${e.dmg}`);
}

// leech：只吃"答错"这一件事，回血量读自己的 mechV，且不会越过血线上限。
// 这条是玩家最容易被吓到的一条 —— 打得好好的，答错一下敌人血条往上跳。
{
  const e = battle(2, 'grubqueen');
  const cap = e.mechV ?? BAL.mech.leech;
  const card = PACK.cards.find((c) => c.kind === 'knowledge')!;

  /** 故意答错一次，返回敌人这次的血量变化。 */
  const missOnce = () => {
    // 每次小明都开一个新回合再点牌：上一条答题的面板要清干净，
    // 否则第二次 askCard 会被"面板还开着"挡住，看起来像机制没生效。
    startTurn();
    G.ap = 9;                       // 别让"行动力不够"伪装成"机制没生效"
    G.hand[0] = card.id;
    const hp0 = e.hp;
    askCard(0);
    const p0 = G.panel;
    if (p0.k === 'question') answer((p0.view.answer + 1) % p0.view.options.length);
    // 答错之后面板会变成 feedback；没弹题的话它还停在原地。
    // 用一个布尔接住，而不是 `if (k !== 'question') throw` —— 那种写法会把
    // panel.k 收窄成 'question'，紧接着的 `k === 'feedback'` 在 TS 眼里永不成立。
    const took = G.panel.k === 'feedback';
    if (took) dismissFeedback();
    if (!took) throw new Error('书蛀母：没弹出题');
    return e.hp - hp0;
  };

  e.hp = e.maxHp - 40;
  ok(missOnce() === cap, `书蛀母：答错回 ${cap} 点`);

  // 差 2 点满血时答错：补到满就停，不能溢出成 102/100
  e.hp = e.maxHp - 2;
  missOnce();
  ok(e.hp === e.maxHp, `书蛀母：回血不越上限（${e.hp}/${e.maxHp}）`);

  // 已经满血：一点不涨。否则血条会顶在最大值上，玩家看不出发生过什么
  e.hp = e.maxHp;
  ok(missOnce() === 0, '书蛀母：满血时答错不回血');

  // 答对不该回血 —— 回血挂在答错分支上，挂错了位置这条会红
  e.hp = e.maxHp - 30;
  const hp1 = e.hp;
  G.ap = 9;
  G.hand[0] = card.id;
  askCard(0);
  if (G.panel.k === 'question') answer(G.panel.view.answer);
  if (G.panel.k === 'feedback') dismissFeedback();
  ok(e.hp <= hp1, `书蛀母：答对不回血（${hp1} → ${e.hp}）`);
}

// ── 6. 答错的格挡补偿只看这张牌自己 ────────────────────────
// 每张卡都挂着一个 blk 档位（同价位牌的格挡底数），但「洞察 / 内化 / 串联 / 专注」
// 的效果里根本没有格挡 —— 卡面上也看不见格挡那一行。补偿要是照着那个纸面数值算，
// 这几类牌答错就会凭空长出一层甲，"答错"和"挡一下"被解绑。
// （「猛击」是例外：它的效果本来就带 0.7 倍格挡，卡面写着"获得 N 点格挡"，该补。）
function missGain(eff: string) {
  battle(1, 'examiner');
  const card = PACK.cards.find((c) => c.kind === 'knowledge' && c.eff === eff)!;
  G.hand[0] = card.id;
  const before = G.block;
  askCard(0);
  if (G.panel.k !== 'question') throw new Error(`「${eff}」那张牌没有弹题`);
  // 故意答错：这次视图里正确答案的下一个就是错的
  answer((G.panel.view.answer + 1) % G.panel.view.options.length);
  const gain = G.block - before;
  // answer() 会把面板换成反馈页，但类型上 G.panel 还被上面那道守卫窄化成 question
  if ((G.panel as { k: string }).k === 'feedback') dismissFeedback();
  return gain;
}
{
  const noBlk = missGain('pierce');
  ok(noBlk === 0, `卡面没有格挡的牌答错不给格挡（实得 ${noBlk} 点）`);
  const hasBlk = missGain('guard');
  ok(hasBlk > 0, `本身有格挡的牌答错仍然补格挡（${hasBlk} 点）`);
}

// ── 6b. 学习模式：不补格挡、不补抽，但牌回牌堆 ──────────────
// 三档的价码差别全在 `MODES` 里，文案却曾经写死"测试模式"—— 学习模式
// 的 missBlock 也变成 0 之后，那句硬编码就会对着学习模式的截图说谎。
// 这里同时钉住行为（0 格挡、不补抽）和文案（不写别的模式名）。
{
  battle(1, 'examiner');
  G.mode = 'learn';
  const card = PACK.cards.find((c) => c.kind === 'knowledge' && c.eff === 'guard')!;
  G.hand[0] = card.id;
  const blocked = G.block;
  const handBefore = G.hand.length;
  const drawBefore = G.draw.length;
  askCard(0);
  if (G.panel.k !== 'question') throw new Error('学习模式那张牌没有弹题');
  answer((G.panel.view.answer + 1) % G.panel.view.options.length);
  const p = G.panel as unknown as { k: string; fb?: { apNote: string } };
  const note = p.fb?.apNote ?? '';
  ok(G.block === blocked, `学习模式答错一格挡也不补（${blocked} → ${G.block}）`);
  // 不补抽：手牌少一张（那张牌回牌堆了），抽牌堆多一张。
  ok(G.hand.length === handBefore - 1, `学习模式答错不补抽（手牌 ${handBefore} → ${G.hand.length}）`);
  ok(G.draw.includes(card.id) && G.draw.length === drawBefore + 1, '学习模式答错的牌回到抽牌堆');
  ok(!note.includes('测试模式'), `学习模式的说明没有写成"测试模式"（${note}）`);
  ok(note.includes('学习模式'), '说明里点了当前模式的名字');
  if (p.k === 'feedback') dismissFeedback();
}

// ── 7. 看题后取消：扣掉一道题，但**不再锁牌** ───────────────
// 旧规则是"取消后这张牌这回合作废"。那条已删：题目在点开的那一刻就从本场
// 题池里扣掉了，代价已经是"这一场少一道题"，再锁一次等于同一个动作收两次钱。
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

// ── 8. 多段反馈的实际伤害与 parts 同源 ─────────────────────
// fb.hits 是结算前的每段值；敌人有格挡时不能拿它当"造成了多少"。
// 反馈面板应读 fb.parts，它的 d 相加必须等于 fb.dmg。
{
  const e = battle(1, 'examiner');
  const chain = PACK.cards.find((c) => c.kind === 'knowledge' && c.eff === 'chain' && c.cost !== 'x')!;
  G.hand[0] = chain.id;
  G.ap = 3;
  e.block = 5;
  askCard(0);
  if (G.panel.k !== 'question') throw new Error('多段测试：没弹题');
  answer(G.panel.view.answer);
  // answer() 之后 TS 仍把 G.panel 窄化成 question；用显式形状接住反馈面板。
  const p = G.panel as unknown as {
    k: string;
    fb?: { hits: number[]; dmg: number; parts: { d: number }[] };
  };
  if (p.k !== 'feedback' || !p.fb) throw new Error('多段测试：没反馈');
  const fb = p.fb;
  const raw = fb.hits.reduce((n: number, x: number) => n + x, 0);
  const parts = fb.parts.reduce((n: number, part: { d: number }) => n + part.d, 0);
  ok(raw > fb.dmg, `多段原始 ${raw} > 实际 ${fb.dmg}（有格挡）`);
  ok(parts === fb.dmg, `parts 相加 ${parts} = 实际 ${fb.dmg}`);
  dismissFeedback();
}

// ── 9. 增益牌池空：奖励改成知识卡，不再静默结束 ─────────────
{
  startRun('review');
  G.deck = G.deck.concat(POWERS.map((p) => powerCardId(p.id)));
  openBossReward();
  ok(panelKind() === 'reward', `增益牌拿齐后开知识卡奖励（${panelKind()}）`);
  skipReward();
  ok(panelKind() === 'none' && !G.powerFallback, '知识卡奖励走完，fallback 清掉');
}

// ── 10. 事件：代价先写清，选牌交给玩家，没牌可交时留在原地 ──
{
  // 长明灯廊：池空时不能白扣血
  startRun('review');
  G.deck = G.deck.concat(POWERS.map((p) => powerCardId(p.id)));
  const deckBefore = G.deck.length;
  G.hp = 50;
  G.panel = { k: 'event', ev: EVENTS.find((e) => e.id === 'lamp-hall')! };
  chooseEventOption(1);
  ok(G.hp === 50, `长明灯廊：没有新增益时不扣血（${G.hp}）`);
  ok(G.deck.length === deckBefore, `长明灯廊：也没多出牌（${G.deck.length} 张）`);
}

{
  // 索引卡：拿卡先付 8 点生命
  startRun('review');
  G.hp = 50;
  const before = G.deck.length;
  G.panel = { k: 'event', ev: EVENTS.find((e) => e.id === 'index-cards')! };
  chooseEventOption(0);
  ok(G.hp === 42, `索引卡：拿卡付 8 点生命（${G.hp}）`);
  ok(G.deck.length === before + 1 && isUpgraded(G.deck[G.deck.length - 1]),
    '索引卡：多一张已精炼的知识卡');
}

{
  // 旧笔记本：打开选牌面板时**不扣血**，挑完牌才扣。这是"点击精炼直接扣血、
  // 没有回头路"那条反馈的修法，顺带把"取消 = 不付钱"也钉在这里。
  startRun('review');
  G.hp = 50;
  G.panel = { k: 'event', ev: EVENTS.find((e) => e.id === 'notebook')! };
  chooseEventOption(0);
  const p = G.panel as unknown as { k: string; mode?: string };
  ok(p.k === 'cardpick' && p.mode === 'up', `旧笔记本：打开精炼选牌（${p.k}/${p.mode}）`);
  ok(G.hp === 50, `旧笔记本：打开面板时还没扣血（${G.hp}）`);
  ok(G.pendingCost === 10, `旧笔记本：待付 10 点生命挂在面板上（${G.pendingCost}）`);
  if (p.k === 'cardpick') {
    const i = G.deck.findIndex((id) => defOf(id).kind !== 'power' && !isUpgraded(id));
    if (i < 0) throw new Error('旧笔记本：没有可精炼的牌');
    upgradeCard(i);
    ok(isUpgraded(G.deck[i]), `旧笔记本：选中的那一张被精炼（${G.deck[i]}）`);
    ok(G.hp === 40, `旧笔记本：选完才付 10 点生命（${G.hp}）`);
    ok(G.pendingCost === 0, '旧笔记本：付完清账，不会重复扣');
  }
}

{
  // 取消 = 不付钱：待付款项跟着面板一起丢掉。
  startRun('review');
  G.hp = 50;
  G.panel = { k: 'event', ev: EVENTS.find((e) => e.id === 'notebook')! };
  chooseEventOption(0);
  ok(G.pendingCost === 10, '取消测试：打开面板时挂着 10 点待付');
  cancelPanel();
  ok(panelKind() === 'none' && G.pendingCost === 0,
    `取消测试：面板关掉、账也清了（${panelKind()} / ${G.pendingCost}）`);
  ok(G.hp === 50, `取消测试：一分血没扣（${G.hp}）`);
}

// ── 基础牌也能精炼 / 遗忘 ───────────────────────────────────
// "保底"是"你至少还有牌能打"，不是"这张牌不能动"。两条路径都要真的通。
{
  startRun('review');
  const bi = G.deck.indexOf('base:strike');
  ok(bi >= 0, '牌组里有基础斩击');
  const atkBefore = statOf(G.deck[bi]).atk;
  G.panel = { k: 'event', ev: EVENTS.find((e) => e.id === 'notebook')! };
  chooseEventOption(0);
  const p = G.panel as unknown as { k: string; mode?: string };
  ok(p.k === 'cardpick' && p.mode === 'up', `基础牌可精炼：打开选牌（${p.k}/${p.mode}）`);
  upgradeCard(bi);
  ok(isUpgraded(G.deck[bi]) && statOf(G.deck[bi]).atk === atkBefore + 3,
    `基础斩击精炼后 ${atkBefore} → ${statOf(G.deck[bi]).atk} 伤`);

  startRun('review');
  const gi = G.deck.indexOf('base:guard');
  const deckBefore = G.deck.length;
  const blkBefore = statOf(G.deck[gi]).blk;
  G.panel = { k: 'event', ev: EVENTS.find((e) => e.id === 'keeper')! };
  chooseEventOption(0);
  forgetCard(gi);
  ok(G.deck.length === deckBefore - 1, `基础格挡可以被遗忘（${deckBefore} → ${G.deck.length}）`);
  void blkBefore;

  // 地板还在：牌组删到 4 张就删不动了，不会出现"没有牌可打"的空牌组。
  const deep = G.deck.length;
  G.deck = G.deck.slice(0, 4);
  ok(!openCardPick('rm'), `牌组 4 张时拒绝删牌（现在 ${G.deck.length}，删前 ${deep}）`);
}

{
  // 守夜人：牌组不够删时返回 null，事件面板留在原地，不白扣血也不白关。
  // 现在的门槛是"牌组 > 4 张"（基础牌也能删了），所以要把牌组压到 4 张。
  startRun('review');
  G.deck = G.deck.slice(0, 4);
  G.hp = 50;
  G.panel = { k: 'event', ev: EVENTS.find((e) => e.id === 'keeper')! };
  chooseEventOption(0);
  ok(panelKind() === 'event' && G.hp === 50,
    `守夜人：没牌可交时留在事件面板（${panelKind()} / ${G.hp}）`);
}

{
  // 守夜人：有牌可交时，交给玩家选，不再随机抽一张。
  // 起手只有 2 张知识卡，而删牌要求可动牌 > 2（"牌组太薄不能再删"），
  // 所以这里先补几张知识卡，模拟一局走到中段的样子。
  startRun('review');
  const extra = PACK.cards.filter((c) => c.kind === 'knowledge').slice(0, 4);
  extra.forEach((c) => G.deck.push(c.id));
  G.hp = 50;
  const before = G.deck.length;
  G.panel = { k: 'event', ev: EVENTS.find((e) => e.id === 'keeper')! };
  chooseEventOption(0);
  const p = G.panel as unknown as { k: string; mode?: string };
  ok(p.k === 'cardpick' && p.mode === 'rm', `守夜人：打开移除选牌（${p.k}/${p.mode}）`);
  if (p.k === 'cardpick') {
    const i = G.deck.findIndex((e) => defOf(e).kind !== 'basic');
    forgetCard(i);
  }
  ok(G.deck.length === before - 1, `守夜人：玩家选的那张被移除（${before} → ${G.deck.length}）`);
  ok(G.hp === 50, '守夜人：不再随机抽卡，也不额外回血');
}

// ── 10b. 开局 10 张：4 斩击 + 4 格挡 + 2 张随机知识卡 ───────
{
  startRun('learn');
  startRun('test');
  const ids = G.deck.slice();
  ok(G.deck.length === 10, `起手 10 张（实为 ${G.deck.length}）`);
  ok(ids.filter((id) => id === 'base:strike').length === 4, `基础斩击 ×4（实为 ${ids.filter((id) => id === 'base:strike').length}）`);
  ok(ids.filter((id) => id === 'base:guard').length === 4, `基础格挡 ×4（实为 ${ids.filter((id) => id === 'base:guard').length}）`);

  const knowledge = G.deck.filter((e) => cardKind(defOf(e)) === 'knowledge');
  ok(knowledge.length === 2, `随机知识卡 ×2（实为 ${knowledge.length}）`);
  ok(new Set(knowledge).size === 2, '两张随机知识卡不重复');
  ok(knowledge.every((id) => PACK.cards.some((c) => c.id === id)), '随机知识卡都来自 catalog（不含基础牌）');
  // 起手不给 A / S：开局抽到一张 3 费 26 伤的牌，前十几层就是平推，
  // 难度曲线会由"开局那一掷"决定而不是由层数决定（见 cards/starter.ts）。
  ok(knowledge.every((id) => ['C', 'B'].includes(cardGrade(defOf(id)))),
    `起手知识卡都是 C/B 级（${knowledge.map((id) => cardGrade(defOf(id))).join('/')}）`);
  ok(!knowledge.some((id) => (defOf(id).cost ?? 1) === 3),
    '起手不会抽到 3 费的 S 级牌');

  // 基础牌不在 PACK 里，所以奖励池 / 事件 / 增益池都抽不到它们 —— 这是"后续获取不出现斩击和格挡"的根据。
  ok(!PACK.cards.some((c) => c.id === 'base:strike' || c.id === 'base:guard'),
    '卡池里没有基础斩击 / 基础格挡（奖励与事件不会产出）');
  ok(BASICS.length === 8, `基础牌共 8 张（实为 ${BASICS.length}）`);
}

// ── 10c. 每张牌都有自己的 id，精炼只作用于挑中的那一张 ────────
// 这是"基础斩击偶发失效"的结构性修法。旧实现把精炼挂在 `CardInst.up` 上，
// 同名牌的两份副本因此是"两个不同的东西"，而界面/表现层却按对象身份追踪它们 ——
// 一旦某个对象被重建（读档、复制、拼接），那张牌就认不出来，表现为"点了没反应"。
// 现在牌组是一串 id：精炼就是把那一张的 id 换成带 `+` 的版本，没有任何实例层。
{
  startRun('review');
  const strikes = G.deck.filter((id) => id === 'base:strike');
  ok(strikes.length === 4, `牌组里有 4 张基础斩击（${strikes.length}）`);
  // 四份完全是同一个字符串：没有实例、没有 per-copy 状态。
  ok(new Set(strikes).size === 1, '四张基础斩击是同一个 id（没有 per-copy 状态）');

  // 精炼**只改一张**：挑中的那一张换成 `base:strike+`，另外三张原样。
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

  // 再精炼另一张：两张精炼版可以共存，且不会叠成 `++`。
  upgradeCard(G.deck.indexOf('base:strike'));
  ok(G.deck.filter((id) => id === 'base:strike+').length === 2, '第二张也能单独精炼');
  ok(!G.deck.some((id) => id.endsWith('++')), '精炼不会叠成 ++');

  // 牌组里新增一张同名卡时，它是白板 —— 精炼不跟着牌名走。
  G.deck.push('base:strike');
  ok(statOf('base:strike').atk === 4, '新增的同名卡是白板（精炼不按牌名传染）');
}

// ── 10d. 敌人血量必须跟着塔的层号单调上升 ───────────────────
// 旧实现按"幕内行号"放大（1 + r * 0.018），于是每次换幕斜率归零、由模板硬跳一级，
// 台阶之间几乎是平的 —— 玩家爬塔时感觉不到怪变厚。
// 为了不被整数取整遮住趋势，这里用一个血量很大的合成模板（5000 血）来读系数。
{
  const shard = FOES.find((f) => f.key === 'shard')!;
  const big = { ...shard, hp: 5000 };
  /** 第 (stage, r) 层的血量系数。 */
  const scaleAt = (stage: number, r: number) => {
    G.stage = stage;
    G.node = { r, i: 0, key: `${r}:0`, col: 1, type: 'fight', next: [] };
    return makeFoe(big, floorOf(stage, r)).maxHp / (big.hp * BAL.hp);
  };
  let prev = 0;
  let mono = true;
  let first = 0;
  let last = 0;
  for (let s = 1; s <= STAGES.length; s++) {
    for (let r = 0; r < STAGE_ROWS; r++) {
      const k = scaleAt(s, r);
      if (prev && k <= prev) mono = false;
      if (!first) first = k;
      last = k;
      prev = k;
    }
  }
  ok(mono, `层号越高，血量系数越大（第 1 层 ×${first.toFixed(3)} → 第 100 层 ×${last.toFixed(3)}，逐层严格递增）`);
  ok(last / first > 1.6,
    `塔顶比塔底厚 ${(last / first).toFixed(2)} 倍（曲线见 BAL.growth：开方，前陡后缓）`);

  // 真实整数血量也不能倒退：同一个模板在第 1 幕末和第 2 幕入口之间不能变薄。
  G.stage = 1;
  G.node = { r: 19, i: 0, key: '19:0', col: 1, type: 'fight', next: [] };
  const endOfOne = makeFoe(shard, 20).maxHp;
  G.stage = 2;
  G.node = { r: 0, i: 0, key: '0:0', col: 1, type: 'fight', next: [] };
  const startOfTwo = makeFoe(shard, 21).maxHp;
  ok(startOfTwo >= endOfOne, `换幕不清零：第 2 幕入口 ${startOfTwo} ≥ 第 1 幕末 ${endOfOne}`);

  // 同一条曲线也作用在**伤害**上：只加血会让后几幕变成"很厚但没威胁"。
  G.stage = 1;
  G.node = { r: 0, i: 0, key: '0:0', col: 1, type: 'fight', next: [] };
  const dmg1 = makeFoe(shard, 1).dmg;
  G.stage = 5;
  G.node = { r: 19, i: 0, key: '19:0', col: 1, type: 'fight', next: [] };
  const dmg100 = makeFoe(shard, 100).dmg;
  ok(dmg100 > dmg1, `层号越高伤害越高（${dmg1} → ${dmg100}）`);

  // Boss 不吃幕内斜率，但必须吃全局层号：第 5 幕 Boss 得比第 1 幕 Boss 厚。
  const bossHp = (stage: number) => {
    G.stage = stage;
    G.node = { r: STAGE_ROWS - 1, i: 0, key: `${STAGE_ROWS - 1}:0`, col: 1, type: 'boss', next: [] };
    return makeFoe(FOES.find((f) => f.stage === stage && f.type === 'boss')!, floorOf(stage, STAGE_ROWS - 1)).maxHp;
  };
  ok(bossHp(5) > bossHp(1) * 1.5, `第 5 幕 Boss ${bossHp(5)} 明显厚于第 1 幕 ${bossHp(1)}`);
}

// ── 10f. `hpType` 只给精英 / Boss 加厚 ───────────────────────
// A/S 免答要在一场里答对同一张牌 2/3 次，而普通战斗实测 2.0 回合 —— 凑不满。
// 解法是让"硬仗"变长，而不是把所有怪一起加厚：后者多出来的回合是纯消耗，
// 技巧曲线会被磨平（README「数值是怎么定的」里有 400 局扫描）。
// 这条盯两件事：普通怪不吃这一档；精英 / Boss 正好吃 `BAL.hpType` 倍。
{
  const base = { ...FOES.find((f) => f.key === 'shard')!, hp: 1000 };
  const hpAt = (type: 'fight' | 'elite' | 'boss') => makeFoe({ ...base, type }, 50).maxHp;
  const fight = hpAt('fight');
  const elite = hpAt('elite');
  const boss = hpAt('boss');
  ok(BAL.hpType > 1, `精英 / Boss 的加厚倍率开着（×${BAL.hpType}）`);
  // 比倍数而不是绝对值：`Math.round` 会吃掉零点几，直接比数会误报。
  ok(Math.abs(elite / fight - BAL.hpType) < 0.01,
    `精英血量是普通怪的 ${(elite / fight).toFixed(2)} 倍（应 ${BAL.hpType}）`);
  ok(boss === elite, 'Boss 和精英同一档厚度');
}

// ── 10e. 能力牌对着现行机制说话 ─────────────────────────────
// 六张牌必须两两不同，而且不能有"恒真"的描述（旧版装订线写"答错不花行动力"，
// 而答错本来就不扣行动力 → 这张牌等于没有效果）。
{
  const cards = POWERS.map((p) => p.card);
  ok(new Set(cards).size === cards.length, `六张能力牌的规则两两不同（${cards.length} 条）`);
  ok(!POWERS.some((p) => /答错不花行动力/.test(p.card + p.desc)),
    '没有能力牌还在说"答错不花行动力"（那已经是全局规则）');
  ok(!POWERS.some((p) => /锁卡/.test(p.card + p.desc)),
    '没有能力牌还在提"锁卡"（那条规则已删）');
  // 荧光笔和双面镜曾经逐字相同（都是"每回合第一次答对抽 1 张"），而 1 费的还比 0 费的弱。
  const marker = POWERS.find((p) => p.id === 'marker')!;
  const mirror = POWERS.find((p) => p.id === 'mirrorcard')!;
  ok(marker.card !== mirror.card && marker.cost >= mirror.cost,
    `荧光笔与双面镜已分开（${marker.cost} 费 / ${mirror.cost} 费）：${marker.card}`);
}

// 六张牌的效果各跑一次：装订线（答错半额结算）和荧光笔（答对多退 1 点）
// 是这一版改的两条，必须真的在结算里发生。
{
  // 装订线：答错时这一手按一半结算。
  const e = battle(1, 'examiner');
  const plain = PACK.cards.find((c) => c.kind === 'knowledge' && c.eff === 'strike' && c.cost === 1)!;
  G.powers = ['binder'];
  G.binderUsed = false;
  G.ap = 9;
  G.hand[0] = plain.id;
  e.hp = 999;
  const hp0 = e.hp;
  askCard(0);
  if (panelKind() !== 'question') throw new Error('装订线测试：没弹题');
  const p = G.panel as unknown as { view: { answer: number; options: string[] } };
  // 必须取模：这题的正确选项可能就是最后一个，+1 会越界，而 `answer()` 对
  // 越界的选项是**直接忽略**的（手滑按到 9 不算答错）—— 于是测试读到 0 伤害，
  // 看起来像"装订线没生效"，其实那一次点击根本没发生。
  answer((p.view.answer + 1) % p.view.options.length);
  const dealt = hp0 - e.hp;
  if (panelKind() === 'feedback') dismissFeedback();
  ok(dealt > 0, `装订线：答错也打出了 ${dealt} 点（半额结算）`);

  // 荧光笔：每回合第一次答对多退 1 点（1 费牌因此净赚 1 点）。
  battle(1, 'examiner');
  G.powers = ['marker'];
  const card = PACK.cards.find((c) => c.kind === 'knowledge' && c.cost === 1)!;
  G.ap = 3;
  G.charge = {};
  G.markerRefund = 0;
  G.okThisTurn = 0;
  G.hand[0] = card.id;
  askCard(0);
  if (panelKind() !== 'question') throw new Error('荧光笔测试：没弹题');
  answer((G.panel as unknown as { view: { answer: number } }).view.answer);
  if (panelKind() === 'feedback') dismissFeedback();
  ok(G.ap === 4, `荧光笔：1 费牌答对后退 2 点（3 - 1 + 2 = ${G.ap}）`);
}

// ── 11. mechV 进结算：reviewer / oblivion ───────────────────
{
  const e = battle(1, 'examiner');
  e.dmg = 10;
  e.moves = [{ k: 'atk', m: 1 }];
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
  o.moves = [{ k: 'atk', m: 1 }];
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

// ── 12. 内化：回血读实际伤害，0 伤害不回 ───────────────────
// 旧代码 `Math.max(1, round(dmg * ratio))` 在伤害被格挡吃光时也会回 1 点，
// 而卡面写的是「按实际造成的伤害」—— 那 1 点是卡面上不存在的保底。
{
  battle(1, 'examiner');
  const drain = PACK.cards.find(
    (c) => c.kind === 'knowledge' && c.eff === 'drain' && c.cost !== 'x',
  )!;

  /** 打出一张内化牌，返回反馈面板里的伤害/实际回血。 */
  const cast = () => {
    G.ap = 3;
    G.hand[0] = drain.id;
    // 这张牌上一手答对已经攒满等级，会走"免答直打"分支、不弹题 ——
    // 这里测的是内化的回血结算，不是等级，所以每次都把本场计数清回 0。
    G.charge = {};
    askCard(0);
    if (G.panel.k !== 'question') throw new Error('内化测试：没弹题');
    answer(G.panel.view.answer);
    const p = G.panel as unknown as { k: string; fb?: { dmg: number; heal: number } };
    if (p.k !== 'feedback' || !p.fb) throw new Error('内化测试：没反馈');
    const fb = p.fb;
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

// ── 13. 反伤读「打出一次攻击」，不读伤害 ───────────────────
// 机制条写的是「你每打出一次攻击，自己挨 N 点」：被格挡吃光的攻击照样算一次；
// 纯格挡牌没有攻击段，不算。旧代码按 dealt > 0 触发，还留了 G.hp - 1 的隐形保底。
{
  const e = battle(3, 'ghostprint');
  G.hp = 40;
  e.block = 999;
  const before = G.hp;
  const i = G.hand.findIndex((c) => canAsk(c) && canPay(defOf(c)));
  if (i < 0) throw new Error('反伤测试：手里没有能答的牌');
  askCard(i);
  // G.panel 在长脚本里会被前面的赋值窄化成别的 k；用显式形状绕过，
  // 断言仍只看运行时字段。
  const p1 = G.panel as unknown as { k: string; view?: { answer: number } };
  if (p1.k !== 'question' || !p1.view) throw new Error('反伤测试：没弹题');
  answer(p1.view.answer);
  if (panelKind() === 'feedback') dismissFeedback();
  const th = e.mechV ?? BAL.mech.thorns;
  ok(G.hp === before - th, `影印：攻击被全挡也反伤 ${th} 点（${before} → ${G.hp}）`);

  // 反伤可以致死：它和敌人的攻击走同一条血线，不做隐形保底。
  // 必须钉一张不带回血的牌 —— 抽到内化会先回血再挨反伤，测的就不是致死了。
  const e2 = battle(3, 'ghostprint');
  const plain = PACK.cards.find(
    (c) => c.kind === 'knowledge' && c.eff === 'strike' && c.cost !== 'x',
  )!;
  G.hp = 1;
  e2.block = 0;
  G.ap = 9;
  G.hand[0] = plain.id;
  askCard(0);
  const p2 = G.panel as unknown as { k: string; view?: { answer: number } };
  if (p2.k !== 'question' || !p2.view) throw new Error('反伤致死测试：没弹题');
  answer(p2.view.answer);
  ok(G.hp <= 0 && (G.pending as string | null) === 'dead',
    `反伤致死：1 点血打影印 → ${G.hp}，判负`);
  if (panelKind() === 'feedback') dismissFeedback();

  // 击杀那一击不反伤：敌人 1 血、玩家 1 血，打死它时玩家不掉血，按胜利算
  const e4 = battle(3, 'ghostprint');
  e4.hp = 1;
  e4.maxHp = 1;
  G.hp = 1;
  G.ap = 9;
  G.hand[0] = plain.id;
  askCard(0);
  const p4 = G.panel as unknown as { k: string; view?: { answer: number } };
  if (p4.k !== 'question' || !p4.view) throw new Error('反伤击杀测试：没弹题');
  answer(p4.view.answer);
  ok(G.hp === 1 && (G.pending as string | null) === 'clear',
    `击杀不反伤：血量 ${G.hp}，判定 ${G.pending}`);
  if (panelKind() === 'feedback') dismissFeedback();

  // 纯格挡的基础牌没有攻击段，不该被「打了一下」
  const e3 = battle(3, 'ghostprint');
  G.hp = 40;
  e3.block = 999;
  G.hand[0] = 'base:guard';
  G.ap = 3;
  playBasic(0);
  ok(G.hp === 40, `基础格挡没有攻击段，不触发反伤（${G.hp}）`);
}

// ── 14. 意图 = 结算后的数：审稿人 / 遗忘的修正进标签 ───────
// 旧界面写底数，结算时才加 +N：玩家照着意图叠甲，却永远多挨一截。
{
  const e = battle(1, 'examiner');
  e.dmg = 10;
  e.moves = [{ k: 'atk', m: 1 }];
  e.mv = 0;
  e.mechV = 5;
  G.okThisTurn = 0;
  ok(intentText(e).text === '15', `复习官意图：没答对时写 15（${intentText(e).text}）`);
  G.okThisTurn = 1;
  ok(intentText(e).text === '10', `复习官意图：答对后回到 10（${intentText(e).text}）`);

  const o = battle(5, 'oblivion');
  o.dmg = 10;
  o.moves = [{ k: 'atk', m: 1 }];
  o.mv = 0;
  G.topicWrong = { '基础动词': 1 };
  G.topOkTopic = null;
  ok(intentText(o).text === '14', `遗忘意图：错题主题 +4 → 14（${intentText(o).text}）`);
  G.topOkTopic = '基础动词';
  ok(intentText(o).text === '11', `遗忘意图：该主题答对 -3 → 11（${intentText(o).text}）`);

  // 多段 + 修正：标签写总数，结算也必须落同一个数
  o.moves = [{ k: 'atk', m: 0.6, times: 2 }];
  o.mv = 0;
  ok(intentText(o).text === '13', `遗忘多段意图写总数 13（${intentText(o).text}）`);
  G.block = 0;
  G.hp = 70;
  G.turn = 2;
  endTurn();
  ok(70 - G.hp === 13, `遗忘：意图 13 与结算同源（实受 ${70 - G.hp}）`);
}

// ── 15. 记忆文件：坏条目不能变成 NaN ───────────────────────
// 旧实现直接把 JSON.parse 的结果当 MEM：null 条目会让 tickDue 抛，
// 缺字段的条目会让 tickDue 读到 undefined，memOf 也会给出 NaN 稳固度。
{
  const bad = parseMem(JSON.stringify({
    good: { stab: 5, due: 2, reps: 3, lapses: 1, ok: 4, bad: 1 },
    nullEntry: null,
    stringEntry: 'x',
    arrayEntry: [],
    partial: { stab: null, due: 'x', reps: -1, lapses: 2.7, ok: null, bad: 1 },
  }));
  ok(Object.keys(bad).length === 2, `坏条目被丢弃（保留 ${Object.keys(bad).length} 条）`);
  ok(bad.good.stab === 5 && bad.good.due === 2 && bad.good.reps === 3, '合法条目原样保留');
  ok(Number.isFinite(bad.partial.stab) && Number.isFinite(bad.partial.due)
    && bad.partial.reps === 0 && bad.partial.lapses === 2 && bad.partial.ok === 0,
    `坏字段回落成有限数（stab ${bad.partial.stab} / due ${bad.partial.due} / lapses ${bad.partial.lapses}）`);
  ok(Object.keys(parseMem('[1,2]')).length === 0, '数组形状的记忆被拒绝');
  ok(Object.keys(parseMem('not json')).length === 0, '坏 JSON 当空');

  // card id 与题干解耦：id 是稳定短键，旧题干前缀只出现在迁移表里
  const ids = PACK.cards.map((c) => c.id);
  ok(ids.length === 83 && ids.every((id) => /^c\d{2}$/.test(id)), 'card id 是稳定短键，不含题干');
  ok(new Set(ids).size === ids.length, 'card id 不重复');
  const [oldId, newId] = Object.entries(LEGACY_CARD_IDS)[0];
  const migrated = parseMem(JSON.stringify({
    [oldId]: { stab: 5, due: 1, reps: 1, lapses: 0, ok: 1, bad: 0 },
  }));
  ok(migrated[newId]?.stab === 5, '旧记忆 key 迁移到新 card id');
}

// ── 16. 坏存档当没有：不抛异常、不把首页带崩 ───────────────
// 设计承诺"版本或形状对不上就当没有"。stage=2.5 会让 STAGES[stage-1]
// 变成 undefined；mode='foo' 会让 MODES[mode] 变成 undefined。两者都必须被
// readSnapshot 拒绝，而不是留到标题/答题时才炸。
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
    v: 3, stage: 1, mode: 'review', hp: 50, maxHp: 70,
    deck: ['base:strike'],
    map: genStage(1), pos: null, seen: {}, topicWrong: {},
    floors: 0, runOk: 0, runBad: 0, answerDraws: 0,
  };
  const put = (snap: unknown) => {
    clearRun();
    store.set('cognirogue.run.v3', JSON.stringify(snap));
  };

  put(base);
  ok(runSaveInfo()?.stage === 1, '合法存档可读');

  const oldId = Object.keys(LEGACY_CARD_IDS)[0];
  put({ ...base, deck: [oldId] });
  ok(runSaveInfo() !== null, '旧卡 id 存档迁移到新 card id');

  // 精炼版存档：`+` 后缀要能原样读回来，迁移也要保住后缀。
  put({ ...base, deck: ['base:strike+', 'base:strike'] });
  ok(runSaveInfo() !== null, '带精炼后缀的牌组可读');
  resumeRun();
  ok(G.deck[0] === 'base:strike+' && G.deck[1] === 'base:strike',
    `精炼状态随 id 存回来（${G.deck.join(' / ')}）`);
  ok(statOf(G.deck[0]).atk === 7 && statOf(G.deck[1]).atk === 4,
    `读档后只有精炼的那一张是 7 伤（${statOf(G.deck[0]).atk} / ${statOf(G.deck[1]).atk}）`);

  // 增益牌不可精炼：`pow:hourglass+` 只可能来自坏存档。
  put({ ...base, deck: ['pow:hourglass+'] });
  ok(runSaveInfo() === null, '带精炼后缀的增益牌被拒绝');

  // 旧版本（v2 / v1）整份作废：KEY 抬到了 v3，
  // 旧档读出来就是"没有存档"，而不是半份解析成功。
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
  startRun('review');
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
  const p1 = G.panel as unknown as { k: string; topic?: string; qid?: string; view: { answer: number; options: string[] } };
  ok(p1.k === 'question' && p1.topic === '基础动词' && p1.topic !== cardTopic,
    `非本章卡问本章题（卡「${cardTopic}」→ 题「${p1.topic}」）`);
  ok(!!p1.qid && allQuestions().some((q) => q.qid === p1.qid), 'Panel 带题号，且题号属于当前阶段题库');
  answer(p1.view.answer);
  if (panelKind() === 'feedback') dismissFeedback();
  ok(stageMemOf('基础动词').ok > 0, '答题记进本章记忆（按题号，不按卡）');

  G.stage = 2;
  G.map = genStage(2);
  G.node = G.map[0][0];
  // 换幕之后要重新切题库、重新预抽本场的题 —— 题池在开战时就算好了，
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
  const p2 = G.panel as unknown as { k: string; topic?: string };
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

  startRun('review');
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
  const p = G.panel as unknown as { k: string; q?: { q: string } };
  ok(p.k === 'question' && p.q?.q === '1+1=?', '题目来自新题库');
  ok(G.deck.join('|') === before, '换题库不改变牌组/card id');
  ok(PACK.cards.length === 83, 'PACK 仍是 83 张固定卡');
}

// ── 19. v0.5 四条新规则 ────────────────────────────────────
// 每条都钉一个"以前会失败"的断言：答错不扣行动力、取消不锁牌、等级攒满免答、
// 一道题本局最多 3 次。规则之间互相牵连，分开测才看得出是哪一条翻了。
{
  loadQuestionBank(mergePacks(
    [readFileSync(join(here, '..', 'packs', 'words.md'), 'utf8')],
    'v05',
  ));
  startRun('review');
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
  const qv = () => (G.panel as unknown as { k: string; view: { answer: number; options: string[] } }).view;
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

console.log(fails ? `\n✗ ${fails} 项失败` : '\n✓ 结构检查通过');
process.exitCode = fails ? 1 : 0;