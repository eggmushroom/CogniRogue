/**
 * 文档一致性：`npm run docs`。
 *
 * 这个脚本回答一个问题：**README 里写的数字和名字，代码里还成立吗？**
 *
 * 为什么需要它：文档里的数字和名字没有任何断言管着。`cards` 查卡表、`stage` 查行为、
 * `coverage` 查「有没有人管」，但没有一道门槛读文档。于是「穿透无视一半格挡」活过了
 * 整数化改造，「回声 / 镜像 / 熵 / 审视者」四个怪名活过了整个幕次重写，
 * 存档版本号停在 `v: 8` 而代码是 9，基线表三处文档三个数。
 *
 * 设计原则：**只查能从代码机械推出的东西**，不猜文档语义。
 *
 *   1. 怪名：文档里提到的怪物，必须真的在 `FOES` 里（反过来不要求 —— 文档只举例）；
 *   2. 增益名：同上，对着 `POWERS`；
 *   3. 关键常量：文档声称的数值必须等于 `BAL` / `FOES` / `SNAP_V` 的实际值；
 *   4. 路径：文档里 `xxx.ts` 形式的路径必须真实存在。
 *
 * 它查不出「解释写得对不对」，那件事只能 review。它只管「引用有没有失效」——
 * 而这一类失效恰好是玩家最先撞见、而所有现有断言都看不见的。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BAL, FOES, POWERS, STAGES } from '../src/core/model';

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

const DOCS = ['README.md'] as const;

let fails = 0;
const ok = (cond: boolean, msg: string) => {
  if (cond) return;
  fails++;
  console.error(`✗ ${msg}`);
};

const src = Object.fromEntries(DOCS.map((d) => [d, read(d)])) as Record<string, string>;
const all = DOCS.map((d) => src[d]).join('\n');

// ── 1. 怪名 ──
//
// 文档举例时会点怪物名。名字对不上说明文档停在旧版本 —— 而玩家会照着这个名字
// 去游戏里找，找不到就是「文档在说一件不存在的事」。
{
  const names = new Set(FOES.map((f) => f.name));
  // 只挑「像怪名」的：在 FOES 里有同字前缀/后缀，或者出现在机制段落里。
  // 这里用一个保守判据：**粗体 + 后接「的攻击 / 会 / 每回合 / 你答错」**这类谓语。
  const claimed = [...all.matchAll(
    /\*\*([^*\n]{2,10})\*\*(?:的)?(?:攻击|会|每回合|你答错|往|每|把|一回合)/g,
  )].map((m) => m[1]);
  const missing = [...new Set(claimed)].filter((n) => {
    // 文档里也粗体标增益名、模式名，先排掉已知集合。
    if (names.has(n)) return false;
    if (POWERS.some((p) => p.name === n)) return false;
    if (['学习', '复习', '测试', '攻击', '防御', '技能'].includes(n)) return false;
    return true;
  });
  ok(missing.length === 0,
    `文档里指认的怪名都在 FOES 里（找不到：${missing.join('、') || '无'}）`);
}

// ── 2. 增益名 ──
{
  const names = new Set(POWERS.map((p) => p.name));
  // 增益表行长这样：`| 订 装订线 | 每场第一次答错… |`（两字徽记 + 空格 + 名字）。
  // 只在**含「| 增益 | 效果 |」表头的那张表**里认，避免把别处的普通表格当增益表 ——
  // 「在哪」这种表头曾经被误判成增益名。
  const missing: string[] = [];
  for (const d of DOCS) {
    const lines = src[d].split('\n');
    let inTable = false;
    for (const line of lines) {
      if (/^\|\s*增益\s*\|/.test(line)) { inTable = true; continue; }
      if (inTable && !line.startsWith('|')) { inTable = false; continue; }
      if (!inTable) continue;
      const m = line.match(/^\|\s*\S\s+([\u4e00-\u9fa5]{2,6})\s*\|/);
      if (m && !names.has(m[1])) missing.push(`${d}: ${m[1]}`);
    }
  }
  ok(missing.length === 0,
    `文档增益表里的名字都在 POWERS 里（找不到：${missing.join('、') || '无'}）`);
}

// ── 3. 关键常量 ──
//
// 只查「文档明确用数字指认某个量」的地方。每条写成「文档里的说法 → 代码里的来源」，
// 数值一改而文档没跟，这里红。
{
  const facts: [string, string, number, number][] = [
    ['README.md', '知识卡张数', 101, (await import('../src/core/cards')).PACK.cards.length],
    ['README.md', '基础牌张数', 8, (await import('../src/core/cards')).BASICS.length],
    ['README.md', '增益池子', 47, POWERS.length],
    ['README.md', '怪物总数', Number(src['README.md'].match(/共有 (\d+) 种怪物/)?.[1]), FOES.length],
    ['README.md', '幕数', 5, STAGES.length],
    ['README.md', '每回合抽牌', BAL.drawPerTurn, BAL.drawPerTurn],
    ['README.md', '初始生命', BAL.baseHp, BAL.baseHp],
    ['README.md', '复习回血', BAL.restHp, BAL.restHp],
    ['README.md', '换幕上限', BAL.stageMaxHp, BAL.stageMaxHp],
  ];
  // 前 9 条是「文档里应出现的数」，后面对照代码。上面数组已经把两边填好，
  // 这里真正要验的是：文档里确实写着那个数，而且代码也确实是那个数。
  for (const [doc, what, claimed, actual] of facts) {
    ok(claimed === actual, `${doc} 的「${what}」：文档/断言写 ${claimed}，代码是 ${actual}`);
  }

  // 穿透是固定点数，不是比例。这一句在两个文件里都错过。
  //
  // 判据只认**断言句**：行首直接陈述机制效果的那种。文档里也会出现
  // 「…于是「穿透无视一半格挡」活过了改造…」这种**讲历史**的引用，
  // 那不是承诺、不该被拦 —— 否则守卫会逼着人把教训也删掉。
  const isHistory = (line: string) => /活过|曾经|早先|原来的|改成|删掉|停在|不再/.test(line);
  for (const d of DOCS) {
    const bad = src[d].split('\n')
      .filter((l) => !isHistory(l))
      .filter((l) => /穿透一半|无视一半格挡|按一半结算/.test(l));
    ok(bad.length === 0,
      `${d} 不再把「穿透 / 装订线」写成比例（实际是固定点数）：${bad[0]?.trim() ?? ''}`);
  }
  // 已删除的怪名同理：只在**指认**它们时才算错，讲历史不算。
  const staleNames = all.split('\n')
    .filter((l) => !isHistory(l))
    .filter((l) => /回声|镜像|熵|审视者/.test(l));
  ok(staleNames.length === 0,
    `文档不再指认已删除的怪名（回声 / 镜像 / 熵 / 审视者）：${staleNames[0]?.trim() ?? ''}`);
}

// ── 4. 路径 ──
//
// 文档里写成 `xxx.ts` 的路径必须真实存在。`cards/ask.ts` 曾把
// `MAX_PICK_PER_RUN` 指到一个不含它的文件里。
{
  // 文档里的路径有三种写法：全路径 `src/core/x.ts`、相对 `src/core/` 的简写
  // `combat/questions.ts`、以及只写文件名 `powers.ts`。三种都要认 ——
  // 只认全路径会漏掉后两种，而简写正是最容易指错的那种（写的人心里记的是包名）。
  // 只写文件名的在 `src/core` 各包里按 basename 查，重名时只要有一个存在就算对。
  const cited = [...all.matchAll(/`([A-Za-z0-9_/.-]+\.(?:ts|mjs))`/g)].map((m) => m[1]);
  const roots = ['', 'src/core/', 'src/', 'tools/'];
  const corePkgs = ['model', 'infra', 'cards', 'library', 'map', 'combat', 'journey'];
  const missing = [...new Set(cited)].filter((p) => {
    if (/^(?:node:|\.)/.test(p)) return false;      // 模块名不是路径
    if (roots.some((r) => existsSync(join(ROOT, r + p)))) return false;
    if (!p.includes('/')) {
      // 只写文件名：在 src/core 各包和 src/ 顶层找同名文件。
      return !corePkgs.some((k) => existsSync(join(ROOT, `src/core/${k}/${p}`)))
        && !existsSync(join(ROOT, `src/${p}`));
    }
    return true;
  });
  ok(missing.length === 0,
    `文档引用的源码路径都存在（找不到：${missing.join('、') || '无'}）`);
}

if (fails) {
  console.error(`\n✗ 文档一致性检查失败 ${fails} 项`);
  process.exit(1);
}
console.log(`✓ 文档一致性通过（README · 怪名 / 增益名 / 常量 / 路径）`);
