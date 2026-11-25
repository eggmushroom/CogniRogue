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
from starlette.requests import Request

from server import app as service


class JobOutputTests(unittest.TestCase):
    def test_health_advertises_the_answer_ledger_api_contract(self) -> None:
        self.assertEqual(service.health()['apiVersion'], 1)

    def test_snapshot_is_detail_only_and_persisted_once_finished(self) -> None:
        with tempfile.TemporaryDirectory() as root, patch.object(service, "JOBS", Path(root)):
            output = Path(root) / "bank.md"
            job = service.make_job("gen", [], output, "doc", "job-test", output, taskType="generate", title="题库")
            job["state"] = "running"
            service.record_model_output(job, {"call": 1, "phase": "live", "text": "第一轮输出"})
            service.record_model_output(job, {"call": 1, "phase": "complete", "text": "第一轮完整输出", "inputTokens": 10})
            service.record_model_output(job, {"call": 2, "phase": "live", "text": "第二轮输出"})
            path = Path(root) / "job-test.json"
            service.save_job(job)
            self.assertNotIn("modelOutput", json.loads(path.read_text(encoding="utf-8")))
            self.assertNotIn("modelOutput", service.job_status(job))
            detail = service.job_status(job, details=True)["modelOutput"]["calls"]
            self.assertEqual([call["text"] for call in detail], ["第一轮完整输出", "第二轮输出"])
            job["state"] = "done"
            service.record_model_output(job, {"call": 2, "phase": "complete", "text": "第二轮完整输出", "outputTokens": 2})
            service.save_job(job)
            saved = json.loads(path.read_text(encoding="utf-8"))["modelOutput"]["calls"]
            self.assertEqual(len(saved), 2)
            self.assertEqual(saved[0]["text"], "第一轮完整输出")
            self.assertEqual(saved[1]["outputTokens"], 2)

    def test_job_event_stream_emits_final_snapshot(self) -> None:
        with patch.object(service, "jobs", {"job-test": {
            "id": "job-test", "state": "done", "taskType": "generate", "title": "题库",
            "started": time.time(), "lines": [], "progress": {"phase": "complete", "completed": 1, "total": 1},
            "modelOutput": {"calls": [{"call": 1, "phase": "tools", "text": "", "toolCalls": [
                {"id": "read-1", "name": "read_source", "arguments": '{"path":["第一章"]}',
                 "state": "complete", "detail": "已读取 20 字符"},
            ]}]},
        }}):
            async def receive():
                return {"type": "http.request", "body": b"", "more_body": False}
            request = Request({"type": "http", "method": "GET", "path": "/api/jobs/job-test/events", "headers": [], "query_string": b"", "server": ("127.0.0.1", 7777), "client": ("127.0.0.1", 1), "scheme": "http", "http_version": "1.1"}, receive)
            response = asyncio.run(service.job_events("job-test", request))
            chunks = asyncio.run(collect_stream(response.body_iterator))
            self.assertIn('event: job\ndata:', chunks)
            self.assertIn('read_source', chunks)
            self.assertIn('"state":"complete"', chunks)


async def collect_stream(iterator) -> str:
    return "".join([chunk.decode() if isinstance(chunk, bytes) else chunk async for chunk in iterator])


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

    def test_pdf_extraction_runs_in_threadpool(self) -> None:
        async def receive() -> dict:
            return {"type": "http.request", "body": b"pdf-bytes", "more_body": False}

        async def extract(function, args, **kwargs):
            self.assertIs(function, subprocess.run)
            Path(args[-1]).write_text("# PDF\n\nExtracted text", encoding="utf-8")
            return subprocess.CompletedProcess(args, 0, stdout="", stderr="")

        offload = AsyncMock(side_effect=extract)
        with patch.object(service, "run_in_threadpool", offload):
            result = asyncio.run(service.upload_doc(Request({"type": "http"}, receive), "book.pdf"))

        self.assertEqual(result["kind"], "pdf")
        offload.assert_awaited_once()

    def test_plan_persists_document_pointer_and_all_topic_memories(self) -> None:
        doc = self.upload()
        with patch.object(service, "start_job", return_value="job-test") as start:
            result = service.start_plan(service.PlanInput(docId=doc["docId"]))
        args = start.call_args.args[1]
        self.assertIn(f"--memory={service.STORE / 'memory' / doc['docId']}", args)
        self.assertIn(f"--document={service.DOCS / (doc['docId'] + '.json')}", args)
        self.assertNotEqual(result["planId"], doc["planId"])
        self.assertEqual(service.document(doc["docId"])["planId"], "")
        with self.assertRaises(HTTPException) as rejected:
            service.start_generate(service.GenerateInput(docId=doc["docId"], plan="another-document", topics=[0]))
        self.assertEqual(rejected.exception.status_code, 400)

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
