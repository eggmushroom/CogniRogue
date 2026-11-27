import { existsSync, readFileSync } from 'node:fs';

const readme = readFileSync('README.md', 'utf8');
const localReferences = [...readme.matchAll(/\]\(([^\s)]+)\)/g)]
  .map(([, target]) => target)
  .filter((target) => !/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(target));
const missing = [...new Set(localReferences)].filter((target) => !existsSync(target.split(/[?#]/, 1)[0]));

if (missing.length > 0) {
  console.error(`✗ README 引用的文件不存在：${missing.join('、')}`);
  process.exitCode = 1;
} else {
  console.log('✓ README 中引用的本地文件均存在');
}
