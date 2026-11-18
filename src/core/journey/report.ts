import type { ReportRow } from '../model/types';
import { MODE_BY_ID } from '../model/data';
import { G } from '../infra/state';
import { saveStageMem, stageDigest } from '../library/stagemem';
import { queueRunAnswers } from '../library/answers';
import { baseIdOf } from '../cards/registry';
import { curFloor } from '../map/gen';
import { clearRun } from './save';

/**
 * 一局的结算：只读统计，不改规则、不驱动战斗。
 * 掌握度按主题算，不按卡牌；报的是**这一局选中的**那几个主题，
 * 不是固定的五章 —— 幕不再绑定主题，五章固定行会报出这局没碰过的主题。
 */
export function endRun(win: boolean) {
  // 一局结束就没有断点了
  clearRun();
  const rows: ReportRow[] = G.topics.map((topic) => {
    const d = stageDigest(topic);
    return { t: topic, ok: d.ok, bad: d.bad, mast: d.mastery };
  });
  const total = rows.length ? rows.reduce((n, r) => n + r.mast, 0) / rows.length : 0;
  // rows 会把没打过的章节也补成空条目，所以章节记忆在算完 rows 之后再落盘，
  // 否则刚建的空条目要等下一次结算才写进去。
  saveStageMem();

  // 这一局的答题流水在这里打包排队，交给表现层发回本机服务。
  // 放在结算里而不是"发牌/答题时边发边传"：一局一次请求，中途掉线也不会丢半截。
  queueRunAnswers(win);

  // 押注没了，结算页也就不再有"你押的档准不准"：现在只剩一个问题：
  // 这一局的伤害里，多少是你记住的，多少是你当时蒙对的那一下。
  const asks = G.runOk + G.runBad;
  // 准确率一次算成整数百分比：三处分支和显示读的是同一个数，不会出现
  // 「显示 80% 却落进 60% 那一档」这种小数与取整不同步。
  const acc = asks ? Math.round((G.runOk * 100) / asks) : 0;
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
  } else if (acc >= 80) {
    verdict = `你答对了 ${acc}%。答对才结算，免答次数也是这么攒的。`;
  } else if (acc >= 60) {
    verdict = `你答对了 ${acc}%。`
      + (weak ? `错得最多的是「${weak.t}」，下一局先把它连着答两轮。` : '');
  } else {
    verdict = `你答对了 ${acc}%。牌组 ${G.deck.length} 张，`
      + (weak ? `错的集中在「${weak.t}」。先把这一章连着答两轮，再压薄牌组。` : '先压薄牌组。');
  }

  G.screen = 'report';
  // 本章本局的答题数：直接读累计计数，不读 `runAnswers()` 那份流水。
  // 流水只留最近 600 手、而且结算时就被交出去了，长局读到一半会少算。
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
