import { g, roundRect } from '../gfx/canvas';
import { C, font, FONT_UI, withAlpha } from '../gfx/theme';
import type { EditField } from '../core/model';

/**
 * 画布里的单行输入框。整个项目只有这一处实现 —— 设置页靠它填接口地址、模型名和密钥。
 *
 * 为什么不用 `<input>`：界面是手写 Canvas，浮层位置、配色、命中矩形都由场景算，
 * 缩放也交给 contain 缩放。塞一个 DOM 输入框进来，焦点、遮挡、坐标换算要另写一套，
 * 还会和 canvas 的点击热区互相打架。代价是中文输入法用不了 —— 而这三个字段里
 * 只该出现 ASCII（URL、模型名、key），可以接受。
 */
export type Field = EditField;

export const fieldOf = (value = ''): Field => ({ value, caret: value.length });

/** 密钥遮起来，只留最后四位：输入时要能核对末位，平时不该整串亮在屏幕上。 */
export function maskOf(s: string): string {
  if (s.length <= 4) return '•'.repeat(s.length);
  return '•'.repeat(Math.min(20, s.length - 4)) + s.slice(-4);
}

export function drawField(
  x: number, y: number, w: number, h: number, f: Field,
  opts: { focused: boolean; masked?: boolean; placeholder?: string; caretOn?: boolean },
) {
  roundRect(x, y, w, h, 8);
  g.fillStyle = opts.focused ? 'rgba(255,255,255,.07)' : 'rgba(255,255,255,.03)';
  g.fill();
  g.strokeStyle = opts.focused ? withAlpha(C.gold, .85) : C.line;
  g.lineWidth = 1.3;
  g.stroke();

  const shown = opts.masked ? maskOf(f.value) : f.value;
  const pad = 12;
  const avail = w - pad * 2;
  const caretAt = opts.masked ? shown.length : f.caret;

  g.save();
  g.font = font(15, 500, FONT_UI);
  g.textAlign = 'left';
  if (shown) {
    // 长了就往左滚：光标始终在框里，而不是让玩家猜自己打到哪儿了
    const before = g.measureText(shown.slice(0, caretAt)).width;
    const shift = Math.max(0, before - avail);
    g.fillStyle = C.ink;
    g.fillText(shown, x + pad - shift, y + h / 2 + 5);
    g.restore();
    if (opts.focused && opts.caretOn !== false) {
      g.save();
      g.fillStyle = C.gold;
      g.fillRect(x + pad + before - shift, y + h / 2 - 9, 1.6, 18);
      g.restore();
    }
    return;
  }
  g.fillStyle = C.faint;
  g.fillText(opts.placeholder ?? '', x + pad, y + h / 2 + 5);
  g.restore();
  if (opts.focused && opts.caretOn !== false) {
    g.save();
    g.fillStyle = C.gold;
    g.fillRect(x + pad, y + h / 2 - 9, 1.6, 18);
    g.restore();
  }
}

/** 一个按键是不是"该交给人手"的编辑键（用来判断要不要吃掉它）。 */
import type { KeyIn } from '../input';
export type { KeyIn };

function insert(f: Field, s: string, max: number) {
  const room = max - f.value.length;
  if (room <= 0) return;
  const add = s.slice(0, room);
  f.value = f.value.slice(0, f.caret) + add + f.value.slice(f.caret);
  f.caret += add.length;
}

/**
 * 把按键落到字段上。返回 true 表示这一下归输入框（调用方别再把 `escape` / `confirm`
 * 当快捷键）。Tab / Enter / Escape 故意不吃 —— 那是"走 / 收 / 换一行"的动作，
 * 由调用方决定，输入框不替它做主。
 */
export function editField(f: Field, k: KeyIn, max: number): boolean {
  if (k.ctrl) return false;
  const { key } = k;
  if (key.length === 1) { insert(f, key, max); return true; }
  if (key === 'Backspace') {
    if (f.caret > 0) {
      f.value = f.value.slice(0, f.caret - 1) + f.value.slice(f.caret);
      f.caret--;
    }
    return true;
  }
  if (key === 'Delete') {
    if (f.caret < f.value.length) f.value = f.value.slice(0, f.caret) + f.value.slice(f.caret + 1);
    return true;
  }
  if (key === 'ArrowLeft') { f.caret = Math.max(0, f.caret - 1); return true; }
  if (key === 'ArrowRight') { f.caret = Math.min(f.value.length, f.caret + 1); return true; }
  if (key === 'Home') { f.caret = 0; return true; }
  if (key === 'End') { f.caret = f.value.length; return true; }
  return false;
}

/** Ctrl+V。剪贴板可能是一整段带换行的配置，压成一行再塞进去。 */
export async function pasteInto(f: Field, max: number) {
  try {
    const s = (await navigator.clipboard.readText()).replace(/[\r\n\t]+/g, ' ').trim();
    if (s) insert(f, s, max);
  } catch {
    // 没有剪贴板权限就当没按：玩家还能手打，弹一句错话只会添乱
  }
}
