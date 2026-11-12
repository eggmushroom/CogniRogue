import { BAL } from '../model/data';
import { G, log, resetTurnState } from '../infra/state';
import { grantBlock, resetAp, setBlock, spendAp } from '../infra/write';
import { shuffle } from '../infra/util';
import { JUNK_ID } from '../cards/registry';
import { onceThisFight, rulesOf } from '../cards/powers';

/**
 * combat/deck：牌堆循环与回合开始。
 * 抽牌堆空则洗回弃牌堆；杂念回合结束原地散掉；数字一律来自 rulesOf()。
 */
export function startTurn() {
  // 索引卡读上一回合剩几张，清手牌前先记下；规则表则在清空之后算。
  const handLeft = G.hand.length;
  const R = rulesOf({ handLeft });
  resetTurnState();
  // 行动力上限也由 rulesOf 给（沙漏 +1），上限与当前值必须同源。
  G.apMax = R.apMax;
  resetAp();
  // 吸水：敌人上回合抽走的行动力在这里结账，挨打时当场扣等于没扣。
  if (G.apDown > 0) {
    const n = Math.min(G.apDown, Math.max(0, G.apMax - 1));
    spendAp(n);
    G.apDown = 0;
    if (n) log(`你被抽走了 ${n} 点行动力，这一回合只剩 ${G.ap} 点`, 'bad');
  }
  // 格挡每回合重设：保底、开局、索引贴三笔都由规则表给，直接覆盖 G.block。
  setBlock(R.turnBlock + R.startBlock + G.carryBlock);
  if (G.carryBlock) log(`索引贴留下了 ${G.carryBlock} 点格挡`, 'hi');
  G.carryBlock = 0;
  if (R.startBlock) log(`开局 ${R.startBlock} 点格挡`, 'hi');
  G.hand.forEach((id) => { if (id !== JUNK_ID) G.discard.push(id); });
  G.hand = [];
  // 索引卡/折角已折进 R.draw，drawCut 是蠹蛾砍的；一回合至少看见一张。
  drawTo(Math.max(1, R.draw - G.drawCut));
  log(`回合 ${G.turn} 开始${G.drawCut ? `（视野 -${G.drawCut}）` : ''}`, 'turn');
}

/** 弃牌堆洗回抽牌堆，唯一的洗牌点：毡垫与档案盒都挂这里。 */
function reshuffle() {
  // 毡垫：第一次洗牌前剔掉杂念；弃牌堆没有杂念时不消耗这次机会。
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
  // 档案盒：洗牌后补一次格挡。
  const n = rulesOf().reshuffleBlock;
  if (n > 0) {
    grantBlock(n);
    log(`档案盒：洗牌后补 ${n} 点格挡`, 'hi');
  }
}

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
