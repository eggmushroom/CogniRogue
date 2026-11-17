import { FOES, mechAmt } from '../model/data';
import type { CardId, MapNode } from '../model/types';
import { G, checkPending, resetBattleFields } from '../infra/state';
import { pick, shuffle } from '../infra/util';
import { runPool } from '../library/stage';
import { floorOf } from '../map/gen';
import { shuffleOptions } from '../library/question';
import { defOf } from '../cards/registry';
import { clearOnceUsed, onceThisFight, syllabusBasicBlock } from '../cards/powers';
import { canPay, costNow, isXCost } from '../cards/cost';
import { needsAsk } from '../cards/ask';
import { cardKind } from '../cards/kinds';
import { startTurn } from './deck';
import { makeFoe } from './foe';
import { requestSettle } from './pending';
import { drawBattleQuestions, takeQuestion } from './questions';
import {
  buildSettlement, emptySettlement, planThorns, settle,
} from './settlement';
import type { Settlement } from './settlement';

/**
 * 战斗开局与玩家出牌的全部路径。
 * 出牌只有两条：答题（`answer`）和基础牌（`playBasic`），都构造一份 Settlement
 * 交给 `settle` 执行；答对奖励只有退 1 点行动力、抽一张牌，没有倍率层。
 */

export function startBattle(nd: MapNode) {
  // 一幕一套物种；找不到时回退到全表，别让一场战斗开不起来。
  const pool = FOES.filter((f) => f.stage === G.stage && f.type === nd.type);
  // 层号读节点自己的坐标，不读 G.pos（调试会直接塞节点进来）。
  const e = makeFoe(
    pick(pool.length ? pool : FOES.filter((f) => f.type === nd.type)),
    floorOf(G.stage, nd.r),
  );

  G.screen = 'battle';
  resetBattleFields();
  G.enemy = e;
  G.draw = shuffle(G.deck);

  drawBattleQuestions();
  // fog：本场每回合少抽一张。记在场上，手牌上限 / 动画读同一个数。
  G.drawCut = e.mech === 'fog' ? mechAmt(e) : 0;

  // 增益跨战斗保留，但「一场一次」的账必须清，否则那张牌从第二场起不再响。
  // 行动力上限由 `startTurn` 按 `rulesOf()` 重算。
  clearOnceUsed();

  // 开局格挡在 startTurn 里给（那里才知道是不是第一回合）：写在这里会被 startTurn 清零
  startTurn();
}

/**
 * 这张知识卡此刻的状态，给卡面和点击路由用（也是"能不能问"的唯一判断）：
 *
 *   'free'   答题要求已攒满，这一场直接打，不出题
 *   'ask'    还要答题
 *   'empty'  要答题，但这一章一道题都没有（题库载入失败时的兜底）
 *   'other'  不是知识卡
 *
 * **不读 `qLeft`**：本场新题用完不会锁牌，`takeQuestion` 会进入复用路径。
 * 所以"还剩几道新题"（顶栏读数）和"这张牌能不能点"是两个问题。
 */
export function cardAskState(id: CardId | null | undefined): 'free' | 'ask' | 'empty' | 'other' {
  if (!id) return 'other';
  const card = defOf(id);
  if (cardKind(card) !== 'knowledge') return 'other';
  if (!needsAsk(id, G.charge)) return 'free';
  return runPool().length ? 'ask' : 'empty';
}

/** 这张牌现在点下去会不会出题。费用是另一回事（`canPay`）。 */
export const canAsk = (id: CardId | null | undefined): boolean => cardAskState(id) === 'ask';

/**
 * 答题要求攒满后直接打：构造同一份 Settlement，不抽题、不判对错、不进答题流水。
 * 不弹反馈面板，结果只留一条内部文字记录。
 */
export function playFree(idx: number) {
  if (G.busy || G.panel.k !== 'none') return;
  const id = G.hand[idx];
  if (!id) return;
  const card = defOf(id);
  if (cardKind(card) !== 'knowledge') return;
  // 没攒够的牌不能从这条路绕过去，规则在这里守一次。
  if (needsAsk(id, G.charge)) return;
  if (!canPay(card)) return;

  const xcost = isXCost(card);
  const spent = xcost ? G.ap : costNow(card);
  const repeat = xcost ? Math.max(1, spent) : 1;
  const s = buildSettlement(id, { repeat });
  planThorns(s);
  commitSimplePlay(id, idx, s, { spent });
}

