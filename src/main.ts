import './style.css';
import { BUILTIN_MD } from './core/builtin';
import { EFFS, POWER_BY_ID } from './core/model';
import { beginFrame, g, initCanvas, toLogic, toScreen, VH, VW } from './gfx/canvas';
import { loadArt } from './gfx/assets';
import * as FX from './gfx/fx';
import { bindInput, beginInput, clearWheel, endInput, hitAt, hotRects, hover, keyHandler, lastClickInfo, setInputLock } from './input';
import { C } from './gfx/theme';
import { text } from './gfx/ui';
import { G, onFx } from './core/infra';
import { BANK, enterStage, loadQuestionBank, stageMemOf } from './core/library';
import { costNow, defOf, PACK } from './core/cards';
import { liveStatOf } from './core/combat/link';
import { FOES } from './core/model';
import { answer, askCard, cancelPanel, canAsk, endTurn } from './core/combat';
import {
  EVENTS, ackPower, dismissFeedback, endRun, enterNode, openCardPick, saveRun, startRun,
} from './core/journey';
import { genStage } from './core/map';
import { CURRICULUM, STAGES } from './core/model';
import type { Move } from './core/model';
import {
  drawBattle, DISCARD_TO, ENEMY, fxCount, handSettled, HERO, heroHand, resetBattleView, syncBattle,
} from './scenes/battle';
import { drawMap, mapCam } from './scenes/map';
import { drawOverlay, quizFrame } from './scenes/overlay';
import { drawTitle } from './scenes/title';
import { drawAtlas } from './scenes/atlas';

const canvas = document.querySelector<HTMLCanvasElement>('#game');
if (!canvas) throw new Error('#game 不存在');

initCanvas(canvas);
bindInput(canvas, toLogic);

// 逻辑层只发事件，表现层在这里翻译成"看得见的后果"
// 面板真的画出来了（而不是"状态里有个面板"）才算挡住 —— 打击演出期间面板是推迟绘制的，
// 这时候玩家侧的格挡/回血数字应该照常弹出来。
const modalOpen = () => G.panel.k !== 'none';
const panelShown = () => modalOpen() && panelHold <= 0;

/**
 * 反馈面板的推迟时间。答对之后先让这一下打完（光刃飞过去、命中、击退），
 * 再把面板弹出来；否则 0.5 屏的暗色遮罩会把整段演出盖掉，
 * 玩家只会看到"血少了，然后弹了个框"。
 */
let panelHold = 0;

/**
 * 答题 → 判定 → 结算现在是**同一块面板**。
 *
 * `settling` 是"判定已经出来、打击演出还在飞"的那一小段：以前这段时间
 * 屏幕上什么面板都没有（答案那一屏瞬间消失，等 0.66s 再弹一个更暗的新框），
 * 一局要经历几十次这种闪断。现在面板原地不走，选项当帧就亮起判定，
 * 演出在它周围继续播；`reveal` 只驱动结果区逐层淡入。
 */
let quizSettling = false;
let quizReveal = 0;
let lastPanelKind = '';
let wasSettling = false;
/** 调试用：下一块判定面板要停在"答案已出、结果未展开"多久。 */
let quizHoldBoost = 0;

/**
 * 结算面板的软自动推进。
 *
 * 鼠标停在面板上时一律暂停 —— 有释义要读，把人赶走是最糟的"优化"；
 * 键盘 / 触屏外操作的玩家则不必再为了一个"继续"多抬一次手。
 * 面板上有一条进度条把这件事讲明白，点面板任意处随时可以立刻走。
 * 用墙钟而不是 dt：渲染被节流时游戏时间会变慢，玩家不该因此被多晾几秒。
 *
 * 只记「还剩多少毫秒」，按相邻两帧的墙钟差递减。以前存起点时间戳再减去
 * 累计暂停时长，暂停段在判定演出里就已经开始了、却没记起点，第一次解除
 * 暂停时会把「页面启动至今」整段当成暂停扣掉，倒计时反而被拉长到 10 秒。
 * 现在演出、展开、悬停这些不该计时的帧直接不扣，语义一眼看得完。
 */
