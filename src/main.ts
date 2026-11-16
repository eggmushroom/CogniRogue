import './style.css';
import { BUILTIN_MD } from './core/builtin';
import { EFFS, POWER_BY_ID } from './core/model';
import { beginFrame, g, initCanvas, toLogic } from './gfx/canvas';
import { loadArt } from './gfx/assets';
import * as FX from './gfx/fx';
import { bindInput, beginInput, clearWheel, endInput, hover, keyHandler, setInputLock } from './input';
import { C } from './gfx/theme';
import { G, onFx } from './core/infra';
import { after } from './core/infra/schedule';
import { loadQuestionBank } from './core/library';
import { answer, cancelPanel, endTurn } from './core/combat';
import { ackPower, dismissFeedback } from './core/journey';
import {
  DISCARD_TO, ENEMY, ENEMY_GROUND, HERO, heroHand,
  resetBattleView, syncBattle,
} from './scenes/battle';
import { drawOverlay, quizFrame } from './scenes/overlay';
import { drawSceneBackdrop, drawSceneWorld, worldLayer } from './scenes/layers';

const canvas = document.querySelector<HTMLCanvasElement>('#game');
if (!canvas) throw new Error('#game 不存在');

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
let lastPanelKind = '';
let wasSettling = false;
/** 调试用：下一块判定面板要停在"答案已出、结果未展开"多久。 */
let quizHoldBoost = 0;

/** 结算面板的软自动推进：指针停在面板上时暂停，用墙钟而不是 dt 计时。 */
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
 * 上一帧面板是否开着。面板开着时滚轮归面板，关掉那一帧要把剩余增量清掉，
 * 否则它会落到刚从面板底下露出来的地图上。
 */
let panelWasOpen = false;

/** 敌人动作演出剩余时间，用来锁输入：core 的 endTurn 是同步的。 */
let enemyHold = 0;

/** 组合根交给世界层的两个入口；场景自己不认识浮层状态。 */
const SCENE_HOOKS = {
  openHelp: () => { G.panel = { k: 'help' }; },
  openPack: () => { G.panel = { k: 'pack', msg: '', ok: true }; },
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
        ground: ENEMY_GROUND,
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

keyHandler((k) => {
  // 玩家一旦用键盘接管，就把自动推进交还给他
  autoCancelled = true;
  const p = G.panel;
  if (panelHold > 0 || enemyHold > 0) return;
  if (k === 'escape') {
    if (G.screen === 'atlas') { G.screen = 'title'; return; }
    // cardpick 也要能按 Esc 退出：取消后回到事件 / 复习面板，账一起清掉。
    if (p.k === 'question' || p.k === 'deck' || p.k === 'pile' || p.k === 'cardpick'
        || p.k === 'help' || p.k === 'pack' || p.k === 'boon') cancelPanel();
    return;
  }
  if (k === 'confirm') {
    if (p.k === 'feedback') dismissFeedback();
    // 掉落面板只有一个出口，回车就是"知道了"
    else if (p.k === 'powerdrop') ackPower();
    // 没有面板时，空格/回车结束回合：键盘能做的事不该只有鼠标能做。
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

  // 面板刚关掉：把面板期间攒下的滚轮增量丢掉
  if (panelWasOpen && !modalOpen()) clearWheel();
  panelWasOpen = modalOpen();

  // 面板推迟只对反馈面板生效
  if (G.panel.k === 'feedback' && panelHold > 0) panelHold = Math.max(0, panelHold - dt);
  else if (G.panel.k !== 'feedback') panelHold = 0;
  if (enemyHold > 0) enemyHold = Math.max(0, enemyHold - dt);

  // 答对没有可看的判定面板：这一手的效果早就结算了，留着它只是给打击演出锁输入。
  // 演出（panelHold）一结束就收掉，玩家不用再点一次「继续」——
  // 打死敌人的那一手也因此能看见最后一击，而不是被奖励面板当场盖住。
  if (G.panel.k === 'feedback' && G.panel.fb.right && panelHold <= 0) dismissFeedback();

  // 面板换屏时重置答题面板的时钟；同一块面板只推进 reveal
  if (G.panel.k !== lastPanelKind) {
    if (G.panel.k === 'feedback') {
      quizReveal = 0;
      resetAuto();
      if (quizHoldBoost > 0) { panelHold = Math.max(panelHold, quizHoldBoost); quizHoldBoost = 0; }
    }
    lastPanelKind = G.panel.k;
  }
  quizSettling = G.panel.k === 'feedback' && panelHold > 0;
  // 倒计时从结果真的展开那一刻起算
  if (wasSettling && !quizSettling && G.panel.k === 'feedback') {
    autoRemain = AUTO_MS;
    autoLast = performance.now();
    autoCancelled = false;
    autoPaused = false;
    autoIn = AUTO_MS / 1000;
  }
  wasSettling = quizSettling;
  if (G.panel.k === 'feedback' && !quizSettling) quizReveal += dt;
  // 放在 boost 之后：调试拉长判定时那一帧也必须锁输入
  setInputLock(panelHold > 0 || enemyHold > 0);

  const sh = FX.shakeOffset();
  const layer = worldLayer(G.panel.k);
  g.save();
  g.translate(sh.x, sh.y);

  // 背景层永远画；世界层按浮层声明的可见性决定画不画。答题 / 判定要留着
  // 战场和光刃，其余浮层只留书架 —— 于是遮罩不必再靠高 alpha 去挡底层文字。
  drawSceneBackdrop(G.screen, t);
  if (layer === 'full') {
    if (G.screen !== 'atlas' && G.screen !== 'title' && G.screen !== 'map') syncBattle();
    drawSceneWorld(G.screen, t, dt, SCENE_HOOKS);
    // 特效和战场在同一层：光刃端点用 HERO/ENEMY 坐标，场景震动时它得跟着走。
    FX.draw();
  }
  g.restore();

  FX.drawFlash();
  // 面板最后画，别跟着震动位移走：按钮会抖，和逻辑坐标的热区错开。
  if (G.panel.k !== 'none') {
    drawOverlay(t, {
      settling: quizSettling, reveal: quizReveal,
      autoProgress: 1 - autoIn / (AUTO_MS / 1000), autoPaused, autoCancelled,
    });
  }
  // 只留背景时不画残留特效，但按 4 倍速散掉：关掉面板时画面已经是干净的。
  FX.update(dt * (layer === 'backdrop' || panelShown() ? 4 : 1));

  // 自动推进只在结果展开、指针不在面板上、玩家没按过键时走
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
    // 演出 / 展开这几帧不计时
    autoLast = performance.now();
    autoPaused = true;
  }

  endInput();
  requestAnimationFrame(frame);
}

async function boot() {
  // 卡面在 cards/catalog.ts 里，启动时只把内置题库灌进 BANK
  loadQuestionBank(BUILTIN_MD);
  if (import.meta.env.DEV) {
    // 开发 / 截图入口：生产构建不会执行这个分支。
    const { devJump } = await import('./dev/jump');
    devJump();
    const { installCog } = await import('./dev/cog');
    installCog({
      holdPanel: (s) => { panelHold = Math.max(panelHold, s); },
      holdEnemy: (s) => { enemyHold = Math.max(enemyHold, s); },
      setQuizHold: (s) => { quizHoldBoost = Math.max(0, s); },
      setAutoHold: (on) => { autoHold = on; autoCancelled = on; },
      quizClock: () => ({ settling: quizSettling, reveal: quizReveal, autoIn, autoPaused }),
      locked: () => enemyHold > 0 || panelHold > 0,
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
