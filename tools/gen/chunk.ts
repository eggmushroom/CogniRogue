/**
 * 源文档 → 结构块。这是「按目录切分」的第一优先级，也是唯一切分策略。
 *
 * 为什么不切定长窗口：一份有目录的书，作者已经把「这一段在讲什么」写在标题里了。
 * 按标题切，切点就是他划的语义边界；按 512 字切，切点跟内容无关，
 * 一道「比较 A 和 B」的题所需的两个小节会被劈到两个窗口里，谁也答不全。
 *
 * 第二优先级才是按段落：**只在段落边界下刀**，同一节太长时按空行分组贪心装箱，
 * 绝不从句子中间截断。代码块（``` / ~~~）里的 `#` 不是标题，必须整块保留。
 *
 * 这一层是纯函数、无网络、无随机：同样的输入永远得到同样的块，
 * 所以切点可以写成断言（见 `tools/gen/selftest.ts`）。
 *
 * 注意 `##` 在**源文档**里是章，在 `packs/*.md`（生成物）里是题池 ——
 * 两种文件走两条路，只有前者进这里。
 */

/** 一个可以直接喂给模型的结构块。 */
export interface Chunk {
  /** 目录路径，例如 ['第三章 图算法', '3.1 最短路']。**这是检索的键**。 */
  path: string[];
  /** 这一块自己的正文（不含子节）。 */
  text: string;
  /** 同一路径被预算切开时的序号，从 0 开始。 */
  part: number;
  /** 字符数。中文大致 1 字 1 token，所以它也是预算的粗略估计。 */
  size: number;
}

/** 目录条目：给 agent 看的「这本书有什么」，它按 path 逐块取。 */
export interface TocEntry {
  path: string[];
  /** 这一节及其所有子节的字符数。 */
  size: number;
  /** 这一节自己被切成了几块。 */
  parts: number;
  /** 这一节开头第一句正文，用来判断「这块值不值得读」。 */
  head: string;
}

export interface Doc {
  chunks: Chunk[];
  toc: TocEntry[];
  /** 原文一级标题，没有就空串。 */
  title: string;
}

/** 默认预算：6000 字。一次生成喂一节，留出记忆与指令的空间。 */
export const DEFAULT_BUDGET = 6000;

interface RawSection {
  path: string[];
  lines: string[];
  children: RawSection[];
}

