import { BAL } from '../model/data';
import type { CardDef, EventDef } from '../model/types';
import { G, log } from '../infra/state';
import { healHp, loseHp } from '../infra/write';
import { emit } from '../infra/events';
import { pick } from '../infra/util';
import { PACK } from '../cards/pack';
import { baseIdOf, defOf, isUpgraded, upgradedId } from '../cards/registry';
import { onceThisStage, rulesOf } from '../cards/powers';
import { finishNode } from './nodes';

/** 随机事件与复习点。选项的 run() 改 G 并返回一句日志。 */
/** 事件不发增益：增益只由精英和幕 Boss 掉。 */
/** 付费事件的血挂在 `G.pendingCost` 上，选完牌才结算（见 `GameState.pendingCost`）。 */

/** 得到一张知识卡，上限同战后奖励 */
function grantCard(up: boolean): CardDef | null {
  // 数牌种，先剥 + 后缀，否则同名卡算两种
  const copies: Record<string, number> = {};
  G.deck.forEach((id) => { copies[baseIdOf(id)] = (copies[baseIdOf(id)] || 0) + 1; });
  // 上限读规则表，书挡把它 +1
  const pool = PACK.cards.filter((c) => (copies[c.id] || 0) < rulesOf().maxCopies);
  if (!pool.length) return null;
  const c = pick(pool);
  G.deck.push(up ? upgradedId(c.id) : c.id);
  return c;
}

function healBy(n: number) {
  const got = healHp(n);
  if (got > 0) emit({ t: 'heal', n: got });
  return got;
}

/** 扣血，下限 1：随机事件不该成为一局的终点 */
function hurtBy(n: number) {
  const lost = loseHp(n, 1);
  if (lost > 0) emit({ t: 'hurt', n: lost });
  return lost;
}

export function restHeal() {
  const pct = rulesOf().restPct;
  // 地图册：这一幕第一次复习多回固定的一段
  const extra = onceThisStage('atlas') ? BAL.atlasHeal : 0;
  const wanted = Math.round(G.maxHp * pct) + extra;
  const got = healBy(wanted);
  log(got === wanted
    ? `休息，回复 ${got} 点生命${extra ? `（地图册额外 +${extra}）` : ''}`
    : `休息，回复 ${got} 点生命（已达到上限 ${G.maxHp}）`, 'hi');
  finishNode();
}

/** 打开精炼 / 遗忘的选牌面板。删牌要求牌组 > 4，精炼按张 */
export function openCardPick(mode: 'up' | 'rm'): boolean {
  if (mode === 'rm' && G.deck.length <= 4) { log('牌组太薄，不能再删了', ''); return false; }
  if (mode === 'up' && !G.deck.some((id) => !isUpgraded(id))) {
    log('没有能精炼的牌', '');
    return false;
  }
  G.panel = { k: 'cardpick', mode };
  return true;
}

export function upgradeCard(i: number) {
  const id = G.deck[i];
  if (!id) return;
  if (isUpgraded(id)) return;
  // 换 id 就是精炼：base:strike → base:strike+
  G.deck[i] = upgradedId(id);
  log(`「${defOf(id).name}」被精炼：攻/挡底数 +3（按效果折算）`, 'hi');
  // 代价在选完牌时才收
  const paid = settlePendingCost();
  if (paid) log(paid, 'bad');
  finishNode();
}

export function forgetCard(i: number) {
  const id = G.deck[i];
  if (!id) return;
  const d = defOf(id);
  // 少于 5 张时每回合重复抽同一批牌
  if (G.deck.length <= 4) { log('牌组太薄，不能再删了', ''); finishNode(); return; }
  G.deck.splice(i, 1);
  log(`你永久放下了「${d.name}」`, '');
  const paid = settlePendingCost();
  if (paid) log(paid, 'bad');
  finishNode();
}

