import { BAL } from '../model/data';
import type { CardDef, CardPickFrom, EventDef, Panel } from '../model/types';
import { G, log } from '../infra/state';
import { healHp, loseHp, raiseMaxHp } from '../infra/write';
import { emit } from '../infra/events';
import { pick } from '../infra/util';
import { PACK } from '../cards/pack';
import { baseIdOf, defOf, isUpgraded, upGain, upgradedId } from '../cards/registry';
import { canOnceStage, onceThisStage, rulesStatic } from '../cards/powers';
import { finishNode } from './nodes';

/** 随机事件与复习点。选项的 run() 改 G 并返回一句日志。 */
/** 事件不发增益：增益只由精英和幕 Boss 掉。 */
/** 付费事件的血挂在 `G.pendingCost` 上，选完牌才结算（见 `GameState.pendingCost`）。 */

/**
 * 事件的固定生命代价与收益。**唯一来源**：副标题文案和 `run()` 里的
 * `hurtBy` / `healBy` / `G.pendingCost` 都从这里取，不许各写一个字面量。
 *
 * 为什么值得单独列一张表：这些数是事件手感的核心，调平衡时会被反复改。
 * 以前文案写「失去 8 点生命」、代码写 `hurtBy(8)`，改一处忘另一处，玩家看到
 * 的和实际扣的对不上 —— 而这类错在测试里完全看不出来（没有哪个断言在读 UI）。
 */
const FX = {
  indexCardCost: 8,
  indexSortHeal: 16,
  notebookCost: 10,
  notebookSweepHeal: 10,
  keeperCost: 12,
  lampRestHeal: 22,
  lampLightCost: 10,
  liftCost: 14,
  liftRest: 8,
  copyCost: 6,
  copyRest: 12,
  wrongPageCost: 10,
  wrongPageRest: 6,
  drawerCost: 8,
  drawerSort: 10,
  maxHpGain: 4,
  maxHpCost: 12,
  oilHeal: 14,
  cartCost: 6,
  cartHeal: 8,
  bindCost: 7,
  bindHeal: 7,
  shelfCost: 9,
  shelfHeal: 5,
  dampHeal: 6,
  lostCost: 5,
  lostRest: 12,
} as const;

/** 得到一张知识卡，上限同战后奖励 */
function grantCard(up: boolean): CardDef | null {
  // 数牌种，先剥 + 后缀，否则同名卡算两种
  const copies: Record<string, number> = {};
  G.deck.forEach((id) => { copies[baseIdOf(id)] = (copies[baseIdOf(id)] || 0) + 1; });
  // 上限读规则表，书挡把它 +1。事件面板是战斗外的界面，读静态层。
  const pool = PACK.cards.filter((c) => (copies[c.id] || 0) < rulesStatic().maxCopies);
  if (!pool.length) return null;
  const c = pick(pool);
  G.deck.push(up ? upgradedId(c.id) : c.id);
  return c;
}

/**
 * 复印一张**已有**的牌：随机挑一张，原样再放一份（精炼状态跟着走）。
 *
 * 和 `grantCard` 分开是因为它改变的是"这份笔记有几份"，不是"多认识一个主题"。
 * 上限照样算：复印机不是绕过 `maxCopies` 的后门，否则"每张牌最多几份"
 * 会在事件里被悄悄破掉，牌组的成长曲线也就跟着失控。
 */
