import { BAL, POWERS } from '../model/data';
import type { CardDef, CardId, PowerId } from '../model/types';
import { G } from '../infra/state';
import { emit } from '../infra/events';
import { shuffle } from '../infra/util';
import { PACK } from '../cards/pack';
import { deckCopies, UP_MARK } from '../cards/registry';
import { applyInstant, onceThisStage, rulesStatic } from '../cards/powers';
import { finishNode } from './nodes';

/**
 * 战后奖励。两种东西：知识卡进牌组，增益拾取即生效、不进牌组。
 * 只有精英和幕 Boss 掉增益。
 */
function rewardPool(n: number): CardDef[] {
  const copies = deckCopies();
  // 上限读规则表：书挡会抬高每种卡的上限，奖励池必须跟着变宽。
  const cap = rulesStatic().maxCopies;
  const fresh = PACK.cards.filter((c) => !copies[c.id]);
  const room = PACK.cards.filter((c) => (copies[c.id] || 0) < cap);
  // 只去重“同一张卡”（同 id）；强弱、取舍、同名换皮都摆在玩家面前自己选。
  const pool = shuffle(fresh).concat(shuffle(room));
  const out: CardDef[] = [];
  const seen = new Set<string>();
  for (const c of pool) {
    if (out.length >= n) break;
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out;
}

export function openReward() {
  // 便签：把这一屏从三选一变成四选一（`R.rewardPicks`），整局常驻。
  // 账本：这一幕**第一次**战后奖励再多一张，而且选中的那张直接精炼：
  // 只是"多一个选项"的话，它仍然被便签完全覆盖；多出来的精炼才是它自己的账。
  const base = rulesStatic().rewardPicks;
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
  afterReward();
}

export function skipReward() {
  if (G.panel.k !== 'reward') return;
  afterReward();
}

/**
 * 掉一个增益并当场生效；池子空了返回 null。
 * 这是精英 / 幕 Boss 掉落与调试发放的唯一入口；开局模式带的增益由 `startRun`
 * 直接写进 `G.powers`，不走这里（它没有“掉落”这件事）。
 */
export function grantPower(): { id: PowerId; cards?: CardId[] } | null {
  const p = shuffle(POWERS.filter((q) => !G.powers.includes(q.id)))[0];
  if (!p) return null;
  G.powers.push(p.id);
  // 拾取即结算的那一类不等下一场，在这里就落到这一局上。
  const out = p.scope === 'instant' ? applyInstant(p.id) : null;
  emit({ t: 'power', id: p.id });
  // 有卡要摆的时候，牌面自己会说话；没有卡，那句话术就是玩家唯一的信息 ——
  // 它早先被整个丢掉，于是「树脂」只留下一个「树脂 生效」。
  if (out?.note && !out.cards?.length) emit({ t: 'note', text: out.note });
  return { id: p.id, cards: out?.cards };
}

/** 关掉掉落面板，回到地图。没有"不要"这个选项。 */
export function ackPower() {
  const p = G.panel;
  if (p.k !== 'powerdrop') return;
  // 藏书那类增益当场往牌组里塞了牌：先让玩家看清是哪几张，再回地图。
  if (p.cards?.length) { G.panel = { k: 'cardget', ids: p.cards }; return; }
  finishNode();
}

/** 选完知识卡之后，看这个节点还剩不剩下增益可掉。 */
function afterReward() {
  const t = G.node?.type;
  if (t === 'elite' || t === 'boss') {
    const got = grantPower();
    if (got) { G.panel = { k: 'powerdrop', id: got.id, cards: got.cards }; return; }
    // 池子空了：精英这一场只剩刚才那张知识卡，别开一个空面板
  }
  finishNode();
}

/** 幕间掉落。过幕时节点已经没了，所以单独一个入口。 */
export function openPowerDrop() {
  const got = grantPower();
  if (got) G.panel = { k: 'powerdrop', id: got.id, cards: got.cards };
}
