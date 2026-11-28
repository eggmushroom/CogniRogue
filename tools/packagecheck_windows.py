"""Verify the extracted ZIP over HTTP without any development tools on PATH."""

import json
import os
import socket
import subprocess
import tempfile
import threading
import time
import zipfile
from contextlib import contextmanager
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import ProxyHandler, Request, build_opener

import pymupdf

from tools.jobcheck import Gateway, STEM

ROOT = Path(__file__).resolve().parent.parent
URL = "http://127.0.0.1:17777"
CLIENT = build_opener(ProxyHandler({}))


def request(path, data=None, headers=None, status=200):
    headers = dict(headers or {})
    if isinstance(data, dict):
        data = json.dumps(data).encode()
        headers["Content-Type"] = "application/json"
    try:
        response = CLIENT.open(Request(URL + path, data, headers), timeout=3)
    except HTTPError as exc:
        response = exc
    with response:
        body = response.read()
        assert response.status == status, (path, response.status, body)
        return json.loads(body) if response.headers.get_content_type() == "application/json" else body


def eventually(callback, ready, timeout=20):
    deadline = time.monotonic() + timeout
    result = None
    while time.monotonic() < deadline:
        result = callback()
        if ready(result):
            return result
        time.sleep(0.1)
    raise AssertionError(f"Timed out waiting; last result: {result}")


def pdf_sample():
    with pymupdf.open() as pdf:
        page = pdf.new_page()
        page.insert_text((55, 50), "Ownership", fontsize=18)
        for row in range(12):
            page.insert_text((55, 85 + 22 * row), "Ownership manages each Rust value. Each value has exactly one owner.")
        pdf.set_toc([[1, "Ownership", 1]])
        return pdf.tobytes()


def clean_env(profile, gateway):
    env = {key.upper(): value for key, value in os.environ.items() if key.upper() not in {
        "VIRTUAL_ENV", "NODE_OPTIONS", "NODE_PATH", "GEN_BASE_URL", "GEN_API_KEY", "GEN_MODEL",
        "REVIEW_BASE_URL", "REVIEW_API_KEY", "REVIEW_MODEL",
    } and not key.upper().startswith(("PYTHON", "UV_"))}
    system = Path(env["SYSTEMROOT"])
    env.update(PATH=os.pathsep.join(map(str, [system / "System32", system, system / "System32" / "WindowsPowerShell" / "v1.0"])),
               LOCALAPPDATA=str(profile), REVIEW_BASE_URL=gateway, REVIEW_API_KEY="fake-review",
               REVIEW_MODEL="test-review")
    return env


def launcher(bundle):
    return [str(bundle / "runtime" / "python" / "python.exe"), "-I", "-B", "-X", "utf8",
            str(bundle / "launcher.py"), "--no-browser"]


@contextmanager
def running(bundle, scratch, env):
    process = subprocess.Popen(launcher(bundle), cwd=scratch, env=env, stdin=subprocess.DEVNULL,
                               stdout=subprocess.PIPE, stderr=subprocess.STDOUT, encoding="utf-8")
    try:
        def probe():
            if process.poll() is not None:
                log = Path(env["LOCALAPPDATA"]) / "CogniRogue" / "launcher.log"
                detail = log.read_text(encoding="utf-8") if log.is_file() else ""
                raise AssertionError(process.stdout.read() + detail)
            try:
                return request("/api/health")
            except OSError:
                return {}

        eventually(probe, lambda health: health.get("desktop") is True)
        yield
    finally:
        if process.poll() is None:
            process.terminate()
        process.communicate(timeout=8)


def job(job_id):
    row = eventually(lambda: request(f"/api/jobs/{job_id}"), lambda data: data["state"] in {"fail", "done"})
    assert row["state"] == "done", row
    return row


