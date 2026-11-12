import { BAL, FOES } from '../model/data';
import { resolveEff } from '../model/effects';
import type { EffOut } from '../model/effects';
import type { CardId, Eff, MapNode } from '../model/types';
import { G, checkPending, log } from '../infra/state';
import { after } from '../infra/schedule';
import { emit } from '../infra/events';
import { grantBlock, gainAp, healHp, loseHp, spendAp } from '../infra/write';
import { pick, shuffle } from '../infra/util';
import { stagePool } from '../library/stage';
import { floorOf } from '../map/gen';
import { shuffleOptions } from '../library/question';
import { defOf } from '../cards/registry';
import { applyCardBonus, clearOnceUsed, onceThisFight, rulesOf, syllabusBasicBlock } from '../cards/powers';
import { canPay, costNow, isXCost } from '../cards/cost';
import { cardGrade, needsAsk } from '../cards/grade';
import { cardKind } from '../cards/kinds';
import { drawCards, startTurn } from './deck';
import { commitLink, liveStatOf } from './link';
import { makeFoe } from './foe';
import { requestSettle } from './pending';
import { drawBattleQuestions, takeQuestion } from './questions';

/**
 * 战斗开局与玩家出牌的全部路径。
 * 出牌只有两条：答题（`answer`）和基础牌（`playBasic`），都经 `strikeWith` 结算，
 * 且都要先 `canPay` 再动牌堆。
 * 答对奖励只有两条：退 1 点行动力、抽一张牌，没有倍率层。
 */

/**
 * 进入下一场 / 过幕前要清的场次字段。`deck`、血量和这一局牌组不在这里。
 * 所有“开新场”的路径都应该先过它，避免下一场还带着上一场的免答计数或题池。
 */
export function resetBattleFields() {
  G.enemy = null;
  G.panel = { k: 'none' };
  G.pending = null;
  G.busy = false;
  G.turn = 1;
  G.draw = [];
  G.discard = [];
  G.hand = [];
  G.charge = {};
  G.syllabusTurn = 0;
  G.cardPlays = {};
  G.nextBoost = null;
  G.drawnThisTurn = 0;
  G.cardsThisTurn = 0;
  G.apDown = 0;
  G.drawCut = 0;
  // 索引贴/事件留下的跨回合或跨节点残账不能带进下一场。
  G.carryBlock = 0;
  G.pendingCost = 0;
  G.pendingHeal = 0;
  G.qLeft = [];
}

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
  // fog：本场每回合少抽一张。记在场上，手牌上限 / 动画 / 日志读同一个数。
  G.drawCut = e.mech === 'fog' ? (e.mechV ?? BAL.mech.fog) : 0;

  // 增益跨战斗保留，但「一场一次」的账必须清，否则那张牌从第二场起不再响。
  // 行动力上限由 `startTurn` 按 `rulesOf()` 重算。
  clearOnceUsed();

  // 模式已经在顶栏标了一次，这一行不再复读。考场提示只在第一次战斗里说：
  // 那是教学，不是战报：打到第八层还在播同一句，就是把日志的位置浪费掉了。
  log(`── ${e.name} 出现了 ──`, 'turn');
  if ((G.node?.r ?? 0) === 0) {
    log(`这一场准备了 ${G.qLeft.length} 道新题；C 牌直接打，B/A/S 各要答对 1/2/3 次。新题用完会复用问得最少的题`, 'turn');
  }
  // 开局格挡在 startTurn 里给（那里才知道是不是第一回合）：写在这里会被 startTurn 清零
  startTurn();
}

/**
 * 这张知识卡此刻的状态，给卡面和点击路由用（也是"能不能问"的唯一判断）：
 *
 *   'free'   等级已攒满，这一场直接打，不出题
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
  return stagePool().length ? 'ask' : 'empty';
}

/** 这张牌现在点下去会不会出题。费用是另一回事（`canPay`）。 */
export const canAsk = (id: CardId | null | undefined): boolean => cardAskState(id) === 'ask';

