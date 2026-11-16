/**
 * 卡表审计：`npm run cards`。
 *
 * 这里回答的是「这些牌放在一起会不会自相矛盾」，不是「数值强不强」：
 *
 *   1. 有没有**空牌**：花了费用却什么都不产出（写错 eff 或把底数写成 0）；
 *   2. 有没有**死字段**：效果原型根本不消费的数字（0 伤却写回血 / 多段）；
 *   3. 卡名是否唯一（同名不同数值会让玩家记错）；
 *   4. **X 费**是不是每点行动力都有产出，**联动牌**有没有给玩家看的说明；
 *   5. 每个费用档 / 每种效果够不够组一副牌；
 *   6. **基础牌**：不答题、不带签名改动，且弱于同费知识卡（不答题的代价）；
 *   7. **答题要求**：每张知识卡在数据里显式写 `ask`；0 = 不问，正数 = 要答对几次。
 *      它是隐藏属性，不画在卡面，也不在奖励 / 牌组 / 帮助页显示。
 *
 * 奖励屏不按费用 / 效果 / 强弱预筛：除“同一张卡同 id”外，怎么选由玩家自己看牌面决定。
 */
import {
  PACK, BASICS, defOf, planStrike, effFace, costOf, isXCost, cardKind, askOf,
} from '../src/core';
import type { CardDef } from '../src/core/model';

let fails = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) fails += 1;
};

interface Row {
  c: CardDef; id: string; name: string; cost: string;
  eff: string; per: number; hits: number; blk: number; pierce: boolean;
  heal: number; draw: number; selfHp: number; link: boolean; ask: number;
}

const rows: Row[] = PACK.cards.map((c) => {
  const f = effFace(planStrike(c.id, { noBoost: true }));
  return {
    c, id: c.id, name: c.name, cost: isXCost(c) ? 'X' : String(costOf(c)),
    eff: c.eff, per: f.per, hits: f.hits, blk: f.blk, pierce: f.pierce,
    heal: f.healMax, draw: f.drawMax, selfHp: f.selfHp, link: !!c.link,
    ask: askOf(c),
  };
});

const dmg = (r: Row) => r.per * r.hits;

// ── 全表 ─────────────────────────────────────────────────────
console.log(`\n卡表：${rows.length} 张\n`);
for (const tier of ['0', '1', '2', '3', 'X']) {
  const g = rows.filter((r) => r.cost === tier);
  if (!g.length) continue;
  console.log(`── ${tier} 费 ${'─'.repeat(32)}`);
  for (const r of g) {
    const num = `${r.hits > 1 ? `${r.per}×${r.hits}` : r.per}伤`
      + `${r.pierce ? '(穿)' : ''}`
      + `${r.blk ? ` ${r.blk}挡` : ''}`
      + `${r.heal ? ` 回${r.heal}` : ''}`
      + `${r.draw ? ` 抽${r.draw}` : ''}`
      + `${r.selfHp ? ` 自伤${r.selfHp}` : ''}`
      + `${r.link ? ` [${r.c.link?.note ?? '联动'}]` : ''}`;
    console.log(`  ${r.id} ${r.name.padEnd(5, '　')} ${r.eff.padEnd(6)} ${num}`);
  }
}
console.log('');

// ── 1. 空牌与退化 ────────────────────────────────────────────
{
  const empty = rows.filter((r) => dmg(r) === 0 && r.blk === 0 && r.heal === 0
    && r.draw === 0 && !r.link);
  ok(empty.length === 0, `没有"花了费用却什么都不产出"的牌${empty.length ? `：${empty.map((r) => r.name).join(' ')}` : ''}`);

  // 0 费牌可以只过一张牌，但 1 费以上总得换点什么。
  const cheap = rows.filter((r) => r.cost !== '0' && dmg(r) === 0 && r.blk === 0 && r.draw === 0);
  ok(cheap.length === 0, `1 费以上没有纯空转的牌${cheap.length ? `：${cheap.map((r) => r.name).join(' ')}` : ''}`);
}

// ── 2. 死字段：签名改动必须在这个形状里真的会被消费 ──────────
{
  const deadHeal = rows.filter((r) => (r.c.mods?.healPer ?? 0) > 0 && r.c.atk <= 0);
  ok(deadHeal.length === 0,
    `没有"0 伤却带回血"的牌${deadHeal.length ? `：${deadHeal.map((r) => r.name).join(' ')}` : ''}`);

  const deadTimes = rows.filter((r) => (r.c.mods?.times ?? 1) > 1 && r.c.atk <= 0);
  ok(deadTimes.length === 0,
    `没有"0 伤却写多段"的牌${deadTimes.length ? `：${deadTimes.map((r) => r.name).join(' ')}` : ''}`);
}

// ── 3. 卡名唯一 ─────────────────────────────────────────────
// 卡面只写牌名和数值；同名不同数值会让玩家把两张牌记混。
// 基础牌另表，名字一并在第 6 节查。
{
  ok(new Set(rows.map((r) => r.name)).size === rows.length, '知识卡卡名唯一');
}

// ── 4. X 费不是废牌；联动牌要有给玩家看的说明 ────────────────
{
  const x = rows.filter((r) => r.cost === 'X');
  ok(x.length > 0 && x.every((r) => dmg(r) > 0 || r.blk > 0 || r.draw > 0),
    `X 费牌每点行动力都有产出（${x.length} 张）`);

  const noNote = rows.filter((r) => r.link && !r.c.link?.note);
  ok(noNote.length === 0,
    `联动牌都写了卡面说明${noNote.length ? `：${noNote.map((r) => r.name).join(' ')}` : ''}`);
}

