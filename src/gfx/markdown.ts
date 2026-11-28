import { closesFence, codeFence } from '../core/library/markdown';
import { g, roundRect } from './canvas';
import { C, FONT_NUM, font, withAlpha } from './theme';

type Style = 'text' | 'code' | 'strong' | 'em' | 'link';
type Run = { value: string; style: Style; x: number; w: number };
type Row = { y: number; runs: Run[] };
type Block = { y: number; h: number };
const inline = /(`+)([^`]*?)(?:\1)(?!`)|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|\[([^\]]+)\]\([^\s)]+\)|\\([\\`*_\[\]])/g;
const tokens = /[\u2e80-\u9fff\uff00-\uffef]|[^\s\u2e80-\u9fff\uff00-\uffef]+|\s+/gu;

function styleFont(style: Style, size: number, weight: number) {
  return (style === 'em' ? 'italic ' : '') + font(size, style === 'strong' ? 700 : weight, style === 'code' ? FONT_NUM : undefined);
}

const cache = new Map<string, ReturnType<typeof measureMarkdown>>();

export function layoutMarkdown(source: string, width: number, size: number, weight = 400) {
  const key = JSON.stringify([source, width, size, weight]);
  const cached = cache.get(key);
  if (cached) return cached;
  const layout = measureMarkdown(source, width, size, weight);
  if (cache.size >= 192) cache.delete(cache.keys().next().value!);
  cache.set(key, layout);
  return layout;
}

/** Canvas-only Markdown subset: source is always painted as text, never mounted as HTML. */
function measureMarkdown(source: string, width: number, size: number, weight: number) {
  const lineH = size + 8;
  const rows: Row[] = [];
  const blocks: Block[] = [];
  let y = 0;
  let code: { marker: string; y: number; indent: number } | undefined;
  g.save();
  const addLine = (input: string, indent: number, codeLine = false, base: Style = 'text') => {
    let row: Row = { y, runs: [] };
    let x = indent;
    const limit = codeLine ? width - indent : width;
    const wrap = () => { rows.push(row); y += lineH; row = { y, runs: [] }; x = indent; };
    const push = (value: string, style: Style, w: number) => {
      const last = row.runs.at(-1);
      if (last?.style === style) { last.value += value; last.w += w; }
      else row.runs.push({ value, style, x, w });
      x += w;
    };
    const add = (value: string, style: Style) => {
      g.font = styleFont(style, size, weight);
      for (const word of value.match(tokens) ?? []) {
        if (!codeLine && x === indent && !word.trim()) continue;
        const w = g.measureText(word).width;
        if (x > indent && x + w > limit) { wrap(); if (!codeLine && !word.trim()) continue; }
        if (w <= limit - indent) push(word, style, w);
        else for (const char of word) {
          const cw = g.measureText(char).width;
          if (x > indent && x + cw > limit) wrap();
          push(char, style, cw);
        }
      }
    };
    if (codeLine) add(input.replace(/\t/g, '    '), 'code');
    else {
      let end = 0;
      for (const match of input.matchAll(inline)) {
        add(input.slice(end, match.index), base);
        if (match[1]) add(match[2], 'code');
        else if (match[3] || match[4]) add(match[3] || match[4], 'strong');
        else if (match[5]) add(match[5], 'em');
        else if (match[6]) add(match[6], 'link');
        else add(match[7], base);
        end = match.index! + match[0].length;
      }
      add(input.slice(end), base);
    }
    wrap();
  };

  for (const line of source.trim().split(/\r?\n/)) {
    if (code) {
      if (closesFence(line, code.marker)) {
        blocks.push({ y: code.y, h: y + 6 - code.y });
        code = undefined;
        y += 12;
      } else addLine(line.slice(Math.min(code.indent, line.match(/^ */)![0].length)), 12, true);
      continue;
    }
    const fence = codeFence(line);
    if (fence) { code = { marker: fence[2], y, indent: fence[1].length }; y += 6; continue; }
    if (!line.trim()) { y += 8; continue; }
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    const list = line.match(/^\s*([-+*]|\d+[.)])\s+(.+)$/);
    const quote = line.match(/^>\s?(.*)$/);
    if (heading) addLine(heading[1], 0, false, 'strong');
    else if (list) addLine(`${/^\d/.test(list[1]) ? list[1] : '\u2022'} ${list[2]}`, 8);
    else if (quote) addLine(`\u2502 ${quote[1]}`, 0);
    else addLine(line, 0);
  }
  if (code) { blocks.push({ y: code.y, h: y + 6 - code.y }); y += 6; }
  g.restore();
  return { rows, blocks, width, size, weight, lineH, h: source.trim() ? y : 0 };
}

type MarkdownLayout = ReturnType<typeof layoutMarkdown>;

function drawCodeBackgrounds({ rows, blocks, width }: MarkdownLayout, x: number, y: number, firstRow: number, lastRow: number) {
  const start = rows[firstRow]?.y ?? Infinity;
  const end = rows[lastRow]?.y ?? Infinity;
  for (const block of blocks) {
    const top = firstRow ? Math.max(block.y, start) : block.y;
    const bottom = Math.min(end, block.y + block.h);
    if (bottom <= top) continue;
    roundRect(x, y + top, width, bottom - top, 6);
    g.fillStyle = withAlpha(C.void, 0.54);
    g.fill();
  }
}

function drawRows({ rows, size, weight, lineH }: MarkdownLayout, x: number, y: number, color: string, firstRow: number, lastRow: number) {
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  for (let i = firstRow; i < Math.min(lastRow, rows.length); i++) {
    const row = rows[i]!;
    const cy = y + row.y + lineH / 2;
    for (const run of row.runs) {
      g.font = styleFont(run.style, size, weight);
      g.fillStyle = run.style === 'code' ? C.gold : run.style === 'link' ? C.blue : color;
      g.fillText(run.value, x + run.x, cy);
    }
  }
}

export function drawMarkdown(layout: MarkdownLayout, x: number, y: number, color: string = C.ink, firstRow = 0, lastRow = Infinity) {
  g.save();
  drawCodeBackgrounds(layout, x, y, firstRow, lastRow);
  drawRows(layout, x, y, color, firstRow, lastRow);
  g.restore();
}

/** A folded title shows one text row. Code backgrounds fade with the rest of the stem. */
export function drawMarkdownTitle(layout: MarkdownLayout, x: number, y: number, color: string, reveal: number) {
  g.save();
  if (reveal > 0) {
    const alpha = g.globalAlpha;
    g.globalAlpha = alpha * reveal;
    drawCodeBackgrounds(layout, x, y, 0, Infinity);
    drawRows(layout, x, y, color, 1, Infinity);
    g.globalAlpha = alpha;
  }
  drawRows(layout, x, y, color, 0, 1);
  g.restore();
}
