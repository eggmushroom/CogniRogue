import './style.css';
import { SHIPPED_PACK } from './core/builtin';
import { EFFS, POWER_BY_ID } from './core/model';
import { beginFrame, g, initCanvas, toLogic } from './gfx/canvas';
import { loadArt } from './gfx/assets';
import * as FX from './gfx/fx';
import { beginTransition, drawTransition, reduceMotion } from './gfx/motion';
import { bindInput, beginInput, clearWheel, consumeDragY, endInput, inputScope, keyHandler, setInputLock, setWheelShield } from './input';
import { C } from './gfx/theme';
import { G, onFx } from './core/infra';
import type { Foe, Panel } from './core/model';
import { after } from './core/infra/schedule';
import { finishAnswerUpload, initBank, refreshDocuments, refreshRemoteBanks, sendAnswers, setServiceBase, takeAnswerUpload } from './core/library';
import { answer, endTurn, setSettleHandler } from './core/combat';
import { ackCardGet, ackPower, dismissFeedback, settlePending } from './core/journey';
import {
  DISCARD_TO, ENEMY, HERO, enemyHand, heroHand,
  animateFeedbackClose, animateQuestion, closeFeedback, feedbackLeaving,
  questionCard, questionReturning, resetBattleView, syncBattle,
} from './scenes/battle';
import { drawOverlay } from './scenes/overlay';
import { drawSceneBackdrop, drawSceneScrim, drawSceneWorld, worldLayer } from './scenes/layers';
import { settingsKey } from './scenes/settings';
import { leavePanel } from './scenes/navigation';
import { closeTaskbar, drawTaskbar, taskbarExit, taskbarOpen } from './scenes/taskbar';
import { tickJobs } from './scenes/jobstate';
import { answerbarExit, answerbarOpen, closeAnswerbar, drawAnswerbar } from './scenes/answerbar';

const canvas = document.querySelector<HTMLCanvasElement>('#game');
if (!canvas) throw new Error('#game 不存在');

const standalone = location.protocol === 'file:';

initCanvas(canvas);
bindInput(canvas, toLogic);

// 逻辑层只发事件，表现层在这里翻译成"看得见的后果"
const modalOpen = () => G.panel.k !== 'none';
/**
 * 面板真的画出来了（而不是"状态里有个面板"）才算挡住：打击演出期间面板是推迟绘制的，
 * 这时候玩家侧的格挡/回血数字应该照常弹出来。
 * 答对的判定面板根本不绘制（只当输入锁），所以它也不算挡住。
 */
const panelShown = () =>
  modalOpen() && panelHold <= 0 && !(G.panel.k === 'feedback' && G.panel.fb.right);

/** 反馈面板的推迟时间：先让这一下打完，再弹面板。 */
let panelHold = 0;

/**
 * 答题、判定、结算共用同一块面板。
 * `settling` 是"判定已出、打击还在飞"的那一小段，此时面板原地不走，只推进 `reveal`。
 */
let quizSettling = false;
let quizReveal = 0;
let lastPanel: Panel | undefined;
let panelOpenedAt = 0;
/** 调试用：下一块判定面板要停在"答案已出、结果未展开"多久。 */
let quizHoldBoost = 0;

/**
 * 上一帧面板是否开着。面板开着时滚轮归面板，关掉那一帧要把剩余增量清掉，
 * 否则它会落到刚从面板底下露出来的地图上。
 */
let panelWasOpen = false;

/** 敌人动作演出剩余时间，用来锁输入：core 的 endTurn 是同步的。 */
let enemyHold = 0;

const DEFEAT_OUT = 0.28;
let victory: { foe: Foe; elapsed: number } | null = null;
const battleWon = () => G.screen === 'battle' && (G.pending === 'clear' || G.pending === 'win');
const victoryLocked = () => victory !== null || (G.busy && battleWon() && !modalOpen());
const victoryProgress = () => victory ? victory.elapsed / DEFEAT_OUT : null;

// 无头运行仍直接结算；浏览器等最后一击和退场，答错时先保留原有的判定面板。
setSettleHandler(() => {
  if (!battleWon() || !G.enemy) { settlePending(); return; }
  if (G.panel.k === 'feedback' || victory?.foe === G.enemy) return;
  G.panel = { k: 'none' };
  victory = { foe: G.enemy, elapsed: 0 };
  setInputLock(true);
});