export const EVENTS: EventDef[] = [
  {
    id: 'index-cards', title: '散落的索引卡',
    text: '地上一摊被别人拆散的知识卡。墨迹还新，边缘被人反复捏过：这个人大概也在这里卡住过。',
    opts: [
      {
        t: '拾起来，收进自己的牌组', sub: '获得一张随机知识卡（已精炼），失去 8 点生命',
        run: () => {
          // 先确认有卡可给，再扣血
          const c = grantCard(true);
          if (!c) return '每种卡你都收齐了上限：这一次你只是把它们理了一遍。';
          const lost = hurtBy(8);
          return `你把「${c.topic}」那张卡收进了牌组（已精炼），代价是 ${lost} 点生命。`;
        },
      },
      {
        t: '按主题重新排好', sub: '回复 16 点生命：整理本身也是复习',
        run: () => {
          const got = healBy(16);
          return got ? `你按主题排好了它们，回了 ${got} 点生命。` : '你按主题排好了它们：你已经满血，不需要再回。';
        },
      },
      { t: '绕过去', sub: '什么也不发生', run: () => '你没有碰它。' },
    ],
  },
  {
    id: 'notebook', title: '旧笔记本',
    text: '一本写着你名字的笔记本，翻开全是错的题。每一道旁边都标了当时的想法：大部分标错了。',
    opts: [
      {
        t: '把错题重抄一遍', sub: '精炼一张你选择的牌（攻/挡底数 +3），失去 10 点生命',
        run: () => {
          // 有牌可精炼才开面板，血在挑完之后扣
          if (!openCardPick('up')) return null;
          G.pendingCost = 10;
          return '你翻开一页错题；选一张要精炼的牌（选完才付 10 点生命）。';
        },
      },
      {
        t: '把错得最多的那几页撕掉', sub: '永久移除一张你选择的牌，回复 10 点生命',
        run: () => {
          if (!openCardPick('rm')) return null;
          const got = healBy(10);
          return `你撕掉一页，回了 ${got} 点生命；选一张要移除的牌。`;
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
        t: '把一张卡留下来', sub: '永久移除一张你选择的牌',
        run: () => {
          if (!openCardPick('rm')) return null;
          return '你把一张卡留在了灯下；选一张要留下的牌。';
        },
      },
      {
        t: '给他 12 点生命', sub: '他替你精炼一张你选择的牌',
        run: () => {
          if (!openCardPick('up')) return null;
          G.pendingCost = 12;
          return '你把手按在钱袋上；选一张要精炼的牌（选完才付 12 点生命）。';
        },
      },
      { t: '什么也不留，转身离开', sub: '什么也不发生', run: () => '他没有拦你。' },
    ],
  },
  {
    id: 'lamp-hall', title: '长明灯廊',
    text: '一整条廊道的灯都亮着，只有尽头那盏是灭的。你可以在这里坐一会儿，也可以去把那盏灯点上。',
    opts: [
      { t: '坐一会儿', sub: '回复 22 点生命',
        run: () => {
          const got = healBy(22);
          return got ? `你在灯下坐了一会儿，回了 ${got} 点生命。` : '你在灯下坐了一会儿：你已经满血，不需要再回。';
        },
      },
      {
        t: '去点那盏灭的灯', sub: '获得一张随机知识卡，但会掉 10 点生命',
        run: () => {
          const c = grantCard(false);
          if (!c) return '灯亮起来，照见的还是同一批卡：没有新的可抄。';
          const lost = hurtBy(10);
          return `灯亮了，你借着光抄下「${c.topic}」那张卡，代价是 ${lost} 点生命。`;
        },
      },
      { t: '转身离开', sub: '什么也不发生', run: () => '你沿着廊道走过去了。' },
    ],
  },
];

export function chooseEventOption(i: number) {
  if (G.panel.k !== 'event') return;
  const msg = G.panel.ev.opts[i]?.run();
  if (msg) log(msg, 'hi');
  // null 表示选项没被消费，面板留在原地
  if (msg === null) return;
  // 选项可能把面板交给 cardpick，收尾由 picker 自己做
  if (G.panel.k === 'event') finishNode();
}

/** 选牌收尾时结算待付款项。取消走 `cancelPanel`，那里直接清零 */
export function settlePendingCost(): string {
  const n = G.pendingCost;
  if (n <= 0) return '';
  G.pendingCost = 0;
  const lost = hurtBy(n);
  return `这一页抄完，你付出 ${lost} 点生命。`;
}