def main():
    if os.name != "nt":
        raise SystemExit("Run this test on Windows x64.")
    archive = ROOT / "release" / "CogniRogue-Windows-x64.zip"
    Gateway.mode = "ok"
    with tempfile.TemporaryDirectory(prefix="CogniRogue Windows ") as directory, \
         GatewayServer() as gateway, zipfile.ZipFile(archive) as package:
        scratch = Path(directory)
        unpack = scratch / "解压 目录"
        package.extractall(unpack)
        bundle = unpack / "CogniRogue"
        address = f"http://127.0.0.1:{gateway.server_port}/v1"
        profile = scratch / "测试 用户数据"
        env = clean_env(profile, address)

        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as occupied:
            occupied.bind(("127.0.0.1", 17777))
            occupied.listen()
            result = subprocess.run(launcher(bundle), cwd=scratch, env=env, timeout=15,
                                    capture_output=True, encoding="utf-8")
            assert result.returncode == 1 and "17777" in result.stderr, result

        with running(bundle, scratch, env):
            assert b"CogniRogue" in request("/")
            assert any(row["id"] == "words" for row in request("/api/banks"))
            second = subprocess.run([env["COMSPEC"], "/d", "/c", "Start-CogniRogue.cmd", "--no-browser"],
                                    cwd=bundle, env=env, stdin=subprocess.DEVNULL, timeout=15,
                                    capture_output=True, encoding="utf-8")
            assert second.returncode == 0 and "已在运行" in second.stdout, second
            settings = {"baseUrl": address, "key": "fake-generation", "model": "test-generation"}
            request("/api/config", settings, {"Origin": "https://example.invalid"}, status=403)
            request("/api/health", headers={"Host": "example.invalid"}, status=400)
            assert request("/api/config", settings, {"Origin": URL})["canGenerate"]
            doc = request("/api/docs", pdf_sample(), {"X-Doc-Name": quote("测试文档.pdf"),
                                                       "Content-Type": "application/octet-stream"})
            assert doc["pdfExtraction"]["pageCount"] == 1, doc
            doc_id = doc["docId"]
            plan = request("/api/plan", {"docId": doc_id, "mode": "auto", "summaries": False})
            topic_id = job(plan["job"])["plan"]["topics"][0]["id"]
            request(f"/api/docs/{doc_id}/topics", {"plan": plan["planId"]})
            out = request("/api/generate", {"docId": doc_id, "plan": plan["planId"], "topics": [0], "per": 1})
            assert job(out["jobs"][0]["id"])["progress"]["written"] == 1
            assert STEM.encode() in request(f"/api/banks/{doc_id}")
            pool = request("/api/run-pool", {"bankId": doc_id, "topics": [topic_id], "quota": 1})
            question = pool["questions"][0]
            assert question["q"] == STEM
            qid = question["qid"]
            source = request(f"/api/banks/{doc_id}/topics/{topic_id}/questions/{qid}/source")
            assert source["source"]["documentName"] == "测试文档.pdf", source
            assert request("/api/answers", {"v": 2, "bankId": doc_id, "events": [
                {"id": "packagecheck-1", "type": "answer", "topic": topic_id, "qid": qid,
                 "runId": "run-packagecheck", "right": True, "choice": 1},
            ]})["written"] == 1

        with running(bundle, scratch, env):
            assert STEM.encode() in request(f"/api/banks/{doc_id}")
            assert request(f"/api/docs/{doc_id}")["kind"] == "pdf"
            assert request("/api/health")["canGenerate"]
            rows = request(f"/api/answers/runs/{doc_id}/run-packagecheck")
            assert len(rows) == 1 and rows[0]["right"] is True, rows
        assert not (bundle / "data").exists()
    print("Windows ZIP verified: no tools on PATH, PDF -> plan -> generated bank, persisted data after restart.")


class GatewayServer:
    def __enter__(self):
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Gateway)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        return self.server

    def __exit__(self, *exc):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()


if __name__ == "__main__":
    main()
