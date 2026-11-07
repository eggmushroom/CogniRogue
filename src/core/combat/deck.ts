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
  // 长明灯：格挡不跨回合，所以它每回合都得重新点一次 —— 3 点是"打不空"的下限
  G.block = hasPower('lamp') ? BAL.lampBlock : 0;
  G.okThisTurn = 0;
  G.cardsPlayed = 0;
  G.binderUsed = false;
  // 答错锁的是"这一回合"，新回合重新给机会
  G.failedTurn = {};
  // 杂念不进入弃牌堆：它是虚无的，回合结束就散
  G.hand.forEach((c) => { if (!c.junk) G.discard.push(c); });
  G.hand = [];
  drawTo(BAL.handSize + (hasPower('index') ? 1 : 0));
  log(`回合 ${G.turn} 开始`, 'turn');
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
