import { beginFrame, g, toScreen, VH, VW } from '../gfx/canvas';
import * as FX from '../gfx/fx';
import { C } from '../gfx/theme';
import { text } from '../gfx/ui';
import { hitAt, hotRects, lastClickInfo } from '../input';
import { G } from '../core/infra';
import { BANK } from '../core/library';
import { costNow, defOf, PACK } from '../core/cards';
import { answer, endTurn, lastFeedback } from '../core/combat';
import { planStrike } from '../core/combat/strike';
import { ackPower, saveRun } from '../core/journey';
import { EFFS } from '../core/model';
import type { Feedback } from '../core/model';
import { DISCARD_TO, ENEMY, enemyHand, fxCount, handSettled, HERO, heroHand } from '../scenes/battle';
import { mapCam } from '../scenes/map';
import { quizFrame } from '../scenes/overlay';
/* 这些是 main.ts 的时钟 / 锁状态，dev 模块只通过 hooks 读写，不反向依赖组合根。 */
export interface CogHooks {
  holdPanel(sec: number): void;
  holdEnemy(sec: number): void;
  setQuizHold(sec: number): void;
  quizClock(): { settling: boolean; reveal: number };
  locked(): boolean;
  victoryProgress(): number | null;
}

declare global {
  interface Window {
    cog: {
      state: typeof G;
      /** 在画面上叠一层 100px 坐标网格，手写布局时对位置用 */
      grid: () => void;
      hots: () => { x: number; y: number; w: number; h: number; label: string; idx?: number }[];
      /** 这个点此刻会点到谁：冒烟测试用它确认选的位置真的属于那张牌 */
      probe: (x: number, y: number) => { label: string; idx?: number } | null;
      /** 手牌是不是全部落位并停稳：代替"睡一会儿再点" */
      handReady: () => boolean;
      /** 地图镜头：滚轮/拖动有没有真的生效（节点热区读不出这件事） */
      mapCam: () => { cam: number; manual: boolean };
      /** 最近一次真正被接受的点击，用来确认"这一下点的是谁" */
      lastClick: () => { label: string; idx?: number } | null;
      toScreen: (x: number, y: number) => { x: number; y: number };
      /** 演示/截图用：单独放一次打击动画，不改变任何数值 */
      strike: (kind?: FX.StrikeKind, target?: 'enemy' | 'hero') => void;
      /** 调试用：内置卡牌库（恒定，导入题库不会变） */
      readonly pack: typeof PACK;
      /** 调试用：当前题库（可换）。题目挂在 Panel 快照上，测试一般不用读这里 */
      readonly bank: typeof BANK;
      /** 调试/自动化用：直接答题，绕过点击 */
      pick: (i: number) => void;
      /** 调试/自动化用：关掉增益掉落面板（它只有一个出口） */
      ackPower: () => void;
      /** 调试/截图用：把当前这一局写成断点（首页「继续这一局」的那条存档） */
      save: () => void;
      /** 调试/自动化用：还在飞的单元数（抽牌 / 弃牌 / 敌人动作），用来盯"飞行单元漏清" */
      fx: () => ReturnType<typeof fxCount> & { enemy: number };
      guardPose: () => { hero: number; enemy: number };
      wards: () => { hero: number; enemy: number };
      /** 调试/自动化用：这张卡此刻的实际费用（X 费牌 = 当前行动力） */
      costOf: (id: string) => number;
      /** 冒烟测试用：单独演一次敌人动作，不改任何数值。taken=0 演"被全挡下" */
      enemyAct: (k?: FX.EnemyActKind, taken?: number) => void;
      /** 演示/截图用：真的走一次敌人回合，血量 / 弃牌堆 / 意图都会跟着变 */
      endTurn: () => void;
      /** 输入是不是正被演出锁住：冒烟测试靠它等敌人这一下演完 */
      locked: () => boolean;
      victory: () => { striking: boolean; exit: number | null };
      /** 答题面板的几何、翻牌阶段和解析状态。 */
      quiz: () => {
        phase: string; settling: boolean; drawn: boolean; reveal: number;
        entry: ReturnType<typeof quizFrame>['entry'];
        flipAt?: ReturnType<typeof quizFrame>['flipAt'];
        optionBottom?: number;
        geom: { x: number; y: number; w: number; h: number };
        review?: ReturnType<typeof quizFrame>['review'];
      };
      /** 最近一次判定的结果。答对不再弹面板，测试要验"打了几段"只能从这里读 */
      lastAnswer: () => Feedback | null;
      /** 截图 / 回归用：把判定演出拉长，好把"面板没消失"这一帧拍下来 */
      holdQuiz: (sec: number) => void;
      /** 联动的战场记账 + 四张联动卡此刻每段打出的伤害，给回归测试验因果 */
      links: () => {
        drawn: number; block: number; plays: Record<string, number>;
        next: { mul: number; add: number; from: string } | null;
        live: Record<string, number>;
      };
    };
  }
}

