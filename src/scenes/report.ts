import { g, roundRect, VH, VW } from '../gfx/canvas';
import { C, font, FONT_TITLE, FONT_UI, withAlpha } from '../gfx/theme';
import { action, bar, panel, text, wrap } from '../gfx/ui';
import { BAL, MODES, POWER_BY_ID } from '../core/model';
import { backToTitle, restart } from '../core/journey';
import type { ReportData } from '../core/model';

export function drawReport(d: ReportData) {
  g.fillStyle = 'rgba(3,4,8,.86)';
  g.fillRect(0, 0, VW, VH);

  const w = 1360;
  const h = 772;
  const x = (VW - w) / 2;
  const y = 64;

  panel(x, y, w, h, { r: 18, fill: 'rgba(12,15,22,.98)', stroke: withAlpha(d.win ? C.gold : C.line, 0.55) });

  const accent = d.win ? C.gold : C.red;
  text(d.win ? '你走到了档案馆的尽头' : `这次倒在了第 ${d.floor} 层`, x + 48, y + 68, {
    size: 34, weight: 700, family: FONT_TITLE, color: accent,
  });
  text('知识等级不会掉。下一局开局前重新选模式，按模式抽牌。', x + 48, y + 106, {
    size: 14, color: C.dim,
  });

  const total = d.runOk + d.runBad;
  const stats: Array<[string, string]> = [
    [MODES[d.mode].name, '本局模式'],
    [`${d.runOk}/${total}`, '本局答题'],
    [`${total ? Math.round((d.runOk / total) * 100) : 0}%`, '正确率'],
    [`${d.floors}`, '走过节点'],
    [`${d.deckSize}`, '牌组张数'],
    [`${Math.round(d.mastery * 100)}%`, '卡牌掌握度'],
  ];
  const sw = (w - 96) / stats.length;
  stats.forEach(([v, k], i) => {
    const sx = x + 48 + i * sw;
    text(v, sx, y + 162, { size: 34, weight: 800, color: C.ink });
    text(k, sx, y + 192, { size: 12, color: C.dim });
  });

  // 牌组里的增益牌。它们是构筑的一部分，所以和牌组张数摆在同一个高度
  let rx = x + 48;
  for (const name of d.powers) {
    const p = Object.values(POWER_BY_ID).find((q) => q.name === name);
    const col = p ? p.color : C.gold;
    const label = `◆ ${name}`;
    g.font = font(13, 600, FONT_UI);
    const cw = g.measureText(label).width + 26;
    roundRect(rx, y + 212, cw, 28, 14);
    g.fillStyle = withAlpha(col, 0.12);
    g.fill();
    g.strokeStyle = withAlpha(col, 0.4);
    g.lineWidth = 1;
    g.stroke();
    text(label, rx + cw / 2, y + 226, { size: 13, color: col, align: 'center', weight: 600 });
    rx += cw + 10;
  }

  // 左：主题掌握
  const ly = y + 282;
  text('主题掌握', x + 48, ly, { size: 15, weight: 700, color: C.ink2 });
  d.rows.slice(0, 8).forEach((r, i) => {
    const ry = ly + 40 + i * 34;
    text(r.t, x + 48, ry, { size: 14, color: C.ink, maxW: 180 });
    text(`${r.ok} 对 / ${r.bad} 错`, x + 238, ry, { size: 12, color: C.dim });
    bar(x + 340, ry - 8, 170, 14, r.mast, C.gold);
    text(`${Math.round(r.mast * 100)}%`, x + 522, ry, { size: 13, color: C.gold, weight: 700 });
  });

  // 右：这一局的输出是怎么来的 —— 押注机制拿掉之后，这里换成"答题还是免答"
  const cx = x + 636;
  const total2 = d.runOk + d.runBad;
  const acc = total2 ? Math.round((d.runOk / total2) * 100) : 0;
  text('这一局怎么打的', cx, ly, { size: 15, weight: 700, color: C.ink2 });
  const tail: Array<[string, string, string]> = [
    ['答题出牌', `${total2} 次`, `正确 ${acc}%`],
    ['免答出牌', `${d.frees} 次`, `伤害 ×${BAL.freeMult}`],
    ['解锁卡种', `${d.unlocks} 种`, '答对一次解锁一种'],
    // 答错的价码现在由本局模式决定，不再是"学习期 / 复习期"两档
    ['答错的牌', `${d.runBad} 次`, MODES[d.mode].cardLabel],
    ['牌组', `${d.deckSize} 张`, `${d.kinds} 种卡`],
  ];
  tail.forEach(([k, v, s], i) => {
    const yy = ly + 40 + i * 38;
    if (i % 2 === 0) {
      roundRect(cx - 8, yy - 17, 470, 34, 6);
      g.fillStyle = 'rgba(255,255,255,.028)';
      g.fill();
    }
    text(k, cx, yy, { size: 14, color: C.ink2 });
    text(v, cx + 140, yy, {
      size: 15, weight: 800,
      color: i === 1 && d.frees > 0 ? C.gold : C.ink,
    });
    text(s, cx + 250, yy, { size: 12, color: C.dim });
  });

  // 结论
  const vy = y + 626;
  roundRect(x + 48, vy, w - 96, 100, 12);
  g.fillStyle = withAlpha(C.purple, 0.08);
  g.fill();
  g.strokeStyle = withAlpha(C.purple, 0.3);
  g.lineWidth = 1;
  g.stroke();
  g.font = font(15, 400, FONT_UI);
  g.fillStyle = C.ink2;
  g.textAlign = 'left';
  wrap(d.verdict, w - 140, 24, x + 72, vy + 30, 3);

  action(x + w - 400, y + h - 74, 170, 52, '再来一局', () => restart(), 'primary');
  action(x + w - 216, y + h - 74, 170, 52, '回到首页', () => backToTitle());
}

void VH;
