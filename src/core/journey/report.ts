import type { ReportRow } from '../model/types';
import { CURRICULUM, MODE_BY_ID } from '../model/data';
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
  /**
   * 结论只回答一件事：下一局先改哪里。
   *
   * 所以每档都给一个**具体到章**的动作，并且不加评语 —— "半懂""这副牌现在是借来的"
   * 是在给玩家下判断，而玩家要的是下一步。指到章名之后，"错得最多的那一章"
   * 这句空话才有落点（原来它没说是哪一章，等于什么也没说）。
   */
  const weak = rows.reduce<ReportRow | null>((w, r) => (r.bad > (w?.bad ?? 0) ? r : w), null);
  let verdict: string;
  if (!asks) {
    verdict = '这一局一道题都没答。点开知识卡才会出题；基础牌不出题，也不退行动力。';
  } else if (acc >= 0.8) {
    verdict = `你答对了 ${Math.round(acc * 100)}%。答对才结算，免答次数也是这么攒的。`;
  } else if (acc >= 0.6) {
    verdict = `你答对了 ${Math.round(acc * 100)}%。`
      + (weak ? `错得最多的是「${weak.t}」，下一局先把它连着答两轮。` : '');
  } else {
    verdict = `你答对了 ${Math.round(acc * 100)}%。牌组 ${G.deck.length} 张，`
      + (weak ? `错的集中在「${weak.t}」。先把这一章连着答两轮，再压薄牌组。` : '先压薄牌组。');
  }

  G.screen = 'report';
  // 本章本局的答题数：直接读累计计数，不读 answers 环形缓冲。
  // 环形缓冲只有最近 120 条，长局读到一半就会少算，而且读档后会被清零。
  G.panel = {
    k: 'report',
    data: {
      win,
      mode: G.mode ? (MODE_BY_ID[G.mode]?.name ?? G.mode) : '无',
      stage: G.stage,
      stageTopic: G.stageTopic,
      stageOk: G.stageOk,
      stageBad: G.stageBad,
      floor: curFloor(),
      runOk: G.runOk, runBad: G.runBad, floors: G.floors, deckSize: G.deck.length,
      // 牌组的"卡种"就是剥掉精炼后缀之后的种类数：同一张牌的普通版和精炼版
      // 是两种 id，但只是一种卡。增益不进牌组，所以这里不必再排除什么。
      kinds: new Set(G.deck.map(baseIdOf)).size,
      mastery: total, rows, answerDraws: G.answerDraws,
      verdict, powers: G.powers,
    },
  };
}
