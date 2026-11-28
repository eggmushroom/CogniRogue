import asyncio
import hashlib
import json
import subprocess
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from pydantic import ValidationError
from starlette.requests import Request

from server import app as service
from server.trace_report import summarize


class JobProgressTests(unittest.TestCase):
    def test_health_advertises_the_answer_ledger_api_contract(self) -> None:
        self.assertEqual(service.health()['apiVersion'], 1)

    def test_job_status_reports_review_progress_and_preserves_written_count(self) -> None:
        output = Path("bank.md")
        job = service.make_job("gen", [], output, "doc", "job-test", output, taskType="generate", title="题库")
        job.update(state="running", progress={"phase": "review", "completed": 2, "total": 10})
        self.assertEqual(service.job_status(job)["progress"], job["progress"])
        job.update(state="done", progress={"phase": "commit", "completed": 1, "total": 1, "written": 7})
        job["progress"] = service.complete_progress(job)
        progress = service.job_status(job, details=True)["progress"]
        self.assertEqual((progress["phase"], progress["written"]), ("complete", 7))

    def test_structured_failure_is_stage_aware_and_safe_for_old_jobs(self) -> None:
        output = Path("bank.md")
        job = service.make_job("gen", [], output, "doc", "job-test", output, taskType="generate", title="题库")
        job.update(state="fail", progress={"phase": "topics"}, lines=["✗ HTTP 403 INSUFFICIENT_BALANCE"])
        self.assertEqual(service.job_status(job)["failure"], {"stage": "generate", "code": "balance"})
        job["failure"] = {"stage": "review", "code": "auth", "secret": "not-exported"}
        self.assertEqual(service.job_status(job)["failure"], {"stage": "review", "code": "auth"})


class AnswerPersistenceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.original_answers = service.ANSWERS
        service.ANSWERS = Path(self.temp.name)

    def tearDown(self) -> None:
        service.ANSWERS = self.original_answers
        self.temp.cleanup()

    def test_retry_is_idempotent_but_distinct_events_are_kept(self) -> None:
        payload = service.AnswersInput.model_validate({
            "v": 2,
            "bankId": "rust-book",
            "events": [
                {"id": "event-1", "type": "answer", "topic": "基础", "qid": "q1", "right": True, "choice": 1, "runId": "run-demo"},
            ],
        })

        first = service.save_answers(payload)
        retry = service.save_answers(payload)
        second_event = service.AnswersInput.model_validate({
            **payload.model_dump(),
            "events": [{**payload.events[0].model_dump(), "id": "event-2"}],
        })
        second = service.save_answers(second_event)

        rows = service.answer_store.details(service.ANSWERS, 'rust-book', 'run-demo', service.MAX_SEQ, 100)
        self.assertEqual(first["written"], 1)
        self.assertEqual(retry["written"], 0)
        self.assertEqual(second["written"], 1)
        self.assertEqual({row["clientId"] for row in rows}, {"event-1", "event-2"})
        self.assertEqual(len(rows), 2)

    def test_answer_choice_is_required_and_bounded(self) -> None:
        base = {"v": 2, "bankId": "rust-book", "events": [
            {"id": "event", "type": "answer", "topic": "基础", "qid": "q1", "right": False, "choice": 5},
        ]}
        with self.assertRaises(Exception):
            service.AnswersInput.model_validate(base)
        base["events"][0].pop("choice")
        parsed_missing = service.AnswersInput.model_validate({**base, "events": [
            {"id": "event", "type": "answer", "topic": "基础", "qid": "q1", "right": False},
        ]})
        with self.assertRaises(Exception):
            service.save_answers(parsed_missing)
        base["events"][0]["choice"] = 3
        parsed = service.AnswersInput.model_validate(base)
        self.assertEqual(parsed.events[0].choice, 3)

    def test_archive_run_marks_every_event_in_that_run(self) -> None:
        payload = service.AnswersInput.model_validate({
            "v": 2,
            "bankId": "rust-book",
            "events": [
                {"id": "event-1", "type": "answer", "topic": "基础", "qid": "q1", "right": True, "choice": 1, "runId": "run-demo"},
                {"id": "event-2", "type": "answer", "topic": "基础", "qid": "q2", "right": False, "choice": 2, "runId": "run-demo"},
                {"id": "event-3", "type": "answer", "topic": "基础", "qid": "q3", "right": True, "choice": 1, "runId": "run-other"},
            ],
        })
        service.save_answers(payload)

        archive = service.AnswersInput(v=2, bankId='rust-book', events=[
            service.AnswerEventInput(id='archive', type='archive', runId='run-demo'),
        ])
        service.save_answers(archive)
        service.save_answers(archive)
        archived = service.answer_store.runs(service.ANSWERS, True, service.MAX_SEQ, 100)
        current = service.answer_store.runs(service.ANSWERS, False, service.MAX_SEQ, 100)
        self.assertEqual([(row['total'], row['correct']) for row in archived], [(2, 1)])
        self.assertEqual([row['runId'] for row in current], ['run-other'])

    def test_late_upload_appends_choices_in_order_and_keeps_run_archived(self) -> None:
        def upload(run, choices):
            return service.save_answers(service.AnswersInput(v=2, bankId='rust-book', events=[
                service.AnswerEventInput(id=f'{run}-{i}', type='answer', runId=run,
                                         topic='Basics', qid='q1', right=choice == 1, choice=choice)
                for i, choice in enumerate(choices)
            ]))

        upload('run-first', [1, 2, 3, 1])
        marker = service.AnswerEventInput(id='archive', type='archive', runId='run-second')
        service.save_answers(service.AnswersInput(v=2, bankId='rust-book', events=[marker]))
        upload('run-second', [1, 2, 2, 2])
        self.assertEqual(upload('run-second', [1, 2, 2, 2])['written'], 0)
        rows = service.answer_store.details(service.ANSWERS, 'rust-book', 'run-second', service.MAX_SEQ, 100)
        self.assertEqual([row['choice'] for row in reversed(rows)], [1, 2, 2, 2])
        archived = service.answer_store.runs(service.ANSWERS, True, service.MAX_SEQ, 100)
        self.assertEqual([(row['total'], row['correct']) for row in archived], [(4, 1)])
        self.assertEqual({r['runId'] for r in service.answer_store.runs(service.ANSWERS, False, service.MAX_SEQ, 100)}, {'run-first'})