const AUTO_MS = 4200;
let autoRemain = AUTO_MS;
let autoLast = 0;
let autoCancelled = false;
/** 自动化 / 截图：整页都不自动收判定面板，免得脚本还没读到它就走了。 */
let autoHold = false;
let autoPaused = false;
let autoIn = 0;

function resetAuto() {
  autoRemain = AUTO_MS;
  autoLast = performance.now();
  autoCancelled = autoHold;
  autoPaused = false;
  autoIn = AUTO_MS / 1000;
}

/**
 * 上一帧面板是否开着。
 *
 * 面板开着时滚轮归面板（`scrollArea`）；地图不再替它把增量取走（见 `map.ts` 的
 * `updateCam`），代价是"这一屏没有列表"的时候没人消费它。所以关掉面板的那一帧
 * 要把剩下的增量清掉，否则它会落在刚从面板底下露出来的地图上。
 */
let panelWasOpen = false;

/**
 * 敌人动作演出剩余时间。core 的 endTurn 是同步的：事件发出来的时候，
 * 血已经扣了、下一回合的手牌也已经抽好。这段时间只是补演"它刚才做了什么"，
 * 不锁输入的话玩家能在光刃还在飞的时候点开下一张牌，画面就乱了。
 */
let enemyHold = 0;

onFx((e) => {
  const enemy = G.enemy;
  switch (e.t) {
    case 'dmg': {
      if (!enemy) break;
      const kind = e.eff ?? 'strike';
      const fly = kind === 'pierce' ? 0.15 : 0.2;
      FX.attack({
        from: heroHand(),
        // 起点每帧跟着提灯走：光刃是从手上甩出去的，不是从一张定住的位置射出来的
        follow: heroHand,
        to: {
          x: ENEMY.x + (Math.random() - 0.5) * 80,
          y: ENEMY.y + (Math.random() - 0.5) * 90,
        },
        color: EFFS[kind].color,
        kind,
        seq: e.seq ?? 0,
        dmg: e.n,
        absorbed: e.absorbed,
      });
      // 判定面板不再等整段打击演完：答案当帧就亮在原地，光刃在它周围飞。
      // 只留够第一下命中的时间，多段按段错开一点，别让"又弹了一个框"变成一拍停顿。
      panelHold = Math.max(panelHold, fly + 0.18 + (e.seq ?? 0) * 0.1);
      break;
    }
    case 'fizzle': {
      // 答错 = 这一手根本没打出去。所以**不朝敌人飞任何东西**：
      // 光刃、光斑、抛物线一律不要 —— 只要画面上有东西冲向敌人，读到的就是"打了"。
      // 反馈落在出手的地方：提灯的焰暗一下，一小撮屑在原地散掉。
      FX.fizzle({ at: heroHand, color: EFFS[e.eff ?? 'strike'].color });
      // 面板还是等这一下演完再展开结果，但答案本身当帧可见。
      panelHold = Math.max(panelHold, 0.2);
      break;
    }
    case 'hurt':
      // 事件选项扣血：这时候根本没有敌人，不能画一条从敌人坐标飞过来的光刃。
      // 敌人打的那一下已经统一走 enemyAct，这里只做"自己受伤"的反馈。
      FX.flash(C.red, 0.12);
      FX.shake(8);
      FX.floatText(HERO.x, HERO.y - 40, `-${e.n}`, C.red, 52, { vy: -80 });
      break;
    case 'enemyAct': {
      const dur = FX.enemyAct({
        k: e.k, n: e.n, times: e.times, taken: e.taken, absorbed: e.absorbed,
        from: { x: ENEMY.x, y: ENEMY.y },
        to: { x: HERO.x, y: HERO.y },
        discard: DISCARD_TO,
      });
      enemyHold = Math.max(enemyHold, dur);
      break;
    }
    case 'blk':
      if (!panelShown()) FX.gainBlock(HERO.x, HERO.y - 30, e.n);
      break;
    case 'heal':
      if (!panelShown()) FX.heal(HERO.x, HERO.y - 40, e.n);
      break;
    case 'foeHeal':
      // 落在它自己身上：和"玩家回血"共用绿色，位置说明是谁在回。
      // 不落在血条上 —— 那会盖住 `n / max` 那行字，正好把该看的数字糊掉。
      if (!panelShown()) FX.heal(ENEMY.x, ENEMY.y + 180, e.n);
      break;
    case 'shake':
      FX.shake(e.power);
      break;
    case 'power': {
      // 捡到增益的那一下：顶上飘一行字。它没有伤害数字，所以必须另给一个反馈，
      // 否则玩家只能靠"下回合多了一点行动力"倒推刚才捡到了什么。
      const pw = POWER_BY_ID[e.id];
      // 落在画面中央上方：敌人头顶是意图气泡，飘在那里会糊成一句
      if (pw) FX.floatText(760, 150, `${pw.name} 生效`, pw.color, 30, { vy: -42 });
      break;
    }
    default:
      break;
  }
});

