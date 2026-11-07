import type { ReportRow } from '../model/types';
import { G } from '../infra/state';
import { clamp } from '../infra/util';
import { memOf, saveMem } from '../library/memory';
import { PACK, topics } from '../library/pack';
import { deckPowers, isPowerId } from '../cards/registry';

/**
 * journey/report —— 一局的结算。
 *
 * 只读记忆与 G 的统计，不改规则、不驱动战斗。它不 import combat，
 * 所以 combat/foe.ts 可以在死亡延迟里安全地调用 endRun。
 */
export function endRun(win: boolean) {
  saveMem();
  const rows: ReportRow[] = topics().map((t) => {
    const cs = PACK.cards.filter((c) => c.topic === t);
    const ok = cs.reduce((n, c) => n + memOf(c.id).ok, 0);
    const bad = cs.reduce((n, c) => n + memOf(c.id).bad, 0);
    const mast = cs.reduce((n, c) => n + clamp(memOf(c.id).stab / 25, 0, 1), 0) / cs.length;
    return { t, ok, bad, mast };
  });
  const total = rows.length ? rows.reduce((n, r) => n + r.mast, 0) / rows.length : 0;

  // 押注没了，结算页也就不再有"你押的档准不准"—— 现在只剩一个问题：
  // 这一局的伤害里，多少是你记住的，多少是你当时蒙对的那一下。
  const asks = G.runOk + G.runBad;
  const acc = asks ? G.runOk / asks : 0;
  const share = asks + G.frees ? G.frees / (asks + G.frees) : 0;
  let verdict: string;
  if (!asks) {
    verdict = '这一局你一道题都没答。战斗不是靠躲过去的 —— 下一局先点开一张牌。';
  } else if (acc >= 0.8) {
    verdict = `你答对了 ${Math.round(acc * 100)}%，${Math.round(share * 100)}% 的出牌是免答打出去的。`
      + '后半场你不是在赌，是在用记住的东西打仗 —— 这就是这套机制想要的状态。';
  } else if (acc >= 0.6) {
    verdict = `你答对了 ${Math.round(acc * 100)}%。这个区间是"半懂"：卡能解锁，但每场都要重新证明一次。`
      + '把错得最多的那个主题连着答两轮，比换一副更强的牌有用。';
  } else {
    verdict = `你答对了 ${Math.round(acc * 100)}%。牌面够强，题没记住 —— 这副牌现在是借来的。`
      + '先把牌组压薄，让同一张卡多被问几次。';
  }

  G.screen = 'report';
  G.panel = {
    k: 'report',
    data: {
      win,
      mode: G.mode,
      floor: G.node ? G.node.r + 1 : G.pos ? G.pos.r + 1 : 1,
      runOk: G.runOk, runBad: G.runBad, floors: G.floors, deckSize: G.deck.length,
      // 增益牌不算卡种：它没有题，混进来会把牌组的多样性说多
      kinds: new Set(G.deck.filter((e) => !isPowerId(e.id)).map((e) => e.id)).size,
      mastery: total, rows, frees: G.frees, unlocks: G.unlocks,
      verdict, powers: deckPowers().map((p) => p.name),
    },
  };
}
