import { g } from '../gfx/canvas';
import { C, font, FONT_UI, withAlpha } from '../gfx/theme';
import { text } from '../gfx/ui';
import { G, playerFacing } from '../core/infra';

/**
 * 即时反馈条：把 `core` 写进 `G.log` 的记录显示出来。
 *
 * 为什么要这一层：`log()` 是 core 里唯一的"往外说话"通道 ——
 * 封蜡削了几点、遗忘挑中哪个主题、事件选项让你付出多少生命、牌组太薄不能删，
 * 全都只写成一条记录。而在这一层存在之前，`G.log` 一个消费者都没有：
 * 玩家点了「抄下这一页，代价是 15 点生命」，面板关掉、血掉了 15，**什么都没读到**。
 *
 * 和「日志面板」的区别：这里只显示**刚刚发生**的几条，5 秒后自己消失。
 * 战斗记录面板当年被删掉，是因为没人会在一场 4 回合的战斗里翻日志；
 * 但"刚刚发生了什么"必须当场看见，过后再查是另一件事（那是结算页的活）。
 *
 * 位置由调用方给：两张屏的空档不一样（战斗是顶栏与立绘之间，地图是左下角），
 * 与其在这里判断 `G.screen`，不如让知道布局的人自己指定。
 */

const LIFE = 5.2;
const FADE = 0.7;
/**
 * 同时最多两条。三条会顶到地图屏左面板的下沿（面板收在 760），
 * 而两条各折两行时最上面一条停在 790，正好让开。
 * 「刚刚发生了什么」两条就够；再往前的属于战斗回顾，那是结算页的事。
 */
const MAX = 2;

interface Item {
  msg: string;
  kind: string;
  born: number;
}

let items: Item[] = [];
let lastSeq = 0;

/**
 * 收新记录。**按 `seq` 判断而不是数组长度**：`G.log` 满了会 `shift()`，
 * 长度恒定在 60，靠它比对会从第 61 条起再也看不见任何新消息。
 */
function intake(t: number) {
  // 记录被整段清空 = 这一局的会话结束了（开新局 / 回标题）。上一局最后一击的
  // 提示条不该跟到新一局的地图上，所以这里连同屏上的东西一起收掉。
  // 不靠 `clearLog()` 回调，是因为 `core` 不认识界面 —— 反过来让界面读它的结果。
  if (!G.log.length) {
    items = [];
    return;
  }
  for (const l of G.log) {
    if (l.seq <= lastSeq) continue;
    // 序号一律推进：这一帧就算挤掉不显示，下一帧也不能把它当成新消息再收一次。
    lastSeq = l.seq;
    // 分节标题不进来：它讲"这一段是什么"，讲不了"刚才发生了什么"。
    if (!playerFacing(l)) continue;
    items.push({ msg: l.msg, kind: l.kind, born: t });
  }
  // 一记结算可能连着写三四条（回血 + 击杀 + 掉落）：留最新的，旧的直接丢。
  if (items.length > MAX) items = items.slice(-MAX);
  items = items.filter((it) => t - it.born < LIFE);
}

export interface FeedAnchor {
  x: number;
  y: number;
  w: number;
  align?: 'left' | 'center';
  /** 每条之间隔多少像素；多行消息会自己往下长。 */
  gap?: number;
}

/**
 * 画提示条。`y` 是**最后一条**的基线，往上堆 —— 这样新的一条永远在最下面，
 * 视线不用跟着跳。
 */
export function drawFeed(t: number, at: FeedAnchor) {
  intake(t);
  if (!items.length) return;

  // 行距与条间距压得比较紧：地图屏左面板收在 760，两条各折两行时
  // 最上面那条的字顶必须停在它下面（792），否则文字会压在面板底边上。
  const gap = at.gap ?? 10;
  const lineH = 17;
  const align = at.align ?? 'left';
  const x = at.x;
  let y = at.y;

  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    const age = t - it.born;
    const a = age > LIFE - FADE ? Math.max(0, (LIFE - age) / FADE) : 1;
    if (a <= 0) continue;

    const col = it.kind === 'bad' ? C.red : it.kind === 'hi' ? C.gold : C.dim;
    // 竖条跟着颜色走：它比文字更早被余光看见，一句话扫过去能分出好坏。
    g.save();
    g.globalAlpha = a;
    g.font = font(13, 600, FONT_UI);
    const lines = measure(it.msg, at.w);
    const h = lines.length * lineH;
    const top = y - (lines.length - 1) * lineH;
    g.fillStyle = withAlpha(col, 0.75);
    g.fillRect(align === 'center' ? x - at.w / 2 : x, top - 12, 2, h - 3);
    const tx = align === 'center' ? x : x + 11;
    for (let n = 0; n < lines.length; n++) {
      // 折行由 `measure()` 自己做，交给 `text` 的 maxW 会再折一次，两种断法叠起来
      // 会出现"第一行提前断、第二行又开始断"的空洞。
      text(lines[n], tx, top + n * lineH, {
        size: 13, color: col, weight: 600, align,
      });
    }
    g.restore();
    y = top - lineH - gap;
  }
}

/** 不能出现在行首的标点：中文排版的基本规矩，否则「（已精炼）」会被断成两截。 */
const NO_LINE_START = '，。、；：！？）」』】…%';

/** 按 13px 的字宽折行；`wrap` 是绘制器，这里只要行数，所以单独量一次。 */
function measure(s: string, maxW: number): string[] {
  g.font = font(13, 600, FONT_UI);
  const out: string[] = [];
  let cur = '';
  for (const ch of s) {
    const over = g.measureText(cur + ch).width > maxW - 11;
    // 断在标点前会把标点甩到下一行开头，所以那个字符允许悬挂出去 ——
    // 提示条是宽度有限的窄条，宁可撑出去两像素，也不要一行只放一个逗号。
    if (over && cur && !NO_LINE_START.includes(ch)) {
      out.push(cur);
      cur = ch;
    } else {
      cur += ch;
    }
  }
  if (cur) out.push(cur);
  return out;
}