function copyCard(): CardDef | null {
  if (!G.deck.length) return null;
  const id = pick(G.deck);
  const d = defOf(id);
  const base = baseIdOf(id);
  const same = G.deck.filter((x) => baseIdOf(x) === base).length;
  // `maxCopies` 管的是**知识卡**：基础牌本来就有 4 张同名的（打击），
  // 拿这一条去卡它，复印机会永远只印出白纸。
  if (d.kind !== 'basic' && same >= rulesStatic().maxCopies) return null;
  G.deck.push(id);
  return d;
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

/** 复习基础回复量，不含地图册那一次额外。唯一算法，别的写法都是副本。 */
function restBase(): number {
  return Math.round(G.maxHp * rulesStatic().restPct);
}

/**
 * 这一刻复习能回多少 —— **纯查询，不消费「每幕一次」的账**。
 *
 * 面板显示和 `restHeal()` 必须走同一个算法：分开算就是两套真值，界面上写着
 * 「最多回复 56」而实际回了 78，玩家没有任何办法察觉。
 */
export function restWanted(): number {
  return restBase() + (canOnceStage('atlas') ? BAL.atlasHeal : 0);
}

export function restHeal() {
  // 面板渲染只调 restWanted()（查账），到这里才真正花掉地图册的名额。
  const extra = onceThisStage('atlas') ? BAL.atlasHeal : 0;
  const wanted = restBase() + extra;
  const got = healBy(wanted);
  log(got === wanted
    ? `休息，回复 ${got} 点生命${extra ? `（地图册额外 +${extra}）` : ''}`
    : `休息，回复 ${got} 点生命（已达到上限 ${G.maxHp}）`, 'hi');
  finishNode();
}

/** 打开精炼 / 遗忘的选牌面板。删牌要求牌组 > 4，精炼按张。 */
export function openCardPick(mode: 'up' | 'rm', from?: CardPickFrom): boolean {
  if (mode === 'rm' && G.deck.length <= 4) { log('牌组太薄，不能再删了', ''); return false; }
  if (mode === 'up' && !G.deck.some((id) => !isUpgraded(id))) {
    log('没有能精炼的牌', '');
    return false;
  }
  G.panel = { k: 'cardpick', mode, from };
  return true;
}

export function upgradeCard(i: number) {
  const id = G.deck[i];
  if (!id) return;
  if (isUpgraded(id)) return;
  // 换 id 就是精炼：base:strike → base:strike+
  G.deck[i] = upgradedId(id);
  log(`「${defOf(id).name}」被精炼：攻/挡底数 +${upGain()}（按效果折算）`, 'hi');
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
        t: '拾起来，收进自己的牌组',
        sub: () => `获得一张随机知识卡（已精炼），失去 ${FX.indexCardCost} 点生命`,
        run: () => {
          // 先确认有卡可给，再扣血
          const c = grantCard(true);
          if (!c) return '每种卡你都收齐了上限：这一次你只是把它们理了一遍。';
          const lost = hurtBy(FX.indexCardCost);
          return `你把「${c.topic}」那张卡收进了牌组（已精炼），代价是 ${lost} 点生命。`;
        },
      },
      {
        t: '按主题重新排好',
        sub: () => `回复 ${FX.indexSortHeal} 点生命`,
        run: () => {
          const got = healBy(FX.indexSortHeal);
          return got ? `你按主题排好了它们，回了 ${got} 点生命。` : '你按主题排好了它们：你已经满血，不需要再回。';
        },
      },
      { t: '绕过去', sub: () => '什么也不发生', run: () => '你没有碰它。' },
    ],
  },
  {
    id: 'notebook', title: '旧笔记本',
    text: '一本写着你名字的笔记本，翻开全是错的题。每一道旁边都标了当时的想法：大部分标错了。',
    opts: [
      {
        t: '把错题重抄一遍',
        sub: () => `精炼一张你选择的牌（攻/挡底数 +${upGain()}），失去 ${FX.notebookCost} 点生命`,
        run: () => {
          // 有牌可精炼才开面板，血在挑完之后扣
          if (!openCardPick('up')) return null;
          G.pendingCost = FX.notebookCost;
          return `你翻开一页错题；选一张要精炼的牌（选完才付 ${FX.notebookCost} 点生命）。`;
        },
      },
      {
        t: '把错得最多的那几页撕掉',
        sub: () => `永久移除一张你选择的牌，回复 ${FX.notebookSweepHeal} 点生命`,
        run: () => {
          if (!openCardPick('rm')) return null;
          // 回血要等真的删掉一张后才结算；先记在 pendingHeal 上，取消时清掉。
          G.pendingHeal = FX.notebookSweepHeal;
          return `你撕掉一页；选一张要移除的牌（选完才回 ${FX.notebookSweepHeal} 点生命）。`;
        },
      },
      { t: '合上，放回原处', sub: () => '什么也不发生', run: () => '你把它放了回去。' },
    ],
  },
  {
    id: 'keeper', title: '守夜人',
    text: '一个坐在灯下的人抬起头："想过去，留一样东西。"他没有说是什么东西。',
    opts: [
      {
        t: '把一张卡留下来', sub: () => '永久移除一张你选择的牌',
        run: () => {
          if (!openCardPick('rm')) return null;
          return '你把一张卡留在了灯下；选一张要留下的牌。';
        },
      },
      {
        t: `给他 ${FX.keeperCost} 点生命`, sub: () => '他替你精炼一张你选择的牌',
        run: () => {
          if (!openCardPick('up')) return null;
          G.pendingCost = FX.keeperCost;
          return `你把手按在钱袋上；选一张要精炼的牌（选完才付 ${FX.keeperCost} 点生命）。`;
        },
      },
      { t: '什么也不留，转身离开', sub: () => '什么也不发生', run: () => '他没有拦你。' },
    ],
  },
  {
    id: 'lamp-hall', title: '长明灯廊',
    text: '一整条廊道的灯都亮着，只有尽头那盏是灭的。你可以在这里坐一会儿，也可以去把那盏灯点上。',
    opts: [
      {
        t: '坐一会儿', sub: () => `回复 ${FX.lampRestHeal} 点生命`,
        run: () => {
          const got = healBy(FX.lampRestHeal);
          return got ? `你在灯下坐了一会儿，回了 ${got} 点生命。` : '你在灯下坐了一会儿：你已经满血，不需要再回。';
        },
      },
      {
        t: '去点那盏灭的灯',
        sub: () => `获得一张随机知识卡，但会掉 ${FX.lampLightCost} 点生命`,
        run: () => {
          const c = grantCard(false);
          if (!c) return '灯亮起来，照见的还是同一批卡：没有新的可抄。';
          const lost = hurtBy(FX.lampLightCost);
          return `灯亮了，你借着光抄下「${c.topic}」那张卡，代价是 ${lost} 点生命。`;
        },
      },
      { t: '转身离开', sub: () => '什么也不发生', run: () => '你沿着廊道走过去了。' },
    ],
  },
  {
    id: 'book-lift', title: '书梯',
    text: '一把带轮子的书梯停在最顶层，上面那本书正一点一点往外滑。你够不到，除非爬上去。',
    opts: [
      {
        t: '爬上去接住它',
        sub: () => `获得一张随机知识卡（已精炼），失去 ${FX.liftCost} 点生命`,
        run: () => {
          const c = grantCard(true);
          if (!c) return '接住了，但这一种你已经收得够多：这一趟只换来手上的一道木刺。';
          const lost = hurtBy(FX.liftCost);
          return `你接住了「${c.topic}」那张卡（已精炼），代价是 ${lost} 点生命。`;
        },
      },
      {
        t: '把梯子扶稳，靠着歇一会儿',
        sub: () => `回复 ${FX.liftRest} 点生命`,
        run: () => {
          const got = healBy(FX.liftRest);
          return got ? `你靠着梯子坐了一会儿，回了 ${got} 点生命。` : '你靠着梯子坐了一会儿：已经不需要再回了。';
        },
      },
      { t: '让它滑下去', sub: () => '什么也不发生', run: () => '书掉在地上，你没有捡。' },
    ],
  },
  {
    id: 'copier', title: '复印机',
    text: '角落里有一台还在通电的复印机，绿灯一闪一闪。玻璃板上没有落灰，像是一直有人在用。',
    opts: [
      {
        t: '把手里的一张放上玻璃板',
        sub: () => `随机复制一张你的牌，失去 ${FX.copyCost} 点生命`,
        run: () => {
          const c = copyCard();
          if (!c) return '机器吐出一张白纸：你带的每一种都已经够多了。';
          const lost = hurtBy(FX.copyCost);
          return `机器完整地印出了「${c.name}」，代价是 ${lost} 点生命。`;
        },
      },
      {
        t: '躺在出纸口上睡一会儿',
        sub: () => `回复 ${FX.copyRest} 点生命`,
        run: () => {
          const got = healBy(FX.copyRest);
          return got ? `出纸口还是温的，你睡了十分钟，回了 ${got} 点生命。` : '出纸口还是温的，你躺了一会儿：已经睡够了。';
        },
      },
      { t: '拔掉电源', sub: () => '什么也不发生', run: () => '绿灯熄了。你听见一个很小的声音跟着停了。' },
    ],
  },
  {
    id: 'wrong-page', title: '错页',
    text: '一页纸夹在完全不该出现的地方。字是对的，但讲的不是这本书的事。',
    opts: [
      {
        t: '顺着读下去',
        sub: () => `一半概率得到一张（已精炼）知识卡，一半概率失去 ${FX.wrongPageCost} 点生命`,
        run: () => {
          if (Math.random() < 0.5) {
            const c = grantCard(true);
            return c
              ? `这一页正好接得上：你抄下了「${c.topic}」（已精炼）。`
              : '这一页的内容你已经收得够多，抄了也没地方放。';
          }
          const lost = hurtBy(FX.wrongPageCost);
          return `读下去才发现是另一本书，而且写得比你记得的更清楚：你头疼得厉害，失去 ${lost} 点生命。`;
        },
      },
      {
        t: '把它还回原处',
        sub: () => `回复 ${FX.wrongPageRest} 点生命`,
        run: () => {
          const got = healBy(FX.wrongPageRest);
          return got ? `你把它插回了该在的位置，回了 ${got} 点生命。` : '你把它插回了该在的位置：已经满血了。';
        },
      },
      { t: '不去管它', sub: () => '什么也不发生', run: () => '你绕开了那一页。' },
    ],
  },
  {
    id: 'drawer', title: '卡片抽屉',
    text: '一整屉的知识卡，只按年份排过，没按主题。每张边角都被人翻得起了毛。',
    opts: [
      {
        t: '抓一把塞进牌组',
        sub: () => `获得一张随机知识卡，失去 ${FX.drawerCost} 点生命`,
        run: () => {
          const c = grantCard(false);
          if (!c) return '抽屉里全是你已经收满的那些：抓起来又放下了。';
          const lost = hurtBy(FX.drawerCost);
          return `你抓到了「${c.topic}」那张卡，代价是 ${lost} 点生命。`;
        },
      },
      {
        t: '按主题重新排一遍',
        sub: () => `回复 ${FX.drawerSort} 点生命`,
        run: () => {
          const got = healBy(FX.drawerSort);
          return got ? `你把一整屉按主题排好了，回了 ${got} 点生命。` : '你排好了整屉卡片：已经满血了。';
        },
      },
      { t: '关上抽屉', sub: () => '什么也不发生', run: () => '抽屉滑回去，发出一声很闷的响。' },
    ],
  },
  {
    id: 'lamp-oil', title: '灯油',
    text: '一小罐灯油挂在墙上，旁边贴着字条："只给还在这里的人"。你自己的灯芯已经烧得很短了。',
    opts: [
      {
        t: '添满自己的灯芯',
        sub: () => `生命上限 +${FX.maxHpGain}（当前生命不变），失去 ${FX.maxHpCost} 点生命`,
        run: () => {
          const lost = hurtBy(FX.maxHpCost);
          const grown = raiseMaxHp(FX.maxHpGain);
          return `灯芯续长了一截：生命上限 +${grown}（现在 ${G.maxHp}），代价是 ${lost} 点生命。`;
        },
      },
      {
        t: '借这盏灯读一会儿',
        sub: () => `回复 ${FX.oilHeal} 点生命`,
        run: () => {
          const got = healBy(FX.oilHeal);
          return got ? `你借着这盏灯读了一会儿，回了 ${got} 点生命。` : '你借着这盏灯读了一会儿：已经满血了。';
        },
      },
      { t: '把油罐放回原处', sub: () => '什么也不发生', run: () => '你没有动那罐油。' },
    ],
  },
  {
    id: 'book-cart', title: '还书车',
    text: '一辆装满书的推车横在过道里，最上面那本还夹着借阅条。没有人在管它。',
    opts: [
      {
        t: '把自己的一张牌放上去',
        sub: () => `永久移除一张你选择的牌，回复 ${FX.cartHeal} 点生命`,
        run: () => {
          if (!openCardPick('rm')) return null;
          G.pendingHeal = FX.cartHeal;
          return `你把一张牌插进车上的空隙；选一张要放下的牌（选完才回 ${FX.cartHeal} 点生命）。`;
        },
      },
      {
        t: '从车上拿一本',
        sub: () => `获得一张随机知识卡，失去 ${FX.cartCost} 点生命`,
        run: () => {
          const c = grantCard(false);
          if (!c) return '车上全是你已经收满的那些：你把手收了回来。';
          const lost = hurtBy(FX.cartCost);
          return `你从车上抽走了「${c.topic}」那张卡，代价是 ${lost} 点生命。`;
        },
      },
      { t: '绕过去', sub: () => '什么也不发生', run: () => '你侧身从推车旁边挤了过去。' },
    ],
  },
  {
    id: 'bindery', title: '装订台',
    text: '胶锅还温着，线轴整整齐齐。上一个用这里的人把工具收拾得比自己的笔记仔细。',
    opts: [
      {
        t: '把自己的笔记重新装订一遍',
        sub: () => `精炼一张你选择的牌（攻/挡底数 +${upGain()}），失去 ${FX.bindCost} 点生命`,
        run: () => {
          if (!openCardPick('up')) return null;
          G.pendingCost = FX.bindCost;
          return `你挑了一根同色的线；选一张要精炼的牌（选完才付 ${FX.bindCost} 点生命）。`;
        },
      },
      {
        t: '拆掉一页',
        sub: () => `永久移除一张你选择的牌，回复 ${FX.bindHeal} 点生命`,
        run: () => {
          if (!openCardPick('rm')) return null;
          G.pendingHeal = FX.bindHeal;
          return `你从线里抽出一页；选一张要拆掉的牌（选完才回 ${FX.bindHeal} 点生命）。`;
        },
      },
      { t: '不碰别人的工具', sub: () => '什么也不发生', run: () => '你把工具摆回原样，走了。' },
    ],
  },
  {
    id: 'shelf-gap', title: '书架缝',
    text: '两排书架之间有一道缝，里面卡着东西。你伸手够得到，只是木板边缘全是毛刺。',
    opts: [
      {
        t: '伸手去摸',
        sub: () => `获得一张随机知识卡（已精炼），失去 ${FX.shelfCost} 点生命`,
        run: () => {
          const c = grantCard(true);
          if (!c) return '摸出来的是空的：缝里那点东西早被翻走了。';
          const lost = hurtBy(FX.shelfCost);
          return `你从缝里抽出「${c.topic}」那张卡（已精炼），代价是 ${lost} 点生命。`;
        },
      },
      {
        t: '用手电照一照',
        sub: () => `回复 ${FX.shelfHeal} 点生命`,
        run: () => {
          const got = healBy(FX.shelfHeal);
          return got ? `你照着看清楚了，顺手把毛刺磨平，回了 ${got} 点生命。` : '你照着看清楚了：已经不需要再歇了。';
        },
      },
      { t: '算了', sub: () => '什么也不发生', run: () => '你把手缩了回来。' },
    ],
  },
  {
    id: 'damp', title: '受潮的纸箱',
    text: '一箱泡过水的资料，纸板已经软了。有些页还粘在一起，有些已经烂成浆。',
    opts: [
      {
        t: '一张张揭开',
        sub: () => '一半概率得到一张随机知识卡，一半概率什么也没有',
        run: () => {
          if (Math.random() < 0.5) {
            const c = grantCard(false);
            return c
              ? `最底下那张还是干的：你收下了「${c.topic}」。`
              : '最底下那张你也已经有了，而且它一碰就散。';
          }
          return '你揭了十几张，没有一张能读的。手上全是水。';
        },
      },
      {
        t: '把箱子搬到干燥的地方',
        sub: () => `回复 ${FX.dampHeal} 点生命`,
        run: () => {
          const got = healBy(FX.dampHeal);
          return got ? `你把它挪到了通风口，回了 ${got} 点生命。` : '你把它挪到了通风口：已经不需要再回血了。';
        },
      },
      { t: '不去碰它', sub: () => '什么也不发生', run: () => '你没有碰那个箱子。' },
    ],
  },
  {
    id: 'lost-found', title: '失物招领',
    text: '一个木架，上面摆着别人丢下的东西：雨伞、围巾、一摞没有名字的卡。',
    opts: [
      {
        t: '认领那摞没有名字的卡',
        sub: () => `获得一张随机知识卡，失去 ${FX.lostCost} 点生命`,
        run: () => {
          const c = grantCard(false);
          if (!c) return '你翻了翻那摞卡：每一张你都认得出。';
          const lost = hurtBy(FX.lostCost);
          return `你认领了「${c.topic}」那张卡，代价是 ${lost} 点生命。`;
        },
      },
      {
        t: '把它们交给管理员',
        sub: () => `回复 ${FX.lostRest} 点生命`,
        run: () => {
          const got = healBy(FX.lostRest);
          return got ? `管理员向你道了谢，回了 ${got} 点生命。` : '管理员向你道了谢：你已经满血了。';
        },
      },
      { t: '什么也不拿', sub: () => '什么也不发生', run: () => '你看了一眼，把手插回了口袋。' },
    ],
  },
];