function advanceVictory(dt: number) {
  if (!victory) return;
  if (!battleWon() || G.enemy !== victory.foe) { victory = null; return; }
  if (G.busy || FX.playerStrikeActive()) return;
  if (reduceMotion() || victory.elapsed >= DEFEAT_OUT) {
    victory = null;
    settlePending();
  } else {
    victory.elapsed = Math.min(DEFEAT_OUT, victory.elapsed + dt);
  }
}

/** 组合根交给世界层的两个入口；场景自己不认识浮层状态。 */
const SCENE_HOOKS = {
  openPack: () => {
    G.panel = { k: 'pack', msg: '', ok: true };
    if (!standalone) void refreshDocuments();
  },
  openSettings: () => { G.panel = { k: 'settings', msg: '', ok: true }; },
};

onFx((e) => {
  const enemy = G.enemy;
  switch (e.t) {
    case 'dmg': {
      if (!enemy) break;
      const kind = e.eff ?? 'strike';
      const fly = kind === 'pierce' ? 0.15 : 0.2;
      FX.attack({
        from: heroHand(),
        // 轨迹跟着刀锋离手，蓄力时不会留在旧位置。
        follow: heroHand,
        to: {
          x: ENEMY.x - (e.absorbed > 0 && e.n === 0 ? 92 : 0) + (Math.random() - 0.5) * 40,
          y: ENEMY.y + (Math.random() - 0.5) * 90,
        },
        color: EFFS[kind].color,
        kind,
        seq: e.seq ?? 0,
        dmg: e.n,
        absorbed: e.absorbed,
      });
      // 判定面板不等打击演完：答案当帧亮起，光刃在它周围飞。
      panelHold = Math.max(panelHold, fly + 0.18 + (e.seq ?? 0) * 0.1);
      break;
    }
    case 'fizzle': {
      // 答错不朝敌人飞任何东西，反馈落在出手的地方。
      FX.fizzle({ at: heroHand, color: EFFS[e.eff ?? 'strike'].color });
      panelHold = Math.max(panelHold, 0.2);
      break;
    }
    case 'hurt':
      // 事件扣血：这时候没有敌人，只做自身受伤的反馈。
      FX.flash(C.red, 0.12);
      FX.shake(8);
      FX.floatText(HERO.x, HERO.y - 40, `-${e.n}`, C.red, 52, { vy: -80 });
      break;
    case 'enemyHit': {
      // 一段一事件：扣血与光刃在 core 的同一个调度点发生，这里只负责画这一段。
      const dur = FX.enemyStrike({
        n: e.n, absorbed: e.absorbed, seq: e.seq, times: e.times, totalAbsorbed: e.totalAbsorbed,
        from: { x: ENEMY.x, y: ENEMY.y },
        to: { x: HERO.x, y: HERO.y },
        follow: enemyHand,
      });
      enemyHold = Math.max(enemyHold, dur);
      break;
    }
    case 'enemyAct': {
      const dur = FX.enemyAct({
        k: e.k, n: e.n,
        from: { x: ENEMY.x, y: ENEMY.y },
        to: { x: HERO.x, y: HERO.y },
        discard: DISCARD_TO,
      });
      enemyHold = Math.max(enemyHold, dur);
      break;
    }
    case 'blk':
      FX.heroBlock({ x: HERO.x + 90, y: HERO.y - 30 }, e.n, !panelShown());
      break;
    case 'heal':
      if (!panelShown()) FX.heal(HERO.x, HERO.y - 40, e.n);
      break;
    case 'foeHeal':
      // 敌人回血落在它自己身上，不压在血条文字上。
      if (!panelShown()) FX.heal(ENEMY.x, ENEMY.y + 180, e.n);
      break;
    case 'power': {
      // 捡到增益：画面上方飘一行字，否则玩家只能靠数值倒推。
      const pw = POWER_BY_ID[e.id];
      // 落在画面中央上方：敌人头顶是意图气泡。
      if (pw) FX.floatText(760, 150, `${pw.name} 生效`, pw.color, 30, { vy: -42 });
      break;
    }
    case 'note':
      // 一句已经算完的结算话术（事件选项的结果、选完牌才收的代价）。
      // 这时人在事件面板或地图上，没有敌人也没有血条动画能解释刚才发生了什么。
      FX.floatText(760, 210, e.text, C.ink, 26, { vy: -26 });
      break;
    default:
      break;
  }
});

