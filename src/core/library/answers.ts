import { G } from '../infra/state';
import { sourceBank } from './bank';
import { clearRunAnswers, runAnswers, type AnswerNote } from './stagemem';

/**
 * 一局的答题记录怎么交回本机服务。
 *
 * 三步：`recordAnswer()` 边答边记流水（stagemem）→ 结算时 `queueRunAnswers()`
 * 把它连同这一局的摘要打成一个包排队 → 表现层（`main.ts`）取走交给
 * `remote.ts` 的 `sendAnswers()`。
 *
 * 为什么不在结算里直接发：core 不发请求，`npm run sim` 才能在 Node 里跑几千局；
 * 请求也只在玩家自己打完一局时发生，和"项目自己不连第三方"是同一条。
 *
 * 服务不在是正常状态：`sendAnswers()` 失败只返回 false，队列已经出队，
 * 不重试、不弹错、不攒到下一次 —— 交不上去就当没发生。
 */
export interface AnswerUpload {
  /** 载荷版本：服务端按行追加，格式变了靠它分辨。 */
  v: 1;
  bank: string;
  topics: string[];
  mode: string | null;
  win: boolean;
  stage: number;
  floors: number;
  ok: number;
  bad: number;
  answers: AnswerNote[];
}

let outbox: AnswerUpload | null = null;

/**
 * 结算时调用：打包这一局的流水。没有答题就不排队 ——
 * 一道题都没答的一局不值得往服务端写一行空记录。
 */
export function queueRunAnswers(win: boolean) {
  const answers = runAnswers();
  if (!answers.length) return;
  outbox = {
    v: 1,
    bank: sourceBank().name,
    topics: G.topics.slice(),
    mode: G.mode,
    win,
    stage: G.stage,
    floors: G.floors,
    ok: G.runOk,
    bad: G.runBad,
    answers: answers.slice(),
  };
  clearRunAnswers();
}

/** 表现层每帧问一次；取走之后就没有了，所以不会重复发同一局。 */
export function takeAnswerUpload(): AnswerUpload | null {
  const p = outbox;
  outbox = null;
  return p;
}
