import asyncio
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pymupdf
from fastapi import HTTPException
from starlette.requests import Request

from server import app as service
from tools.pdf2md import PdfImportError, convert_pdf


def pdf_bytes(*kinds, toc=None, password=False):
    with pymupdf.open() as image_doc, pymupdf.open() as doc:
        image_page = image_doc.new_page(width=400, height=500)
        image_page.insert_text((40, 180), "Words baked into an image")
        pixmap = image_page.get_pixmap()
        for i, kind in enumerate(kinds, 1):
            page = doc.new_page(width=400, height=500)
            if kind in {"scan", "scan-with-header", "ocr-layer", "figure"}:
                rect = (110, 205, 230, 345) if kind == "figure" else page.rect
                page.insert_image(rect, pixmap=pixmap)
            if kind in {"text", "figure", "ocr-layer"}:
                page.insert_text((40, 160), f"Readable body {i}.", render_mode=3 if kind == "ocr-layer" else 0)
            elif kind == "scan-with-header":
                page.insert_text((40, 30), f"Page {i}")
            elif kind == "vector":
                page.draw_rect((40, 100, 360, 400), color=(0, 0, 0))
        if toc:
            doc.set_toc(toc)
        options = dict(encryption=pymupdf.PDF_ENCRYPT_AES_256, owner_pw="owner", user_pw="test") if password else {}
        return doc.tobytes(**options)


class PdfExtractionTests(unittest.TestCase):
    def test_text_and_illustrated_pages_keep_text_without_requiring_ocr(self):
        md, report = convert_pdf(pdf_bytes("text", "figure", "ocr-layer"))
        self.assertEqual(report, {"pageCount": 3, "imagePages": [], "unreadablePages": [], "blankPages": []})
        for i in range(1, 4):
            self.assertIn(f"Readable body {i}.", md)
        self.assertNotIn("Words baked into an image", md)

    def test_mixed_pdf_keeps_page_numbers_and_separates_blank_from_missing(self):
        md, report = convert_pdf(pdf_bytes("text", "scan", "blank", "vector", "scan-with-header", "text",
                                            toc=[[1, "Starts on a scanned page", 2]]))
        self.assertEqual(report, {"pageCount": 6, "imagePages": [2, 5], "unreadablePages": [4], "blankPages": [3]})
        self.assertIn("<!-- cognirogue-page: 6 -->\n\nReadable body 6.", md)
        self.assertIn("# Starts on a scanned page", md)
        self.assertNotIn("Page 5", md)

    def test_scan_only_with_bookmark_or_header_is_rejected(self):
        for kind in ("scan", "scan-with-header"):
            with self.subTest(kind=kind), self.assertRaisesRegex(PdfImportError, "扫描或纯图片页"):
                convert_pdf(pdf_bytes(kind, toc=[[1, "Not body text", 1]]))

    def test_blank_vector_invalid_and_locked_files_are_distinguished(self):
        for data, message in (
            (pdf_bytes("blank", "blank"), "都是空白"),
            (pdf_bytes("vector"), "没有可用正文"),
            (b"", "无法读取 PDF"),
            (b"%PDF-1.7\nbroken data", "无法读取 PDF"),
            (pdf_bytes("text", password=True), "密码保护"),
        ):
            with self.subTest(message=message), self.assertRaisesRegex(PdfImportError, message):
                convert_pdf(data)

    def test_bookmarks_on_same_page_do_not_swallow_short_body_or_later_anchor(self):
        with pymupdf.open() as doc:
            page = doc.new_page()
            page.insert_text((50, 120), "First\nShort body.")
            page.insert_text((50, 250), "Second")
            page.insert_text((50, 310), "Second body.")
            doc.set_toc([[1, "Preface (anchor not found)", 1], [1, "1. First", 1], [2, "Second", 1]])
            md, _ = convert_pdf(doc.tobytes(), keep_front=True)
        self.assertIn("# 1. First\n\nShort body.\n\n## Second\n\nSecond body.", md)
        self.assertLess(md.index("Preface"), md.index("Short body."))

    def test_printed_toc_and_cjk_text_work_without_bookmarks(self):
        with pymupdf.open() as doc:
            page = doc.new_page()
            page.insert_text((45, 100), "Contents")
            page.insert_text((45, 140), "1. Topic .......... 2")
            page = doc.new_page()
            page.insert_text((45, 100), "Topic")
            page.insert_text((45, 150), "这是一段中文正文。", fontname="china-s")
            md, report = convert_pdf(doc.tobytes())
        self.assertEqual(report["imagePages"], [])
        self.assertNotIn("..........", md)
        self.assertIn("<!-- cognirogue-page: 2 -->\n\n## 1. Topic\n\n这是一段中文正文。", md)

    def test_printed_toc_alone_is_not_body_text_for_a_scan(self):
        with pymupdf.open() as doc, pymupdf.open(stream=pdf_bytes("scan"), filetype="pdf") as scan:
            page = doc.new_page()
            page.insert_text((45, 100), "Contents")
            page.insert_text((45, 140), "1. Topic .......... 2")
            doc.insert_pdf(scan)
            with self.assertRaisesRegex(PdfImportError, "扫描或纯图片页"):
                convert_pdf(doc.tobytes())

    def test_repeated_body_is_not_discarded_as_page_furniture(self):
        with pymupdf.open() as doc:
            for _ in range(3):
                page = doc.new_page()
                page.insert_text((50, 25), "Running header")
                page.insert_text((50, 180), "Repeated definition.")
            md, _ = convert_pdf(doc.tobytes())
        self.assertEqual(md.count("Repeated definition."), 3)
        self.assertNotIn("Running header", md)


