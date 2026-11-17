"""
PDF → markdown（开发期工具，不进产物、不进 package.json）。

为什么不是 npm 依赖：仓库的约定是运行时零依赖、devDependencies 只有 vite + typescript。
抽文字只在"把一份新语料接进题库"时跑一次，用 Python 的 pymupdf 最省事：

    python -m pip install pymupdf
    python tools/pdf2md.py data/sources/x.pdf data/sources/x.md

**骨架用 PDF 自带的目录（bookmark），不用字号猜。** 字号猜标题在规范文档上很不稳：
NIST 的一级标题和正文几乎同号，只差粗体，猜出来 80 页只剩 26 个标题，
而目录里有 120 个。目录是作者自己标的，比任何启发式都准。

**但目录只给到页，一个 `## 4.1` 和它的 `### 4.1.1` 常常同页开头。** 按页切会让
同一段文字被两个小节各收一遍，题目就重复。所以这里把目录换算成
「页 + 该页上的 y 坐标」，再让正文块按 y 归位 —— 同页多个标题也能切准。

顺带两件事：跨页重复的短行（页眉页脚、密级、页码）直接丢掉；
正文按块输出，块内换行合成一段 —— PDF 的硬换行不是段落边界。
"""
import re
import sys
from collections import Counter

import pymupdf

FOOTER_MAX = 80


def norm(s):
    return re.sub(r"\s+", " ", s).strip().lower()


def page_blocks(page):
    out = []
    for b in page.get_text("dict")["blocks"]:
        if b.get("type") != 0:
            continue
        text = " ".join(
            "".join(s["text"] for s in line["spans"]).strip() for line in b["lines"]
        )
        text = re.sub(r"\s+", " ", text).strip()
        if text:
            out.append({"text": text, "y": b["bbox"][1]})
    out.sort(key=lambda b: b["y"])
    return out


def drop_furniture(pages):
    need = max(3, len(pages) // 2)
    seen = Counter(b["text"] for ps in pages for b in ps)
    junk = {t for t, c in seen.items() if c >= need and len(t) <= FOOTER_MAX}
    return [[b for b in ps if b["text"] not in junk] for ps in pages]


def locate(toc, pages):
    """目录条目 → (level, title, page, y)。y 为 -1 表示这一页上没找到标题文字。"""
    out = []
    missing = 0
    for lv, title, page in toc:
        y = -1
        want = norm(title)
        if 1 <= page <= len(pages):
            for b in pages[page - 1]:
                have = norm(b["text"])
                # 目录标题可能被 PDF 拆成"AC-2  ACCOUNT MANAGEMENT"，也可能只写了前半段
                if have.startswith(want) or want in have[: len(want) + 24]:
                    y = b["y"]
                    break
        if y < 0:
            missing += 1
        out.append((lv, title, page, y))
    return out, missing


def body_start(marks):
    """跳过封面、作者、法务声明这些前置页：从第一个编号为 1 的一级标题开始。"""
    for i, (lv, title, _page, _y) in enumerate(marks):
        if lv == 1 and re.match(r"^1[.\s]", title):
            return i
    return 0


def to_markdown(marks, pages):
    out = []

    # 按页重排：每页内先放本页的标题（按 y），其余正文按 y 顺序填到相邻标题之间
    stream = []
    heads_by_page = {}
    for lv, title, page, y in marks:
        heads_by_page.setdefault(page, []).append((y, lv, title))
    for hs in heads_by_page.values():
        hs.sort(key=lambda h: h[0])

    for pno in range(1, len(pages) + 1):
        heads = heads_by_page.get(pno, [])
        hi = 0
        used = []  # 已经当标题用掉的块，正文里不能再出现一遍
        for b in pages[pno - 1]:
            while hi < len(heads) and heads[hi][0] >= 0 and heads[hi][0] <= b["y"]:
                _y, lv, title = heads[hi]
                stream.append(("head", lv, title))
                if abs(_y - b["y"]) < 0.5:
                    used.append((b, title))
                hi += 1
            if any(b is u[0] for u in used):
                # 标题块常常把下一句也装进去了：剥掉标题，剩下的还回去
                rest = b["text"]
                for _bb, title in used:
                    if rest.lower().startswith(title.lower()):
                        rest = rest[len(title):].strip()
                        break
                if len(rest) > 20:
                    stream.append(("text", 0, rest))
                continue
            stream.append(("text", 0, b["text"]))
        # 这一页剩下的标题（y 找不到的、或者在本页末尾的）补在页尾
        while hi < len(heads):
            _y, lv, title = heads[hi]
            stream.append(("head", lv, title))
            hi += 1

    for kind, lv, text in stream:
        if kind == "head":
            out.append(f"{'#' * min(lv, 6)} {text}\n")
        else:
            out.append(f"{text}\n")
    return "\n".join(out)


def main():
    if len(sys.argv) < 3:
        print("用法：python tools/pdf2md.py <源.pdf> <输出.md> [--keep-front]", file=sys.stderr)
        return 2
    src, dst = sys.argv[1], sys.argv[2]
    keep_front = "--keep-front" in sys.argv

    doc = pymupdf.open(src)
    pages = drop_furniture([page_blocks(p) for p in doc])
    toc = doc.get_toc(simple=True)
    if not toc:
        print("✗ 这份 PDF 没有目录（bookmark），先人工补一份再跑", file=sys.stderr)
        return 1

    marks, missing = locate(toc, pages)
    if not keep_front:
        marks = marks[body_start(marks):]

    md = to_markdown(marks, pages)
    with open(dst, "w", encoding="utf-8") as f:
        f.write(md)

    heads = sum(1 for ln in md.split("\n") if ln.startswith("#"))
    print(f"{src} → {dst}")
    print(f"  页 {doc.page_count} · 目录 {len(toc)} 条（{missing} 条在这一页找不到文字）"
          f" · 输出标题 {heads} 个 · 正文 {len(md)} 字")
    return 0


if __name__ == "__main__":
    sys.exit(main())
