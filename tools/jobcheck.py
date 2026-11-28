"""Offline integration check: fake gateway, real Node worker, temporary job store."""

import asyncio
import json
import os
import re
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

from starlette.requests import Request

from server import app as service
from server.trace_report import summarize

STEM = "In the source, what manages a Rust value?"


class Gateway(BaseHTTPRequestHandler):
    mode = "generate-fail"

    def log_message(self, *args):
        pass

    def send_body(self, status, data, content_type="application/json"):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.end_headers()
        self.wfile.write(data.encode())

    def do_POST(self):
        data = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        model = data["model"]
        if (model, self.mode) in {("test-generation", "generate-fail"), ("test-review", "review-fail")}:
            return self.send_body(403, json.dumps({
                "code": "INSUFFICIENT_BALANCE", "message": "Insufficient account balance",
            }))
        if model == "test-review":
            return self.send_body(200, json.dumps({
                "choices": [{"message": {"content": "1"}}],
                "usage": {"prompt_tokens": 5, "completion_tokens": 1},
            }))
        assert model == "test-generation", model
        messages = data["messages"]
        found = re.search(r"sec_[0-9a-f]{16}", messages[1]["content"])
        assert found is not None
        key = found.group(0)
        if not any(row["role"] == "tool" for row in messages):
            delta = {"tool_calls": [{
                "index": 0, "id": "tool-1",
                "function": {"name": "read_source", "arguments": json.dumps({"sectionId": key})},
            }]}
            reason = "tool_calls"
        else:
            assert any("Ownership" in row["content"] for row in messages if row["role"] == "tool")
            delta = {"content": json.dumps({"questions": [{
                "knowledge": "Ownership", "stem": STEM, "options": ["Ownership", "Randomness"],
                "answer": 0, "explain": "Ownership manages each Rust value.", "sectionIds": [key],
            }]})}
            reason = "stop"
        frame = json.dumps({"choices": [{"delta": delta, "finish_reason": reason}]})
        self.send_body(200, f"data: {frame}\n\ndata: [DONE]\n\n", "text/event-stream")


def wait(job_id):
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        status = service.get_job(job_id)
        if status["state"] in {"fail", "done"}:
            return status
        time.sleep(0.025)
    raise RuntimeError(f"Timed out waiting for {job_id}")


async def upload():
    paragraph = "Ownership manages each Rust value. Each value has one owner, and is dropped when the owner goes out of scope.\n\n"
    text = "# Rust\n\n## Ownership\n\n" + paragraph * 12

    async def receive():
        return {"type": "http.request", "body": text.encode(), "more_body": False}

    return await service.upload_doc(Request({"type": "http"}, receive), "rust-test.md")


def main():
    Gateway.mode = "generate-fail"
    with ThreadingHTTPServer(("127.0.0.1", 0), Gateway) as gateway, tempfile.TemporaryDirectory() as temp:
        thread = threading.Thread(target=gateway.serve_forever, daemon=True)
        thread.start()
        url = f"http://127.0.0.1:{gateway.server_port}/v1"
        env = {"GEN_BASE_URL": url, "GEN_MODEL": "test-generation", "GEN_API_KEY": "fake-generation",
               "REVIEW_BASE_URL": url, "REVIEW_MODEL": "test-review", "REVIEW_API_KEY": "fake-review"}
        root = Path(temp)
        for sub in ("docs", "plans", "banks", "jobs", "answers"):
            (root / sub).mkdir()
        paths = dict(STORE=root, DOCS=root / "docs", PLANS=root / "plans", GEN_BANKS=root / "banks",
                     JOBS=root / "jobs", ANSWERS=root / "answers", CONFIG_FILE=root / "gen.json")
        try:
            with patch.dict(os.environ, env), patch.multiple(service, **paths, jobs={}, active_docs=set()):
                doc_id = asyncio.run(upload())["docId"]
                bank = root / "banks" / f"{doc_id}.md"
                plan = service.start_plan(service.PlanInput(docId=doc_id, mode="toc", summaries=False))
                planned = wait(plan["job"])
                assert planned["state"] == "done", planned
                service.import_topics(doc_id, service.ImportTopicsInput(plan=plan["planId"]))
                request = service.GenerateInput(docId=doc_id, plan=plan["planId"], topics=[0], per=1)
                first = service.start_generate(request)["jobs"][0]
                first = wait(first["id"])
                assert first["failure"] == {"stage": "generate", "code": "balance"}, first
                assert not bank.exists()
                Gateway.mode = "review-fail"
                second = service.retry_job(first["id"])["job"]
                assert service.retry_job(first["id"])["job"]["id"] == second["id"]
                second = wait(second["id"])
                assert second["failure"] == {"stage": "review", "code": "balance"}, second
                assert not bank.exists()
                Gateway.mode = "ok"
                final = wait(service.retry_job(second["id"])["job"]["id"])
                assert final["state"] == "done" and final["progress"]["written"] == 1, final
                assert STEM in bank.read_text(encoding="utf-8")
                trace = summarize(service.job_trace.path_for(service.JOBS, final["traceId"]))
                assert trace["retryOfTraceId"] == second["traceId"] and trace["planTraceId"] == planned["traceId"], trace
                assert trace["model"]["completedRequests"] == 3 and trace["model"]["reportedInputTokens"] == 5, trace
                assert trace["review"]["outcomes"] == {"pass": 1}, trace
                failed_trace = summarize(service.job_trace.path_for(service.JOBS, second["traceId"]))
                assert failed_trace["review"]["failureCodes"] == {"balance": 1}, failed_trace
                print("Offline worker integration passed (generation balance -> review balance -> persisted question and linked trace).")
        finally:
            gateway.shutdown()


if __name__ == "__main__":
    main()
