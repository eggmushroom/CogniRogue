import type { ReportRow } from '../model/types';
import { CURRICULUM, MODE_BY_ID, POWER_BY_ID } from '../model/data';
import { G } from '../infra/state';
import { saveMem } from '../library/memory';
import { saveStageMem, stageDigest } from '../library/stagemem';
import { baseIdOf } from '../cards/registry';
import { curFloor } from '../map/gen';
import { clearRun } from './save';

/**
 * 一局的结算：只读记忆与统计，不改规则、不驱动战斗。
 * 掌握度按章节算，不按卡牌。
 */
export function endRun(win: boolean) {
  saveMem();
  // 一局结束就没有断点了
  clearRun();
  const rows: ReportRow[] = CURRICULUM.map((plan) => {
    const d = stageDigest(plan.stage, plan.topic);
    return { t: plan.topic, ok: d.ok, bad: d.bad, mast: d.mastery };
  });
  const total = rows.length ? rows.reduce((n, r) => n + r.mast, 0) / rows.length : 0;
  // rows 会把没打过的章节也补成空条目，所以章节记忆在算完 rows 之后再落盘，
  // 否则刚建的空条目要等下一次结算才写进去。
  saveStageMem();

  // 押注没了，结算页也就不再有"你押的档准不准"：现在只剩一个问题：
  // 这一局的伤害里，多少是你记住的，多少是你当时蒙对的那一下。
  const asks = G.runOk + G.runBad;
  const acc = asks ? G.runOk / asks : 0;
  let verdict: string;
  if (!asks) {
    verdict = '这一局你一道题都没答。战斗不是靠躲过去的 —— 下一局先点开一张牌。';
  } else if (acc >= 0.8) {
    verdict = `你答对了 ${Math.round(acc * 100)}%。`
      + '后半场你不是在赌，是在用记住的东西打仗 —— 答对退回的行动力和多抽的那张牌，都是这么来的。';
  } else if (acc >= 0.6) {
    verdict = `你答对了 ${Math.round(acc * 100)}%。这个区间是"半懂"：牌打得出去，但每一手都要重新想一次。`
      + '把错得最多的那一章连着答两轮，比换一副更强的牌有用。';
  } else {
    verdict = `你答对了 ${Math.round(acc * 100)}%。牌面够强，题没记住 —— 这副牌现在是借来的。`
      + '先把牌组压薄，让同一张卡多被问几次。';
  }

  G.screen = 'report';
  // 本章本局的答题数：从流水里数，而不是从卡牌记忆里推：同一张卡可能
  // 在前几章问过别的题。流水只留最近若干条，所以它是"这一章打到现在"的下限。
  const stageAs = G.answers.filter((a) => a.stage === G.stage && a.stageTopic === G.stageTopic);
  G.panel = {
    k: 'report',
    data: {
      win,
      mode: G.mode ? (MODE_BY_ID[G.mode]?.name ?? G.mode) : '无',
      stage: G.stage,
      stageTopic: G.stageTopic,
      stageOk: stageAs.filter((a) => a.right).length,
      stageBad: stageAs.filter((a) => !a.right).length,
      floor: curFloor(),
      runOk: G.runOk, runBad: G.runBad, floors: G.floors, deckSize: G.deck.length,
      // 牌组的"卡种"就是剥掉精炼后缀之后的种类数：同一张牌的普通版和精炼版
      // 是两种 id，但只是一种卡。增益不进牌组，所以这里不必再排除什么。
      kinds: new Set(G.deck.map(baseIdOf)).size,
      mastery: total, rows, answerDraws: G.answerDraws,
      verdict, powers: G.powers.map((id) => POWER_BY_ID[id]?.name ?? id),
    },
  };
}