keyHandler((k) => {
  // 玩家一旦用键盘接管，就把自动推进交还给他 —— 这是"可打断的便利"，不是倒计时。
  autoCancelled = true;
  const p = G.panel;
  if (panelHold > 0 || enemyHold > 0) return;
  if (k === 'escape') {
    if (G.screen === 'atlas') { G.screen = 'title'; return; }
    if (p.k === 'question' || p.k === 'deck' || p.k === 'pile'
        || p.k === 'help' || p.k === 'pack' || p.k === 'boon') cancelPanel();
    return;
  }
  if (k === 'confirm') {
    if (p.k === 'feedback') dismissFeedback();
    // 掉落面板只有一个出口，回车就是"知道了"
    else if (p.k === 'powerdrop') ackPower();
    // 没有面板时，空格/回车就是结束回合。键盘能做的事不该只有鼠标能做 ——
    // 这也是"某个按钮热区被漏注册"时唯一还能把一局推下去的逃生口。
    else if (p.k === 'none' && G.screen === 'battle') endTurn();
    return;
  }
  if (p.k === 'question') {
    const i = Number(k) - 1;
    const card = G.hand[p.idx];
    if (card) answer(i);
  }
});

let t = 0;
let last = performance.now();

function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  t += dt;

  beginFrame();
  beginInput();

  // 面板刚关掉：把面板期间攒下的滚轮增量丢掉，别让它一次性落到地图镜头上。
  if (panelWasOpen && !modalOpen()) clearWheel();
  panelWasOpen = modalOpen();

  // 面板推迟：只在"刚打完这一下"的反馈面板上生效，别把奖励/休息这些面板一起按住
  if (G.panel.k === 'feedback' && panelHold > 0) panelHold = Math.max(0, panelHold - dt);
  else if (G.panel.k !== 'feedback') panelHold = 0;
  if (enemyHold > 0) enemyHold = Math.max(0, enemyHold - dt);

  // 面板换屏要重置答题面板的三段时钟；同一块面板只推进 reveal，不重新开始。
  if (G.panel.k !== lastPanelKind) {
    if (G.panel.k === 'feedback') {
      quizReveal = 0;
      resetAuto();
      if (quizHoldBoost > 0) { panelHold = Math.max(panelHold, quizHoldBoost); quizHoldBoost = 0; }
    }
    lastPanelKind = G.panel.k;
  }
  quizSettling = G.panel.k === 'feedback' && panelHold > 0;
  // 倒计时从"结果真的展开"那一刻起算，不把打击演出的时间算进去。
  if (wasSettling && !quizSettling && G.panel.k === 'feedback') {
    autoRemain = AUTO_MS;
    autoLast = performance.now();
    autoCancelled = false;
    autoPaused = false;
    autoIn = AUTO_MS / 1000;
  }
  wasSettling = quizSettling;
  if (G.panel.k === 'feedback' && !quizSettling) quizReveal += dt;
  // 放在 boost 之后：调试拉长判定时那一帧也必须是锁输入的。
  setInputLock(panelHold > 0 || enemyHold > 0);

  const sh = FX.shakeOffset();
  g.save();
  g.translate(sh.x, sh.y);

  if (G.screen === 'atlas') {
    drawAtlas(t);
  } else if (G.screen === 'title') {
    drawTitle(t, () => { G.panel = { k: 'help' }; }, () => { G.panel = { k: 'pack', msg: '', ok: true }; });
  } else if (G.screen === 'map') {
    drawMap(t, dt);
  } else {
    syncBattle();
    drawBattle(t, dt);
  }

  // 特效和战场必须在同一层：光刃端点用的是 HERO/ENEMY 的逻辑坐标，
  // 场景跟着震动位移、特效却不跟着走，命中那一瞬光刃会脱离角色。
  FX.draw();
  g.restore();

  FX.drawFlash();
  // 面板最后画。以前 FX.draw 排在这里之后，伤害飘字和粒子会压在弹窗上面，
  // 看起来像渲染残留；同时面板也别跟着震动位移走 —— 画在位移里时按钮会抖，
  // 而命中热区是逻辑坐标，两者会错开几像素。
  if (G.panel.k !== 'none') {
    drawOverlay(t, {
      settling: quizSettling, reveal: quizReveal,
      autoProgress: 1 - autoIn / (AUTO_MS / 1000), autoPaused, autoCancelled,
    });
  }
  // 面板已经盖住战场时，还在飘的伤害数字和粒子会透过遮罩变成几块脏影子
  // （反馈页上那个孤零零的 "6"）。按 4 倍速散掉，比直接 clearFx 柔和 ——
  // 突然清空看起来像掉帧。判定演出那一小段不加速：光刃本来就该看得见。
  FX.update(dt * (panelShown() ? 4 : 1));

  // 自动推进只在"结果已经展开、指针不在面板上、玩家没按过键"时走。
  // 面板几何由刚才那一帧的绘制给出，所以暂停判据和玩家看到的是同一块区域。
  if (G.panel.k === 'feedback' && !quizSettling && quizReveal > 0.3) {
    const box = quizFrame().geom;
    const nowMs = performance.now();
    const stepMs = Math.max(0, nowMs - autoLast);
    autoLast = nowMs;
    const paused = autoCancelled || hover(box.x, box.y, box.w, box.h);
    autoPaused = paused;
    if (!paused) autoRemain = Math.max(0, autoRemain - stepMs);
    autoIn = autoRemain / 1000;
    if (!paused && autoRemain <= 0) dismissFeedback();
  } else if (G.panel.k === 'feedback') {
    // 打击演出 / 结果刚展开这几帧不计时，否则慢机器上玩家还没看清就走了。
    autoLast = performance.now();
    autoPaused = true;
  }

  endInput();
  requestAnimationFrame(frame);
}

