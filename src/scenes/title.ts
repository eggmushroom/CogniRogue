import { g, roundRect, VH, VW } from '../gfx/canvas';
import { C, FONT_TITLE, withAlpha } from '../gfx/theme';
import { action, text } from '../gfx/ui';
import { hover, onClick } from '../input';
import { G } from '../core/infra';
import { resumeRun, runSaveInfo } from '../core/journey';
import { bankProgress, countQuestions, sourceBank } from '../core/library';

/**
 * 世界层：只画标题、按钮、题库卡片、进度和它们的热区；书架由 layers.ts 的背景层统一画。
 *
 * 首页只回答三个问题：**接着打还是开新的**、**这些题是哪来的**、**我学到哪了**。
 * 之前「题库」既是一颗按钮、又是底部一段单独的文字，中间空着一大片 ——
 * 同一个东西写两遍，还互相离得很远。现在合成一张卡片，空出来的位置放进度。
 */
export function drawTitle(t: number, openHelp: () => void, openPack: () => void) {
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

  // 按钮、题库卡片、进度条共用同一列宽：三块各自居中最容易看出"左边缘不齐"
  const bw = 460;
  const bx = cx - bw / 2;

  // 有断点就把它摆到第一位。100 层的一局接近一小时，首页上「继续」比「开始」更常用；
  // 反过来，一旦按错「开始新的一局」，代价不是十分钟，是整座塔：
  // 所以破坏性的那个降成次按钮，要点的那个是唯一带金边的。
  const save = runSaveInfo();
  let cardTop: number;
  if (save) {
    action(bx, 424, bw, 60, '继续这一局', () => { resumeRun(); }, 'primary', {
      size: 23, sub: `第 ${save.stage} 幕 · ${save.stageName}`,
    });
    text(`第 ${save.floor}/100 层 · ${save.hp}/${save.maxHp} 生命`, cx, 506, {
      size: 13, align: 'center', color: C.dim,
    });
    action(bx, 524, bw, 50, '开始新的一局', () => { G.panel = { k: 'boon' }; });
    action(bx, 586, bw, 50, '这游戏怎么玩', openHelp);
    cardTop = 654;
  } else {
    action(bx, 448, bw, 60, '开始新的一局', () => { G.panel = { k: 'boon' }; }, 'primary', { size: 22 });
    action(bx, 524, bw, 52, '这游戏怎么玩', openHelp);
    cardTop = 596;
  }

  drawBankCard(cardTop, openPack);
  drawProgress(cardTop + 96);

  // 版本和许可合成右下角一行。左下原来还有一行"v0.4 · TypeScript + Canvas"：
  // 技术栈对玩家没有意义，对读源码的人 README 里也有。
  text('v0.4 · MIT License', VW - 40, VH - 28, { size: 12, color: C.faint, align: 'right' });
}

/** 现在用的是哪份题库 —— 名字、题数、主题数都在这里，点开是题库面板。 */
function drawBankCard(y: number, openPack: () => void) {
  const w = 460;
  const x = VW / 2 - w / 2;
  const h = 76;
  const hv = hover(x, y, w, h);

  roundRect(x, y, w, h, 12);
  g.fillStyle = hv ? 'rgba(255,255,255,.06)' : 'rgba(255,255,255,.028)';
  g.fill();
  g.strokeStyle = hv ? withAlpha(C.gold, 0.7) : C.line;
  g.lineWidth = 1.3;
  g.stroke();

  // 首页展示的是**来源题库**（正在用的那份），不是某一幕切出来的切片。
  // 数的是**题池**：卡和题解耦之后，玩家真正会遇到的分组是题库里的 `## 主题`。
  const src = sourceBank();
  text(src.name, x + 22, y + 30, { size: 17, weight: 700, color: C.ink, maxW: w - 140 });
  text(`${countQuestions(src)} 道题 / ${Object.keys(src.byTopic).length} 个主题`,
    x + 22, y + 54, { size: 12, color: C.dim });
  text('换一份 ›', x + w - 22, y + 42, { size: 13, color: hv ? C.gold : C.dim, align: 'right' });

  onClick(x, y, w, h, openPack, 'title:bank');
}

/**
 * 学到哪了：答对满 `BAL.retireAt` 次的题不再抽，所以"已掌握"就是这道进度条。
 * 一个学习游戏，首页上一眼能看到自己攒了多少，比知道题库有几百道题重要得多。
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
