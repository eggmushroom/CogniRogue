import { BAL, POWERS } from '../model/data';
import type { CardDef } from '../model/types';
import { G, log } from '../infra/state';
import { shuffle } from '../infra/util';
import { PACK } from '../cards/pack';
import { powerById, powerCardId, powerCardOf } from '../cards/registry';
import { finishNode } from './nodes';

/**
 * journey/rewards —— 战后奖励。
 *
 * 知识卡奖励与增益牌奖励是两步：先选一张卡，再决定要不要看增益牌。
 * 两者都是「往牌组里塞一张牌」，不是白给一个永久效果。
 */
function rewardPool(n: number): CardDef[] {
  const copies: Record<string, number> = {};
  G.deck.forEach((e) => { copies[e.id] = (copies[e.id] || 0) + 1; });
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
  G.deck.push({ id: c.id, up: 0 });
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
 * 精英必给；普通战斗按 BAL.powerDrop 掉 —— 一局五场战斗大概能见着一两次。
 * 不给这个概率的话，模拟里一局只有 0.4 张增益牌：机制写得再细，玩家整局都碰不到，
 * 那就等于没做。
 */
function afterReward() {
  const t = G.node?.type;
  if (t === 'elite') { openPowerReward(); return; }
  if (t === 'fight' && Math.random() < BAL.powerDrop) { openPowerReward(); return; }
  finishNode();
}

/**
 * 精英战后的奖励。原来是"选一件遗物，直接生效一辈子"，现在变成
 * "选一张增益牌塞进牌组"——你要抽到它、花 1 点行动力打出它，它才开始工作。
 *
 * 代价换来两件事：牌组会因此变厚（稀释知识卡，这是真实的构筑成本），
 * 以及每场战斗都要重新做一次"先答题还是先点灯"的决定。
 */
function openPowerReward() {
  const owned: Record<string, boolean> = {};
  G.deck.forEach((e) => { owned[e.id] = true; });
  const pool = shuffle(POWERS.filter((p) => !owned[powerCardId(p.id)])).slice(0, 3);
  if (!pool.length) { finishNode(); return; }
  G.panel = { k: 'power', pool: pool.map((p) => powerCardOf(p.id)) };
}

export function takePower(cardId: string) {
  if (G.panel.k !== 'power') return;
  if (!G.panel.pool.some((c) => c.id === cardId)) return;
  G.deck.push({ id: cardId, up: 0 });
  const p = powerById(cardId.replace('pow:', ''));
  log(`「${p?.name ?? '增益'}」加入牌组 —— 抽到它，花 1 点行动力打出，本场生效`, 'hi');
  finishNode();
}

/** 增益牌可以不要。牌组厚度是真实的成本，所以"不拿"必须是一个选项。 */
export function skipPower() {
  if (G.panel.k !== 'power') return;
  log('你没有拿走任何东西', '');
  finishNode();
}
