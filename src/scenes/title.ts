import { g, roundRect, VH, VW } from '../gfx/canvas';
import { C, FONT_TITLE, withAlpha } from '../gfx/theme';
import { action, text } from '../gfx/ui';
import { hover, onClick } from '../input';
import { G } from '../core/infra';
import { resumeRun, runSaveInfo } from '../core/journey';
import { bankProgress, countQuestions, sourceBank } from '../core/library';

/**
 * 世界层：只画标题、三个入口、学习进度和它们的热区；书架由 layers.ts 的背景层统一画。
 *
 * 首页只回答三件事：**接着打还是开新的**、**这些题是哪来的**、**我学到哪了**。
 * 三颗按钮就是三个入口，题库名写在「题库」那颗的副标题里 —— 它原来是单独一张卡片，
 * 和按钮各占一列宽、左边缘还差一截，同一个东西在页面上出现两遍。
 *
 * 玩法说明没有消失，它搬进了「设置」：那是一页说明，不是每天要按的东西。
 */
export function drawTitle(
  t: number, openPack: () => void, openSettings: () => void,
) {
  const cx = VW / 2;

  // 标题光
  const gl = g.createRadialGradient(cx, 252, 20, cx, 252, 520);
  gl.addColorStop(0, withAlpha(C.gold, 0.16));
  gl.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gl;
  g.fillRect(0, 0, VW, VH);

  const pulse = 1 + Math.sin(t * 1.1) * 0.006;
  g.save();
  g.translate(cx, 236);
  g.scale(pulse, pulse);
  text('COGNIROGUE', 0, 0, {
    size: 96, weight: 700, align: 'center', color: C.ink, family: FONT_TITLE,
  });
  g.restore();

  const lg = g.createLinearGradient(cx - 300, 0, cx + 300, 0);
  lg.addColorStop(0, withAlpha(C.gold, 0));
  lg.addColorStop(0.5, withAlpha(C.gold, 0.85));
  lg.addColorStop(1, withAlpha(C.gold, 0));
  g.fillStyle = lg;
  g.fillRect(cx - 300, 296, 600, 1.6);

  text('一边打牌，一边把该复习的东西复习掉', cx, 336, {
    size: 21, align: 'center', color: C.ink2, weight: 500,
  });
  text('题不印在卡面上 · 点开才出题', cx, 372, {
    size: 15, align: 'center', color: C.dim,
  });

  const bw = 460;
  const bx = cx - bw / 2;
  const bh = 64;

  /*
   * 有断点时整列上提，并在「继续」和「题库」之间插一行小字「开始新的一局」。
   *
   * 100 层的一局接近一小时，首页上「继续」比「开始」更常用；反过来，一旦按错
   * 「开始新的一局」，代价不是十分钟，是整座塔 —— 所以它是小字，不是按钮。
   */
  const save = runSaveInfo();
  let by: number;
  if (save) {
    action(bx, 416, bw, bh, '继续这一局', () => { resumeRun(); }, 'primary', {
      size: 23, sub: `第 ${save.stage} 幕 · ${save.stageName} · ${save.hp}/${save.maxHp} 生命`,
    });
    drawNewRunLink(496);
    by = 512;
  } else {
    action(bx, 452, bw, bh, '开始游戏', () => { G.panel = { k: 'boon' }; }, 'primary', { size: 23 });
    by = 532;
  }

  // 题库那颗的副标题就是"正在用哪份、共多少题"，点开是题库面板
  const src = sourceBank();
  action(bx, by, bw, bh, '题库', openPack, 'ghost', {
    size: 21, sub: `${src.name} · ${countQuestions(src)} 道题 / ${Object.keys(src.byTopic).length} 个主题`,
  });
  action(bx, by + 80, bw, bh, '设置', openSettings, 'ghost', {
    size: 21, sub: '玩法说明 · 本机服务 · 出题模型',
  });

  // 进度条的位置两种版式一致：多了一个断点，它不该跟着往下跳
  drawProgress(720);

  // 版本和许可合成右下角一行。技术栈对玩家没有意义，读源码的人看 README。
  text('v0.4 · MIT License', VW - 40, VH - 28, { size: 12, color: C.faint, align: 'right' });
}

/**
 * 「开始新的一局」：一行小字，不是按钮。它会丢掉断点，所以不配和「继续」抢注意力。
 */
function drawNewRunLink(y: number) {
  const w = 160;
  const x = VW / 2 - w / 2;
  const hv = hover(x, y - 16, w, 24);
  text('开始新的一局', VW / 2, y, { size: 13, align: 'center', color: hv ? C.gold : C.dim });
  onClick(x, y - 16, w, 24, () => { G.panel = { k: 'boon' }; }, '开始新的一局');
}

/**
 * 学到哪了：答对满 `BAL.retireAt` 次的题不再抽，所以"已掌握"就是这道进度条。
 * 一个学习游戏，首页上一眼看到自己攒了多少，比知道题库有几百道题重要得多。
 */
function drawProgress(y: number) {
  const w = 460;
  const x = VW / 2 - w / 2;
  const p = bankProgress();
  const rate = p.answers ? Math.round((p.ok / p.answers) * 100) : 0;

  text(`已掌握 ${p.mastered} / ${p.total} 题`, x, y, { size: 13, weight: 600, color: C.ink2 });
  if (p.answers) {
    text(`正确率 ${rate}%`, x + w, y, { size: 13, color: C.dim, align: 'right' });
  }

  // 8px 才看得出是"进度"，6px 会读成一条分隔线
  roundRect(x, y + 13, w, 8, 4);
  g.fillStyle = 'rgba(255,255,255,.09)';
  g.fill();
  if (p.total && p.mastered) {
    // 一道题也是看得见的一点，别让"刚掌握 1 题"渲染成空条
    roundRect(x, y + 13, Math.max(8, (w * p.mastered) / p.total), 8, 4);
    g.fillStyle = C.gold;
    g.fill();
  }

  text(p.answers ? `累计 ${p.answers} 次答题` : '还没答过题', x, y + 42, {
    size: 12, color: C.faint,
  });
}
