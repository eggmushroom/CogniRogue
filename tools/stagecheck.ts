/**
 * 过幕/新机制的结构检查。不是端到端测试，只回答三个问题：
 *   1. 打死幕 Boss 会换图、回满血、上限 +N，而不是直接通关；
 *   2. 只有第五幕的 Boss 会真的结束这一局；
 *   3. 五幕各自的怪都取得到，且每条新机制在结算里真的发生了。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { BAL, FOES, STAGES, STAGE_ROWS } from '../src/core/model';
import type { MapNode } from '../src/core/model';
import {
  G, answer, askCard, canAsk, canPay, defOf, dismissFeedback, endTurn, startBattle, startTurn,
  loadQuestionBank, PACK, startRun, takePower, mergePacks, genStage, floorOf,
} from '../src/core';

(globalThis as unknown as { setTimeout: (fn: () => void) => void }).setTimeout = (fn) => { fn(); };
const here = dirname(fileURLToPath(import.meta.url));
loadQuestionBank(mergePacks(
  ['algorithms.md', 'advanced.md', 'systems.md'].map((f) => readFileSync(join(here, '..', 'packs', f), 'utf8')),
  'x',
));

let fails = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) fails += 1;
};

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
  maxHp: 10, hp: 1, block: 0, mv: 0, buff: 0, stage: 1,
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
G.node = { ...bossNode, r: STAGE_ROWS - 1 };
G.enemy = { ...FOES.find((f) => f.type === 'boss')!, maxHp: 10, hp: 0, block: 0, mv: 0, buff: 0 };
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
  Object.assign(G.enemy!, { ...tpl, maxHp: 999, hp: 999, block: 0, mv: 0, buff: 0 });
  // `drawCut` 是 startBattle 按"它自己那一刻抽到的怪"写下的，换怪发生在之后 ——
  // 不跟着重算，下面 fog 那条断言就变成了"开局抽到谁"的掷硬币（抽到别的怪就红）。
  const e = G.enemy!;
  G.drawCut = e.mech === 'fog' ? (e.mechV ?? 1) : 0;
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
  if (i >= 0) {
    askCard(i);
    if (G.panel.k === 'question') answer(G.panel.view.answer);
    if (G.panel.k === 'feedback') dismissFeedback();
  }
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

// ── 6. 答错的格挡补偿只看这张牌自己 ────────────────────────
// 每张卡都挂着一个 blk 档位（同价位牌的格挡底数），但「洞察 / 内化 / 串联 / 专注」
// 的效果里根本没有格挡 —— 卡面上也看不见格挡那一行。补偿要是照着那个纸面数值算，
// 这几类牌答错就会凭空长出一层甲，"答错"和"挡一下"被解绑。
// （「猛击」是例外：它的效果本来就带 0.7 倍格挡，卡面写着"获得 N 点格挡"，该补。）
function missGain(eff: string) {
  battle(1, 'examiner');
  const card = PACK.cards.find((c) => c.kind === 'knowledge' && c.eff === eff)!;
  G.hand[0] = { id: card.id, up: 0 };
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

console.log(fails ? `\n✗ ${fails} 项失败` : '\n✓ 结构检查通过');
process.exitCode = fails ? 1 : 0;