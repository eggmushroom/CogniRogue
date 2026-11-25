/**
 * 架构不变量守卫：`npm run check` 的一部分。
 *
 * deps.mjs 守的是「模块之间谁能 import 谁」，这里守的是「一种能力只允许在
 * 一个地方实现」。两者互补：依赖方向正确，不代表没有第二个地方在偷偷做同一件事。
 *
 * 每条规则只声明三样东西：作用域、唯一实现点（owners）、禁止出现的写法。
 * owners 不是豁免表——它是这条能力的**定义域**：能力本身必须有一个落点，
 * 守卫要保证落点只有一个。架构每收敛一次，owners 只减不增，作用域只扩不缩。
 *
 * 没有解析 AST：不变量都是「某处不该出现某种写法」，字符串扫描足够，
 * 而且不引入依赖。注释会被抹成等长空白，行号因此保持准确。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

const core = (rel) => rel.startsWith('src/core/');
const ts = (rel) => rel.endsWith('.ts');

/**
 * 「会被增益改动」的 BAL 字段，**从代码里推出来**，不是手工维护的名单。
 *
 * 做法：读 `cards/powers.ts` 的 `rulesStatic()` 函数体，抓它引用的所有 `BAL.X`。
 * 这些字段的「声明值」和「玩家此刻的现值」可能不同（修书胶、抛光布、书板……），
 * 界面直读声明值就会写错数字。以后新增益自动进入这个集合，不用回来改守卫。
 *
 * 返回 null 表示抓不到 —— 那时守卫必须失败，否则等于静默关闭。
 */
/**
 * 从 `at` 处的 `{` 开始做花括号配对，返回函数体（含外层花括号）的结束下标。
 *
 * 为什么不用 `code.indexOf('\n}\n')`：那依赖文件的行尾符。CRLF 检出时
 * 字符串是 `\r\n}\r\n`，`\n}\n` 永远匹配不到，`indexOf` 返回 -1，
 * 于是 `slice(at, -1)` 一路吃到文件末尾 —— 守卫**多抓**了后面那些函数的
 * `BAL.X`（实测 25 → 35 个字段），同一份代码在 LF 与 CRLF 检出上给出不同结论。
 * 它当时没造成误报，只因为多抓的恰好是增益自己的参数；换个位置就会误伤。
 *
 * 配对时跳过字符串与模板串里的花括号，否则 `'}'` 这种字面量会提前收尾。
 */
