import { BAL, POWERS } from '../model/data';
import type { EventDef, PowerDef } from '../model/types';
import { G, log } from '../infra/state';
import { emit } from '../infra/events';
import { pick } from '../infra/util';
import { PACK } from '../cards/pack';
import { baseIdOf, defOf, isUpgraded, powerCardId, upgradedId } from '../cards/registry';
import { cardKind } from '../cards/kinds';
import { finishNode } from './nodes';

/**
 * journey/events —— 随机事件与复习点。
 *
 * 事件选项的 `run()` 直接改 G，返回一句要写进日志的话；表现层只负责
 * 把这句话和 EVENTS 里的标题、副标题画出来。所有"得到增益"都走
 * grantRandomPower —— 塞一张牌进牌组，不是白给一个永久效果。
 *
 * ## 付费的事件选项为什么要"先打开选牌面板、收尾时才扣钱"
 *
 * 「旧笔记本」原先的顺序是"打开选牌 → 立刻扣 10 点生命"。玩家看到的是：
 * 点了一下，血先掉了，然后才被要求挑一张牌 —— 而选牌面板**没有返回键**
 * （`box(..., null)`），于是他必须在已经付出代价之后做一个只能往前走的决定。
 *
 * 现在改成：打开面板时只挂一个待付款项（`G.pendingCost`），挑完牌才真的扣。
 * 面板因此可以取消（`cancelPanel`），取消后事件留在原地、钱一分没扣。
 */
/** 事件里"要付的血"挂在 `G.pendingCost` 上，选完牌才结算（见 `GameState.pendingCost`）。 */

/** 事件里的"得到一个增益"：同样是塞一张牌进牌组，不是白给一个永久效果。 */
function grantRandomPower(): PowerDef | null {
  const owned: Record<string, boolean> = {};
  G.deck.forEach((id) => { owned[baseIdOf(id)] = true; });
  const pool = POWERS.filter((p) => !owned[powerCardId(p.id)]);
  if (!pool.length) return null;
  const p = pick(pool);
  G.deck.push(powerCardId(p.id));
  return p;
}

/** 返回实际回复量：满血时是 0，演出不该凭空飘一个 +N。 */
function healBy(n: number) {
  const before = G.hp;
  G.hp = Math.min(G.maxHp, G.hp + n);
  const got = G.hp - before;
  if (got > 0) emit({ t: 'heal', n: got });
  return got;
}

/** 返回实际扣血量：1 血时事件不能致死，也因此没有 "+12" 的假演出。 */
function hurtBy(n: number) {
  const before = G.hp;
  G.hp = Math.max(1, G.hp - n);
  const lost = before - G.hp;
  if (lost > 0) emit({ t: 'hurt', n: lost });
  return lost;
}

export function restHeal() {
  const wanted = Math.round(G.maxHp * BAL.restPct);
  const got = healBy(wanted);
  log(got === wanted
    ? `休息，回复 ${got} 点生命`
    : `休息，回复 ${got} 点生命（已达到上限 ${G.maxHp}）`, 'hi');
  finishNode();
}

/**
 * 打开精炼 / 遗忘的选牌面板。
 *
 * 基础牌**也在列表里**：它们是这一局的保底，但不是不可动的圣物 ——
 * 「保底」的意思是"你至少还有牌能打"，不是"你不能拿它做构筑决定"。
 * 把一张基础斩击精炼成 7 伤、或者丢掉一张基础格挡去换知识卡，都是合法的选择。
 *
 * 唯一要守住的地板是**牌组不能空**：删到只剩个位数张之后，每回合抽 5 张
 * 就会反复抽到同一批牌，这一局已经不是在打牌了。所以删牌要求牌组 > 4 张。
 *
 * 精炼是**按张**的（见 `cards/registry.ts` 的 `UP_MARK`）：面板上每份副本各占一格，
 * 挑中的那一张换成 `+` 后缀的 id，同名的其余几张原样不动。
 */
export function openCardPick(mode: 'up' | 'rm'): boolean {
  if (mode === 'rm' && G.deck.length <= 4) { log('牌组太薄，不能再删了', ''); return false; }
  if (mode === 'up'
    && !G.deck.some((id) => cardKind(defOf(id)) !== 'power' && !isUpgraded(id))) {
    log('没有能精炼的牌', '');
    return false;
  }
  G.panel = { k: 'cardpick', mode };
  return true;
}

export function upgradeCard(i: number) {
  const id = G.deck[i];
  if (!id) return;
  // 增益牌没有攻/挡可加，所以它不在精炼列表里 —— 这条仍然成立。
  // 基础牌可以精炼：它是"弱但永远在"的地板，精炼之后变成"还行且永远在"，
  // 代价是这次精炼机会没花在知识卡上。
  if (cardKind(defOf(id)) === 'power') return;
  if (isUpgraded(id)) return;
  // 换 id 就是精炼：`base:strike` → `base:strike+`。牌组里其余同名副本不受影响，
  // 这也让"哪一张变强了"在存档里是确定的，不依赖数组下标或对象身份。
  G.deck[i] = upgradedId(id);
  log(`「${defOf(id).name}」被精炼：攻/挡底数 +3（按效果折算）`, 'hi');
  // 事件里"精炼一张、失去 N 点生命"这类代价在这里才收：玩家已经看到自己
  // 挑了哪一张、也看到了精炼后的数值，反悔的窗口一直开到这一下之前。
  const paid = settlePendingCost();
  if (paid) log(paid, 'bad');
  finishNode();
}