export function installCog(hooks: CogHooks) {
  window.cog = {
    state: G,
    hots: hotRects,
    probe: hitAt,
    handReady: handSettled,
    mapCam,
    lastClick: lastClickInfo,
    toScreen,
    strike: (kind = 'strike', target: 'enemy' | 'hero' = 'enemy') => {
      const follow = target === 'enemy' ? heroHand : enemyHand;
      FX.attack({
        from: follow(),
        follow,
        to: target === 'enemy' ? { x: ENEMY.x, y: ENEMY.y } : { x: HERO.x, y: HERO.y - 10 },
        color: target === 'enemy' ? EFFS[kind].color : C.red,
        kind, dmg: 9, target,
      });
      hooks.holdPanel(0.6);
    },
    get pack() { return PACK; },
    get bank() { return BANK; },
    pick: (i: number) => answer(i),
    ackPower: () => ackPower(),
    costOf: (id: string) => costNow(defOf(id)),
    fx: () => ({ ...fxCount(), enemy: FX.enemyActCount() }),
    guardPose: () => ({ hero: FX.heroGuard(), enemy: FX.enemyGuard() }),
    wards: () => ({ hero: FX.wardPower('hero'), enemy: FX.wardPower('enemy') }),
    enemyAct: (k: FX.EnemyActKind = 'atk', taken = 9) => {
      const from = { x: ENEMY.x, y: ENEMY.y };
      const to = { x: HERO.x, y: HERO.y };
      // 调试入口演的是「一段」：多段由真实敌人回合的执行器逐段发出。
      if (k === 'atk') {
        const absorbed = taken === 0 ? 12 : 0;
        const dur = FX.enemyStrike({
          n: taken, absorbed, seq: 0, times: 1, totalAbsorbed: absorbed, from, to, follow: enemyHand,
        });
        hooks.holdEnemy(dur);
        return;
      }
      const n = k === 'jam' ? 2 : k === 'def' ? 12 : k === 'buff' ? 2 : 12;
      const dur = FX.enemyAct({
        k, n, from, to, discard: DISCARD_TO,
      });
      hooks.holdEnemy(dur);
    },
    endTurn: () => endTurn(),
    locked: () => hooks.locked(),
    victory: () => ({ striking: FX.playerStrikeActive(), exit: hooks.victoryProgress() }),
    quiz: () => {
      const clock = hooks.quizClock();
      return {
        phase: G.panel.k === 'feedback' ? (clock.settling ? 'settle' : 'result')
          : G.panel.k === 'question' ? 'ask' : 'idle',
        settling: clock.settling,
        entry: quizFrame().entry,
        flipAt: quizFrame().flipAt,
        optionBottom: quizFrame().optionBottom,
        drawn: quizFrame().drawn,
        manual: quizFrame().manual ?? false,
        reveal: clock.reveal,
        geom: { ...quizFrame().geom },
        review: quizFrame().review,
      };
    },
    lastAnswer: () => lastFeedback(),
    holdQuiz: (sec: number) => hooks.setQuizHold(sec),
    links: () => ({
      drawn: G.drawnThisTurn,
      block: G.block,
      plays: { ...G.cardPlays },
      next: G.nextBoost ? { ...G.nextBoost } : null,
      live: Object.fromEntries(['c83', 'c84', 'c85', 'c86'].map((k) => [k, planStrike(k).hits[0] ?? 0])),
    }),
    save: () => saveRun(),
    grid: () => {
      beginFrame();
      g.strokeStyle = 'rgba(255,255,255,.06)';
      for (let x = 0; x < VW; x += 100) {
        g.beginPath(); g.moveTo(x, 0); g.lineTo(x, VH); g.stroke();
        text(String(x), x + 4, 12, { size: 10, color: 'rgba(255,255,255,.3)' });
      }
      for (let y = 0; y < VH; y += 100) {
        g.beginPath(); g.moveTo(0, y); g.lineTo(VW, y); g.stroke();
        text(String(y), 4, y + 10, { size: 10, color: 'rgba(255,255,255,.3)' });
      }
    },
  };
}
