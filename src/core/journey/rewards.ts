import { BAL, POWERS } from '../model/data';
import type { CardDef, PowerId } from '../model/types';
import { G, log } from '../infra/state';
import { emit } from '../infra/events';
import { shuffle } from '../infra/util';
import { PACK } from '../cards/pack';
import { baseIdOf, UP_MARK } from '../cards/registry';
import { applyInstant, onceThisStage, rulesOf } from '../cards/powers';
import { finishNode } from './nodes';

/**
 * 战后奖励。两种东西：知识卡进牌组，增益拾取即生效、不进牌组。
 * 只有精英和幕 Boss 掉增益。
 */
function rewardPool(n: number): CardDef[] {
  const copies: Record<string, number> = {};
  G.deck.forEach((id) => { copies[baseIdOf(id)] = (copies[baseIdOf(id)] || 0) + 1; });
  // 上限读规则表：书挡会抬高每种卡的上限，奖励池必须跟着变宽。
  const cap = rulesOf().maxCopies;
  const fresh = PACK.cards.filter((c) => !copies[c.id]);
  const room = PACK.cards.filter((c) => (copies[c.id] || 0) < cap);
  // 三张来自不同主题
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
  // 账本：这一幕**第一次**战后奖励再多一张，而且选中的那张直接精炼：
  // 只是"多一个选项"的话，它仍然被便签完全覆盖；多出来的精炼才是它自己的账。
  const base = rulesOf().rewardPicks;
  const ledger = onceThisStage('ledger');
  const bonus = ledger ? BAL.ledgerPicks : 0;
  G.panel = { k: 'reward', cards: rewardPool(base + bonus), ledger };
}

export function takeCard(i: number) {
  if (G.panel.k !== 'reward') return;
  const c = G.panel.cards[i];
  if (!c) return;
  // 牌组里只存 id，精炼过的那一张带 `+` 后缀。账本那一屏选中的牌直接带后缀；
  // 其余奖励拿到的是**新的一张**，想要强化版，得另外花一次精炼在它身上。
  const id = G.panel.ledger ? c.id + UP_MARK : c.id;
  G.deck.push(id);
  log(`「${c.topic}」加入牌组${G.panel.ledger ? '（账本已精炼）' : ''}（${G.deck.length} 张）`, 'hi');
  afterReward();
}

export function skipReward() {
  if (G.panel.k !== 'reward') return;
  afterReward();
}

/**
 * 掉一个增益并当场生效；池子空了返回 null。
 * 这是所有增益的唯一发放口，开局带的增益也走这里。
 */
export function grantPower(): PowerId | null {
  const p = shuffle(POWERS.filter((q) => !G.powers.includes(q.id)))[0];
  if (!p) return null;
  G.powers.push(p.id);
  // 拾取即结算的那一类不等下一场，在这里就落到这一局上。
  const instant = p.scope === 'instant' ? applyInstant(p.id) : '';
  log(`精英掉落「${p.name}」：${instant || p.card}（整局生效）`, 'hi');
  emit({ t: 'power', id: p.id });
  return p.id;
}

/** 关掉掉落面板，回到地图。没有"不要"这个选项。 */
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

/** 幕间掉落。过幕时节点已经没了，所以单独一个入口。 */
export function openPowerDrop() {
  const id = grantPower();
  if (id) G.panel = { k: 'powerdrop', id };
}
