/**
 * 机制覆盖清点：`npm run coverage`。
 *
 * 这个脚本回答一个问题：**源码里每一个「玩家会碰到的东西」，测试里有没有人管？**
 * 它不判断断言写得好不好 —— 那件事没法自动判断，只能靠 review。它管的是
 * 「有没有」：新增一条增益 / 一种效果 / 一个签名改动，而不写断言，这里就红。
 *
 * 三份库存**从源码推出来**，不是手抄的名单：
 *
 *   1. 增益：`POWERS` 表里的每一条（`.powers` / `.scope` 都从运行时读）；
 *   2. 效果：`EFFS` 的每个 key（六种形状）；
 *   3. 签名改动：卡表里真正被用到的 `mods` 字段。
 *
 * 证据的取法有一个硬约定：**卡面文案断言不算证据**。`10e2` 那一段逐条比对
 * 「哪个数字该出现在哪句话里」，它证明文案抄得对，不证明那件事会发生 ——
 * 书套 / 批注当年在那一整段里全绿，而玩法里一次都没兑现过。所以增援证据
 * 要先从 `stagecheck` 里把文案区整段切掉，剩下的才算数。
 *
 * 局限写在明处：命中一次「'id'」不等于有一条好断言。要判断写得对不对，
 * 读 `10j 增益落地` 那一段 —— 那一段按消费者写，不按规则表写。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EFFS, POWERS, PACK, BASICS } from '../src/core';

// 打包后 `import.meta.dirname` 指向 `.cache/`，所以按 npm 脚本的运行目录取根。
const here = join(process.cwd(), 'tools');
const read = (rel: string) => readFileSync(join(here, rel), 'utf8');
const stage = read('stagecheck.ts').split('\n');
const cards = read('cards.ts');
const smoke = read('smoke.mjs');

/** 卡面文案断言区：这一整段不算「行为证据」。 */
const copyFrom = stage.findIndex((l) => l.startsWith('// ── 10e. 增益文案'));
const copyTo = stage.findIndex((l) => l.startsWith('// ── 10e3.'));
if (copyFrom < 0 || copyTo < 0 || copyTo < copyFrom) {
  console.error('✗ 找不到卡面文案断言区（10e … 10e3）—— 切不掉它，这一趟清点就没有意义');
  process.exit(1);
}
const behaviour = [...stage.slice(0, copyFrom), ...stage.slice(copyTo)].join('\n');

/**
 * 在 `ok(...)` 的文案里就近取一条，作为人读的样本；取不到就返回空。
 *
 * 先往后找六行（断言通常写在 setup 之后），再往前找三行。
 * 取不到不是错误：有些机制只在**别处**被间接印证（例如一条常驻规则落在
 * 另一个函数的读数上），这种情况只打印文件名，由 review 判断。
 */
function sample(text: string, at: number, name: string): string {
  const lines = text.split('\n');
  const line = text.slice(0, at).split('\n').length - 1;
  const lift = (i: number) => {
    const l = lines[i];
    if (!l || !l.includes('ok(')) return '';
    const m = /`(.{4,60})`/.exec(l);
    if (!m) return '';
    // 只认点了名的断言：隔壁那条断言写得再好，也不是这个机制的证据。
    return name && m[1].includes(name) ? m[1] : '';
  };
  for (let d = 1; d <= 12; d++) {
    const hit = lift(line + d);
    if (hit) return hit;
  }
  for (let d = 1; d <= 12; d++) {
    const hit = lift(line - d);
    if (hit) return hit;
  }
  return name ? '' : '';
}

interface Row {
  kind: string;
  id: string;
  name: string;
  where: string;
  sample: string;
  ok: boolean;
}

const rows: Row[] = [];
let fails = 0;

function audit(kind: string, id: string, name: string, pool: [string, string][], quoted = true) {
  // 签名改动在代码里写作 `mods?.times`，不是字符串字面量，所以取证据的方式不一样。
  const pattern = quoted ? `['"\`]${id}['"\`]` : `mods\\??\\.${id}\\b`;
  for (const [where, text] of pool) {
    const at = text.search(new RegExp(pattern));
    if (at >= 0) {
      rows.push({ kind, id, name, where, sample: sample(text, at, name), ok: true });
      return;
    }
  }
  rows.push({ kind, id, name, where: '—', sample: '', ok: false });
  fails += 1;
}

for (const p of POWERS) {
  audit('增益', p.id, p.name, [['stage', behaviour], ['smoke', smoke]]);
}
for (const key of Object.keys(EFFS)) {
  audit('效果', key, EFFS[key as keyof typeof EFFS].name, [['stage', behaviour], ['cards', cards]]);
}
const modsKeys = new Set<string>();
for (const c of [...PACK.cards, ...BASICS]) {
  for (const k of Object.keys(c.mods ?? {})) modsKeys.add(k);
}
for (const k of [...modsKeys].sort()) {
  audit('签名改动', k, k, [['stage', behaviour], ['cards', cards]], false);
}

console.log('\n机制覆盖清点');
console.log(`  库存：增益 ${POWERS.length} / 效果 ${Object.keys(EFFS).length} / 签名改动 ${modsKeys.size}`
  + `　（卡面文案区不算证据：${copyTo - copyFrom} 行被排除）\n`);

for (const kind of ['增益', '效果', '签名改动']) {
  const mine = rows.filter((r) => r.kind === kind);
  const bad = mine.filter((r) => !r.ok);
  console.log(`── ${kind}：${mine.length - bad.length}/${mine.length} 有断言`
    + `${bad.length ? `（缺 ${bad.length}）` : ''}`);
  for (const r of mine) {
    if (!r.ok) console.log(`  ✗ ${r.name.padEnd(6, '　')} ${r.id}　只有卡面文案，没有任何断言`);
    else if (r.sample) console.log(`  ✓ ${r.name.padEnd(6, '　')} ${r.id}　${r.where}: ${r.sample}`);
    else console.log(`  ✓ ${r.name.padEnd(6, '　')} ${r.id}　${r.where}`);
  }
  console.log('');
}

if (fails) {
  console.error(`✗ ${fails} 个机制没有任何断言。`);
  console.error('  修法：在 tools/stagecheck.ts 里按「消费者」写一条 —— 装上这个机制，');
  console.error('  结算里那个数字要变，而且变得和 BAL 上写的一样多。卡面文案不算。');
  process.exit(1);
}
console.log('✓ 每个机制都有断言（质量靠 review，不靠这一趟）');