const homeToolsVisible = () => G.screen === 'title' && !modalOpen();
const sidePanelOpen = () => homeToolsVisible() && (taskbarOpen() || answerbarOpen());
let navigationReady = true;

keyHandler((k) => {
  if (questionReturning() || feedbackLeaving()) return;
  if (k !== 'escape' && (!navigationReady || (G.panel !== lastPanel && questionCard()))) return;
  if (sidePanelOpen()) {
    if (k === 'escape') (answerbarExit() ?? taskbarExit())?.run();
    return;
  }
  const p = G.panel;
  if (panelHold > 0 || enemyHold > 0 || victoryLocked()) return;
  if (k === 'escape') { leavePanel(); return; }
  if (k === 'confirm') {
    if (p.k === 'feedback') closeFeedback();
    // 掉落面板只有一个出口，回车就是"知道了"
    else if (p.k === 'powerdrop') ackPower();
    else if (p.k === 'cardget') ackCardGet();
    // 没有面板时，空格/回车结束回合：键盘能做的事不该只有鼠标能做。
    else if (p.k === 'none' && G.screen === 'battle') endTurn();
    return;
  }
  if (p.k === 'question') {
    const i = Number(k) - 1;
    const card = G.hand[p.idx];
    if (card) answer(i);
  }
  // 输入框拿着焦点时，按键先过它 —— 见 scenes/settings.ts 的 settingsKey
}, (key) => navigationReady && settingsKey(key), sidePanelOpen);

let t = 0;
let last = performance.now();
let nextAnswerSync = 0;