function braceBodyEnd(code, at) {
  let i = code.indexOf('{', at);
  if (i < 0) return -1;
  let depth = 0;
  let quote = null;
  for (let j = i; j < code.length; j++) {
    const ch = code[j];
    if (quote) {
      if (ch === '\\') { j++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return j + 1;
    }
  }
  return -1;
}

function gainAffectedFields() {
  const code = stripComments(readFileSync(join(ROOT, 'src/core/cards/powers.ts'), 'utf8'));
  const at = code.indexOf('export function rulesStatic');
  if (at < 0) return null;
  const end = braceBodyEnd(code, at);
  // 配不上对就当作抓不到：宁可守卫失败，也不要它悄悄扫半份文件。
  if (end < 0) return null;
  const body = code.slice(at, end);
  const out = new Set();
  for (const m of body.matchAll(/\bBAL\.(\w+)/g)) out.add(m[1]);
  return out.size ? out : null;
}
const GAIN_FIELDS = gainAffectedFields();
if (!GAIN_FIELDS) {
  console.error('✗ 抓不到 rulesStatic() 引用的 BAL 字段 —— 界面数字守卫会静默失效');
  process.exit(1);
}

/**
 * 规则集。新增规则时先问：这个能力的唯一实现点是哪个文件？答不出来，
 * 说明架构还没定，不要先把规则写成"暂时允许 N 个文件"。
 */
const RULES = [
  {
    id: 'clock/single',
    why: '全项目只有 infra/schedule.ts 一个时钟：无头模拟把调度器换成同步执行，直接写 setTimeout 会让 sim 挂住，也会长出第二套互不知情的节拍',
    applies: (rel) => rel.startsWith('src/') && ts(rel),
    owners: ['src/core/infra/schedule.ts'],
    ban: /\bset(?:Timeout|Interval)\s*\(/g,
  },
  {
    id: 'state/single-writer',
    why: '玩家资源只有 infra/write.ts 一个写入口，血量/格挡/行动力的上下限与日志才不会各写一遍',
    applies: (rel) => core(rel) && ts(rel),
    owners: ['src/core/infra/write.ts'],
    ban: /\bG\.(?:hp|block|ap|maxHp|apMax)\s*(?:[+\-*/]?=|\+\+|--)(?!=)/g,
  },
  {
    id: 'numeric/single-entry',
    why: '效果原型只在 model/effects.ts 定义、只在 combat/strike.ts 调用；任何第三处调用 resolveEff 都会重新长出「卡面一套数、结算一套数」',
    applies: (rel) => ts(rel) && (rel.startsWith('src/') || rel.startsWith('tools/')),
    owners: ['src/core/model/effects.ts', 'src/core/combat/strike.ts'],
    ban: /\bresolveEff\s*\(/g,
  },
  {
    id: 'core/no-platform',
    why: 'core 必须能在 Node 里跑：DOM、localStorage、rAF 只允许 infra/storage.ts 这一个平台适配点接触',
    applies: (rel) => core(rel) && ts(rel),
    owners: ['src/core/infra/storage.ts'],
    ban: /\b(?:document|window|localStorage|sessionStorage|requestAnimationFrame|navigator)\b/g,
  },
  {
    id: 'settlement/single-plan',
    why: '出牌与答题只构造 Settlement；可见状态（hp/block/ap/抽牌）与事件只能由 combat/settlement.ts 的执行器写，否则一手牌又会分成两个时相、两份读数',
    applies: (rel) => /^src\/core\/combat\/(?:play|answer|foe)\.ts$/.test(rel),
    owners: [],
    ban: /\b(?:emit|drawCards|grantBlock|healHp|loseHp|spendAp|gainAp|applyHit)\s*\(/g,
  },
  {
    id: 'event/single-emitter',
    why: '战斗层只有执行器能发 GameEvent：事件必须与它对应的状态写入落在同一个调度点，任何别处直接 emit 都会重新长出「状态先变、特效后补」',
    applies: (rel) => /^src\/core\/combat\/.*\.ts$/.test(rel),
    owners: ['src/core/combat/settlement.ts'],
    ban: /\bemit\s*\(/g,
  },
  {
    id: 'content/self-describing',
    why: '出题视图不许根据选项文案猜语义：位置依赖是题库 DSL 的数据属性（! 固定顺序），由 parse.ts 在解析期校验并要求作者声明',
    applies: (rel) => rel === 'src/core/library/question.ts',
    owners: [],
    ban: /\bPOSITIONAL\b|\.test\s*\(|\/\^/g,
  },
  {
    id: 'settlement/no-legacy-api',
    why: 'strikeWith / runStrike / publishStrike / thornsBack 是「状态一次写完、特效事后补播」那套架构的入口，不允许复活',
    applies: (rel) => ts(rel) || rel.endsWith('.mjs'),
    owners: [],
    ban: /\b(?:strikeWith|runStrike|publishStrike|thornsBack)\s*\(/g,
  },
  {
    id: 'ui/no-rule-literal',
    why: `界面不许直读会被增益改的 BAL 字段（${[...GAIN_FIELDS].join(' / ')}）：声明值与玩家此刻的现值不同，`
      + '界面读声明值、结算读现值，两个数字差在哪玩家看不出来。界面一律走 rulesStatic() 或它派生的函数',
    applies: (rel) => /^src\/(?:scenes|gfx)\//.test(rel) && ts(rel),
    owners: [],
    ban: new RegExp(`\\bBAL\\.(?:${[...GAIN_FIELDS].join('|')})\\b`, 'g'),
  },
  {
    id: 'content/no-literal-hp',
    why: '事件的代价与收益只写在 journey/events.ts 的 FX 表里，副标题与 run() 都从那儿取。'
      + '文案写「失去 8 点生命」、代码写 hurtBy(10)，测试里没有任何断言读 UI，这种错会一直存在',
    applies: (rel) => rel === 'src/core/journey/events.ts',
    owners: [],
    ban: /\d+\s*点生命/g,
  },
  {
    id: 'ui/no-design-voice',
    why: '玩家可见的文案只有三种视角：你看到什么、什么条件换什么数、按哪里。'
      + '第四种是"为什么这样设计"——它读起来像作者在解释自己的作品，而不是游戏在跟玩家说话。'
      + '这类句子没有任何断言能抓到（测试不读 UI 文案），只能靠词表拦；'
      + '新增一条文案前先问：这句是在跟玩家交代，还是在跟自己交代',
    applies: (rel) => rel.startsWith('src/') && ts(rel),
    owners: [],
    ban: /本身也是|只保证|救不了这一手|越早拿到越值|真正的|默认规则|照常生效|照旧|互不替代|一句话[：:]|换句话说|这意味着|简单说|需要注意的是|仍然随时|不会丢/g,
  },
  {
    id: 'numeric/integer-only',
    why: '游戏数值只许用整数和加减乘：小数、百分比、"×0.55 存活率"这类写法没有唯一读法（+18% 是加 18 个百分点还是乘 1.18？），'
      + '也说不清卡面上那个数是怎么来的。血量、伤害、格挡、回复、地图配比全部是整数；'
      + '需要"每 N 级领 M 道"这种比例关系时，写成整数乘除并把 M / N 放进 BAL（`qPer` / `qOf`），不要留 0.6。'
      + '字符串内容不扫：「0.1 + 0.2 在多数语言里不等」是题面，不是公式',
    applies: (rel) => rel.startsWith('src/core/') && ts(rel),
    owners: [],
    skipStrings: true,
    ban: /\b\d+\.\d+(?![%\d])/g,
  },
  {
    id: 'panel/single-reader',
    why: '读面板内部字段统一走 infra/state.ts 的 panelOf(k)。手写 `as unknown as { view: ... }` 会在'
      + '面板字段改名后静默读 undefined —— stagecheck 里就有一个 `type: \'battle\'` 被断言藏了整整一版',
    applies: (rel) => ts(rel) && (rel.startsWith('src/') || rel.startsWith('tools/')),
    owners: ['src/core/infra/state.ts'],
    ban: /\bG\.panel\s+as\s+(?:unknown\s+as\s+)?\{/g,
  },
];

function walk(dir, rel = '', out = []) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const next = rel ? `${rel}/${ent.name}` : ent.name;
    if (ent.isDirectory()) walk(join(dir, ent.name), next, out);
    else out.push(next);
  }
  return out;
}

/** 抹成等长空白而不是删掉，行号与列号保持不变。 */
function stripComments(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|\s)\/\/[^\n]*/g, (m, lead) => lead + ' '.repeat(m.length - lead.length));
}

/**
 * 把字符串字面量的**内容**抹成空白，引号保留。
 *
 * 只给「扫数值」这类规则用：题面里的 `"0.1 + 0.2 在多数语言里不等"` 是内容，
 * 不是写进公式的小数。抹掉内容之后，规则只看得到代码里的数字。
 */
function maskStrings(code) {
  return code.replace(/(['"`])(?:\\.|(?!\1)[^\\\n])*\1/g, (m) => m[0] + ' '.repeat(m.length - 2) + m[0]);
}

const files = [...walk(join(ROOT, 'src'), 'src'), ...walk(join(ROOT, 'tools'), 'tools')];
const cache = new Map();
function source(rel) {
  if (!cache.has(rel)) cache.set(rel, stripComments(readFileSync(join(ROOT, rel), 'utf8')));
  return cache.get(rel);
}

let failures = 0;
let checked = 0;
console.log('架构不变量检查');

for (const rule of RULES) {
  const inScope = files.filter(rule.applies);
  if (!inScope.length) {
    console.error(`✗ ${rule.id}: 作用域内一个文件都没扫到 —— 守卫失效了`);
    failures += 1;
    continue;
  }
  const owners = new Set(rule.owners);
  const missing = rule.owners.filter((o) => !files.includes(o));
  if (missing.length) {
    console.error(`✗ ${rule.id}: 唯一实现点不存在了：${missing.join('、')}`);
    failures += 1;
    continue;
  }

  const hits = [];
  for (const rel of inScope) {
    if (owners.has(rel)) continue;
    const raw = source(rel);
    const code = rule.skipStrings ? maskStrings(raw) : raw;
    for (const m of code.matchAll(rule.ban)) {
      const line = code.slice(0, m.index).split('\n').length;
      hits.push(`${rel}:${line}`);
    }
  }
  checked += inScope.length;
  if (hits.length) {
    console.error(`✗ ${rule.id} —— ${rule.why}`);
    for (const h of hits.slice(0, 20)) console.error(`    ${h}`);
    if (hits.length > 20) console.error(`    …另有 ${hits.length - 20} 处`);
    failures += hits.length;
  } else {
    const ownerText = rule.owners.length ? rule.owners.join(', ') : '全禁';
    console.log(`  ✓ ${rule.id.padEnd(26)} 扫 ${inScope.length} 文件 / ${ownerText}`);
  }
}

// 空扫描必须失败：守卫最容易的死法是「什么都没扫到，于是全部通过」
if (!files.length || !RULES.length || !checked) {
  console.error('✗ 没有执行任何扫描 —— 路径或规则被改坏了？');
  process.exit(1);
}

if (failures) {
  console.error(`\n✗ ${failures} 处违反架构不变量。修法见 tools/invariants.mjs 里每条规则的 why，`);
  console.error('  不要加豁免：把写法收回唯一实现点。');
  process.exit(1);
}
console.log('✓ 通过');
