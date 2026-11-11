import { BAL, POWERS } from '../model/data';
import type { CardDef } from '../model/types';
import { G, log } from '../infra/state';
import { shuffle } from '../infra/util';
import { PACK } from '../cards/pack';
import { baseIdOf, powerById, powerCardId, powerCardOf } from '../cards/registry';
import { finishNode } from './nodes';

/**
 * journey/rewards —— 战后奖励。
 *
 * 知识卡奖励与增益牌奖励是两步：先选一张卡，再决定要不要看增益牌。
 * 两者都是「往牌组里塞一张牌」，不是白给一个永久效果。
 */
function rewardPool(n: number): CardDef[] {
  const copies: Record<string, number> = {};
  G.deck.forEach((id) => { copies[baseIdOf(id)] = (copies[baseIdOf(id)] || 0) + 1; });
  const fresh = PACK.cards.filter((c) => !copies[c.id]);
  const room = PACK.cards.filter((c) => (copies[c.id] || 0) < BAL.maxCopies);
  // 三张必须来自不同主题：构筑的乐趣是"这一局往哪个方向堆"，不是挑三张同主题的
  const pool = shuffle(fresh).concat(shuffle(room));
  const out: CardDef[] = [];
  const used: Record<string, number> = {};
  pool.forEach((c) => {
    if (out.length < n && !used[c.topic]) { used[c.topic] = 1; out.push(c); }
  });
  pool.forEach((c) => { if (out.length < n && !out.includes(c)) out.push(c); });
  return out;
}

export function openReward() {
  G.panel = { k: 'reward', cards: rewardPool(3) };
}

export function takeCard(i: number) {
  if (G.panel.k !== 'reward') return;
  const c = G.panel.cards[i];
  if (!c) return;
  // 牌组里只存 id，精炼过的那一张带 `+` 后缀。奖励拿到的是**新的一张**，
  // 所以它进牌组时是未精炼的 —— 想要强化版，得另外花一次精炼在它身上。
  G.deck.push(c.id);
  log(`「${c.topic}」加入牌组（${G.deck.length} 张）`, 'hi');
  afterReward();
}

export function skipReward() {
  if (G.panel.k !== 'reward') return;
  afterReward();
}

/**
 * 选完知识卡之后再决定要不要看增益牌。
 *
 * 精英必给；普通战斗按 BAL.powerDrop 掉。100 层里一共只有 6 种，所以后半程
 * 很可能会拿齐；池空之后改开知识卡三选一，避免精英/Boss 的奖励变成静默跳过。
 */
function afterReward() {
  // 增益牌池空时 openBossReward 会改开知识卡三选一；这轮奖励走完就收尾，
  // 不能再按节点类型开一次增益面板，否则会在"知识卡 → 精英奖励"之间循环。
  if (G.powerFallback) { G.powerFallback = false; finishNode(); return; }
  const t = G.node?.type;
  if (t === 'elite') { openBossReward(); return; }
  if (t === 'fight' && Math.random() < BAL.powerDrop) { openBossReward(); return; }
  finishNode();
}

/**
 * 精英 / 幕 Boss 战后的奖励。原来是"选一件遗物，直接生效一辈子"，现在变成
 * "选一张增益牌塞进牌组"——你要抽到它、付得起它的费用、打出它，它才开始工作。
 *
 * 代价换来两件事：牌组会因此变厚（稀释知识卡，这是真实的构筑成本），
 * 以及每场战斗都要重新做一次"先答题还是先点灯"的决定。
 *
 * 幕 Boss 也走这里：100 层里有 5 个 Boss，如果过幕什么都不给，第 4、5 幕的
 * 牌组会和第 1 幕一样薄，而敌人已经厚了一倍。
 */
export function openBossReward() {
  const owned: Record<string, boolean> = {};
  G.deck.forEach((id) => { owned[baseIdOf(id)] = true; });
  const pool = shuffle(POWERS.filter((p) => !owned[powerCardId(p.id)])).slice(0, 3);
  if (!pool.length) {
    // 6 种增益牌拿齐后，列表里已经没有"新"牌。继续 finishNode 会让
    // 后半程的精英/Boss 奖励静默消失；改给一次知识卡三选一，至少还有构筑价值。
    G.powerFallback = true;
    openReward();
    return;
  }
  G.panel = { k: 'power', pool: pool.map((p) => powerCardOf(p.id)) };
}

export function takePower(cardId: string) {
  if (G.panel.k !== 'power') return;
  if (!G.panel.pool.some((c) => c.id === cardId)) return;
  G.deck.push(cardId);
  const p = powerById(cardId.replace('pow:', ''));
  log(`「${p?.name ?? '增益'}」加入牌组 —— 抽到它，付费用打出，本场生效`, 'hi');
  finishNode();
}

/** 增益牌可以不要。牌组厚度是真实的成本，所以"不拿"必须是一个选项。 */
export function skipPower() {
  if (G.panel.k !== 'power') return;
  log('你没有拿走任何东西', '');
  finishNode();
}