/**
 * 抽一个事件。
 *
 * 先去没出现过的里面抽；池子抽空之后才允许重复。早先是 `pick(EVENTS)`，
 * 一局十几个事件节点、四个模板轮着来，"长明灯廊"能出现四五次 ——
 * 事件就退化成了补给站，玩家不再期待"这次会遇到什么"。
 */
export function drawEvent(): EventDef {
  const fresh = EVENTS.filter((e) => !G.eventsSeen.includes(e.id));
  const ev = pick(fresh.length ? fresh : EVENTS);
  if (!G.eventsSeen.includes(ev.id)) G.eventsSeen.push(ev.id);
  return ev;
}

export function chooseEventOption(i: number) {
  if (G.panel.k !== 'event') return;
  const ev = G.panel.ev;
  const msg = ev.opts[i]?.run();
  // 选项可能把面板交给 cardpick；记住来源，取消时才能回到事件本身而不是直接关掉。
  // `run()` 可能改写 G.panel，TS 仍按调用前的 narrowing 看它，所以这里重新按 Panel 读一次。
  const after = G.panel as Panel;
  if (after.k === 'cardpick') after.from = { k: 'event', ev };
  if (msg) log(msg, 'hi');
  // null 表示选项没被消费，面板留在原地
  if (msg === null) return;
  // 选项可能把面板交给 cardpick，收尾由 picker 自己做
  if (G.panel.k === 'event') finishNode();
}

/** 选牌收尾时结算待付的代价与收益。取消走 `cancelPanel`，那里直接清零。 */
export function settlePendingCost(): string {
  const cost = G.pendingCost;
  const heal = G.pendingHeal;
  G.pendingCost = 0;
  G.pendingHeal = 0;
  let note = '';
  if (cost > 0) {
    const lost = hurtBy(cost);
    note += `这一页抄完，你付出 ${lost} 点生命。`;
  }
  if (heal > 0) {
    const got = healBy(heal);
    note += `你撕掉一页，回了 ${got} 点生命。`;
  }
  return note;
}