/**
 * 等级攒满后直接打：走同一条 `strikeWith`，不抽题、不判对错、不进答题流水。
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
  const r = strikeWith(id, 1, repeat);
  const back = thornsBack(r.out.hits);

  const shape = r.out.hits.length > 1 ? `${r.out.hits.join('+')} 伤害` : `${r.dmg} 伤害`;
  commitSimplePlay(id, idx, r, {
    spent,
    logKind: 'hi',
    logMsg:
      `「${card.name}」${r.dmg ? shape : ''}${r.blk ? `${r.dmg ? '，' : ''}${r.blk} 格挡` : ''}` +
      `${r.selfHp ? `，失去 ${r.selfHp} 生命` : ''}` +
      `（${cardGrade(card)} 级，这一场已免答${back ? `；反伤 ${back}` : ''}）` +
      `${r.nextNote ? `　·　${r.nextNote}` : ''}`,
  });
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
  // 攒满等级：直接打，不抽题
  if (!needsAsk(id, G.charge)) { playFree(idx); return; }

  const q = takeQuestion();
  if (!q) {
    // 空题库：给一个能查的失败原因，不静默吞掉点击。
    log('这一章的题库是空的：检查题库文件，或者先用基础牌撑过去', 'bad');
    emit({ t: 'fizzle', eff: card.eff });
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
      log('放大镜：这一场的第一道题，一个干扰项被划掉了。', 'hi');
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
  if (G.panel.k === 'deck' || G.panel.k === 'pile'
      || G.panel.k === 'help' || G.panel.k === 'pack' || G.panel.k === 'boon') {
    G.panel = { k: 'none' };
  }
}

function damageEnemy(raw: number, pierce = false) {
  const e = G.enemy!;
  let n = raw;
  let absorbed = 0;
  // 洞察绕过格挡：连"被吸收"这件事都不会发生，敌人那层防御直接不参与结算
  if (!pierce && e.block > 0) { absorbed = Math.min(e.block, n); e.block -= absorbed; n -= absorbed; }
  const alive = e.hp > 0;
  e.hp -= n;
  // 藏书印：**这一下打死的**才算击杀。多段牌的第二段会让 `e.hp` 已经是负数，
  // 不加 `alive` 这个前置判断的话，一张两段牌会回两次血。
  if (alive && e.hp <= 0) {
    const got = healHp(rulesOf().healOnKill);
    if (got) {
      log(`藏书印：击杀回复 ${got} 点生命`, 'hi');
      emit({ t: 'heal', n: got });
    }
  }
  return { dealt: n, absorbed };
}

/**
 * 一手结算的完整结果。同时给反馈面板、日志和演出用。
 * 注意 `hits` 是扣格挡前的原始段值，`parts` 是实际打进/被吸收的值。
 */
export interface StrikeResult {
  out: EffOut;
  dmg: number;
  absorbed: number;
  blk: number;
  heal: number;
  drawn: number;
  selfHp: number;
  parts: { d: number; a: number }[];
  linkNote: string;
  boosted: boolean;
  nextNote: string;
}

/**
 * 一张卡真正打出去的那一下。`mult` 只给装订线的"半额结算"传 0.5，其余路径
 * 一律 1：没有全局倍率，卡面写的数就是打出来的数。
 * `repeat` 是 X 费牌花掉的点数，走同一条结算路径，所以牌面写的段数和实际打出的段数
 * 永远由同一份 `resolveEff` 决定。
 */
export function strikeWith(id: CardId, mult: number, repeat = 1): StrikeResult {
  const card = defOf(id);
  // 这一回合第几张真正生效的牌。答错不增加，所以墨水瓶/节拍器只数打出去的牌。
  G.cardsThisTurn += 1;
  // 读的是**此刻**的联动底数，不是卡面印死的那个数。手牌、答题面板、
  // 结算三处都调 liveStatOf，所以「卡面写 10」和「实际打 10」是同一个数。
  const st = liveStatOf(id);
  // card.mods 必须一起传：卡面（ui.ts）和答题面板（overlay.ts）都是按 mods 画的，
  // 结算漏掉它，带签名改动的 15 张卡就会「卡面写的」和「实际发生的」两张皮。
  // `applyCardBonus` 同理：压书石 / 校规加在**结果**上，卡面走的是同一个函数。
  const out = applyCardBonus(resolveEff(card.eff, st.atk, st.blk, mult, card.mods, repeat));
  const parts: { d: number; a: number }[] = [];
  let dmg = 0;
  let absorbed = 0;
  for (const hit of out.hits) {
    const r = damageEnemy(hit, out.pierce);
    dmg += r.dealt;
    absorbed += r.absorbed;
    parts.push({ d: r.dealt, a: r.absorbed });
  }
  grantBlock(out.blk);
  let heal = 0;
  let drawn = 0;
  let selfHp = 0;
  // 按实际打进去的伤害回血；0 伤害不回 1 点。
  if (out.healRatio > 0 && dmg > 0) {
    heal = healHp(Math.max(1, Math.round(dmg * out.healRatio)));
  }
  if (out.draw > 0) drawn = drawCards(out.draw);
  // 自伤：卡面写多少扣多少。
  if (out.selfHp > 0) {
    selfHp = out.selfHp;
    loseHp(selfHp);
    log(`「${card.name}」反噬：你失去 ${selfHp} 点生命`, 'bad');
    emit({ t: 'hurt', n: selfHp });
  }
  // 节奏型增益：按"真正生效的牌"计数，答错不触发
  const R = rulesOf();
  if (R.inkDraw > 0 && G.cardsThisTurn % 3 === 0) {
    const got = drawCards(R.inkDraw);
    if (got) log(`墨水瓶：本回合第 ${G.cardsThisTurn} 张牌，抽 ${got} 张`, 'hi');
  }
  if (G.cardsThisTurn === 3 && onceThisFight('pulse')) {
    gainAp(BAL.pulseRefund);
    log(`节拍器：这一场第一次三连，退回 ${BAL.pulseRefund} 点行动力`, 'hi');
  }
  if (!isXCost(card) && costNow(card) === 0 && onceThisFight('varnish')) {
    const got = drawCards(BAL.varnishDraw);
    if (got) log(`亮油：这一场第一张 0 费牌，抽 ${got} 张`, 'hi');
  }
  if (out.hits.some((h) => h > 0) && onceThisFight('seed')) {
    grantBlock(BAL.seedBlock);
    log(`种纸：这一场第一张攻击牌，补 ${BAL.seedBlock} 点格挡`, 'hi');
  }
  // 走完才记账：答错这一手作废，上一张留的倍率继续留着。
  const nextNote = commitLink(id);
  return {
    out, dmg, absorbed, blk: out.blk, heal, drawn, selfHp, parts,
    linkNote: st.reasons.join(' · '), boosted: st.boosted, nextNote,
  };
}