function boot() {
  // 卡面在 cards/catalog.ts 里，启动时只把内置题库灌进 BANK
  loadQuestionBank(BUILTIN_MD);
  devJump();
  loadArt().then(() => {
    const el = document.querySelector('#boot');
    if (el) {
      el.classList.add('gone');
      setTimeout(() => el.remove(), 500);
    }
    requestAnimationFrame((n) => { last = n; frame(n); });
  });
}

// 供控制台调试与冒烟测试：window.cog
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
      fx: () => { hand: number; discard: number; enemy: number };
      /** 调试/自动化用：这张卡此刻的实际费用（X 费牌 = 当前行动力） */
      costOf: (id: string) => number;
      /** 冒烟测试用：单独演一次敌人动作，不改任何数值。taken=0 演"被全挡下" */
      enemyAct: (k?: FX.EnemyActKind, taken?: number) => void;
      /** 演示/截图用：真的走一次敌人回合，血量 / 弃牌堆 / 意图都会跟着变 */
      endTurn: () => void;
      /** 输入是不是正被演出锁住：冒烟测试靠它等敌人这一下演完 */
      locked: () => boolean;
      /** 答题面板：阶段 / 几何 / 自动推进倒计时。用来验"没有闪断、没有换框" */
      quiz: () => {
        phase: string; settling: boolean; reveal: number;
        geom: { x: number; y: number; w: number; h: number };
        autoIn: number; autoPaused: boolean;
      };
      /** 截图 / 回归用：把判定演出拉长，好把"面板没消失"这一帧拍下来 */
      holdQuiz: (sec: number) => void;
      /** 截图/回归用：停掉软自动推进，否则 4.2s 后判定面板会自己收掉 */
      pauseAuto: (on?: boolean) => void;
      /** 联动的战场记账 + 四张联动卡此刻的攻击底数，给回归测试验因果 */
      links: () => {
        drawn: number; block: number; plays: Record<string, number>;
        next: { mul: number; add: number; from: string } | null;
        live: Record<string, number>;
      };
    };
  }
}
window.cog = {
  state: G,
  hots: hotRects,
  probe: hitAt,
  handReady: handSettled,
  mapCam,
  lastClick: lastClickInfo,
  toScreen,
  strike: (kind = 'strike', target: 'enemy' | 'hero' = 'enemy') => {
    FX.attack({
      from: target === 'enemy' ? heroHand() : { x: ENEMY.x, y: ENEMY.y },
      follow: target === 'enemy' ? heroHand : undefined,
      to: target === 'enemy' ? { x: ENEMY.x, y: ENEMY.y } : { x: HERO.x, y: HERO.y - 10 },
      color: target === 'enemy' ? EFFS[kind].color : C.red,
      kind, dmg: 9, target,
    });
    panelHold = Math.max(panelHold, 0.6);
  },
  // BANK 是 let 绑定，换题库后要拿到新的那份，所以必须走 getter
  get pack() { return PACK; },
  get bank() { return BANK; },
  pick: (i: number) => answer(i),
  // 掉落面板只有一个出口。冒烟测试要能"关掉它"，不然一局推不下去。
  ackPower: () => ackPower(),
  // X 费牌的费用是活的，读的是"此刻"——冒烟测试断言扣了几点时用它，别去猜卡表
  costOf: (id: string) => costNow(defOf(id)),
  fx: () => ({ ...fxCount(), enemy: FX.enemyActCount() }),
  enemyAct: (k: FX.EnemyActKind = 'atk', taken = 9) => {
    // 每种动作给一个像真的数值：杂念一次塞两张，不是十二张
    const n = k === 'jam' ? 2 : k === 'def' ? 12 : k === 'buff' ? 2 : 12;
    const dur = FX.enemyAct({
      k, n, times: k === 'atk' ? 2 : 1, taken, absorbed: taken === 0 ? 12 : 0,
      from: { x: ENEMY.x, y: ENEMY.y },
      to: { x: HERO.x, y: HERO.y },
      discard: DISCARD_TO,
    });
    enemyHold = Math.max(enemyHold, dur);
  },
  endTurn: () => endTurn(),
  locked: () => enemyHold > 0 || panelHold > 0,
  quiz: () => ({
    phase: G.panel.k === 'feedback' ? (quizSettling ? 'settle' : 'result')
      : G.panel.k === 'question' ? 'ask' : 'idle',
    settling: quizSettling,
    reveal: quizReveal,
    geom: { ...quizFrame().geom },
    autoIn, autoPaused,
  }),
  holdQuiz: (sec: number) => { quizHoldBoost = Math.max(0, sec); },
  pauseAuto: (on = true) => { autoHold = on; autoCancelled = on; },
  links: () => ({
    drawn: G.drawnThisTurn,
    block: G.block,
    plays: { ...G.cardPlays },
    next: G.nextBoost ? { ...G.nextBoost } : null,
    live: Object.fromEntries(['c83', 'c84', 'c85', 'c86'].map((k) => [k, liveStatOf(k).atk])),
  }),
  // 截图用：把当前这一局写成断点，然后刷新回首页就能拍"继续这一局"那屏。
  // 只有"在地图上、且没有面板"时才写得进去（和真实存档同一个门槛）。
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

/**
 * 开发用：?dev=battle 直接落在某个画面，省得每次都点进去。
 * 这只是入口，规则仍然是同一套 core。
 */
function devJump() {
  const d = new URLSearchParams(location.search).get('dev');
  if (!d || d === 'title') return;
  // 开局能力卡面板本身（首页点"开始新的一局"会到这里）
  if (d === 'boon') { G.panel = { k: 'boon' }; return; }
  // 素材图集：不需要开局，是一张独立的质量检验页
  if (d === 'atlas') { G.screen = 'atlas'; return; }
  // 地图/战斗的截图要能指定幕：?dev=map&stage=4
  const qs = Number(new URLSearchParams(location.search).get('stage') || 0);
  const stageArg = Number.isInteger(qs) && qs >= 1 && qs <= STAGES.length ? qs : 0;
  const gotoStage = (n: number) => {
    if (!n) return;
    G.stage = n;
    // 截图/调试也要切当前章的题库，否则幕名和"本章"会对不上。
    enterStage(n);
    G.map = genStage(n);
    G.pos = null;
    G.seen = {};
  };
  if (d === 'map') { startRun(); gotoStage(stageArg); return; }
  if (d === 'rest') { startRun(); G.panel = { k: 'rest' }; return; }
  if (d === 'event') { startRun(); G.panel = { k: 'event', ev: EVENTS[0] }; return; }
  if (d === 'deck') { startRun(); G.panel = { k: 'deck' }; return; }
  // 精炼选牌面板：每份副本各一格，卡面写的是"选完之后的数值"。
  // 专门留一个入口，是因为这张面板的版式最容易在改动里悄悄退回去
  //（去重、格子数、预览数值），而它正好是玩家报过"看不到效果"的那一屏。
  if (d === 'refine') { startRun(); openCardPick('up'); return; }
  if (d === 'pack') { startRun(); G.panel = { k: 'pack', msg: '', ok: true }; return; }
  if (d === 'help') { startRun(); G.panel = { k: 'help' }; return; }
  // 敌人动作截图：把招式表固定成单招循环，头顶意图和演出才是同一件事；
  // 而且真的走一次 endTurn，血量 / 格挡 / 弃牌堆都会跟着变，不是只盖一层特效。
  // 参数既可以是单招名（atk/jam/def/buff），也可以是 FOES 里的怪物 key，
  // 后者直接把敌人整个换成那只怪 —— 新怪的立绘 / hint / 意图才能被逐个拍到。
  if (d.startsWith('foe:')) {
    const arg = d.slice(4);
    const MOVES: Record<string, Move> = {
      atk: { k: 'atk', m: 1 },
      jam: { k: 'jam', n: 2 },
      def: { k: 'def', v: 12 },
      buff: { k: 'buff', v: 2 },
    };
    startRun();
    enterNode(G.map[0][0].key);
    if (G.enemy) {
      const tpl = FOES.find((f) => f.key === arg);
      if (tpl) {
        Object.assign(G.enemy, {
          key: tpl.key, name: tpl.name, art: tpl.art, hue: tpl.hue,
          tag: tpl.tag, mech: tpl.mech, mechV: tpl.mechV,
          moves: tpl.moves, mv: 0,
        });
      } else {
        G.enemy.moves = [MOVES[arg] ?? MOVES.atk];
        G.enemy.mv = 0;
        // 穿透 / 复习官这些机制会给攻击加减成，截图要可复现就先摘掉
        G.enemy.mech = undefined;
      }
    }
    return;
  }
  // 精英掉落的收据：一张徽记 + "知道了"。没有选择，所以这里只有一个 id。
  // 面板出现时掉落**已经生效**（G.powers 里有它），这一屏只负责把它念出来。
  if (d === 'powerdrop') {
    startRun();
    G.powers.push('hourglass', 'lamp');
    G.panel = { k: 'powerdrop', id: 'lamp' };
    return;
  }
  if (d === 'power') {
    startRun();
    // 顶上那一排增益是**这一局已经拿到的**，截图要能看出排布，所以先塞两个
    G.powers.push('hourglass', 'lamp');
    enterNode(G.map[0][0].key);
    return;
  }

  startRun();
  enterNode(G.map[0][0].key);
  // 体验/截图入口：四张联动卡一次摊在手里，配一张基础格挡喂「铸甲为刃」。
  // 走的是真实战斗与真实出牌路径，只是替玩家把抽牌运气拿掉。
  if (d === 'links') {
    // c04「扩容远见」是 0 费免答的抽牌卡，用它真实抽一张来验证抽牌数联动。
    G.hand = ['c83', 'c84', 'c85', 'c86', 'c86', 'c04'];
    G.ap = G.apMax = 9;
    G.enemy!.maxHp = G.enemy!.hp = 999;
    G.enemy!.block = 0;
    G.busy = false;
    return;
  }
  // 点开一张**能出题的知识卡**，而不是写死下标 0：手牌是洗过的，
  // 0 号位有时是基础牌，截图就会随机拍成"没有面板的战斗画面"。
  let askIdx = G.hand.findIndex((e) => canAsk(e));
  if (askIdx < 0 && (d === 'question' || d === 'answer' || d === 'wrong')) {
    // findIndex 只找**手牌里**的牌，可起手 5 张完全可能一张需答题的知识卡
    // 都没有（约两成）。那时 ?dev=answer 会安静地拍成一张空战斗画面 ——
    // 文档图就随机裂了。补一张 1 费知识卡到 0 号位，手牌数不变，
    // 后面依旧走真人那条 askCard → answer 流程，没有任何特殊结算。
    const seed = PACK.cards.find((c) => canAsk(c.id) && typeof c.cost === 'number' && c.cost >= 1);
    if (seed) { G.hand[0] = seed.id; askIdx = 0; }
  }
  // 和真人点下去看到的东西一致：一道题，四个选项，没有前置选择
  if (d === 'question') { if (askIdx >= 0) askCard(askIdx); }
  else if (d === 'answer') {
    if (askIdx >= 0) askCard(askIdx);
    // 截图脚本也必须走本次打乱后的视图，否则「正确」那一屏会拍成答错
    const v = G.panel.k === 'question' ? G.panel.view : null;
    if (v) answer(v.answer);
  } else if (d === 'wrong') {
    if (askIdx >= 0) askCard(askIdx);
    const v = G.panel.k === 'question' ? G.panel.view : null;
    if (v) answer(v.answer === 0 ? 1 : 0);
  } else if (d === 'xcard') {
    // X 费牌：牌面上只有一个 X，得看答题面板怎么把它换算成"现在等于几"。
    // 换一张真的 X 费知识卡进手牌，而不是靠抽牌运气。
    const xid = PACK.cards.find((c) => c.cost === 'x')!.id;
    G.hand[0] = xid;
    G.ap = G.apMax;
    askCard(0);
  } else if (d === 'reward') {
    // ?dev=reward&sticky=1：带着「便签」走真实的 openReward()，四选一那一屏
    // 才能稳定复现（卡片最多、最容易贴到面板边框的就是这一屏）。
    if (new URLSearchParams(location.search).get('sticky') === '1') G.powers.push('sticky');
    if (G.enemy) G.enemy.hp = 0;
    G.pending = 'clear';
    dismissFeedback();
  } else if (d === 'report') {
    // 只是为了让文档截图里不是一排 0 —— 正常游戏里这些数字全部来自真实答题。
    // 章节掌握读的是 STAGE_MEM，所以这里造的是章节档案，不是卡牌记忆。
    const demo: Array<[number, number]> = [[9, 2], [7, 4], [12, 6], [4, 5], [0, 0]];
    CURRICULUM.forEach((p, i) => {
      const e = stageMemOf(p.topic);
      e.ok = demo[i][0];
      e.bad = demo[i][1];
      e.q = {};
      for (let j = 0; j < e.bad; j++) e.q[`q_demo_${p.stage}_${j}`] = { ok: 0, bad: 1 };
    });
    G.answerDraws = 14;
    G.runOk = 12;
    G.runBad = 6;
    G.floors = 5;
    G.stage = 3;
    enterStage(3);
    // 本章答题也来自流水，不是卡牌记忆；造 18 条，12 对 6 错。
    G.answers = Array.from({ length: 18 }, (_, i) => ({
      qid: `q_demo_3_${i}`, topic: G.stageTopic, stageTopic: G.stageTopic, stage: G.stage,
      right: i < 12, choice: 0, answer: 0, stem: `演示题 ${i + 1}`,
    }));
    G.deck.push('pow:lamp');
    endRun(true);
  }
}

resetBattleView();
boot();