class PdfUploadTests(unittest.TestCase):
    def upload(self, data):
        async def request_body():
            return {"type": "http.request", "body": data, "more_body": False}

        return asyncio.run(service.upload_doc(Request({"type": "http"}, request_body), "sample.PDF"))

    def test_real_worker_preserves_partial_report_and_does_not_leave_failed_uploads(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(service, "DOCS", Path(tmp)):
            for data, message in ((pdf_bytes("scan", toc=[[1, "Chapter", 1]]), "OCR"),
                                  (b"%PDF-1.7\nbroken data", "无法读取 PDF")):
                with self.subTest(message=message), self.assertRaises(HTTPException) as error:
                    self.upload(data)
                self.assertEqual(error.exception.status_code, 400)
                self.assertIn(message, error.exception.detail)
                self.assertEqual(list(Path(tmp).iterdir()), [])

            result = self.upload(pdf_bytes("text", "scan", "blank", "vector"))
            report = result["pdfExtraction"]
            self.assertEqual(report, {"pageCount": 4, "imagePages": [2], "unreadablePages": [4], "blankPages": [3]})
            self.assertEqual(service.get_document(result["docId"])["pdfExtraction"], report)
            self.assertEqual(service.list_documents()[0]["pdfExtraction"], report)
            self.assertEqual({path.suffix for path in Path(tmp).iterdir()}, {".pdf", ".md", ".json"})
            self.assertIn("Readable body 1.", (Path(tmp) / f"{result['docId']}.md").read_text(encoding="utf-8"))

    def test_worker_timeout_and_crash_are_not_bad_input_or_success(self):
        for worker, status, message in (
            (AsyncMock(side_effect=subprocess.TimeoutExpired("pdf2md.py", 90)), 408, "超时"),
            (AsyncMock(return_value=subprocess.CompletedProcess([], 3, "", "crash")), 500, "本机服务"),
        ):
            with self.subTest(status=status), tempfile.TemporaryDirectory() as tmp, \
                    patch.object(service, "DOCS", Path(tmp)), patch.object(service, "run_in_threadpool", worker):
                with self.assertRaises(HTTPException) as error:
                    self.upload(b"test data")
                self.assertEqual(error.exception.status_code, status)
                self.assertIn(message, error.exception.detail)
                self.assertEqual(list(Path(tmp).iterdir()), [])
