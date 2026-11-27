/**
 * 对配置的真实审核模型运行固定的 10 道正反例回归集。
 * 运行：npm run reviewcheck（默认沿用 GEN_*；可用 REVIEW_* 单独覆盖）。
 * 这是联网评估，不纳入默认离线 verify。
 */
import { openAiLlm, reviewConfigFromEnv } from './llm';
import { reviewQuestion } from './review';
import type { ReviewCandidate } from './review';

const cfg = reviewConfigFromEnv();
if (!cfg.apiKey || !cfg.baseUrl || !cfg.model) {
  console.error('缺少生成模型配置；请设置 GEN_API_KEY（及可选的 GEN_BASE_URL、GEN_MODEL），或配置完整的 REVIEW_*。');
  process.exit(2);
}

const sources = [{
  sectionId: 'sec_test',
  text: '二分查找适用于有序数组。每次比较后，算法会排除当前搜索区间的一半，因此搜索区间长度按几何级数递减。对包含 n 个元素的数组，二分查找的时间复杂度为 O(log n)。',
}];
type Case = { name: string; expected: 'pass' | 'reject'; question: Omit<ReviewCandidate, 'qid'> };
const cases: Case[] = [
  { name: 'valid-grounded-question', expected: 'pass', question: { stem: '对一个包含 n 个元素的有序数组执行二分查找，其时间复杂度是？', options: ['O(log n)', 'O(n)', 'O(1)', 'O(n log n)'], answer: 0, explain: '每次比较排除一半，故为 O(log n)。', sources } },
  { name: 'wrong-answer-index', expected: 'reject', question: { stem: '对一个包含 n 个元素的有序数组执行二分查找，其时间复杂度是？', options: ['O(log n)', 'O(n)', 'O(1)', 'O(n log n)'], answer: 1, explain: '每次比较排除一半，故为 O(n)。', sources } },
  { name: 'evidence-contradicts-question', expected: 'reject', question: { stem: '二分查找适用于哪种数组？', options: ['有序数组', '无序数组'], answer: 1, explain: '原文说二分查找适用于无序数组。', sources } },
  { name: 'explanation-contradicts-evidence', expected: 'reject', question: { stem: '二分查找时间复杂度？', options: ['O(log n)', 'O(n)'], answer: 0, explain: '因为每次只排除一个元素，所以需要 O(n)。', sources } },
  { name: 'multiple-correct-options', expected: 'reject', question: { stem: '二分查找时间复杂度？', options: ['O(log n)', 'O(log n)', 'O(n)'], answer: 0, explain: '复杂度为 O(log n)。', sources } },
  { name: 'insufficient-evidence-for-return-contract', expected: 'reject', question: { stem: '目标值不存在时，这个二分查找函数返回哪个整数？', options: ['-1', '0'], answer: 0, explain: '查找失败返回 -1。', sources } },
  { name: 'false-unsorted-array-premise', expected: 'reject', question: { stem: '对无序数组执行二分查找的时间复杂度是？', options: ['O(log n)', 'O(n)'], answer: 0, explain: '二分查找适用于无序数组，复杂度为 O(log n)。', sources } },
  { name: 'unsupported-extra-claim', expected: 'reject', question: { stem: '二分查找时间复杂度？', options: ['O(log n)', 'O(n)'], answer: 0, explain: '答案为 O(log n)，且所有现代 CPU 都能在常数时间完成二分查找。', sources } },
  { name: 'irrelevant-evidence', expected: 'reject', question: { stem: '哈希表查找的平均时间复杂度是？', options: ['O(1)', 'O(log n)'], answer: 0, explain: '平均为 O(1)。', sources: [{ sectionId: 'sec_other', text: '快速排序的平均时间复杂度为 O(n log n)。' }] } },
  { name: 'missing-evidence', expected: 'reject', question: { stem: '对一个包含 n 个元素的有序数组执行二分查找，其时间复杂度是？', options: ['O(log n)', 'O(n)'], answer: 0, explain: '每次排除一半，故为 O(log n)。', sources: [] } },
];

const llm = openAiLlm({ ...cfg, timeoutMs: 45_000, retries: 0 });
let matched = 0;
for (const [index, item] of cases.entries()) {
  const result = await reviewQuestion(llm, { ...item.question, qid: `eval_${index + 1}` });
  const ok = result.verdict === item.expected;
  if (ok) matched++;
  console.log(`${ok ? '✓' : '✗'} ${item.name}: expected=${item.expected}, actual=${result.verdict}${result.verdict === 'pending' ? ` (${result.issue})` : ''}`);
  if (result.verdict === 'pending' && result.issue === 'request-failed' && result.attempts) {
    console.log(`  ${JSON.stringify(result.attempts)}`);
  }
}
console.log(`审核回归结果：${matched}/${cases.length} 命中预期`);
if (matched !== cases.length) process.exitCode = 1;
