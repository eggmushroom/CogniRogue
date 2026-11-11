import { BAL } from '../model/data';
import { G, log, resetTurnState } from '../infra/state';
import { resetAp, setBlock, spendAp } from '../infra/write';
import { shuffle } from '../infra/util';
import { JUNK_ID } from '../cards/registry';
import { onceThisFight, rulesOf } from '../cards/powers';

/**
 * combat/deck —— 牌堆循环与回合开始。
 *
 * 抽牌堆空了就洗回弃牌堆；杂念不进弃牌堆（回合结束原地散掉）。
 * 这里只动牌堆和手牌，不动敌人、不动面板。
 *
 * **不认牌名**：能力牌给的所有数字都从 `rulesOf()` 来（见 `cards/powers.ts`）。
 * 这个文件以前有六处 `hasPower('xxx')`，现在一处也没有 —— 加一张"每回合多抽一张"
 * 的牌，改的是 `powers.ts`，不是这里。
 */
export function startTurn() {
  // 索引卡看的是"上一回合剩了几张"：手牌在下面会被清空，所以先记下来。
  const handLeft = G.hand.length;
  // 规则要在清手牌**之后**的回合数上算，但 handLeft 只能从清空之前拿 —— 所以先算。
  const R = rulesOf({ handLeft });
  resetTurnState();
  // 沙漏那 +1 点由 `rulesOf` 折算进 apMax。上限和当前值必须是同一个数，
  // 否则能量球会显示成 4 / 3。
  G.apMax = R.apMax;
  resetAp();
  // 吸水（siphon）：敌人上回合抽走的那一点，在这里结账。
  // 记账放到下一回合，是因为挨打时这一回合的行动力早就花完了 —— 当场扣等于没扣。
  if (G.apDown > 0) {
    const n = Math.min(G.apDown, Math.max(0, G.apMax - 1));
    spendAp(n);
    G.apDown = 0;
    if (n) log(`你被抽走了 ${n} 点行动力，这一回合只剩 ${G.ap} 点`, 'bad');
  }
  // 格挡不跨回合，所以每回合都得重新来一次：`turnBlock` 是保底（长明灯），
  // `startBlock` 是第一回合的开局缓冲（镇纸 / 护角，非第一回合恒为 0），
  // `carryBlock` 是上一回合「索引贴」留下的那一笔（唯一跨回合的格挡）。
  // 三笔都从规则表来，这里只负责把它们落到 `G.block` 上 —— 注意是**设成**，
  // 不是加上：上一回合剩的格挡在这一行之前就该消失（索引贴除外）。
  setBlock(R.turnBlock + R.startBlock + G.carryBlock);
  if (G.carryBlock) log(`索引贴留下了 ${G.carryBlock} 点格挡`, 'hi');
  G.carryBlock = 0;
  // 只报总数，不复读牌名：哪几张牌凑出来的，卡面与顶栏已经写着了，
  // 日志再念一遍只是把这一行从"结果"变成"清单"。
  if (R.startBlock) log(`开局 ${R.startBlock} 点格挡`, 'hi');
  // 杂念不进入弃牌堆：它是虚无的，回合结束就散
  G.hand.forEach((id) => { if (id !== JUNK_ID) G.discard.push(id); });
  G.hand = [];
  // 手牌在回合末尾整把进弃牌堆，所以"抽几张"= 这回合能看见几张。
  // 索引卡 / 折角已经折进 `R.draw`；`drawCut` 是敌人砍的（蠹蛾的雾），
  // 但一回合至少得看见一张，否则这一手没有任何选择。
  drawTo(Math.max(1, R.draw - G.drawCut));
  log(`回合 ${G.turn} 开始${G.drawCut ? `（视野 -${G.drawCut}）` : ''}`, 'turn');
}

/**
 * 弃牌堆洗回抽牌堆。**牌堆循环的唯一洗牌点** —— 两个抽牌函数都走它。
 *
 * 原来这里是两段一模一样的 `shuffle(G.discard)`，于是「毡垫」要挂上去
 * 就得改两处，漏一处就是"某些抽牌路径上它不生效"。抽成一个函数之后，
 * 洗牌前的处理只有一份。
 */
function reshuffle() {
  // 毡垫：第一次洗牌之前，把敌人塞进来的杂念剔掉。先数一遍再消耗 ——
  // 弃牌堆里本来没有杂念时不该把这张牌的机会用掉。
  if (G.discard.some((id) => id === JUNK_ID) && onceThisFight('felt')) {
    let n = 0;
    G.discard = G.discard.filter((id) => {
      if (id !== JUNK_ID || n >= BAL.feltJunk) return true;
      n += 1;
      return false;
    });
    log(`毡垫：${n} 张杂念没被洗回来`, 'hi');
  }
  G.draw = shuffle(G.discard);
  G.discard = [];
  log('弃牌堆重新洗入牌堆', 'turn');
}

/** 把手牌补到 n 张。牌堆与弃牌堆都空了就停，不会死循环。 */
export function drawTo(n: number) {
  while (G.hand.length < n) {
    if (!G.draw.length) {
      if (!G.discard.length) break;
      reshuffle();
    }
    G.hand.push(G.draw.pop()!);
    G.drawnThisTurn += 1;
  }
}

/** 额外抽 n 张（专注、索引卡、双面镜）。返回实际抽到的张数，反馈面板要写这个数。 */
export function drawCards(n: number) {
  let got = 0;
  while (n-- > 0) {
    if (!G.draw.length) {
      if (!G.discard.length) break;
      reshuffle();
    }
    G.hand.push(G.draw.pop()!);
    G.drawnThisTurn += 1;
    got += 1;
  }
  return got;
}
