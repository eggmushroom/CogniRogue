import { G } from '../infra/state';
import { shuffle } from '../infra/util';
import { BAL } from '../model/data';
import type { Question } from '../model/types';
import { allQuestions } from './bank';
import { rightCount } from './stagemem';

/**
 * 本局的**临时题库**。
 *
 * 一局开局时从选中的几个主题里各取一批题，拼成一条有序队列，整局共用这一份池子，
 * 五幕都从它里面抽 —— 幕不再绑定主题（以前五幕对应五章，选 2 个主题就没法摆了）。
 *
 * 队列按主题**连续**排：先把第一个主题走完，再走下一个。所以一局会自然形成
 * 「先啃完这一章，再进下一章」的节奏，而不是几个主题打散混在一起。
 *
 * 池子在开局定死，是**快照**：题库的异步更新永远污染不了当前局，
 * 新题要等下一局开局才会进池。退役也只在建池时生效，局内重复由
 * `MAX_PICK_PER_RUN` 管 —— 局内再筛一次退役会让池子提前见底。
 */

/**
 * 这道题还能不能抽到：**答对**满 `BAL.retireAt` 次就退役。答错不算。
 *
 * 按题目自己的主题查记忆。题池回退到全部题目时按 `G.stageTopic` 查会记错账 ——
 * 主题轮换之后，同一个 qid 在不同幕会被当成两个不同的题。
 *
 * 这一步最终归后端：接上服务之后，终身答对次数由服务端记账，
 * 前端拿到的就是"还能抽的题"，不再自己判。
 */
export function isRetired(q: Question): boolean {
  return rightCount(q.topic, q.qid) >= BAL.retireAt;
}

/** 一个主题里还没退役的题。 */
export function liveQuestionsOf(topic: string): Question[] {
  return allQuestions().filter((q) => q.topic === topic && !isRetired(q));
}

/**
 * 建这一局的临时题库。
 *
 * 每个主题各取 `BAL.runTopicQuota` 道，按传入顺序首尾相接。主题的活题不足就全取；
 * 一道活的都没有就退回它全部的题 —— 一个主题整局缺席，比抽到旧题更糟，
 * 而「这个主题该补题了」由 `liveCount()` 报给更新层，不该罚在玩家手上。
 */
export function buildRunPool(topics: string[]): void {
  const all = allQuestions();
  const queue: string[] = [];
  for (const topic of topics) {
    const mine = all.filter((q) => q.topic === topic);
    const live = mine.filter((q) => !isRetired(q));
    const take = shuffle(live.length ? live : mine).slice(0, BAL.runTopicQuota);
    queue.push(...take.map((q) => q.qid));
  }
  G.runQueue = queue;
  G.runCursor = 0;
}

/** 本局临时题库里的全部题：复用兜底、存档校验、"这个主题还有多少"都读它。 */
export function runPool(): Question[] {
  const byId = new Map(allQuestions().map((q) => [q.qid, q]));
  return G.runQueue.map((id) => byId.get(id)).filter((q): q is Question => !!q);
}

/**
 * 按队列顺序取下 `n` 道，可能跨主题边界（一节走完了就接下一个主题）。
 * 队列走完就返回手上这些，不回头 —— 回头由 `takeQuestion` 的复用兜底。
 */
export function nextQuestions(n: number): Question[] {
  const byId = new Map(allQuestions().map((q) => [q.qid, q]));
  const out: Question[] = [];
  while (out.length < n && G.runCursor < G.runQueue.length) {
    const q = byId.get(G.runQueue[G.runCursor] as string);
    G.runCursor += 1;
    if (q) out.push(q);
  }
  return out;
}

/**
 * 界面上的主题标签。幕不再一一对应主题，所以不能写「本章 X」。
 * 多主题时只报个数：一局五个主题名字串起来，顶栏放不下。
 */
export function runLabel(topics: string[]): string {
  if (!topics.length) return '未选主题';
  const first = topics[0] as string;
  return topics.length === 1 ? first : `${first} 等 ${topics.length} 个主题`;
}