function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  t += dt;

  beginInput();
  if (!standalone) tickJobs(now);
  const showHomeTools = homeToolsVisible();
  if (!showHomeTools && taskbarOpen()) closeTaskbar(true);
  if (!showHomeTools && answerbarOpen()) closeAnswerbar(true);
  if (!standalone && now >= nextAnswerSync) {
    nextAnswerSync = now + 2000;
    const upload = takeAnswerUpload();
    if (upload) void sendAnswers(upload).then((ok) => finishAnswerUpload(upload, ok));
  }

  // 面板刚关掉：把面板期间攒下的滚轮增量丢掉
  if (panelWasOpen && !modalOpen()) clearWheel();
  panelWasOpen = modalOpen();

  // 面板推迟只对反馈面板生效
  if (G.panel.k === 'feedback' && panelHold > 0) panelHold = Math.max(0, panelHold - dt);
  else if (G.panel.k !== 'feedback') panelHold = 0;
  if (enemyHold > 0) enemyHold = Math.max(0, enemyHold - dt);

  // 答对没有可看的判定面板：这一手的效果早就结算了，留着它只是给打击演出锁输入。
  // 演出（panelHold）一结束就收掉，玩家不用再点一次「继续」。
  if (G.panel.k === 'feedback' && G.panel.fb.right && panelHold <= 0) dismissFeedback();
  advanceVictory(dt);
  const quizExit = animateFeedbackClose(dt);
  const quizEntry = animateQuestion(G.panel === lastPanel ? t - panelOpenedAt : 0, dt);

  // 面板换屏时重置答题面板的时钟；同一块面板只推进 reveal
  if (G.panel !== lastPanel) {
    panelOpenedAt = t;
    if (G.panel.k === 'feedback') {
      quizReveal = 0;
      if (quizHoldBoost > 0) { panelHold = Math.max(panelHold, quizHoldBoost); quizHoldBoost = 0; }
    }
    lastPanel = G.panel;
  }
  quizSettling = G.panel.k === 'feedback' && panelHold > 0;
  if (G.panel.k === 'feedback' && !quizSettling) quizReveal += dt;
  const panel = G.panel;
  const age = t - panelOpenedAt;
  const sheet = panel.k === 'none' ? ''
    : panel.k === 'settings' ? `settings:${!!panel.form}:${!!panel.form?.connection}`
    : panel.k === 'pack' ? `pack:${panel.deletion ? 'delete' : panel.page?.topic ? 'questions' : panel.page ? 'topics' : 'list'}`
    : panel.k === 'cardpick' ? `cardpick:${panel.mode}:${panel.pick !== undefined}`
    : panel.k;
  // 答题与判定沿用原有演出；导航不能截住光刃或敌人的动作。
  const combatHold = panelHold > 0 || enemyHold > 0;
  const exitLocked = victoryLocked();
  navigationReady = beginTransition(G.screen, sheet, now,
    !sidePanelOpen() && panel.k !== 'question' && panel.k !== 'feedback' && !combatHold)
    && (quizEntry?.ready ?? true) && !quizExit;
  setInputLock(combatHold || exitLocked || !navigationReady);
  setWheelShield(sidePanelOpen() || exitLocked || !navigationReady);
  if (exitLocked || !navigationReady) { clearWheel(); consumeDragY(); }
  beginFrame();

  const sh = FX.shakeOffset();
  const layer = worldLayer(G.panel.k);
  g.save();
  g.translate(sh.x, sh.y);

  // 背景层永远画；世界层按浮层声明的可见性决定画不画。答题 / 判定要留着
  // 战场和光刃，其余浮层只留书架 —— 于是遮罩不必再靠高 alpha 去挡底层文字。
  drawSceneBackdrop(G.screen, t);
  if (layer === 'full') {
    if (G.screen !== 'atlas' && G.screen !== 'title' && G.screen !== 'map') syncBattle();
    inputScope(0, 0, navigationReady && !exitLocked,
      () => drawSceneWorld(G.screen, t, dt, SCENE_HOOKS, victoryProgress() ?? 0));
    // 特效和战场在同一层：光刃端点用 HERO/ENEMY 坐标，场景震动时它得跟着走。
    FX.draw();
  }
  g.restore();

  FX.drawFlash();
  if (layer === 'backdrop') drawSceneScrim();
  drawTransition(() => inputScope(0, 0, navigationReady, () => {
    // 浮层不跟屏幕震动；只跟随导航位移，同时移动对应热区。
    if (modalOpen()) {
      drawOverlay(t, {
        settling: quizSettling, reveal: quizReveal, entry: quizEntry, exit: quizExit,
      }, age);
    }
    if (showHomeTools) {
      if (!standalone) drawTaskbar(dt, t, () => closeAnswerbar(true));
      drawAnswerbar(dt, () => closeTaskbar(true));
    }
  }));
  // 只留背景时不画残留特效，但按 4 倍速散掉：关掉面板时画面已经是干净的。
  FX.update(dt * (layer === 'backdrop' ? 4 : 1));


  endInput();
  requestAnimationFrame(frame);
}

async function boot() {
  // 页面由开发 / 发布服务提供时同源调 /api；双击文件时不访问本机服务。
  setServiceBase(standalone ? 'file://' : '');

  // 卡面在 cards/catalog.ts 里，启动时只把英语内置题库灌进 BANK。
  initBank(SHIPPED_PACK.id, SHIPPED_PACK.md);
  if (!standalone) void refreshRemoteBanks();
  if (import.meta.env.DEV) {
    // 开发 / 截图入口：生产构建不会执行这个分支。
    const { devJump } = await import('./dev/jump');
    devJump();
    const { installCog } = await import('./dev/cog');
    installCog({
      holdPanel: (s) => { panelHold = Math.max(panelHold, s); },
      holdEnemy: (s) => { enemyHold = Math.max(enemyHold, s); },
      setQuizHold: (s) => { quizHoldBoost = Math.max(0, s); },
      quizClock: () => ({ settling: quizSettling, reveal: quizReveal }),
      locked: () => !navigationReady || enemyHold > 0 || panelHold > 0 || victoryLocked(),
      victoryProgress,
    });
  }
  loadArt().then(() => {
    const el = document.querySelector('#boot');
    if (el) {
      el.classList.add('gone');
      // 连 DOM 清理也走项目唯一的调度器：表现层不持有第二套时钟。
      after(500, () => el.remove());
    }
    requestAnimationFrame((n) => { last = n; frame(n); });
  });
}

resetBattleView();
boot();