/**
 * 反伤：打出有攻击段的牌就挨一下，格挡挡不住。
 * 数的是打出几张，不是打中几段；击杀的那一下不反伤。
 */
export function thornsBack(hits: number[]) {
  const e = G.enemy;
  if (!e || e.mech !== 'thorns' || e.hp <= 0 || !hits.some((h) => h > 0)) return 0;
  const n = e.mechV ?? BAL.mech.thorns;
  if (n <= 0) return 0;
  loseHp(n);
  log(`${e.name} 的反伤：你受到 ${n} 点伤害`, 'bad');
  emit({ t: 'hurt', n });
  return n;
}

/**
 * 一手的结果怎么演：三段出牌路径共用。
 * 0 伤害的知识卡（纯防御 / 纯过牌）不发空光刃；答错的牌只有在真的没造成伤害时才演"焰灭"，
 * 装订线半额结算已经打出了伤害，不能再播一段"没打出去"。
 */
export function publishStrike(
  r: { parts: { d: number; a: number }[]; blk: number; heal: number },
  eff: Eff,
  opts: { wrong?: boolean; base?: number; blockBonus?: number } = {},
) {
  const dealt = r.parts.some((p) => p.d > 0);
  if (dealt) {
    r.parts.forEach((p, i) => {
      const fire = () => emit({ t: 'dmg', n: p.d, absorbed: p.a, eff, seq: i });
      if (i === 0) fire(); else after(i * 150, fire);
    });
  } else if (opts.wrong) {
    emit({ t: 'fizzle', eff });
  }

  const base = opts.base ?? 0;
  const blk = r.blk + (opts.blockBonus ?? 0);
  if (blk) after(base + (opts.wrong ? 220 : 60), () => emit({ t: 'blk', n: blk }));
  if (r.heal) after(base + 60, () => emit({ t: 'heal', n: r.heal }));
}

/**
 * 免答直打 / 基础牌共用的收尾：扣费、离手、判胜负、日志、演出、输入锁。
 * 知识卡的答题路径不用它——那条路径要留反馈面板，不能 200ms 后自动收。
 */
function commitSimplePlay(
  id: CardId, idx: number, r: StrikeResult,
  opts: { spent: number; logMsg: string; logKind: '' | 'hi' | 'bad'; blockBonus?: number },
) {
  spendAp(opts.spent);
  G.discard.push(id);
  G.hand.splice(idx, 1);
  checkPending();
  log(opts.logMsg, opts.logKind);
  publishStrike(r, defOf(id).eff, { blockBonus: opts.blockBonus });

  G.busy = true;
  after(200, () => {
    G.busy = false;
    requestSettle();
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
  const r = strikeWith(id, 1);
  // 课表只认基础牌，和题目池无关。
  const syllabusBlk = syllabusBasicBlock();
  thornsBack(r.out.hits);

  const shape = r.out.hits.length > 1 ? `${r.out.hits.join('+')} 伤害` : `${r.dmg} 伤害`;
  commitSimplePlay(id, idx, r, {
    spent,
    blockBonus: syllabusBlk,
    logKind: '',
    logMsg:
      `「${card.name}」${r.dmg ? shape : ''}${r.blk ? `${r.dmg ? '，' : ''}${r.blk} 格挡` : ''}` +
      `${syllabusBlk ? `${r.dmg || r.blk ? '，' : ''}课表 +${syllabusBlk} 格挡` : ''}` +
      `（基础牌，不答题）${r.nextNote ? `　·　${r.nextNote}` : ''}`,
  });
}

