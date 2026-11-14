/**
 * 卡表审计：`npm run cards`。
 *
 * 这里回答的是「101 张牌之间会不会互相打架」，不是「数值强不强」：
 *
 *   1. 有没有**空牌**：花了费用却什么都不产出（写错 eff 或把底数写成 0）；
 *   2. 有没有**死字段**：效果原型根本不消费的数字（`chain` 的 blk 一直是 0，
 *      卡表却写着 10 —— 那不是"待用"，那是下一次调平衡时的假开关）；
 *   3. 有没有**严格支配**：同一章、同费用、同效果、同段数，一张各项都不差。
 *      这种牌在奖励面板上出现时，"选择"是假的；
 *   4. 有没有**一模一样的牌**（同章同指纹）—— 那是复制粘贴，不是两张牌；
 *   5. **X 费**是不是每点行动力都有产出，**联动牌**有没有给玩家看的说明；
 *   6. 每章**够不够组一副牌**（≥ 4 张），内置池里有没有混进基础牌。
 *
 * 跨章的同模板**不算问题**：每章都要有一套能用的卡，章与章之间的差异是
 * 「这一局练哪一章」，不是"上位卡"。所以支配检查按主题分组，跨主题只打印。
 */
import { PACK, BASICS, defOf, planStrike, effFace, cardGrade, costOf, isXCost, cardKind } from '../src/core';
import type { CardDef } from '../src/core/model';

let fails = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) fails += 1;
};

interface Row {
  c: CardDef; id: string; name: string; topic: string; cost: string; grade: string;
  eff: string; per: number; hits: number; blk: number; pierce: boolean;
  heal: number; draw: number; selfHp: number; link: boolean;
}

const rows: Row[] = PACK.cards.map((c) => {
  const f = effFace(planStrike(c.id, { noBoost: true }));
  return {
    c, id: c.id, name: c.name, topic: c.topic,
    cost: isXCost(c) ? 'X' : String(costOf(c)), grade: cardGrade(c), eff: c.eff,
    per: f.per, hits: f.hits, blk: f.blk, pierce: f.pierce,
    heal: f.healMax, draw: f.drawMax, selfHp: f.selfHp, link: !!c.link,
  };
});

const dmg = (r: Row) => r.per * r.hits;