const isFence = (line: string) => /^\s*(```|~~~)/.test(line);
const headingOf = (line: string) => {
  const m = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
  return m ? { level: m[1].length, text: m[2] } : null;
};

/** 一行在切分眼里的身份。代码块里的 `#` 只是正文，**唯一**的判定在这儿。 */
interface Tok {
  line: number;
  text: string;
  kind: 'blank' | 'heading' | 'text';
  level: number;
}

function scan(md: string): Tok[] {
  const out: Tok[] = [];
  let fence: string | null = null;
  md.split(/\r?\n/).forEach((raw, line) => {
    if (/^<!--\s*cognirogue-page:\s*\d+\s*-->$/.test(raw.trim())) {
      out.push({ line, text: '', kind: 'blank', level: 0 });
      return;
    }
    if (isFence(raw)) {
      const mark = raw.trim().slice(0, 3);
      if (!fence) fence = mark;
      else if (mark === fence) fence = null;
      out.push({ line, text: raw, kind: 'text', level: 0 });
      return;
    }
    if (fence) {
      out.push({ line, text: raw, kind: 'text', level: 0 });
      return;
    }
    const h = headingOf(raw);
    if (h) {
      out.push({ line, text: raw, kind: 'heading', level: h.level });
      return;
    }
    out.push({ line, text: raw, kind: raw.trim() ? 'text' : 'blank', level: 0 });
  });
  return out;
}

/** 文档里的标题，按出现顺序。切分、取数、分层都从这一份扫描出发。 */
export function headingsOf(md: string): Array<{ level: number; text: string; line: number }> {
  return scan(md)
    .filter((t) => t.kind === 'heading')
    .map((t) => ({ level: t.level, text: headingOf(t.text)?.text ?? t.text, line: t.line }));
}

/**
 * 段落：按空行分组，**代码块不拆**，标题单独成段。
 *
 * 段落是「默认划分」和「模型划分」的最小单位：切点只能落在段落之间，
 * 这样两种划分都不会把一句话、一个代码块劈成两半。
 */
export interface Para {
  from: number;
  to: number;
  text: string;
  chars: number;
}

export function paragraphsOf(md: string): Para[] {
  const out: Para[] = [];
  let cur: string[] = [];
  let from = 0;
  const flush = (end: number) => {
    const text = cur.join('\n').trim();
    if (text) out.push({ from, to: end, text, chars: text.length });
    cur = [];
  };
  let lastLine = 0;
  for (const t of scan(md)) {
    lastLine = t.line + 1;
    if (t.kind === 'blank') { flush(t.line); from = t.line + 1; continue; }
    if (t.kind === 'heading' && cur.length) { flush(t.line); from = t.line; }
    if (!cur.length) from = t.line;
    cur.push(t.text);
  }
  flush(lastLine);
  return out;
}

/**
 * 解析成标题树。**唯一**的解析实现：切分和按路径取数都从这里出发，
 * 免得两份解析器对「代码块里的 # 算不算标题」给出不同答案。
 */
function parseTree(md: string): { root: RawSection; title: string } {
  const root: RawSection = { path: [], lines: [], children: [] };
  const stack: RawSection[] = [root];
  let title = '';

  for (const t of scan(md)) {
    if (t.kind !== 'heading') {
      stack[stack.length - 1].lines.push(t.text);
      continue;
    }
    const h = headingOf(t.text);
    if (!h) {
      stack[stack.length - 1].lines.push(t.text);
      continue;
    }
    if (h.level === 1 && !title) title = h.text;
    while (stack.length > 1 && stack[stack.length - 1].path.length >= h.level) stack.pop();
    const parent = stack[stack.length - 1];
    const sec: RawSection = { path: [...parent.path, h.text], lines: [], children: [] };
    parent.children.push(sec);
    stack.push(sec);
  }
  return { root, title };
}

/**
 * 按段落切成不超过 `budget` 的若干段；单段超预算时再按行切，仍然不切断一行。
 *
 * 对外也导出：生成一侧要的是「这一章（含子节）的全文按预算切好」，
 * 而 `chunks` 里的块是**本节自己**的正文 —— 一本书的章常常只有标题，
 * 正文全在子节里，只取本节块会拿到空字符串。
 */
export function splitText(text: string, budget: number): string[] {
  const blocks = text.split(/\n[ \t]*\n/).map((b) => b.trim()).filter(Boolean);
  const packed: string[] = [];
  let cur = '';
  for (const b of blocks) {
    if (!cur) { cur = b; continue; }
    if (cur.length + b.length + 2 <= budget) { cur += '\n\n' + b; continue; }
    packed.push(cur);
    cur = b;
  }
  if (cur) packed.push(cur);

  // 单段就超预算（一整段没有空行）：只能按行装，仍然不切断任何一行。
  const out: string[] = [];
  for (const p of packed) {
    if (p.length <= budget) { out.push(p); continue; }
    let buf = '';
    for (const ln of p.split('\n')) {
      if (buf && buf.length + ln.length + 1 > budget) { out.push(buf); buf = ln; }
      else buf = buf ? buf + '\n' + ln : ln;
    }
    if (buf) out.push(buf);
  }
  return out;
}

/** 把一节连同子节拼成完整正文，用于「让我看整章」。 */
function fullText(s: RawSection): string {
  const head = s.path.length ? '#'.repeat(s.path.length) + ' ' + s.path[s.path.length - 1] + '\n' : '';
  let out = head + s.lines.join('\n');
  for (const c of s.children) out += '\n\n' + fullText(c);
  return out.trim();
}

/**
 * 切分。`budget` 是单块的字符上限；超了就按段落装箱，
 * 而不是把内容截掉 —— 截掉的那部分永远不会被生成到。
 */
export function chunkMarkdown(md: string, budget: number = DEFAULT_BUDGET): Doc {
  const { root, title } = parseTree(md);
  const chunks: Chunk[] = [];
  const toc: TocEntry[] = [];

  const emit = (path: string[], body: string) => {
    const parts = body.trim() ? splitText(body, budget) : [];
    parts.forEach((text, i) => chunks.push({ path, text, part: i, size: text.length }));
    return parts.length;
  };

  // 第一个标题之前的正文（前言、说明）也算内容：丢掉它等于静默少读一段。
  // 它没有路径可取，所以只进 chunks，不进目录。
  emit([], root.lines.join('\n'));

  const walk = (s: RawSection) => {
    const body = s.lines.join('\n');
    const parts = emit(s.path, body);
    toc.push({
      path: s.path,
      size: fullText(s).length,
      parts,
      head: (body.split('\n').find((l) => l.trim()) ?? '').trim().slice(0, 80),
    });
    s.children.forEach(walk);
  };
  root.children.forEach(walk);

  return { chunks, toc, title };
}

/** 按路径取一节（含子节）的完整正文；给 JIT 取数用。 */
export function readSection(md: string, path: string[]): string | null {
  if (!path.length) return null;
  const key = path.join('\u0000');
  const seek = (list: RawSection[]): RawSection | null => {
    for (const s of list) {
      if (s.path.join('\u0000') === key) return s;
      const deep = seek(s.children);
      if (deep) return deep;
    }
    return null;
  };
  const hit = seek(parseTree(md).root.children);
  return hit ? fullText(hit) : null;
}

/** 目录渲染成 agent 能读的一段文字：路径 + 规模 + 首句。 */
export function tocText(doc: Doc): string {
  return doc.toc
    .map((e) => `${'  '.repeat(e.path.length - 1)}${e.path[e.path.length - 1]} · ${e.size} 字${e.parts > 1 ? ` · ${e.parts} 块` : ''} · ${e.head}`)
    .join('\n');
}

/** 一段行号区间：计划、切分、取数都用它描述"这一节是哪几行"。 */
export interface Block {
  /** 起始行（含）。 */
  from: number;
  /** 结束行（不含）。 */
  to: number;
  /** 这一节的名字：有标题用标题，没有就用开头几个字。 */
  title: string;
  chars: number;
}

/** 按行号取原文。计划里的区间都经过这里，别处不许自己 split。 */
export function sliceLines(md: string, from: number, to: number): string {
  return md.split(/\r?\n/).slice(Math.max(0, from), Math.max(0, to)).join('\n');
}

/** 没有标题可用时，拿正文开头当名字：一条空标题比没有更糟。 */
function titleFromText(text: string): string {
  const flat = text
    .split('\n')
    .map((l) => l.replace(/^[#>\-*\s]+/, '').trim())
    .find((l) => l && !l.startsWith('```'));
  return (flat ?? '未命名').slice(0, 18);
}

/**
 * 默认划分：段落装箱到 `size` 字左右。
 *
 * 这里 `size` 是**目标**而不是硬上限：单段就超过 size 时它自成一节，
 * 绝不在段落中间下刀 —— 切一半的段落喂给模型，等于让它对着半句话出题。
 * 真要在超长节里再切，是生成一侧按 `splitText` 分块的事，不属于划分。
 */
export function blocksOf(md: string, size: number): Block[] {
  const paras = paragraphsOf(md);
  const heads = headingsOf(md);
  const out: Block[] = [];
  let cur: Para[] = [];
  let chars = 0;

  const flush = () => {
    if (!cur.length) return;
    const from = cur[0].from;
    const to = cur[cur.length - 1].to;
    const head = heads.find((h) => h.line >= from && h.line < to);
    out.push({ from, to, title: head?.text ?? titleFromText(cur[0].text), chars });
    cur = [];
    chars = 0;
  };

  for (const p of paras) {
    // 标题另起一节：章节边界不该被装箱算法抹平；其余段落攒到目标大小再收
    const isHead = p.text.startsWith('#');
    if (cur.length && (isHead || chars + p.chars > size)) flush();
    cur.push(p);
    chars += p.chars;
  }
  flush();
  return out;
}
