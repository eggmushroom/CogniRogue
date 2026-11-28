"""Read the evidence saved with approved questions, without calling a model."""

import json
import re
from pathlib import Path
from typing import Any

PAGE_MARK = re.compile(r"<!--\s*cognirogue-page:\s*([0-9]{1,9})\s*-->")
HEADING = re.compile(r"#{1,6}\s+")
EXCERPT_LIMIT = 640


def read_object(path: Path) -> dict[str, Any] | None:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, UnicodeError, json.JSONDecodeError):
        return None
    return value if isinstance(value, dict) else None


def topic_files(directory: Path, topic_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
    def component(part: str, version: int) -> dict[str, Any]:
        row = read_object(directory / f"{topic_id}{part}.json") or {}
        return row if row.get("v") == version and row.get("topicId") == topic_id else {}

    legacy = component("", 6)
    # Do not restore an obsolete index if a newer component exists but is invalid.
    def current(suffix: str) -> dict[str, Any]:
        return component(suffix, 7) if (directory / f"{topic_id}{suffix}.json").is_file() else legacy

    return current(".questions"), current(".source")


def saved_question(catalog: dict[str, Any], qid: str) -> dict[str, Any]:
    knowledge = catalog.get("knowledge")
    if isinstance(knowledge, dict):
        for entry in knowledge.values():
            questions = entry.get("questions") if isinstance(entry, dict) else None
            if isinstance(questions, dict) and isinstance(questions.get(qid), dict):
                return questions[qid]
    return {}


def section_text(content: str, section: dict[str, Any], document: dict[str, Any], *,
                 full: bool = False) -> tuple[str, list[int]]:
    is_pdf = document.get("kind") == "pdf"
    report = document.get("pdfExtraction")
    report = report if isinstance(report, dict) else {}
    page_count = report.get("pageCount")
    skipped = {page for key in ("imagePages", "unreadablePages", "blankPages")
               for page in (report[key] if isinstance(report.get(key), list) else []) if type(page) is int}
    first, last = section.get("pageFrom"), section.get("pageTo")

    def valid_page(value: Any) -> bool:
        return (type(value) is int and value > 0
                and (type(page_count) is not int or value <= page_count))

    # A section may begin mid-page; the planner preserves the inherited anchor in pageFrom.
    page = first if is_pdf and valid_page(first) and valid_page(last) and first <= last else None
    chunks: list[tuple[int | None, list[str]]] = [(page, [])]
    for line in content.splitlines():
        match = PAGE_MARK.fullmatch(line.strip())
        if match:
            if is_pdf:
                number = int(match[1])
                page = number if valid_page(number) else None
                chunks.append((page, []))
        else:
            chunks[-1][1].append(line)

    parts: list[str] = []
    pages: list[int] = []
    unknown_page = False
    remaining = None if full else EXCERPT_LIMIT
    for page, lines in chunks:
        if page in skipped:
            continue
        # PDF bookmarks can produce headings without body text. Do not count those pages
        # as evidence, but keep the headings of readable pages when showing the full text.
        if not any(line.strip() and not HEADING.match(line.strip()) for line in lines):
            continue
        if is_pdf and not full:
            lines = [line for line in lines if not HEADING.match(line.strip())]
        text = "\n".join(lines).strip()
        separator = ("\n\n…\n\n" if page and pages and page > pages[-1] + 1 else "\n\n") if parts else ""
        room = remaining - len(separator) if remaining is not None else None
        if room is not None and room < 2:
            break
        cut = room is not None and len(text) > room
        segment = text[:room - 1].rstrip() + "…" if cut and room is not None else text
        parts.append(separator + segment)
        if remaining is not None:
            remaining -= len(separator) + len(segment)
        if page is not None and page not in pages:
            pages.append(page)
        elif page is None:
            unknown_page = True
        if cut:
            break
    return "".join(parts), [] if unknown_page else sorted(pages)


def sections_for(directory: Path, index: dict[str, Any], section_ids: list[Any],
                 document: dict[str, Any], *, only: str | None = None) -> list[dict[str, Any]]:
    sections = index.get("sections")
    if not isinstance(sections, list):
        return []
    allowed = {section["id"]: section for section in sections if isinstance(section, dict)
               and isinstance(section.get("id"), str)}
    rows = []
    seen = set()
    for section_id in section_ids:
        if only is not None and section_id != only:
            continue
        if not isinstance(section_id, str) or not re.fullmatch(r"sec_[a-f0-9]{16}", section_id):
            continue
        section = allowed.get(section_id)
        if not section or section_id in seen or not isinstance(section.get("title"), str) or not section["title"].strip():
            continue
        seen.add(section_id)
        try:
            content = (directory / f"{section_id}.md").read_text(encoding="utf-8")
        except (FileNotFoundError, UnicodeError):
            continue
        text, pages = section_text(content, section, document, full=only is not None)
        if text:
            rows.append({"id": section_id, "title": section["title"], "pages": pages,
                         ("text" if only is not None else "excerpt"): text})
    return rows