/** 点一张知识卡 = 从**本场预抽的题**里取一道。 */
export function askCard(idx: number) {
  if (G.busy || G.panel.k !== 'none') return;
  const id = G.hand[idx];
  if (!id) return;
  const card = defOf(id);
  // 付不起就不弹题：让人答完才发现打不出去是最难受的白费。
  if (!canPay(card)) return;
  if (cardKind(card) !== 'knowledge') return;
  // 攒满答题要求：直接打，不抽题
  if (!needsAsk(id, G.charge)) { playFree(idx); return; }

  const q = takeQuestion();
  if (!q) {
    // 空题库：给一个能查的失败原因，不静默吞掉点击。
    // 空计划也走执行器：反馈事件与状态写入只有一条出口。
    settle(emptySettlement(card.id));
    return;
  }
  // 题目快照挂在 Panel 上，答题期间不随题库变。
  let view = shuffleOptions(q);
  // 放大镜：这一场第一道题删一个错误选项；只剩两项的题不动。
  // 记账在抬手就打，不等 `answer()`，否则取消再点能一直删。
  if (view.options.length >= 3 && onceThisFight('loupe')) {
    const wrongs = view.options.map((_, i) => i).filter((i) => i !== view.answer);
    if (wrongs.length) {
      const drop = wrongs[Math.floor(Math.random() * wrongs.length)];
      view = {
        options: view.options.filter((_, i) => i !== drop),
        answer: drop < view.answer ? view.answer - 1 : view.answer,
      };
    }
  }
  G.panel = { k: 'question', idx, qid: q.qid, topic: q.topic, q, view };
}

export function cancelPanel() {
  // 取消不作废这张牌：题已经被 `takeQuestion` 扣掉了，代价已经付过。
  if (G.panel.k === 'question') {
    G.panel = { k: 'none' };
    return;
  }
  // 选牌面板（精炼 / 遗忘）现在可以取消：事件里"精炼一张、失去 N 点生命"
  // 的代价挂在 `G.pendingCost` 上，取消就要把它一起丢掉：否则玩家取消一次，
  // 之后随便做点什么就凭空掉 10 点血。收益挂在 `G.pendingHeal` 上，同理。
  // 从事件 / 复习点打开的选牌，取消后回到原面板，不能把节点空丢在半路。
  if (G.panel.k === 'cardpick') {
    const from = G.panel.from;
    G.pendingCost = 0;
    G.pendingHeal = 0;
    if (from && from.k === 'event') G.panel = { k: 'event', ev: from.ev };
    else if (from && from.k === 'rest') G.panel = { k: 'rest' };
    else G.panel = { k: 'none' };
    return;
  }
  // 选主题还没开局，取消退回选模式，而不是把玩家扔回标题。
  if (G.panel.k === 'topic') {
    G.panel = { k: 'boon' };
    return;
  }
  if (G.panel.k === 'deck' || G.panel.k === 'pile'
      || G.panel.k === 'help' || G.panel.k === 'pack' || G.panel.k === 'boon') {
    G.panel = { k: 'none' };
  }
}

/**
 * 免答直打 / 基础牌共用的收尾：把扣费并入计划、牌离手，再交给执行器。
 * 知识卡的答题路径不用它——那条路径要留反馈面板，不能演完自动收。
 */
function commitSimplePlay(
  id: CardId, idx: number, s: Settlement,
  opts: { spent: number },
) {
  s.budget.ap.spend += opts.spent;
  G.discard.push(id);
  G.hand.splice(idx, 1);
  checkPending();
  G.busy = true;
  settle(s, {
    // 以前是固定 200ms 解锁：多段演出比它长时，玩家能在最后几段落地前动手，
    // 胜负也判得太早。现在跟着执行器走完才解锁。
    onDone: () => { G.busy = false; requestSettle(); },
  });
}

/**
 * 打出一张基础牌：不答题、不退款、不进记忆调度。
 * 它是这一局的地板，数值刻意低于知识卡，同样花 1 点。
 */
export function playBasic(idx: number) {
  if (G.busy || G.panel.k !== 'none') return;
  const id = G.hand[idx];
  if (!id) return;
  const card = defOf(id);
  if (cardKind(card) !== 'basic') return;
  if (!canPay(card)) return;

  const spent = costNow(card);
  const s = buildSettlement(id);
  // 课表只认基础牌，和题目池无关；它同样只报预算，由执行器统一写入。
  s.budget.blk += syllabusBasicBlock();
  planThorns(s);
  commitSimplePlay(id, idx, s, { spent });
}
