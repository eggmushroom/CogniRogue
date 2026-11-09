import './style.css';
import { BUILTIN_MD } from './core/builtin';
import { EFFS, POWER_BY_ID } from './core/model';
import { beginFrame, g, initCanvas, toLogic, toScreen, VH, VW } from './gfx/canvas';
import { loadArt } from './gfx/assets';
import * as FX from './gfx/fx';
import { bindInput, beginInput, endInput, hotRects, keyHandler, setInputLock } from './input';
import { C } from './gfx/theme';
import { text } from './gfx/ui';
import { G, onFx } from './core/infra';
import { BANK, loadQuestionBank, memOf } from './core/library';
import { PACK, powerCardOf } from './core/cards';
import { FOES } from './core/model';
import { answer, askCard, cancelPanel, canAsk, endTurn, playPower } from './core/combat';
import { EVENTS, dismissFeedback, endRun, enterNode, startRun } from './core/journey';
import type { Move } from './core/model';
import {
  drawBattle, DISCARD_TO, ENEMY, fxCount, HERO, heroHand, resetBattleView, syncBattle,
} from './scenes/battle';
import { drawMap } from './scenes/map';
import { drawOverlay } from './scenes/overlay';
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
      panelHold = Math.max(panelHold, fly + 0.46 + (e.seq ?? 0) * 0.15);
      break;
    }
    case 'fizzle': {
      // 答错 = 这一手根本没打出去。所以**不朝敌人飞任何东西**：
      // 光刃、光斑、抛物线一律不要 —— 只要画面上有东西冲向敌人，读到的就是"打了"。
      // 反馈落在出手的地方：提灯的焰暗一下，一小撮屑在原地散掉。
      FX.fizzle({ at: heroHand, color: EFFS[e.eff ?? 'strike'].color });
      // 面板还是等这一下演完再弹，否则遮罩一盖，玩家只看到"牌没了"。
      panelHold = Math.max(panelHold, 0.34);
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
    case 'shake':
      FX.shake(e.power);
      break;
    case 'power': {
      // 增益牌生效的那一下：顶上飘一行字。它没有伤害数字，所以必须另给一个反馈，
      // 否则玩家只能靠"下回合多了一点行动力"倒推刚才那张牌干了什么。
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
  const p = G.panel;
  if (panelHold > 0 || enemyHold > 0) return;
  if (k === 'escape') {
    if (G.screen === 'atlas') { G.screen = 'title'; return; }
    if (p.k === 'question' || p.k === 'deck' || p.k === 'pile' || p.k === 'help' || p.k === 'pack') cancelPanel();
    return;
  }
  if (k === 'confirm') {
    if (p.k === 'feedback') dismissFeedback();
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

  // 面板推迟：只在"刚打完这一下"的反馈面板上生效，别把奖励/休息这些面板一起按住
  if (G.panel.k === 'feedback' && panelHold > 0) panelHold = Math.max(0, panelHold - dt);
  else if (G.panel.k !== 'feedback') panelHold = 0;
  if (enemyHold > 0) enemyHold = Math.max(0, enemyHold - dt);
  setInputLock(panelHold > 0 || enemyHold > 0);

  const sh = FX.shakeOffset();
  g.save();
  g.translate(sh.x, sh.y);

  if (G.screen === 'atlas') {
    drawAtlas(t);
  } else if (G.screen === 'title') {
    drawTitle(t, () => { G.panel = { k: 'help' }; }, () => { G.panel = { k: 'pack', msg: '', ok: true }; });
  } else if (G.screen === 'map') {
    drawMap(t);
  } else {
    syncBattle();
    drawBattle(t, dt);
  }

  if (G.panel.k !== 'none' && panelHold <= 0) drawOverlay(t);

  g.restore();

  FX.drawFlash();
  FX.draw();
  FX.update(dt);

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
      hots: () => { x: number; y: number; w: number; h: number; label: string }[];
      toScreen: (x: number, y: number) => { x: number; y: number };
      /** 演示/截图用：单独放一次打击动画，不改变任何数值 */
      strike: (kind?: FX.StrikeKind, target?: 'enemy' | 'hero') => void;
      /** 调试用：内置卡牌库（恒定，导入题库不会变） */
      readonly pack: typeof PACK;
      /** 调试用：当前题库（可换）。题目挂在 Panel 快照上，测试一般不用读这里 */
      readonly bank: typeof BANK;
      /** 调试/自动化用：直接答题，绕过点击 */
      pick: (i: number) => void;
      /** 调试/自动化用：把所有卡种设为已解锁，用来测「免答出牌」那条点击路径 */
      unlockAll: () => void;
      /** 调试/截图用：直接打出手牌里第 i 张增益牌 */
      power: (i: number) => void;
      /**
       * 调试/自动化用：直接改一张卡的记忆（稳固度）。模式只决定答错时掉多少，
       * 冒烟测试没有时间去真的答对两次，所以开一个后门。
       */
      markMem: (id: string, ok: number, bad?: number) => void;
      /** 调试/自动化用：还在飞的单元数（抽牌 / 弃牌 / 敌人动作），用来盯"飞行单元漏清" */
      fx: () => { hand: number; discard: number; enemy: number };
      /** 冒烟测试用：单独演一次敌人动作，不改任何数值。taken=0 演"被全挡下" */
      enemyAct: (k?: FX.EnemyActKind, taken?: number) => void;
      /** 演示/截图用：真的走一次敌人回合，血量 / 弃牌堆 / 意图都会跟着变 */
      endTurn: () => void;
      /** 输入是不是正被演出锁住：冒烟测试靠它等敌人这一下演完 */
      locked: () => boolean;
    };
  }
}
window.cog = {
  state: G,
  hots: hotRects,
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
  unlockAll: () => { G.deck.forEach((e) => { G.unlocked[e.id] = true; }); },
  power: (i: number) => playPower(i),
  markMem: (id: string, ok: number, bad = 0) => {
    const m = memOf(id);
    m.ok = ok;
    m.bad = bad;
    // 顺手把稳定度抬起来，卡面上的记忆条才和"学过了"对得上
    m.stab = Math.max(m.stab, ok * 4);
  },
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
  // 调试/截图可以指定模式：?dev=battle&mode=test
  const qm = new URLSearchParams(location.search).get('mode');
  if (qm === 'learn' || qm === 'review' || qm === 'test') G.mode = qm;
  // 模式选择面板本身（首页点"开始新的一局"会到这里）
  if (d === 'mode') { G.panel = { k: 'mode' }; return; }
  // 素材图集：不需要开局，是一张独立的质量检验页
  if (d === 'atlas') { G.screen = 'atlas'; return; }
  if (d === 'map') { startRun(); return; }
  if (d === 'rest') { startRun(); G.panel = { k: 'rest' }; return; }
  if (d === 'event') { startRun(); G.panel = { k: 'event', ev: EVENTS[0] }; return; }
  if (d === 'deck') { startRun(); G.panel = { k: 'deck' }; return; }
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
          tag: tpl.tag, hint: tpl.hint, mech: tpl.mech,
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
  // 精英战后的三选一：三张增益牌并排，和选知识卡是同一个动作
  if (d === 'powerpick') {
    startRun();
    G.panel = {
      k: 'power',
      pool: (['hourglass', 'lamp', 'marker'] as const).map(powerCardOf),
    };
    return;
  }
  if (d === 'power') {
    startRun();
    G.deck.push({ id: 'pow:hourglass', up: 0 }, { id: 'pow:lamp', up: 0 });
    enterNode(G.map[0][0].key);
    // 正常是抽牌抽到的；截图要确定性，所以直接从牌堆挪两张进手
    ['pow:hourglass', 'pow:lamp'].forEach((id) => {
      const i = G.draw.findIndex((e) => e.id === id);
      if (i >= 0) G.hand.push(G.draw.splice(i, 1)[0]);
    });
    return;
  }

  // 复习模式：卡面下沿写「复习 · 答错等洗牌」
  if (d === 'review') {
    startRun('review');
    G.deck.forEach((e) => { const m = memOf(e.id); m.ok = 3; m.stab = 14; m.due = 3; });
    enterNode(G.map[0][0].key);
    return;
  }

  startRun();
  enterNode(G.map[0][0].key);
  // 点开一张**能出题的知识卡**，而不是写死下标 0：手牌是洗过的，
  // 0 号位有时是基础牌，截图就会随机拍成"没有面板的战斗画面"。
  const askIdx = G.hand.findIndex((e) => canAsk(e));
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
  } else if (d === 'reward') {
    if (G.enemy) G.enemy.hp = 0;
    G.pending = 'clear';
    dismissFeedback();
  } else if (d === 'report') {
    // 只是为了让文档截图里不是一排 0 —— 正常游戏里这些数字全部来自真实答题
    PACK.cards.forEach((c, i) => {
      const m = memOf(c.id);
      m.ok = 4 - (i % 3);
      m.bad = i % 2;
      m.stab = 13 + ((i * 5) % 12);
    });
    G.frees = 26;
    G.unlocks = 9;
    G.runOk = 12;
    G.runBad = 6;
    G.floors = 5;
    G.deck.push({ id: 'pow:log', up: 0 }, { id: 'pow:lamp', up: 0 });
    endRun(true);
  }
}

resetBattleView();
boot();
