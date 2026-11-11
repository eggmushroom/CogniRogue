import { BAL, POWERS } from '../model/data';
import type { CardDef, PowerId } from '../model/types';
import { G, log } from '../infra/state';
import { emit } from '../infra/events';
import { shuffle } from '../infra/util';
import { PACK } from '../cards/pack';
import { baseIdOf } from '../cards/registry';
import { applyInstant, onceThisStage, rulesOf } from '../cards/powers';
import { finishNode } from './nodes';

/**
 * journey/rewards —— 战后奖励。
 *
 * 两条奖励是**两种东西**：
 *   - 知识卡：往牌组里塞一张，是构筑（厚度有代价，抽到才能用）；
 *   - 增益：精英 / 幕 Boss 掉，**拾取即生效、整局亮着**，不进牌组。
 *
 * 这两条以前是同一个形状（"往牌组里塞一张增益牌"），于是玩家要抽到它、付得起它的费用、
 * 打出它，它才开始工作 —— 一场打完也不一定见得到。现在增益回到"掉什么、立刻就有什么"。
 */
function rewardPool(n: number): CardDef[] {
  const copies: Record<string, number> = {};
  G.deck.forEach((id) => { copies[baseIdOf(id)] = (copies[baseIdOf(id)] || 0) + 1; });
  // 上限读规则表：书挡把每种卡从 3 张抬到 4 张，奖励池必须跟着变宽，
  // 否则那张牌在"该生效的地方"仍然是旧的 3。
  const cap = rulesOf().maxCopies;
  const fresh = PACK.cards.filter((c) => !copies[c.id]);
  const room = PACK.cards.filter((c) => (copies[c.id] || 0) < cap);
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
  // 便签：把这一屏从三选一变成四选一（`R.rewardPicks`），整局常驻。
  // 账本：这一幕**第一次**战后奖励再多一张，一幕一次 ——
  // 两个都是"多一个选项"，但一个问"这一局带没带便签"，一个问"这是不是幕内第一次"，
  // 所以它们叠在一起是五选一，不是同一个数的两次覆盖。
  const base = rulesOf().rewardPicks;
  const bonus = onceThisStage('ledger') ? BAL.ledgerPicks : 0;
  G.panel = { k: 'reward', cards: rewardPool(base + bonus) };
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
 * 掉一个增益，**当场生效**。
 *
 * 只有精英和幕 Boss 掉；每种只有一个（已拥有的排除），所以池子空了就是空 ——
 * 这时返回 null，由调用方决定是直接收尾还是换别的奖励。
 * 池子按"一局会走过多少个精英 / Boss"配到四十个（`POWERS`），正常一局掉不完，
 * 但真拿齐了也不该再塞重复的（叠加会让沙漏变成 +5 行动力）。
 */
export function grantPower(): PowerId | null {
  const p = shuffle(POWERS.filter((q) => !G.powers.includes(q.id)))[0];
  if (!p) return null;
  G.powers.push(p.id);
  // 「拾取即结算」的那一类（书脊 / 藏书票 / 裁纸刀 / 树脂 / 抛光布）不等下一场，
  // 在这里就把效果落到这一局上。它是**所有**增益的唯一发放口，所以开局带进来的
  // 那张走的也是同一行（见 `journey/run.ts` 的 `startRun`）。
  const instant = p.scope === 'instant' ? applyInstant(p.id) : '';
  log(`精英掉落「${p.name}」—— ${instant || p.card}（整局生效）`, 'hi');
  emit({ t: 'power', id: p.id });
  return p.id;
}

/**
 * 关掉掉落面板，回到地图。
 *
 * 没有"不要"这个选项：增益不占牌位、不稀释牌组，拒绝它没有任何好处。
 * 上一版必须给一个"不拿"，是因为那时候它要占掉一张牌的位置。
 */
export function ackPower() {
  if (G.panel.k !== 'powerdrop') return;
  finishNode();
}

/** 选完知识卡之后，看这个节点还剩不剩下增益可掉。 */
function afterReward() {
  const t = G.node?.type;
  if (t === 'elite' || t === 'boss') {
    const id = grantPower();
    if (id) { G.panel = { k: 'powerdrop', id }; return; }
    // 池子空了：精英这一场只剩刚才那张知识卡，别开一个空面板
  }
  finishNode();
}

/**
 * 幕间 / 幕 Boss 的增益掉落。`nextStage()` 换完地图之后调它。
 *
 * 之所以单独一个入口，是因为过幕时节点已经没了（`G.node = null`），
 * `afterReward` 读节点类型那套在这里不成立。
 */
export function openPowerDrop() {
  const id = grantPower();
  if (id) G.panel = { k: 'powerdrop', id };
}
