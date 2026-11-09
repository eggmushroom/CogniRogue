import { g, roundRect, VH, VW } from '../gfx/canvas';
import { C, FONT_UI, withAlpha } from '../gfx/theme';
import { panel, text, icon } from '../gfx/ui';
import { EFFS } from '../core/model';
import { drawArtIcon, type ArtIconName } from '../gfx/art/icons';

/**
 * scenes/atlas —— 素材图集（开发用，?dev=atlas）。
 *
 * 自建素材库的质检台：所有图标按"实际使用的颜色 + 大小两档"铺在一屏里，
 * 改任何一枚 path 立刻能看到全局协调度。新素材先来这里过目，再上卡面。
 */
export function drawAtlas(_t: number) {
  g.fillStyle = C.void;
  g.fillRect(0, 0, VW, VH);

  text('素材图集', 64, 78, { size: 34, weight: 700, family: FONT_UI, color: C.ink });
  text('自建矢量图标 · 24×24 · 颜色全部来自 theme.ts', 64, 108, { size: 15, color: C.dim });
  text('ESC 返回标题', VW - 64, 78, { size: 14, color: C.faint, align: 'right' });

  /* ── 效果原型：八枚 ───────────────────────────────────── */
  const defs: { name: ArtIconName; label: string; color: string; note: string }[] = [
    { name: 'strike', label: '猛击', color: EFFS.strike.color, note: '打击 / 攻击' },
    { name: 'pierce', label: '洞察', color: EFFS.pierce.color, note: '无视格挡' },
    { name: 'guard', label: '巩固', color: EFFS.guard.color, note: '格挡' },
    { name: 'drain', label: '内化', color: EFFS.drain.color, note: '伤害转回血' },
    { name: 'chain', label: '串联', color: EFFS.chain.color, note: '多段伤害' },
    { name: 'focus', label: '专注', color: EFFS.focus.color, note: '抽牌' },
    { name: 'power', label: '增益', color: C.gold, note: '打出后常驻' },
    { name: 'junk', label: '杂念', color: C.faint, note: '无法打出' },
  ];

  const cw = 348;
  const ch = 200;
  const gx = 64;
  const gy = 140;
  defs.forEach((d, i) => {
    const col = i % 4;
    const row = (i / 4) | 0;
    const x = gx + col * (cw + 18);
    const y = gy + row * (ch + 18);

    panel(x, y, cw, ch, { r: 12 });
    drawArtIcon(d.name, x + 84, y + 88, 96, d.color);
    // 手牌尺寸（约 27px）同一枚：缩小后还能认出来才算过关
    drawArtIcon(d.name, x + 84, y + 168, 28, d.color, { alpha: 0.9 });

    text(d.label, x + 160, y + 62, { size: 24, weight: 700, color: C.ink });
    text(d.note, x + 160, y + 90, { size: 14, color: C.dim });
    // 色票：标注这枚图标在卡面上用的就是效果色本身
    roundRect(x + 160, y + 110, 46, 16, 8);
    g.fillStyle = withAlpha(d.color, 0.85);
    g.fill();
    text(d.color, x + 216, y + 123, { size: 12, color: C.dim, family: FONT_UI });
    text('96px / 28px 双档校验', x + 160, y + 160, { size: 12, color: C.faint });
  });

  /* ── UI 基础图标（ui.ts 手画线条）─────────────────────── */
  const uy = gy + 2 * (ch + 18) + 10;
  text('UI 基础图标', gx, uy, { size: 16, weight: 700, color: C.ink2 });
  const names = [
    'attack', 'shield', 'junk', 'buff', 'check',
    'heart', 'flame', 'cards', 'discard', 'turn', 'floor',
  ] as const;
  names.forEach((n, i) => {
    const x = gx + 128 + i * 112;
    icon(n, x, uy + 40, 22, C.ink2);
    icon(n, x + 44, uy + 40, 13, C.dim);
    text(n, x + 22, uy + 84, { size: 12, color: C.faint, align: 'center' });
  });

  /* ── 主题调色板 ───────────────────────────────────────── */
  const py = uy + 116;
  text('调色板', gx, py, { size: 16, weight: 700, color: C.ink2 });
  const palette: [string, string][] = [
    [C.gold, 'gold'], [C.red, 'red'], [C.blue, 'blue'], [C.purple, 'purple'],
    [C.cyan, 'cyan'], [C.orange, 'orange'], [C.green, 'green'], ['#ef8bb0', 'pink'],
  ];
  palette.forEach(([c, n], i) => {
    const x = gx + 100 + i * 150;
    roundRect(x, py + 18, 34, 34, 9);
    g.fillStyle = c;
    g.fill();
    text(n, x + 17, py + 72, { size: 12, color: C.dim, align: 'center' });
  });
}
