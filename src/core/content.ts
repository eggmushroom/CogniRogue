import { toEff } from './effects';
import type { CardDef, Pack, Question } from './types';

/**
 * 知识包 DSL —— 一个纯文本格式，因为写题库的人不该被迫碰 JSON。
 *
 *   # 包名
 *   ## 主题
 *   ### 一个问题
 *   A) 选项
 *   B) 选项
 *   = B
 *   + 解析
 *   % 攻 挡 [效果]
 *   @ 知识点短名（可省略，省略时从题干里截）
 *   ? 这个知识点的第二道题（可再跟选项/答案，最多 5 道）
 *
 * 一张卡 = 一个知识点 = 一个恒定卡面 + 一个题库。战斗中每次点开只问一道，
 * 本场问过的不再问 —— 同一个知识点被反复问，才谈得上"记住"。
 * 效果可写英文键（pierce）或中文名（洞察），不写就是默认的猛击。
 */
/** 一张卡最多收几道题。超过这个数的会被丢掉，免得一张卡把整局的题都占满。 */
export const MAX_Q = 5;
/**
 * 卡名兜底：没有写 @ 的时候，从题干里截一个短名。
 * 卡面空间只够两行，所以要先把「……是什么？」这类尾巴削掉。
 */
export function autoName(q: string): string {
  let t = q.trim().replace(/[？?。！!]+$/, '');
  t = t.replace(/(是|为|有|用|会|能|应该|需要|属于|包括)$/, '');
  const cut = t.search(/[，,；;：:（(]/);
  if (cut > 3) t = t.slice(0, cut);
  if (t.length > 14) t = t.slice(0, 14);
  return t.trim() || '未命名知识点';
}

export function parsePack(text: string): Pack {
  const pack: Pack = { name: '未命名知识包', cards: [] };
  let topic = '未分类';
  let cur: CardDef | null = null;
  let q: Question | null = null;

  const newQ = (s: string): Question => ({ q: s, options: [], answer: -1, explain: '' });

  const flushQ = () => {
    if (!cur || !q) return;
    if (
      cur.qs.length < MAX_Q &&
      q.options.length >= 2 &&
      q.answer >= 0 &&
      q.answer < q.options.length &&
      // 同题去重：题库里贴两遍同一道题，只会让玩家觉得被耍
      !cur.qs.some((x) => x.q === q!.q)
    ) {
      cur.qs.push(q);
    }
    q = null;
  };

  const flush = () => {
    flushQ();
    if (cur && cur.qs.length) {
      cur.q = cur.qs[0].q;
      if (!cur.name) cur.name = autoName(cur.q);
      cur.id = pack.cards.length + ':' + cur.q.slice(0, 18);
      pack.cards.push(cur);
    }
    cur = null;
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('>')) continue;

    if (line.startsWith('### ')) {
      flush();
      cur = { id: '', topic, name: '', q: '', atk: 6, blk: 5, eff: 'strike', qs: [] };
      q = newQ(line.slice(4).trim());
      continue;
    }
    if (line.startsWith('## ')) { flush(); topic = line.slice(3).trim(); continue; }
    if (line.startsWith('# ')) { flush(); pack.name = line.slice(2).trim(); continue; }
    if (!cur) continue;

    // ? 追加一道题。允许写「? 理解: 」这类前缀，它只是个给写题人看的标签，
    // 读进来时会被剥掉 —— 老知识包不用改。
    if (line.startsWith('? ')) {
      flushQ();
      const m = line.slice(2).match(/^(识记|理解|迁移|回忆|应用|挑战|进阶|变式)\s*[:：]\s*(.+)$/);
      q = newQ(m ? m[2].trim() : line.slice(2).trim());
      continue;
    }

    const om = line.match(/^([A-Za-z])[).、:：]\s*(.+)$/);
    if (om) { (q ??= newQ('')).options.push(om[2].trim()); continue; }

    const am = line.match(/^=\s*([A-Za-z])/);
    if (am) { if (q) q.answer = am[1].toUpperCase().charCodeAt(0) - 65; continue; }

    if (line.startsWith('+ ')) { if (q) q.explain = line.slice(2).trim(); continue; }

    // @ 卡名：写在题干的下一行，或者块内任意一行都行
    if (line.startsWith('@ ')) { cur.name = line.slice(2).trim(); continue; }

    if (line.startsWith('% ')) {
      const n = line.slice(2).trim().split(/\s+/);
      cur.atk = Number(n[0]) || 6;
      cur.blk = Number(n[1]) || 5;
      // 第三列可选：不写就是猛击，写错了也回落到猛击
      if (n[2]) cur.eff = toEff(n[2]);
      continue;
    }
  }
  flush();
  return pack;
}

/** 也吃 JSON，方便脚本生成题库。 */
export function parseAny(text: string): Pack {
  const t = text.trim();
  if (!t.startsWith('{')) return parsePack(t);

  /** 兼容两种 JSON：卡片自带 qs（题库），或只有顶层 q/options/answer。 */
  type JsonCard = Partial<CardDef> & {
    /** 老格式的字段名，照着读，省得别人手上的题库全废掉 */
    tiers?: Question[];
    options?: string[]; answer?: number; explain?: string;
  };
  const j = JSON.parse(t) as { name?: string; cards?: JsonCard[] };
  if (!Array.isArray(j.cards)) throw new Error('JSON 缺少 cards 数组');

  const cards: CardDef[] = j.cards.map((c, i) => {
    const raw = (c.qs && c.qs.length ? c.qs : c.tiers && c.tiers.length ? c.tiers : null)
      ?? [{ q: c.q ?? '', options: c.options ?? [], answer: c.answer ?? 0, explain: c.explain ?? '' }];
    const qs = raw.slice(0, MAX_Q).map((x) => ({
      q: x.q ?? '',
      options: x.options ?? [],
      answer: x.answer ?? 0,
      explain: x.explain ?? '',
    }));
    return {
      id: c.id ?? 'json:' + i,
      topic: c.topic ?? '未分类',
      name: c.name ?? autoName(qs[0].q),
      q: qs[0].q,
      atk: c.atk ?? 6,
      blk: c.blk ?? 5,
      eff: toEff(c.eff),
      qs,
    };
  });

  return { name: j.name ?? '自定义知识包', cards };
}
