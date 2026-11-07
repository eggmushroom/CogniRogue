import { g, VH, VW } from '../gfx/canvas';
import { C, FONT_TITLE, withAlpha } from '../gfx/theme';
import { action, text } from '../gfx/ui';
import { drawBackdrop, drawMotes } from '../gfx/backdrop';
import { G } from '../core/infra';
import { BANK, bankQuestionCount, PACK, topics } from '../core/library';
import { startRun } from '../core/journey';

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
  text('每张牌有自己的名字和效果 · 题不印在卡面上 · 点开才出题', cx, 372, {
    size: 15, align: 'center', color: C.dim,
  });

  const bw = 330;
  const bx = cx - bw / 2;
  let by = 452;
  const gap = 76;

  action(bx, by, bw, 60, '开始新的一局', () => startRun(), 'primary', { size: 22 });
  by += gap;
  action(bx, by, bw, 56, '这游戏怎么玩', openHelp);
  by += 70;
  action(bx, by, bw, 56, '载入自己的题库', openPack);

  // 卡池是内置的、题库是可换的，两行分开写才不会让人以为导入会换牌
  const py = 760;
  text(BANK.name, cx, py, { size: 16, align: 'center', color: C.gold, weight: 700 });
  text(
    `内置 ${PACK.cards.length} 张卡 · ${topics().length} 个主题 · 题库 ${bankQuestionCount()} 道题　|　进度自动存在本地`,
    cx, py + 26, { size: 13, align: 'center', color: C.dim },
  );

  if (G.deck.length) {
    text('上一次的牌组还在。开新局会重新按到期顺序抽牌。', cx, py + 50, {
      size: 12, align: 'center', color: C.faint,
    });
  }

  text('v0.2 · TypeScript + Canvas', 40, VH - 28, { size: 12, color: C.faint });
  text('MIT License', VW - 40, VH - 28, { size: 12, color: C.faint, align: 'right' });
}
