"""
PDF → Markdown（题库导入、开发期语料提取共用）。

为什么不是 npm 依赖：仓库的约定是运行时零依赖、devDependencies 只有 vite + typescript。
使用 Python 的 PyMuPDF 提取文字层。图片区不做 OCR：

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
import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

import pymupdf

FOOTER_MAX = 80
TEXT_FLAGS = pymupdf.TEXTFLAGS_DICT & ~pymupdf.TEXT_PRESERVE_IMAGES


class PdfImportError(ValueError):
    """可向用户显示的 PDF 输入错误。"""


def page_blocks(page):
    out = []
    for b in page.get_text("dict", flags=TEXT_FLAGS)["blocks"]:
        if b.get("type") != 0:
            continue
        lines = [re.sub(r"\s+", " ", "".join(s["text"] for s in line["spans"])).strip()
                 for line in b["lines"]]
        lines = [line for line in lines if line]
        if lines:
            out.append({"text": " ".join(lines), "lines": lines, "y": b["bbox"][1], "bottom": b["bbox"][3]})
    out.sort(key=lambda b: b["y"])
    return out


def edge(block, height):
    return block["bottom"] <= height * .12 or block["y"] >= height * .88


def drop_furniture(pages, heights):
    need = max(3, len(pages) // 2)
    seen = Counter(text for blocks, height in zip(pages, heights)
                   for text in {b["text"] for b in blocks if edge(b, height) and len(b["text"]) <= FOOTER_MAX})
    return [[b for b in blocks if not (edge(b, height) and seen[b["text"]] >= need)]
            for blocks, height in zip(pages, heights)]


def readable(text):
    # 字体没有有效 Unicode 映射时，提取器可能只吐出替换符或私用区字符。
    chars = sum(ch.isalnum() for ch in text)
    return chars > sum(ch == "\ufffd" or "\ue000" <= ch <= "\uf8ff" for ch in text)


def page_kind(page, blocks, height):
    text = [b for b in blocks if readable(b["text"])]
    if text and any(not edge(b, height) for b in text):
        return "text"
    if sum(len(b["text"]) for b in text) > 40:
        return "text"
    # 只用绘制范围判断，不解码图片。整页图加短页眉仍可能是扫描件。
    painted = [(kind, pymupdf.Rect(rect)) for kind, rect in page.get_bboxlog() if kind != "ignore-text"]
    bounds = page.rect * page.derotation_matrix
    images = [rect & bounds for kind, rect in painted if kind == "fill-image"]
    images = [rect for rect in images if not rect.is_empty]
    if images and (not text or max(rect.get_area() for rect in images) >= .5 * bounds.get_area()):
        return "image"
    if text:
        return "text"
    return "unreadable" if blocks or painted else "blank"


def title_remainder(line, title):
    # 目录和正文的标题可能只有一边带编号。
    prefix = r"^\d+(?:\.\d+)*(?:\.\s*|\s+)"
    text = re.sub(prefix, "", line)
    wanted = re.sub(prefix, "", title)
    if wanted and text.casefold().startswith(wanted.casefold()):
        rest = text[len(wanted):]
        if not rest or not rest[0].isalnum():
            return rest.lstrip(" :：")
    return None


def locate(toc, pages):
    """目录条目 → (level, title, page, y)。y 为 -1 表示这一页上没找到标题文字。"""
    out = []
    for lv, title, page in toc:
        y = -1
        if 1 <= page <= len(pages):
            for b in pages[page - 1]:
                if title_remainder(b["lines"][0], title) is not None:
                    y = b["y"]
                    break
        out.append((lv, title, page, y))
    return out


def body_start(marks):
    """跳过封面、作者、法务声明这些前置页：从第一个编号为 1 的一级标题开始。"""
    for i, (lv, title, _page, _y) in enumerate(marks):
        if lv <= 2 and re.match(r"^1[.\s]", title):
            return i
    return 0


def printed_toc(pages):
    """读取前置页上的印刷目录；不少 PDF 有可见目录，却没有 PDF 书签。"""
    out = []
    index_lines = {}
    started_at = None
    for i, blocks in enumerate(pages[:12]):
        lines = [line for block in blocks for line in block["lines"]]
        if started_at is None:
            caption = next((line for line in lines if re.fullmatch(r"目录|contents", re.sub(r"\s+", "", line), re.I)), None)
            if caption is None:
                continue
            started_at = (i, caption)
        elif not out and i > started_at[0] + 1:
            break

        page_entries = []
        for original in lines:
            line = original.replace("\u2060", "")
            match = re.search(r"(?:\s*\.\s*){3,}\s*(\d+)\s*$", line)
            if not match:
                continue
            page = int(match.group(1))
            title = line[:match.start()].strip(" .\t")
            numbered = re.match(r"^(\d+(?:\.\d+)*)\.\s*(.+)$", title)
            if numbered:
                number, title = numbered.groups()
                level = number.count(".") + 2
                title = f"{number}. {title}"
            else:
                level = 1
            title = re.sub(r"\s+", " ", title).strip()
            if title and 1 <= page <= len(pages):
                page_entries.append((level, title, page))
                index_lines.setdefault(i, set()).add(original)

        if page_entries:
            out.extend(page_entries)
        elif out:
            break
    if out and started_at is not None:
        i, caption = started_at
        index_lines.setdefault(i, set()).add(caption)
    return out, index_lines


def without_index_lines(blocks, index_lines):
    for block in blocks:
        lines = [line for line in block["lines"] if line not in index_lines]
        if lines:
            yield {**block, "text": " ".join(lines), "lines": lines}


def to_markdown(marks, pages):
    out = []

    # 按页重排：每页内先放本页的标题（按 y），其余正文按 y 顺序填到相邻标题之间
    stream = []
    heads_by_page = {}
    for lv, title, page, y in marks:
        heads = heads_by_page.setdefault(page, [])
        # 缺失的锚点用同页上一个目录位置（或页首），不能卡住后面有坐标的标题。
        at = max(heads[-1][0] if heads else 0, y)
        heads.append((at, y, lv, title))

    for pno in range(1, len(pages) + 1):
        stream.append(("page", 0, pno))
        heads = heads_by_page.get(pno, [])
        hi = 0
        for b in pages[pno - 1]:
            lines = b["lines"]
            while hi < len(heads) and heads[hi][0] <= b["y"]:
                _, anchor, lv, title = heads[hi]
                stream.append(("head", lv, title))
                if lines and anchor == b["y"]:
                    rest = title_remainder(lines[0], title)
                    if rest is not None:
                        lines = ([rest] if rest else []) + lines[1:]
                hi += 1
            if lines:
                stream.append(("text", 0, " ".join(lines)))
        # 没有文本块的页仍保留 PDF 书签和页码，以免下一页归到错误章节。
        while hi < len(heads):
            _, _, lv, title = heads[hi]
            stream.append(("head", lv, title))
            hi += 1

    for kind, lv, text in stream:
        if kind == "page":
            out.append(f"<!-- cognirogue-page: {text} -->\n")
        elif kind == "head":
            out.append(f"{'#' * min(lv, 6)} {text}\n")
        else:
            out.append(f"{text}\n")
    return "\n".join(out), any(kind == "text" and readable(text) for kind, _, text in stream)


def convert_pdf(data: bytes, *, keep_front=False):
    try:
        # 内存打开避免 Windows 上损坏文件触发解析异常后，原文件仍被 MuPDF 锁住。
        doc = pymupdf.open(stream=data, filetype="pdf")
    except pymupdf.FileDataError as exc:
        raise PdfImportError("无法读取 PDF：文件为空、已损坏或不是有效的 PDF。") from exc

    with doc:
        if not doc.is_pdf or not doc.page_count:
            raise PdfImportError("无法读取 PDF：文件无页面或不是有效的 PDF。")
        if doc.needs_pass:
            raise PdfImportError("这份 PDF 有密码保护，请解锁后重新上传。")

        heights = [(p.rect * p.derotation_matrix).height for p in doc]
        pages = drop_furniture([page_blocks(p) for p in doc], heights)
        report = dict(pageCount=doc.page_count, imagePages=[], unreadablePages=[], blankPages=[])
        skipped = {"image": "imagePages", "unreadable": "unreadablePages", "blank": "blankPages"}
        for i, (page, blocks, height) in enumerate(zip(doc, pages, heights)):
            kind = page_kind(page, blocks, height)
            if kind in skipped:
                report[skipped[kind]].append(i + 1)
                pages[i] = []

        printed, index_lines = printed_toc(pages)
        for i, lines in index_lines.items():
            pages[i] = list(without_index_lines(pages[i], lines))
        toc = doc.get_toc(simple=True) or printed
        marks = locate((row for row in toc if 1 <= row[2] <= doc.page_count), pages)
        if not keep_front:
            marks = marks[body_start(marks):]
        md, has_body = to_markdown(marks, pages)
        if not has_body:
            if report["imagePages"]:
                raise PdfImportError("PDF 中没有可用正文，包含扫描或纯图片页。请先 OCR，或导入 Markdown。")
            if len(report["blankPages"]) == doc.page_count:
                raise PdfImportError("这份 PDF 的页面都是空白的。")
            raise PdfImportError("PDF 中没有可用正文。请确认文件含有可提取的文字，或重新导出为 Markdown。")
    return md, report


def main():
    cli = argparse.ArgumentParser(description="提取 PDF 文字为 Markdown")
    cli.add_argument("src", type=Path)
    cli.add_argument("dst", type=Path)
    cli.add_argument("--keep-front", action="store_true")
    cli.add_argument("--report-json", action="store_true")
    args = cli.parse_args()
    try:
        md, report = convert_pdf(args.src.read_bytes(), keep_front=args.keep_front)
    except PdfImportError as exc:
        if args.report_json:
            print(json.dumps({"error": str(exc)}))
        else:
            print(exc, file=sys.stderr)
        return 1

    args.dst.write_text(md, encoding="utf-8")
    if args.report_json:
        print(json.dumps(report))
    else:
        skipped = {key: value for key, value in report.items() if key != "pageCount" and value}
        print(f"{args.src} → {args.dst} · {report['pageCount']} 页 · 输出 {len(md)} 字")
        if skipped:
            print(f"未写入正文的页：{skipped}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
