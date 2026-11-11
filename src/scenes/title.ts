import { g, VH, VW } from '../gfx/canvas';
import { C, FONT_TITLE, withAlpha } from '../gfx/theme';
import { action, text } from '../gfx/ui';
import { drawBackdrop, drawMotes } from '../gfx/backdrop';
import { G } from '../core/infra';
import { resumeRun, runSaveInfo } from '../core/journey';
import { countQuestions, sourceBank } from '../core/library';
import { PACK } from '../core/cards';

export function drawTitle(t: number, openHelp: () => void, openPack: () => void) {
  drawBackdrop(t, 0.72);
  drawMotes(t);

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

  const bw = 330;
  const bx = cx - bw / 2;
  let by = 452;

  // 有断点就把它摆到第一位。100 层的一局接近一小时，首页上「继续」比「开始」更常用；
  // 反过来，一旦按错「开始新的一局」，代价不是十分钟，是整座塔 ——
  // 所以破坏性的那个降成次按钮，要点的那个是唯一带金边的。
  const save = runSaveInfo();
  if (save) {
    action(bx, 424, bw, 60, '继续这一局', () => { resumeRun(); }, 'primary', {
      size: 23, sub: `第 ${save.stage} 幕 · ${save.stageName}`,
    });
    text(`第 ${save.floor}/100 层 · ${save.hp}/${save.maxHp} 生命`, cx, 506, {
      size: 13, align: 'center', color: C.dim,
    });
    by = 526;
    action(bx, by, bw, 50, '开始新的一局', () => { G.panel = { k: 'boon' }; }); by += 62;
    action(bx, by, bw, 50, '这游戏怎么玩', openHelp); by += 62;
    action(bx, by, bw, 50, '载入自己的题库', openPack);
  } else {
    action(bx, by, bw, 60, '开始新的一局', () => { G.panel = { k: 'boon' }; }, 'primary', { size: 22 });
    by += 76;
    action(bx, by, bw, 56, '这游戏怎么玩', openHelp);
    by += 70;
    action(bx, by, bw, 56, '载入自己的题库', openPack);
  }

  // 卡池是内置的、题库是可换的，两行分开写才不会让人以为导入会换牌。
  // "进度自动存在本地"撤了：这句话是承诺不是数据，帮助页里讲得比这里清楚。
  const py = save ? 744 : 760;
  // 首页展示的是**来源题库**（载入的那份），不是某一幕切出来的切片。
  // 数的是**题池**而不是卡面主题：卡题解耦之后 `card.topic` 只是牌组排序用的旧标签，
  // 玩家真正会遇到的分组是题库里的 `## 主题`。
  const src = sourceBank();
  text(src.name, cx, py, { size: 16, align: 'center', color: C.gold, weight: 700 });
  text(
    `内置 ${PACK.cards.length} 张卡 · ${countQuestions(src)} 道题 / ${Object.keys(src.byTopic).length} 个题池`,
    cx, py + 26, { size: 13, align: 'center', color: C.dim },
  );

  if (G.deck.length) {
    text('上一次的牌组还在。开新局会用固定的 10 张起手牌。', cx, py + 50, {
      size: 12, align: 'center', color: C.faint,
    });
  }

  // 版本和许可合成右下角一行。左下原来还有一行"v0.4 · TypeScript + Canvas"——
  // 技术栈对玩家没有意义，对读源码的人 README 里也有。
  text('v0.4 · MIT License', VW - 40, VH - 28, { size: 12, color: C.faint, align: 'right' });
}