export function forgetCard(i: number) {
  const id = G.deck[i];
  if (!id) return;
  const d = defOf(id);
  // 牌组不能删空：少于 5 张时每回合都在重复抽同一批牌，这一局已经不是在打牌了。
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
    text: '地上一摊被别人拆散的知识卡。墨迹还新，边缘被人反复捏过——这个人大概也在这里卡住过。',
    opts: [
      {
        t: '拾起来，收进自己的牌组', sub: '获得一张随机知识卡（已精炼），失去 8 点生命',
        run: () => {
          // 和战后奖励同一条上限：同一种卡最多 BAL.maxCopies 张。
          // 数的是**牌种**，所以要先剥掉精炼后缀 —— 否则 `c00` 和 `c00+`
          // 会被算成两种不同的牌，上限就形同虚设。
          const copies: Record<string, number> = {};
          G.deck.forEach((id) => { copies[baseIdOf(id)] = (copies[baseIdOf(id)] || 0) + 1; });
          const pool = PACK.cards.filter((c) => (copies[c.id] || 0) < BAL.maxCopies);
          if (!pool.length) return '每种卡你都收齐了上限 —— 这一次你只是把它们理了一遍。';
          const lost = hurtBy(8);
          const c = pick(pool);
          // 这张卡一进牌组就是精炼状态：它的 id 直接带 `+` 后缀。
          // 这样它和牌组里可能已有的同名卡是**两张不同的牌**（一张强化过、一张没有），
          // 和"精炼只作用于单张卡"这条规则一致。
          G.deck.push(upgradedId(c.id));
          return `你把「${c.topic}」那张卡收进了牌组（已精炼），代价是 ${lost} 点生命。`;
        },
      },
      {
        t: '按主题重新排好', sub: '回复 16 点生命——整理本身也是复习',
        run: () => {
          const got = healBy(16);
          return got ? `你按主题排好了它们，回了 ${got} 点生命。` : '你按主题排好了它们 —— 你已经满血，不需要再回。';
        },
      },
      { t: '绕过去', sub: '什么也不发生', run: () => '你没有碰它。' },
    ],
  },
  {
    id: 'notebook', title: '旧笔记本',
    text: '一本写着你名字的笔记本，翻开全是错的题。每一道旁边都标了当时的想法——大部分标错了。',
    opts: [
      {
        t: '把错题重抄一遍', sub: '精炼一张你选择的牌（攻/挡底数 +3），失去 10 点生命',
        run: () => {
          // 先确认有牌可精炼，再把面板交给 picker；血在**挑完之后**才扣
          // （见本文件顶部「付费的事件选项」）。挑牌期间可以取消，取消了不收钱。
          if (!openCardPick('up')) return null;
          G.pendingCost = 10;
          return '你翻开一页错题；选一张要精炼的牌（选完才付 10 点生命）。';
        },
      },
      {
        t: '把错得最多的那几页撕掉', sub: '永久移除一张你选择的牌，回复 10 点生命',
        run: () => {
          // 移除是"收益"，不存在反悔的代价，所以回血仍然在这里当场结算。
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
          // 不再随机抽：玩家自己选要交出哪一张，事件才是一个构筑决定。
          if (!openCardPick('rm')) return null;
          return '你把一张卡留在了灯下；选一张要留下的牌。';
        },
      },
      {
        t: '给他 12 点生命', sub: '一张增益牌进牌组（要抽到、要打出才生效）',
        run: () => {
          // 先确认还有牌可给，再扣血：池空时不能让人白付 12 点。
          const r = grantRandomPower();
          if (!r) return '他已经没有东西可以给你了。';
          const lost = hurtBy(12);
          return `你付了 ${lost} 点生命。「${r.name}」进了你的牌组：${r.card}。抽到它，付它的费用打出去（增益牌不答题，这笔钱不退）。`;
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
          return got ? `你在灯下坐了一会儿，回了 ${got} 点生命。` : '你在灯下坐了一会儿 —— 你已经满血，不需要再回。';
        },
      },
      {
        t: '去点那盏灭的灯', sub: '一张增益牌进牌组，但会掉 10 点生命',
        run: () => {
          // 先确认还有牌可给，再扣血：池空时不能让人白付 10 点。
          const r = grantRandomPower();
          if (!r) return '灯已经全亮着，没有新的增益可拿 —— 你没有付出什么。';
          const lost = hurtBy(10);
          return `灯亮了，你付出 ${lost} 点生命；牌组里多了一张「${r.name}」：${r.card}。`;
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
  // null = 这个选项没被消费（比如没有可精炼/可删的牌）；面板留在原地，
  // 让玩家改选别的。否则"打开选牌面板"会被 finishNode 当场关掉。
  if (msg === null) return;
  // 选项可能把面板交给 cardpick；选牌由 picker 自己收尾（upgradeCard/forgetCard 会 finishNode）。
  if (G.panel.k === 'event') finishNode();
}

/**
 * 选牌面板收尾时结算待付款项。**只有真的选了牌才收钱** ——
 * 取消 / Esc 走的是 `cancelPanel`，那里把 `G.pendingCost` 直接清零。
 */
export function settlePendingCost(): string {
  const n = G.pendingCost;
  if (n <= 0) return '';
  G.pendingCost = 0;
  const lost = hurtBy(n);
  return `这一页抄完，你付出 ${lost} 点生命。`;
}
