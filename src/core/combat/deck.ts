import { BAL } from '../model/data';
import { G, log } from '../infra/state';
import { shuffle } from '../infra/util';
import { hasPower } from '../cards/registry';

/**
 * combat/deck —— 牌堆循环与回合开始。
 *
 * 抽牌堆空了就洗回弃牌堆；杂念不进弃牌堆（回合结束原地散掉）。
 * 这里只动牌堆和手牌，不动敌人、不动面板。
 */
export function startTurn() {
  // 沙漏已经在 playPower 里把 apMax 抬高了，这里不再额外加 ——
  // 上限和当前值必须是同一个数，否则能量球会显示成 4 / 3。
  G.ap = G.apMax;
  // 吸水（siphon）：敌人上回合抽走的那一点，在这里结账。
  // 记账放到下一回合，是因为挨打时这一回合的行动力早就花完了 —— 当场扣等于没扣。
  if (G.apDown > 0) {
    const n = Math.min(G.apDown, Math.max(0, G.apMax - 1));
    G.ap -= n;
    G.apDown = 0;
    if (n) log(`你被抽走了 ${n} 点行动力，这一回合只剩 ${G.ap} 点`, 'bad');
  }
  // 长明灯：格挡不跨回合，所以它每回合都得重新点一次 —— 3 点是"打不空"的下限
  G.block = hasPower('lamp') ? BAL.lampBlock : 0;
  // 开局缓冲：第一回合额外给 BAL.startBlock 点格挡。
  // 这段以前写在 startBattle 里，紧接着就被上面这行覆盖成 0 —— 缓冲从来没真的生效过。
  if (G.turn === 1) {
    G.block += BAL.startBlock;
    if (BAL.startBlock) log(`开局 ${BAL.startBlock} 点格挡`, 'hi');
  }
  G.okThisTurn = 0;
  // 遗忘 Boss 的 -3 只保一回合：每回合重新等"这一回合你有没有答对它"
  G.topOkTopic = null;
  G.cardsPlayed = 0;
  G.binderUsed = false;
  // 答对抽牌的每回合上限在 startTurn 归零，不是"每场"
  G.answerDrawsThisTurn = 0;
  G.missDrawsThisTurn = 0;
  // 答错锁的是"这一回合"，新回合重新给机会
  G.failedTurn = {};
  // 杂念不进入弃牌堆：它是虚无的，回合结束就散
  G.hand.forEach((c) => { if (!c.junk) G.discard.push(c); });
  G.hand = [];
  // 手牌在回合末尾整把进弃牌堆，所以"抽几张"= 这回合能看见几张。
  // 默认 5 张（BAL.drawPerTurn）：10 张起手牌组一回合看一半，构筑才有意义。
  drawTo(Math.max(1, BAL.drawPerTurn + (hasPower('index') ? 1 : 0) - G.drawCut));
  log(`回合 ${G.turn} 开始${G.drawCut ? `（视野 -${G.drawCut}）` : ''}`, 'turn');
}

/** 把手牌补到 n 张。牌堆与弃牌堆都空了就停，不会死循环。 */
export function drawTo(n: number) {
  while (G.hand.length < n) {
    if (!G.draw.length) {
      if (!G.discard.length) break;
      G.draw = shuffle(G.discard);
      G.discard = [];
      log('弃牌堆重新洗入牌堆', 'turn');
    }
    G.hand.push(G.draw.pop()!);
  }
}

/** 额外抽 n 张（专注、索引卡、荧光笔）。返回实际抽到的张数，反馈面板要写这个数。 */
export function drawCards(n: number) {
  let got = 0;
  while (n-- > 0) {
    if (!G.draw.length) {
      if (!G.discard.length) break;
      G.draw = shuffle(G.discard);
      G.discard = [];
    }
    G.hand.push(G.draw.pop()!);
    got += 1;
  }
  return got;
}