class ProcessRecoveryTests(unittest.TestCase):
    def test_recovery_pid_must_still_have_the_job_marker(self) -> None:
        marker = Path("C:/jobs/test folder/job-123.complete").resolve()
        job = {"pid": 42, "completeFile": str(marker)}
        with patch.object(service, "process_command_line", return_value=f'node gen.mjs "--complete={marker}"'):
            self.assertTrue(service.process_matches_job(job))
        with patch.object(service, "process_command_line", return_value=f'node unrelated.mjs "--complete={marker}.backup"'):
            self.assertFalse(service.process_matches_job(job))


class QuestionSourceTests(unittest.TestCase):
    bank_id = "my-notes"
    topic_id = "t_" + "a" * 24
    qid = "q_example"
    section_id = "sec_" + "a" * 16
    other_id = "sec_" + "b" * 16
    question = {"stem": "示例题？", "options": ["正确", "错误"], "answer": 0}
    report = {"pageCount": 8, "imagePages": [3], "unreadablePages": [4], "blankPages": [5]}

    def setUp(self) -> None:
        root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.enterContext(patch.multiple(service, STORE=root, DOCS=root / "docs", GEN_BANKS=root / "banks"))
        self.memory = root / "memory" / self.bank_id
        self.sections = root / "sections" / self.bank_id
        for directory in (self.memory, self.sections, service.DOCS, service.GEN_BANKS):
            directory.mkdir(parents=True)
        self.bank = service.GEN_BANKS / f"{self.bank_id}.md"
        self.bank.write_text(f"# 题库\n## 基础 <!-- topic: {self.topic_id} -->\n### 示例题？\n"
                             f"^ {self.qid}\nA) 正确\nB) 错误\n= A\n", encoding="utf-8")
        self.current = self.enterContext(patch.object(service.subprocess, "run"))
        self.current.return_value.stdout = json.dumps({"question": self.question})
        self.write_memory()

    def write_document(self, kind="pdf", **extra) -> None:
        row = {"docId": self.bank_id, "name": f"C:\\local\\原文.{kind}", "kind": kind, **extra}
        (service.DOCS / f"{self.bank_id}.json").write_text(json.dumps(row), encoding="utf-8")

    def write_memory(self, *, legacy=False, refs=None, sections=None, page_from=2, page_to=2) -> None:
        question = {**self.question, "sectionIds": [self.section_id] if refs is None else refs}
        knowledge = {"concept": {"questions": {self.qid: question}}}
        if sections is None:
            sections = [{"id": self.section_id, "title": "小节", "pageFrom": page_from, "pageTo": page_to}]
        data = {"topicId": self.topic_id, "v": 6 if legacy else 7}
        entries = {"": {"knowledge": knowledge, "sections": sections}} if legacy else {
            ".questions": {"knowledge": knowledge}, ".source": {"sections": sections},
        }
        for suffix, entry in entries.items():
            (self.memory / f"{self.topic_id}{suffix}.json").write_text(json.dumps({**data, **entry}), encoding="utf-8")

    def write_section(self, content, section_id=None) -> None:
        (self.sections / f"{section_id or self.section_id}.md").write_text(content, encoding="utf-8")

    def source(self, qid=None, topic_id=None):
        return service.get_question_source(self.bank_id, topic_id or self.topic_id, qid or self.qid)["source"]

    def full_section(self, section_id):
        return service.get_question_source(self.bank_id, self.topic_id, self.qid, section=section_id)["section"]

    def test_pdf_excerpt_pages_only_include_body_that_is_shown(self) -> None:
        self.write_document(pdfExtraction=self.report)
        self.write_memory(page_to=7)
        self.write_section("# 小节\n继承页码的正文\n<!-- cognirogue-page: 3 -->\n# 扫描页书签\n"
                           "<!-- cognirogue-page: 4 -->\n不应展示的正文\n<!-- cognirogue-page: 5 -->\n"
                           "<!-- cognirogue-page: 6 -->\n后续正文\n"
                           "<!-- cognirogue-page: 7 -->\n# 仅标题")
        source = self.source()
        self.assertEqual(source, {"documentName": "原文.pdf", "sections": [{
            "id": self.section_id, "title": "小节", "pages": [2, 6], "excerpt": "继承页码的正文\n\n…\n\n后续正文",
        }]})
        query = json.loads(self.current.call_args.kwargs["input"])
        self.assertEqual((query["action"], query["topic"], query["qid"]),
                         ("find-question", self.topic_id, self.qid))

    def test_normal_pdf_truncates_excerpt_without_claiming_later_pages(self) -> None:
        self.write_document()
        self.write_memory(page_to=3)
        self.write_section("<!-- cognirogue-page: 2 -->\n" + "正文" * 500 + "\n<!-- cognirogue-page: 3 -->\n后续")
        section = self.source()["sections"][0]
        self.assertEqual(section["pages"], [2])
        self.assertEqual(len(section["excerpt"]), 640)
        self.assertTrue(section["excerpt"].endswith("…"))

    def test_markdown_and_legacy_memory_do_not_display_page_numbers(self) -> None:
        self.write_document("md")
        for suffix in ("questions", "source"):
            (self.memory / f"{self.topic_id}.{suffix}.json").unlink()
        self.write_memory(legacy=True)
        self.write_section("<!-- cognirogue-page: 8 -->\n## 基础\n有效的 Markdown 正文")
        self.assertEqual(self.source()["sections"], [{
            "id": self.section_id, "title": "小节", "excerpt": "## 基础\n有效的 Markdown 正文", "pages": [],
        }])
        self.write_memory(sections=[])
        self.assertIsNone(self.source())  # New index must take priority over legacy.

    def test_missing_unreadable_or_out_of_scope_evidence_is_not_guessed(self) -> None:
        self.write_document(pdfExtraction=self.report)
        self.assertIsNone(self.source())
        self.write_section("<!-- cognirogue-page: 3 -->\n# 扫描页书签")
        self.assertIsNone(self.source())
        self.write_section("同一文档不同主题的正文", self.other_id)
        self.write_memory(refs=[self.other_id, "../outside", None])
        self.assertIsNone(self.source())
        self.assertIsNone(self.source(qid="q_old"))
        self.assertIsNone(self.source(topic_id="../other"))
        with self.assertRaises(HTTPException) as invalid:
            service.get_question_source("../other", self.topic_id, self.qid)
        self.assertEqual(invalid.exception.status_code, 400)

    def test_full_pdf_section_reaches_tail_without_including_skipped_pages(self) -> None:
        self.write_document(pdfExtraction=self.report)
        self.write_memory(page_to=6)
        self.write_section("# 小节\n" + "正文" * 500 + "\n<!-- cognirogue-page: 3 -->\n扫描页噪声\n"
                           "<!-- cognirogue-page: 4 -->\n不可读页噪声\n<!-- cognirogue-page: 5 -->\n"
                           "<!-- cognirogue-page: 6 -->\n结尾正文")
        old = self.source()["sections"][0]
        self.assertNotIn("结尾正文", old["excerpt"])
        section = self.full_section(self.section_id)
        self.assertEqual(section, {"id": self.section_id, "title": "小节", "pages": [2, 6],
                                   "text": "# 小节\n" + "正文" * 500 + "\n\n…\n\n结尾正文"})

    def test_source_lists_all_cited_sections_without_allowing_uncited_sections(self) -> None:
        self.write_document("md")
        refs = [f"sec_{n:016x}" for n in range(1, 7)]
        self.write_memory(refs=refs, sections=[{"id": sec, "title": sec} for sec in [*refs, self.other_id]])
        for sec in [*refs, self.other_id]:
            self.write_section("## 标题\n" + "内容" * 330 + "\n最后一行", sec)
        self.assertEqual([row["id"] for row in self.source()["sections"]], refs)
        self.assertEqual(self.full_section(refs[-1])["text"], "## 标题\n" + "内容" * 330 + "\n最后一行")
        self.current.reset_mock()
        self.assertIsNone(self.full_section(self.other_id))
        self.assertIsNone(self.full_section("../outside.md"))
        self.current.assert_not_called()

    def test_catalog_only_or_edited_questions_cannot_show_stale_evidence(self) -> None:
        self.write_document()
        self.write_section("可读正文")
        self.current.return_value.stdout = '{"question":null}'
        self.assertIsNone(self.source())
        self.current.return_value.stdout = json.dumps({"question": {**self.question, "answer": 1}})
        self.assertIsNone(self.source())
        self.bank.unlink()
        self.current.reset_mock()
        self.assertIsNone(self.source())
        self.current.assert_not_called()


class DocumentPersistenceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.paths = patch.multiple(service, STORE=root, DOCS=root / "docs", PLANS=root / "plans",
                                    GEN_BANKS=root / "banks", JOBS=root / "jobs", ANSWERS=root / "answers",
                                    jobs={}, active_docs=set())
        self.paths.start()
        service.PLANS.mkdir()

    def tearDown(self) -> None:
        self.paths.stop()
        self.temp.cleanup()

    def upload(self) -> dict:
        async def receive() -> dict:
            return {"type": "http.request", "body": "# 小书\n## 基础\n对象是数据。\n## 进阶\n引用连接对象。".encode(), "more_body": False}
        return asyncio.run(service.upload_doc(Request({"type": "http"}, receive), "book.md"))

    def test_document_is_reopenable_without_any_questions(self) -> None:
        first = self.upload()
        source = service.DOCS / f"{first['docId']}.md"
        timestamp = source.stat().st_mtime_ns
        second = self.upload()
        self.assertNotEqual(first["docId"], second["docId"])
        self.assertEqual(timestamp, source.stat().st_mtime_ns)
        self.assertEqual({doc["docId"] for doc in service.list_documents()}, {first["docId"], second["docId"]})
        self.assertIsNone(service.get_document(first["docId"])["plan"])
        self.assertFalse(service.GEN_BANKS.exists())

    def test_reset_document_keeps_source_and_clears_generated_artifacts(self) -> None:
        doc = self.upload()
        doc_id = doc["docId"]
        row_path = service.DOCS / f"{doc_id}.json"
        row = json.loads(row_path.read_text(encoding="utf-8"))
        plan_id = f"{doc_id}-plan-test"
        row.update(planId=plan_id, importedPlanId=plan_id)
        row_path.write_text(json.dumps(row), encoding="utf-8")
        service.GEN_BANKS.mkdir(parents=True)
        (service.GEN_BANKS / f"{doc_id}.md").write_text("generated", encoding="utf-8")
        (service.PLANS / f"{plan_id}.json").write_text("{}", encoding="utf-8")
        for directory in (service.STORE / "memory" / doc_id, service.STORE / "sections" / doc_id):
            directory.mkdir(parents=True)
            (directory / "part.md").write_text("derived", encoding="utf-8")

        checkpoint = service.GEN_BANKS / f"{doc_id}.md.checkpoint.json"
        checkpoint.write_text("{}", encoding="utf-8")
        result = service.reset_document(doc_id)

        self.assertTrue(result["ok"])
        self.assertFalse(checkpoint.exists())
        self.assertTrue((service.DOCS / f"{doc_id}.md").is_file())
        self.assertEqual(service.get_document(doc_id)["planId"], "")
        self.assertFalse((service.GEN_BANKS / f"{doc_id}.md").exists())
        self.assertFalse((service.PLANS / f"{plan_id}.json").exists())
        self.assertFalse((service.STORE / "memory" / doc_id).exists())
        self.assertFalse((service.STORE / "sections" / doc_id).exists())

    def test_delete_document_removes_uploaded_source_and_derived_files(self) -> None:
        doc = self.upload()
        doc_id = doc["docId"]
        plan_id = f"{doc_id}-plan-test"
        service.GEN_BANKS.mkdir(parents=True)
        (service.GEN_BANKS / f"{doc_id}.md").write_text("generated", encoding="utf-8")
        (service.PLANS / f"{plan_id}.json").write_text("{}", encoding="utf-8")

        result = service.delete_document(doc_id)

        self.assertTrue(result["ok"])
        self.assertFalse((service.DOCS / f"{doc_id}.json").exists())
        self.assertFalse((service.DOCS / f"{doc_id}.md").exists())
        self.assertFalse((service.GEN_BANKS / f"{doc_id}.md").exists())
        self.assertFalse((service.PLANS / f"{plan_id}.json").exists())
        self.assertEqual(service.list_documents(), [])

    def test_reset_and_delete_reject_documents_with_active_jobs(self) -> None:
        doc = self.upload()
        service.jobs["job-active"] = {"id": "job-active", "lock_doc": doc["docId"], "state": "running"}
        for operation in (service.reset_document, service.delete_document):
            with self.assertRaises(HTTPException) as rejected:
                operation(doc["docId"])
            self.assertEqual(rejected.exception.status_code, 409)
        self.assertTrue((service.DOCS / f"{doc['docId']}.md").exists())

    def test_pdf_extraction_runs_in_threadpool(self) -> None:
        async def receive() -> dict:
            return {"type": "http.request", "body": b"pdf-bytes", "more_body": False}

        async def extract(function, args, **kwargs):
            self.assertIs(function, subprocess.run)
            Path(args[-1]).write_text("# PDF\n\nExtracted text", encoding="utf-8")
            report = {"pageCount": 1, "imagePages": [], "unreadablePages": [], "blankPages": []}
            return subprocess.CompletedProcess(args, 0, stdout=json.dumps(report), stderr="")

        offload = AsyncMock(side_effect=extract)
        with patch.object(service, "run_in_threadpool", offload):
            result = asyncio.run(service.upload_doc(Request({"type": "http"}, receive), "book.pdf"))

        self.assertEqual(result["kind"], "pdf")
        offload.assert_awaited_once()

    def test_plan_persists_document_pointer_and_all_topic_memories(self) -> None:
        doc = self.upload()
        with patch.object(service, "dispatch_jobs"):
            result = service.start_plan(service.PlanInput(docId=doc["docId"], agenticWindow=12000, agenticOverlapChars=0))
        args = service.jobs[result["job"]]["args"]
        self.assertIn("--window=12000", args)
        self.assertIn("--overlap=0", args)
        self.assertIn(f"--memory={service.STORE / 'memory' / doc['docId']}", args)
        self.assertIn(f"--document={service.DOCS / (doc['docId'] + '.json')}", args)
        self.assertNotEqual(result["planId"], doc["planId"])
        self.assertEqual(service.document(doc["docId"])["planId"], "")
        with self.assertRaises(HTTPException) as rejected:
            service.start_generate(service.GenerateInput(docId=doc["docId"], plan="another-document", topics=[0]))
        self.assertEqual(rejected.exception.status_code, 400)

    def test_plan_rejects_document_with_queued_work(self) -> None:
        doc_id = self.upload()["docId"]
        service.jobs["job-queued"] = {"id": "job-queued", "lock_doc": doc_id, "state": "queued"}
        with self.assertRaises(HTTPException) as rejected:
            service.start_plan(service.PlanInput(docId=doc_id))
        self.assertEqual(rejected.exception.status_code, 409)
        self.assertEqual(list(service.jobs), ["job-queued"])

    def test_plan_window_must_be_a_strict_integer_in_supported_range(self) -> None:
        self.assertEqual(service.PlanInput(docId="doc").agenticWindow, 8000)
        for value in (1999, 20001, 8000.5, True):
            with self.subTest(value=value), self.assertRaises(ValidationError):
                service.PlanInput(docId="doc", agenticWindow=value)

    def test_plan_overlap_must_be_a_strict_integer_within_window(self) -> None:
        self.assertEqual(service.PlanInput(docId="doc").agenticOverlapChars, 800)
        self.assertEqual(service.PlanInput(docId="doc", agenticWindow=2000, agenticOverlapChars=2000).agenticOverlapChars, 2000)
        for value in (-1, 2001, 10.5, "10", True):
            with self.subTest(value=value), self.assertRaises(ValidationError):
                service.PlanInput(docId="doc", agenticWindow=2000, agenticOverlapChars=value)

    def test_only_imported_topics_can_be_queued_as_individual_jobs(self) -> None:
        doc = self.upload()
        doc_id = doc["docId"]
        plan_id = doc_id + "-preview"
        (service.PLANS / f"{plan_id}.json").write_text(json.dumps({
            "v": 2,
            "topics": [{"id": "t_aaaaaaaaaaaaaaaaaaaaaaaa", "title": "Basics"}, {"id": "t_bbbbbbbbbbbbbbbbbbbbbbbb", "title": "Advanced"}],
        }), encoding="utf-8")
        manifest = service.DOCS / f"{doc_id}.json"
        manifest.write_text(json.dumps({**doc, "planId": plan_id}), encoding="utf-8")
        request = service.GenerateInput(docId=doc_id, plan=plan_id, topics=[0, 1, 1])
        with self.assertRaises(HTTPException) as rejected:
            service.start_generate(request)
        self.assertEqual(rejected.exception.status_code, 400)
        service.import_topics(doc_id, service.ImportTopicsInput(plan=plan_id))
        self.assertEqual(service.get_document(doc_id)["importedPlanId"], plan_id)
        self.assertEqual(service.list_jobs(), [])
        with patch.object(service, "config", return_value={"key": "test"}), patch.object(service.threading, "Thread"):
            with self.assertRaises(HTTPException):
                service.start_generate(request.model_copy(update={"topics": [0, 2]}))
            self.assertEqual(service.list_jobs(), [])
            accepted = service.start_generate(request)["jobs"]
            self.assertEqual([job["topic"] for job in accepted], [0, 1])
            self.assertEqual([job["state"] for job in accepted], ["running", "queued"])
            self.assertNotEqual(accepted[0]["id"], accepted[1]["id"])
            with self.assertRaises(HTTPException) as duplicate:
                service.start_generate(request)
            self.assertEqual(duplicate.exception.status_code, 409)
        self.assertEqual(len(list(service.JOBS.glob("*.json"))), 2)

    def test_failed_generation_retry_is_single_topic_idempotent_and_trace_linked(self) -> None:
        doc = self.upload()
        doc_id = doc["docId"]
        plan_id = doc_id + "-preview"
        topic_id = "t_" + "a" * 24
        (service.PLANS / f"{plan_id}.json").write_text(json.dumps({
            "v": 2, "topics": [{"id": topic_id, "title": "Basics"}, {"id": "t_" + "b" * 24, "title": "Second"}],
        }), encoding="utf-8")
        manifest = service.DOCS / f"{doc_id}.json"
        manifest.write_text(json.dumps({**doc, "planId": plan_id, "importedPlanId": plan_id}), encoding="utf-8")
        with patch.object(service, "config", return_value={"key": "test"}), patch.object(service, "dispatch_jobs"):
            old, other = service.start_generate(service.GenerateInput(docId=doc_id, plan=plan_id, topics=[0, 1], per=7))["jobs"]
            with self.assertRaises(HTTPException) as not_failed:
                service.retry_job(old["id"])
            self.assertEqual(not_failed.exception.status_code, 409)
            service.jobs[old["id"]].update(state="fail")
            service.jobs[old["id"]].pop("per")  # Persisted before the field was added.
            service.jobs[other["id"]].update(state="done")
            manifest.write_text(json.dumps({**doc, "planId": plan_id, "importedPlanId": "new-plan"}), encoding="utf-8")
            with self.assertRaises(HTTPException) as stale:
                service.retry_job(old["id"])
            self.assertEqual(stale.exception.status_code, 409)
            self.assertEqual(len(service.jobs), 2)
            manifest.write_text(json.dumps({**doc, "planId": plan_id, "importedPlanId": plan_id}), encoding="utf-8")
            replay = service.retry_job(old["id"])["job"]
            self.assertEqual(service.retry_job(old["id"])["job"]["id"], replay["id"])
        self.assertEqual(len(service.jobs), 3)
        self.assertEqual(replay["topic"], 0)
        self.assertEqual(replay["retryOfJobId"], old["id"])
        self.assertIn("--per=7", service.jobs[replay["id"]]["args"])
        self.assertIn(f"--topic-id={topic_id}", service.jobs[replay["id"]]["args"])
        self.assertEqual(service.get_job(old["id"])["state"], "fail")
        self.assertNotEqual(replay["traceId"], old["traceId"])
        report = summarize(service.job_trace.path_for(service.JOBS, replay["traceId"]))
        self.assertEqual(report["outcome"], "unfinished")
        self.assertEqual(report["retryOfTraceId"], old["traceId"])

    def test_trace_summary_separates_parallel_duration_and_reported_usage(self) -> None:
        job = service.make_job("gen", [], service.GEN_BANKS / "doc.md", "doc", "job-test",
                               service.JOBS / "test.complete", taskType="generate", title="Test", planId="p")
        service.jobs[job["id"]] = job
        with patch.object(service.threading, "Thread"):
            service.dispatch_jobs()
        trace = service.job_trace
        parent = job["traceExecution"]["spanId"]
        for index, status in enumerate((403, 200)):
            span = f"{index:016x}"
            trace.lifecycle(service.JOBS, job, "model.request", span, "start", parent=parent)
            attrs = {"status": status, "errorKind": "http"} if status == 403 else {"status": status, "inputTokens": 17}
            trace.lifecycle(service.JOBS, job, "model.request", span, "end", parent=parent,
                            outcome="error" if status == 403 else "ok", **attrs)
        trace.lifecycle(service.JOBS, job, "topic.review", "f" * 16, "start", parent=parent)
        job["failure"] = {"stage": "review", "code": "balance"}
        service.finish_trace(job, "error")
        path = trace.path_for(service.JOBS, job["traceId"])
        with path.open("ab") as file:
            file.write(b'{"partial":')
        report = summarize(path)
        self.assertEqual(report["failure"], job["failure"])
        self.assertEqual(report["model"]["httpStatuses"], {"403": 1, "200": 1})
        self.assertEqual(report["model"]["usageReportedRequests"], 1)
        self.assertEqual(report["model"]["reportedInputTokens"], 17)
        self.assertEqual(report["unclosedSpans"], 1)
        self.assertEqual(report["ignoredLines"], 1)

    def test_trace_links_job_worker_and_child_and_preserves_id_after_restart(self) -> None:
        job = service.make_job("plan", [], service.PLANS / "test.json", "doc", "job-test",
                               service.JOBS / "test.complete", taskType="plan", title="Test", planId="p")
        service.jobs[job["id"]] = job
        with patch.object(service.threading, "Thread"):
            service.dispatch_jobs()
            trace_id = service.get_job(job["id"])["traceId"]
            first = job["traceExecution"]["spanId"]
            event = {"v": 1, "traceId": trace_id, "jobId": job["id"], "name": "plan.chunk",
                     "event": "start", "spanId": "1234567890abcdef", "parentSpanId": first}
            service.job_trace.accept_child(service.JOBS, job, json.dumps(event))
            service.job_trace.accept_child(service.JOBS, job, json.dumps({**event, "traceId": "wrong"}))
            service.jobs.clear()
            service.active_docs.clear()
            with patch.object(service.subprocess, "run") as build:
                build.return_value.returncode = 0
                service.startup()
        recovered = service.jobs[job["id"]]
        self.assertEqual(recovered["traceId"], trace_id)
        self.assertEqual(recovered["traceExecution"]["attempt"], 2)
        self.assertNotEqual(recovered["traceExecution"]["spanId"], first)
        service.finish_trace(recovered, "ok")
        response = service.get_trace(trace_id)
        self.assertIn(f"trace-{trace_id}.jsonl", response.headers["content-disposition"])
        events = [json.loads(line) for line in response.body.splitlines()]
        self.assertTrue(all(row["traceId"] == trace_id for row in events))
        self.assertEqual([row["outcome"] for row in events if row["name"] == "worker" and row["event"] == "end"],
                         ["interrupted", "ok"])
        self.assertEqual([row["parentSpanId"] for row in events if row["name"] == "plan.chunk"], [first])
        self.assertEqual(events[-1]["name"], "job")
        with self.assertRaises(HTTPException) as missing:
            service.get_trace("../test")
        self.assertEqual(missing.exception.status_code, 404)

    def test_feedback_reads_split_progress_and_preserves_inflight_snapshot(self) -> None:
        bank_id, topic_id = "doc", "t_" + "a" * 24
        directory = service.STORE / "memory" / bank_id
        directory.mkdir(parents=True)
        legacy = directory / f"{topic_id}.json"
        legacy.write_text(json.dumps({"v": 6, "topicId": topic_id, "cursor": 1}), encoding="utf-8")
        source = directory / f"{topic_id}.source.json"
        source.write_text(json.dumps({"v": 7, "topicId": topic_id, "topic": "基础"}), encoding="utf-8")
        with service.answer_store.connect(service.ANSWERS) as db, db:
            for seq in range(1, 4):
                service.answer_store.append(db, bank_id, {"id": str(seq), "topic": topic_id, "qid": "q1",
                    "type": "answer", "right": True, "choice": seq}, "")

        def snapshot(job_id):
            service.prepare_feedback({"id": job_id, "bankId": bank_id, "topicId": topic_id})
            return json.loads((service.STORE / "feedback" / f"{job_id}.json").read_text(encoding="utf-8"))

        before = snapshot("job-legacy")
        self.assertEqual(before["after"], 1)
        self.assertEqual([row["seq"] for row in before["records"]], [2, 3])
        progress = directory / f"{topic_id}.progress.json"
        progress.write_text(json.dumps({"v": 7, "topicId": topic_id, "cursor": 2, "stats": {}}), encoding="utf-8")
        self.assertEqual(snapshot("job-legacy"), before)
        after = snapshot("job-split")
        self.assertEqual(after["after"], 2)
        self.assertEqual([row["seq"] for row in after["records"]], [3])

    def test_interrupted_plan_commit_recovers_memories_and_active_plan(self) -> None:
        doc = self.upload()
        doc_id = doc["docId"]
        plan_id = doc_id + "-plan"
        output = service.PLANS / f"{plan_id}.json"
        transaction = service.PLANS / ".gen-transaction" / output.name
        transaction.mkdir(parents=True)
        memory = service.STORE / "memory" / doc_id / "基础.json"
        targets = [(output, {"topics": [{"title": "基础"}]}),
                   (memory, {"topic": "基础", "concepts": {}, "sections": [{"title": "基础", "from": 1, "to": 3}]}),
                   (service.DOCS / f"{doc_id}.json", {**doc, "planId": plan_id})]
        entries = []
        for index, (target, content) in enumerate(targets):
            data = json.dumps(content).encode()
            staged = transaction / f"{index}.next"
            staged.write_bytes(data)
            entries.append({"staged": str(staged), "target": str(target), "sha256": hashlib.sha256(data).hexdigest()})
        (transaction / "commit.json").write_text(json.dumps(entries), encoding="utf-8")
        Path(entries[0]["staged"]).replace(output)
        service.recover_bank_transaction()
        self.assertEqual(service.get_document(doc_id)["plan"]["topics"][0]["title"], "基础")
        self.assertTrue(memory.exists())
        self.assertFalse(transaction.exists())


if __name__ == "__main__":
    unittest.main()
