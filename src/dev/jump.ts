import { FOES, STAGES } from '../core/model';
import type { Move, PowerId } from '../core/model';
import { PACK } from '../core/cards';
import { G } from '../core/infra';
import {
  EVENTS, dismissFeedback, endRun, enterNode, openCardPick, startRun,
} from '../core/journey';
import { applyInstant } from '../core/cards';
import { answer, askCard, canAsk } from '../core/combat';
import { genStage } from '../core/map';
import { sourceBank, stageMemOf } from '../core/library';

/**
 * 开发 / 截图入口：`?dev=battle` 直接落到某个画面。只是入口，规则仍是同一套 core。
 * 这个文件只在 `import.meta.env.DEV` 下动态 import，生产构建不会执行它。
 */
export function devJump() {
  const d = new URLSearchParams(location.search).get('dev');
  if (!d || d === 'title') return;
  // 开局选模式面板
  if (d === 'boon') { G.panel = { k: 'boon' }; return; }
  // 选主题面板：预勾两个，截图里才看得出"勾上是什么样"
  if (d === 'topic') {
    G.panel = {
      k: 'topic', mode: 'study',
      picks: Object.keys(sourceBank().byTopic).slice(0, 2),
    };
    return;
  }
  // 素材图集：不需要开局，是一张独立的质量检验页
  if (d === 'atlas') { G.screen = 'atlas'; return; }
  // 地图/战斗的截图要能指定幕：?dev=map&stage=4
  const qs = Number(new URLSearchParams(location.search).get('stage') || 0);
  const stageArg = Number.isInteger(qs) && qs >= 1 && qs <= STAGES.length ? qs : 0;
  const gotoStage = (n: number) => {
    if (!n) return;
    G.stage = n;
    G.map = genStage(n);
    G.pos = null;
    G.seen = {};
  };
  if (d === 'map') { startRun(); gotoStage(stageArg); return; }
  if (d === 'rest') { startRun(); G.panel = { k: 'rest' }; return; }
  // `?dev=event&ev=notebook`：指定事件。选牌类事件（旧笔记本 / 守夜人）才有
  // "打开面板 → 取消 → 回到事件"这条路径，冒烟测试要能稳定落到它上面。
  if (d === 'event') {
    startRun();
    const want = new URLSearchParams(location.search).get('ev');
    const ev = EVENTS.find((e) => e.id === want) ?? EVENTS[0];
    G.panel = { k: 'event', ev };
    return;
  }
  if (d === 'deck') { startRun(); G.panel = { k: 'deck' }; return; }
  // 精炼选牌面板：每份副本各一格，卡面写的是"选完之后的数值"。
  // 专门留一个入口，是因为这张面板的版式最容易在改动里悄悄退回去
  //（去重、格子数、预览数值），而它正好是玩家报过"看不到效果"的那一屏。
  if (d === 'refine') { startRun(); openCardPick('up'); return; }
  if (d === 'pack') { startRun(); G.panel = { k: 'pack', msg: '', ok: true }; return; }
  if (d === 'help') { startRun(); G.panel = { k: 'help' }; return; }
  // 敌人动作截图：把招式表固定成单招循环，状态牌上的意图和演出才是同一件事；
  // 而且真的走一次 endTurn，血量 / 格挡 / 弃牌堆都会跟着变，不是只盖一层特效。
  // 参数既可以是单招名（atk/jam/def/buff），也可以是 FOES 里的怪物 key，
  // 后者直接把敌人整个换成那只怪：新怪的立绘 / hint / 意图才能被逐个拍到。
  if (d.startsWith('foe:')) {
    const arg = d.slice(4);
    const MOVES: Record<string, Move> = {
      atk: { k: 'atk' },
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
          key: tpl.key, name: tpl.name, art: tpl.art, hue: tpl.hue, type: tpl.type,
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
    // `&id=atlas`：`desc` 是可选的，没有说明的增益走另一条排版（面板更矮），
    // 两种高度都得能拍到，否则这条分支只有等玩家抽到才第一次被看见。
    const want = (new URLSearchParams(location.search).get('id') ?? 'lamp') as PowerId;
    G.powers.push('hourglass', want);
    // 拾取即结算的增益要真的落地，否则藏书那一屏永远拍不到它该带的卡。
    // 对非 instant 的增益 `applyInstant` 是空操作，所以这里不必再判 scope。
    const out = applyInstant(want);
    G.panel = { k: 'powerdrop', id: want, cards: out.cards };
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
  // 联动卡演示：四张联动卡摊在手里，用 c04 真实抽一张验证抽牌数联动
  if (d === 'links') {
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
    // 都没有（约两成）。那时 ?dev=answer 会安静地拍成一张空战斗画面：
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
    // 只是为了让文档截图里不是一排 0：正常游戏里这些数字全部来自真实答题。
    // 章节掌握读的是 STAGE_MEM，所以这里造的是章节档案。
    const demo: Array<[number, number]> = [[9, 2], [7, 4], [12, 6], [4, 5], [0, 0]];
    // 结算页现在报的是**本局选中的**主题，所以造的档案也要跟着这局的主题走
    G.topics.forEach((topic, i) => {
      const e = stageMemOf(topic);
      const [ok, bad] = demo[i] ?? [0, 0];
      e.ok = ok;
      e.bad = bad;
      e.q = {};
      for (let j = 0; j < bad; j++) e.q[`q_demo_${i}_${j}`] = { ok: 0, bad: 1, attempts: [1] };
    });
    G.answerDraws = 14;
    G.runOk = 12;
    G.runBad = 6;
    G.stageOk = 12;
    G.stageBad = 6;
    G.floors = 5;
    G.stage = 3;
    // 牌组里加一张 3 费卡：起手只给 0–1 费，所以这张一定是新卡种
    G.deck.push(PACK.cards.find((c) => c.cost === 3)!.id);
    endRun(true);
  }
}
