import { POWERS } from '../model/data';
import type { EventDef, PowerDef } from '../model/types';
import { G, log, topTopic } from '../infra/state';
import { emit } from '../infra/events';
import { pick } from '../infra/util';
import { PACK, topics } from '../library/pack';
import { defOf, powerCardId } from '../cards/registry';
import { cardKind } from '../cards/kinds';
import { finishNode } from './nodes';

/**
 * journey/events —— 随机事件与复习点。
 *
 * 事件选项的 `run()` 直接改 G，返回一句要写进日志的话；表现层只负责
 * 把这句话和 EVENTS 里的标题、副标题画出来。所有"得到增益"都走
 * grantRandomPower —— 塞一张牌进牌组，不是白给一个永久效果。
 */

/** 事件里的"得到一个增益"：同样是塞一张牌进牌组，不是白给一个永久效果。 */
function grantRandomPower(): PowerDef | null {
  const owned: Record<string, boolean> = {};
  G.deck.forEach((e) => { owned[e.id] = true; });
  const pool = POWERS.filter((p) => !owned[powerCardId(p.id)]);
  if (!pool.length) return null;
  const p = pick(pool);
  G.deck.push({ id: powerCardId(p.id), up: 0 });
  return p;
}

function healBy(n: number) {
  G.hp = Math.min(G.maxHp, G.hp + n);
  emit({ t: 'heal', n });
}
function hurtBy(n: number) {
  G.hp = Math.max(1, G.hp - n);
  emit({ t: 'hurt', n });
}

export function restHeal() {
  const n = Math.round(G.maxHp * 0.32);
  G.hp = Math.min(G.maxHp, G.hp + n);
  log(`休息，回复 ${n} 点生命`, 'hi');
  emit({ t: 'heal', n });
  finishNode();
}

export function openCardPick(mode: 'up' | 'rm') {
  // 基础牌不可精炼、不可删除，所以列表里不会出现它们；能不能打开面板，
  // 要按"真正可动的那几张"算，而不是按牌组总长（基础牌永远占着 3 个位）。
  const movable = G.deck.filter((e) => cardKind(defOf(e)) !== 'basic');
  if (mode === 'rm' && movable.length <= 2) { log('牌组太薄，不能再删了', ''); return; }
  if (mode === 'up' && !movable.some((e) => cardKind(defOf(e)) !== 'power')) {
    log('没有能精炼的牌', '');
    return;
  }
  G.panel = { k: 'cardpick', mode };
}

export function upgradeCard(i: number) {
  const e = G.deck[i];
  if (!e) return;
  // 增益牌没有攻/挡可加，基础牌是初始牌组的保底（精炼会让它偏离"弱但永远在"的定位）
  if (cardKind(defOf(e)) === 'power') return;
  if (cardKind(defOf(e)) === 'basic') { log('基础牌不用精炼，它们本来就一直在', ''); finishNode(); return; }
  e.up = 1;
  log(`「${defOf(e).topic}」被精炼：攻 +3、挡 +3`, 'hi');
  finishNode();
}

export function forgetCard(i: number) {
  const d = defOf(G.deck[i]);
  if (!d) return;
  // 基础牌是这一局的地板：删了它，"永远有牌可打"就不成立了
  if (cardKind(d) === 'basic') { log('基础牌是初始牌组，不能丢', ''); finishNode(); return; }
  G.deck.splice(i, 1);
  log(`你永久放下了「${d.topic}」`, '');
  finishNode();
}

export const EVENTS: EventDef[] = [
  {
    id: 'index-cards', title: '散落的索引卡',
    text: '地上一摊被别人拆散的知识卡。墨迹还新，边缘被人反复捏过——这个人大概也在这里卡住过。',
    opts: [
      {
        t: '拾起来，收进自己的牌组', sub: '获得一张随机知识卡，已精炼（攻/挡 +3）',
        run: () => {
          const c = pick(PACK.cards);
          G.deck.push({ id: c.id, up: 1 });
          return `你把「${c.topic}」那张卡收进了牌组。`;
        },
      },
      {
        t: '按主题重新排好', sub: '回复 16 点生命——整理本身也是复习',
        run: () => { healBy(16); return '你按主题排好了它们，回了 16 点生命。'; },
      },
      { t: '绕过去', sub: '什么也不发生', run: () => '你没有碰它。' },
    ],
  },
  {
    id: 'notebook', title: '旧笔记本',
    text: '一本写着你名字的笔记本，翻开全是错的题。每一道旁边都标了当时的想法——大部分标错了。',
    opts: [
      {
        t: '一页一页看完', sub: '本局所有主题攻击 +2，但你会掉 12 点生命',
        run: () => {
          topics().forEach((t) => { G.topicAtk[t] = (G.topicAtk[t] || 0) + 2; });
          hurtBy(12);
          return '看完自己犯过的错，比做十道新题疼，但有用。';
        },
      },
      {
        t: '只翻你最近错的那几页', sub: '本局该主题攻击 +3',
        run: () => {
          const t = topTopic() || topics()[0];
          G.topicAtk[t] = (G.topicAtk[t] || 0) + 3;
          return `「${t}」的攻击 +3。`;
        },
      },
      { t: '合上，放回原处', sub: '什么也不发生', run: () => '你把它放了回去。' },
    ],
  },
  {
    id: 'keeper', title: '守夜人',
    text: '一个坐在灯下的人抬起头："想过去，留一样东西。"他没有说是什么东西。',
    opts: [
      {
        t: '把一张卡留下来', sub: '永久移除牌组里一张卡，回复 20 点生命',
        run: () => {
          if (G.deck.length > 5) {
            const i = Math.floor(Math.random() * G.deck.length);
            const d = defOf(G.deck[i]);
            G.deck.splice(i, 1);
            healBy(20);
            return `「${d.topic}」被留下了，你换回 20 点生命。`;
          }
          healBy(20);
          return '你的牌组太薄了，他只收下了 20 点生命。';
        },
      },
      {
        t: '给他 12 点生命', sub: '一张增益牌进牌组（要抽到、要打出才生效）',
        run: () => {
          hurtBy(12);
          const r = grantRandomPower();
          if (!r) { healBy(12); return '他已经没有东西可以给你了。'; }
          return `「${r.name}」进了你的牌组：${r.card}。抽到它，花 1 点行动力打出去。`;
        },
      },
      { t: '什么也不留，转身离开', sub: '什么也不发生', run: () => '他没有拦你。' },
    ],
  },
  {
    id: 'lamp-hall', title: '长明灯廊',
    text: '一整条廊道的灯都亮着，只有尽头那盏是灭的。你可以在这里坐一会儿，也可以去把那盏灯点上。',
    opts: [
      { t: '坐一会儿', sub: '回复 22 点生命', run: () => { healBy(22); return '你在灯下坐了一会儿，回了 22 点生命。'; } },
      {
        t: '去点那盏灭的灯', sub: '一张增益牌进牌组，但会掉 10 点生命',
        run: () => {
          hurtBy(10);
          const r = grantRandomPower();
          if (!r) return '灯亮了，什么也没发生。';
          return `灯亮了，牌组里多了一张「${r.name}」：${r.card}。`;
        },
      },
    ],
  },
];

export function chooseEventOption(i: number) {
  if (G.panel.k !== 'event') return;
  const msg = G.panel.ev.opts[i]?.run();
  if (msg) log(msg, 'hi');
  finishNode();
}