// ── 5. 每个费用档 / 每种效果够组一副牌 ─────────────────────────
{
  const tiers = ['0', '1', '2', '3', 'X'];
  const thin = tiers.filter((t) => rows.filter((r) => r.cost === t).length < 4);
  ok(thin.length === 0, `每个费用档至少 4 张可抽的牌${thin.length ? `：${thin.join(' ')}` : ''}`);

  const effs = ['strike', 'pierce', 'guard', 'drain', 'chain', 'focus'];
  const thinEff = effs.filter((e) => rows.filter((r) => r.eff === e).length < 4);
  ok(thinEff.length === 0, `每种效果至少 4 张可抽的牌${thinEff.length ? `：${thinEff.join(' ')}` : ''}`);

  const unknown = rows.filter((r) => cardKind(defOf(r.id)) !== 'knowledge');
  ok(unknown.length === 0, '内置卡池里全是知识卡（基础牌另表）');
}

// ── 6. 基础牌：不在抽取池里，但它也在牌组里 ──────────────────
{
  const uniq = [...new Map(BASICS.map((c) => [c.id, c])).values()];
  const basicRows: Row[] = uniq.map((c) => {
    const f = effFace(planStrike(c.id, { noBoost: true }));
    return {
      c, id: c.id, name: c.name, cost: isXCost(c) ? 'X' : String(costOf(c)),
      eff: c.eff, per: f.per, hits: f.hits, blk: f.blk, pierce: f.pierce,
      heal: f.healMax, draw: f.drawMax, selfHp: f.selfHp, link: !!c.link,
      ask: askOf(c),
    };
  });
  for (const r of basicRows) {
    console.log(`  ${r.id} ${r.cost}费 ${r.name}　${r.eff}　${dmg(r)}伤 ${r.blk}挡`);
  }
  ok(basicRows.length === uniq.length && uniq.length > 0,
    `基础牌 ${uniq.length} 种（${uniq.map((c) => c.name).join(' / ')}）`);
  ok(basicRows.every((r) => dmg(r) + r.blk + r.draw > 0), '基础牌都打得出东西');
  ok(basicRows.every((r) => r.ask === 0), '基础牌不需要答题');
  ok(basicRows.every((r) => !r.c.mods && !r.c.link), '基础牌不带签名改动与联动');

  // 卡名唯一：知识卡 + 基础牌一起查，卡面只靠名字认牌。
  const allNames = [...rows, ...basicRows].map((r) => r.name);
  ok(new Set(allNames).size === allNames.length, `所有卡名唯一（${allNames.length} 张）`);

  // 不比同费知识卡强：知识卡要答题才结算，基础牌不答题，所以同费同效果里
  // 基础牌不得在**任何一项**上超过知识卡的下限，而且要至少弱在一项上。
  // 只比一条轴会把防御牌判错 —— 纯防御牌伤害是 0，"0 不高于 0"不该算超过。
  const weak: string[] = [];
  for (const r of basicRows) {
    const same = rows.filter((x) => x.cost === r.cost && x.eff === r.eff && !x.link);
    if (!same.length) continue;
    const axes: [string, (x: Row) => number][] = [
      ['伤害', dmg], ['格挡', (x) => x.blk], ['回血', (x) => x.heal], ['抽牌', (x) => x.draw],
    ];
    const over = axes.filter(([, get]) => get(r) > Math.min(...same.map(get)));
    const under = axes.filter(([, get]) => get(r) < Math.min(...same.map(get)));
    const shape = `${dmg(r)}伤/${r.blk}挡`;
    const floorShape = `${Math.min(...same.map(dmg))}伤/${Math.min(...same.map((x) => x.blk))}挡`;
    if (over.length) weak.push(`${r.name}(${shape}) 的${over.map(([n]) => n).join('/')}压过同费知识卡(${floorShape})`);
    else if (!under.length) weak.push(`${r.name}(${shape}) 与同费知识卡(${floorShape}) 一样强`);
  }
  ok(!weak.length,
    `基础牌弱于同费知识卡${weak.length ? `：${weak.join('；')}` : '（不答题的代价）'}`);
}

// ── 7. 答题要求：写进卡牌数据的隐藏属性 ──────────────────────
{
  ok(rows.every((r) => Number.isInteger(r.c.ask) && r.c.ask >= 0),
    '每张知识卡都在数据里写了非负整数的答题要求');
  ok(rows.every((r) => r.ask === r.c.ask),
    'askOf() 直接读卡牌数据，不从费用推导');
  ok(rows.some((r) => r.ask === 0) && rows.some((r) => r.ask > 0),
    '答题要求同时覆盖"不问"与"要答"');
  const byAsk = new Map<number, number>();
  for (const r of rows) byAsk.set(r.ask, (byAsk.get(r.ask) ?? 0) + 1);
  const dist = [...byAsk.entries()].sort((a, b) => a[0] - b[0])
    .map(([n, c]) => `${n} 次 ${c} 张`).join(' / ');
  console.log(`  · 答题要求（隐藏）：${dist}`);
}

console.log(fails ? `\n✗ 卡表检查 ${fails} 项失败` : '\n✓ 卡表检查通过');
process.exitCode = fails ? 1 : 0;