// ── 全表 ─────────────────────────────────────────────────────
console.log(`\n卡表：${rows.length} 张 / ${new Set(rows.map((r) => r.topic)).size} 个主题\n`);
const topics = [...new Set(rows.map((r) => r.topic))];
for (const t of topics) {
  console.log(`── ${t} ${'─'.repeat(Math.max(1, 30 - t.length * 2))}`);
  for (const r of rows.filter((x) => x.topic === t)) {
    const num = `${r.hits > 1 ? `${r.per}×${r.hits}` : r.per}伤`
      + `${r.pierce ? '(穿)' : ''}`
      + `${r.blk ? ` ${r.blk}挡` : ''}`
      + `${r.heal ? ` 回${r.heal}` : ''}`
      + `${r.draw ? ` 抽${r.draw}` : ''}`
      + `${r.selfHp ? ` 自伤${r.selfHp}` : ''}`
      + `${r.link ? ` [${r.c.link?.note ?? '联动'}]` : ''}`;
    console.log(`  ${r.id} ${r.cost}费/${r.grade} ${r.name.padEnd(5, '　')} ${r.eff.padEnd(6)} ${num}`);
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
// 原型不再带系数，所以"格挡写了却从不结算"这一类消失了；现在会死的只剩
// 「在 0 伤的牌上写回血 / 多段」—— 回血要有伤害才回，0 伤打几段都是 0。
{
  const deadHeal = rows.filter((r) => (r.c.mods?.healPer ?? 0) > 0 && r.c.atk <= 0);
  ok(deadHeal.length === 0,
    `没有"0 伤却带回血"的牌${deadHeal.length ? `：${deadHeal.map((r) => r.name).join(' ')}` : ''}`);

  const deadTimes = rows.filter((r) => (r.c.mods?.times ?? 1) > 1 && r.c.atk <= 0);
  ok(deadTimes.length === 0,
    `没有"0 伤却写多段"的牌${deadTimes.length ? `：${deadTimes.map((r) => r.name).join(' ')}` : ''}`);
}

// ── 3. 同章同指纹 = 复制粘贴 ─────────────────────────────────
const fp = (r: Row) => [r.cost, r.eff, r.per, r.hits, r.blk, r.pierce, r.heal, r.draw, r.selfHp,
  r.c.link?.atkFrom ?? '', r.c.link?.grow ?? '', r.c.link?.nextMul ?? ''].join('|');
{
  let dup = 0;
  for (const t of topics) {
    const g = rows.filter((r) => r.topic === t);
    const seen = new Map<string, Row>();
    for (const r of g) {
      const k = fp(r);
      const hit = seen.get(k);
      if (hit) {
        dup += 1;
        console.log(`  ✗ ${t}：${hit.name} 与 ${r.name} 机制完全一样`);
      } else seen.set(k, r);
    }
  }
  ok(dup === 0, `同一章里没有两张一模一样的牌（重复 ${dup} 组）`);
}

// ── 4. 严格支配：同章 / 同费 / 同效果 / 同段数 ────────────────
// 段数不同不算支配：多段对格挡更吃亏、对"每段 +1"更划算，是两种形状。
function dominates(a: Row, b: Row): boolean {
  if (a.topic !== b.topic || a.cost !== b.cost || a.eff !== b.eff || a.hits !== b.hits) return false;
  if (a.link || b.link) return false;
  if (a.pierce !== b.pierce) return false;
  if (dmg(a) < dmg(b) || a.blk < b.blk || a.heal < b.heal || a.draw < b.draw) return false;
  if (a.selfHp > b.selfHp) return false;
  return dmg(a) > dmg(b) || a.blk > b.blk || a.heal > b.heal || a.draw > b.draw || a.selfHp < b.selfHp;
}
{
  const bad: [Row, Row][] = [];
  for (const a of rows) for (const b of rows) if (a !== b && dominates(a, b)) bad.push([a, b]);
  for (const [a, b] of bad) {
    console.log(`  ✗ ${a.topic}：${a.name} 压过 ${b.name} —— ${a.cost}费 ${a.eff} `
      + `${dmg(a)}伤/${a.blk}挡 vs ${dmg(b)}伤/${b.blk}挡`);
  }
  ok(bad.length === 0, `同一章里没有"永远不该选"的牌（${bad.length} 组）`);

  // 跨章的同模板是设计（每章一套），只报数量，不报错。
  const template = new Map<string, number>();
  for (const r of rows) template.set(`${r.cost}费 ${r.eff}`, (template.get(`${r.cost}费 ${r.eff}`) ?? 0) + 1);
  const wide = [...template.entries()].filter(([, n]) => n > 3);
  console.log(`  · 跨章同模板：${wide.length} 组超过 3 张（${wide.slice(0, 4).map(([k, n]) => `${k}×${n}`).join('，')}…）`);
  console.log('    这是设计：每章都要有一套能用的卡，章与章的差别是"练哪一章"，不是上位卡');
}

// ── 5. X 费不是废牌；联动牌要有给玩家看的说明 ────────────────
{
  const x = rows.filter((r) => r.cost === 'X');
  ok(x.length > 0 && x.every((r) => dmg(r) > 0 || r.blk > 0 || r.draw > 0),
    `X 费牌每点行动力都有产出（${x.length} 张）`);

  const noNote = rows.filter((r) => r.link && !r.c.link?.note);
  ok(noNote.length === 0,
    `联动牌都写了卡面说明${noNote.length ? `：${noNote.map((r) => r.name).join(' ')}` : ''}`);
}

// ── 6. 每章够组一副牌 ───────────────────────────────────────
{
  const thin = topics.filter((t) => rows.filter((r) => r.topic === t).length < 4);
  ok(thin.length === 0, `每个主题至少 4 张可抽的牌${thin.length ? `：${thin.join(' ')}` : ''}`);
  const unknown = rows.filter((r) => cardKind(defOf(r.id)) !== 'knowledge');
  ok(unknown.length === 0, '内置卡池里全是知识卡（基础牌另表）');
}

// ── 7. 基础牌：不在抽取池里，但它也在牌组里 ──────────────────
//
// 前六条都只看 `PACK.cards`，基础牌从来不在审计范围内。效果原型去掉倍率那次，
// 基础格挡从 6 点掉到 3 点（原型 `guard` 的 ×2 没了，卡表没跟着改），新手
// 第一幕的存活层数少了近一半，六条断言却全绿 —— 因为没人看它们。
//
// 所以基础牌单独审一遍：**数就是打出去的那个数**（和知识卡同口径），
// 并且不比同费知识卡强（否则开局那四张就不该被替换）。
{
  const uniq = [...new Map(BASICS.map((c) => [c.id, c])).values()];
  const basicRows: Row[] = uniq.map((c) => {
    const f = effFace(planStrike(c.id, { noBoost: true }));
    return {
      c, id: c.id, name: c.name, topic: c.topic,
      cost: isXCost(c) ? 'X' : String(costOf(c)), grade: cardGrade(c), eff: c.eff,
      per: f.per, hits: f.hits, blk: f.blk, pierce: f.pierce,
      heal: f.healMax, draw: f.drawMax, selfHp: f.selfHp, link: !!c.link,
    };
  });
  for (const r of basicRows) {
    console.log(`  ${r.id} ${r.cost}费 ${r.name}　${r.eff}　${dmg(r)}伤 ${r.blk}挡`);
  }
  ok(basicRows.length === uniq.length && uniq.length > 0,
    `基础牌 ${uniq.length} 种（${uniq.map((c) => c.name).join(' / ')}）`);
  ok(basicRows.every((r) => dmg(r) + r.blk + r.draw > 0), '基础牌都打得出东西');
  ok(basicRows.every((r) => !r.c.mods && !r.c.link), '基础牌不带签名改动与联动');

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

console.log(fails ? `\n✗ 卡表检查 ${fails} 项失败` : '\n✓ 卡表检查通过');
process.exitCode = fails ? 1 : 0;
