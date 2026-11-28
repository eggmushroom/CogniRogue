from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import signal
import shutil
import subprocess
import sys
import threading
import time
import tomllib
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal
from urllib.parse import unquote

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, PlainTextResponse, Response
from pydantic import BaseModel, Field, StrictBool, StrictInt, ValidationInfo, field_validator
from starlette.concurrency import run_in_threadpool

from . import answer_store, job_failure, job_trace, question_source

ROOT = Path(__file__).resolve().parent.parent
PACKS, DIST = ROOT / "packs", ROOT / "dist"
DESKTOP = os.environ.get("COG_DESKTOP") == "1"
STORE = (Path(os.environ["COG_DESKTOP_DATA"]).resolve() if DESKTOP else
         Path(os.environ.get("COG_SOURCE_DATA") or ROOT / "data" / "service").resolve())
GEN_BANKS, DOCS, PLANS = STORE / "banks", STORE / "docs", STORE / "plans"
JOBS = STORE / "jobs"
ANSWERS = STORE / "answers"
CONFIG_FILE = STORE / "gen.json"
WORKERS = ROOT / ("workers" if DESKTOP else ".cache")
POOL_HELPER = WORKERS / "runpool.mjs"

with (ROOT / "pyproject.toml").open("rb") as project_file:
    PROJECT_VERSION = tomllib.load(project_file)["project"]["version"]

app = FastAPI(docs_url=None, redoc_url=None, version=PROJECT_VERSION)
jobs: dict[str, dict[str, Any]] = {}
job_lock = threading.Lock()
active_docs: set[str] = set()
MAX_FINISHED_JOBS = 30
MAX_SEQ = (1 << 63) - 1


class RunPoolInput(BaseModel):
    bankId: str
    topics: list[str] = Field(min_length=1)
    retired: list[str] = Field(default_factory=list)
    quota: StrictInt = 20


class ImportBankInput(BaseModel):
    text: str = Field(min_length=1, max_length=1_500_000)


class BankIdInput(BaseModel):
    id: str


class ConfigInput(BaseModel):
    baseUrl: str = ''
    key: str = ''
    model: str = ''


class PlanInput(BaseModel):
    docId: str
    mode: Literal['auto', 'toc', 'fixed', 'agentic'] = 'auto'
    size: StrictInt = 4000
    agenticWindow: StrictInt = Field(default=8000, ge=2000, le=20000)
    agenticOverlapChars: StrictInt = Field(default=800, ge=0)
    summaries: bool = True
    name: str = ''

    @field_validator("agenticOverlapChars")
    @classmethod
    def overlap_fits_window(cls, value: int, info: ValidationInfo) -> int:
        window = info.data.get("agenticWindow")
        if window is not None and value > window:
            raise ValueError("重叠字符数不能超过窗口字符数")
        return value


class GenerateInput(BaseModel):
    docId: str
    plan: str = ''
    per: StrictInt = 20
    topics: list[StrictInt] = Field(min_length=1)


class ImportTopicsInput(BaseModel):
    plan: str


class AnswerEventInput(BaseModel):
    id: str
    type: Literal['answer', 'reset', 'archive']
    topic: str = ''
    qid: str = ''
    runId: str | None = None
    right: StrictBool | None = None
    choice: StrictInt | None = Field(default=None, ge=1, le=4)
    archived: StrictBool = False


class AnswersInput(BaseModel):
    v: Literal[2]
    bankId: str = Field(min_length=1)
    events: list[AnswerEventInput] = Field(max_length=600)


def config() -> dict[str, str]:
    try:
        saved = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        saved = {}
    return {"baseUrl": os.environ.get("GEN_BASE_URL") or saved.get("baseUrl", ""), "key": os.environ.get("GEN_API_KEY") or saved.get("key", ""), "model": os.environ.get("GEN_MODEL") or saved.get("model", "")}


def banks() -> list[dict[str, Any]]:
    found: dict[str, dict[str, Any]] = {}
    builtin = PACKS / "words.md"
    if builtin.is_file():
        found["words"] = {"file": builtin, "kind": "pack", "id": "words"}
    for file in GEN_BANKS.glob("*.md") if GEN_BANKS.exists() else []:
        found[file.stem] = {"file": file, "kind": "generated", "id": file.stem}
    return list(found.values())


def recover_bank_transaction(output: Path | None = None) -> None:
    if output is None:
        for directory in (GEN_BANKS, PLANS):
            root = directory / ".gen-transaction"
            for transaction in list(root.iterdir()) if root.is_dir() else []:
                recover_bank_transaction(directory / transaction.name)
        return
    root = output.parent / ".gen-transaction"
    if not root.is_dir():
        return
    transactions = [root / output.name] if output else list(root.iterdir())
    for transaction in transactions:
        manifest = transaction / "commit.json"
        if not manifest.is_file():
            continue
        for item in json.loads(manifest.read_text(encoding="utf-8")):
            staged, target = Path(item["staged"]), Path(item["target"])
            expected = item["sha256"]
            if staged.exists():
                if hashlib.sha256(staged.read_bytes()).hexdigest() != expected:
                    raise RuntimeError(f"生成事务暂存文件校验失败：{staged.name}")
                target.parent.mkdir(parents=True, exist_ok=True)
                os.replace(staged, target)
            elif not target.is_file() or hashlib.sha256(target.read_bytes()).hexdigest() != expected:
                raise RuntimeError(f"生成事务文件缺失或校验失败：{target.name}")
        shutil.rmtree(transaction)
    if root.is_dir() and not any(root.iterdir()):
        root.rmdir()


def bank_row(bank: dict[str, Any]) -> dict[str, Any]:
    text = bank["file"].read_text(encoding="utf-8")
    match = re.search(r"^#[ \t]+(.+?)[ \t]*$", text, re.M)
    return {"id": bank["id"], "name": match.group(1) if match else bank["id"], "kind": bank["kind"], "bytes": bank["file"].stat().st_size}


def slug(name: str) -> str:
    stem = re.sub(r"\.(md|markdown|txt|pdf)$", "", name, flags=re.I)
    stem = re.sub(r"[^A-Za-z0-9_-]+", "-", stem).strip("-")[:40] or "doc"
    return f"{stem}-{hashlib.sha1(name.encode()).hexdigest()[:8]}"


def npm() -> str:
    return shutil.which("npm.cmd") or shutil.which("npm") or "npm"


def node() -> str:
    if DESKTOP:
        return str(ROOT / "runtime" / "node" / "node.exe")
    return shutil.which("node.exe") or shutil.which("node") or "node"


def trim_jobs() -> None:
    with job_lock:
        finished = sorted(
            (key for key, value in jobs.items() if value["state"] in {"done", "fail"}),
            key=lambda key: jobs[key]["started"],
        )
        for key in finished[:-MAX_FINISHED_JOBS]:
            job = jobs.pop(key)
            (JOBS / f"{key}.json").unlink(missing_ok=True)
            if job.get("completeFile"):
                Path(job["completeFile"]).unlink(missing_ok=True)
            if job.get("traceId"):
                job_trace.path_for(JOBS, job["traceId"]).unlink(missing_ok=True)


def complete_progress(job: dict[str, Any]) -> dict[str, Any]:
    progress = job.get("progress", {})
    total = progress.get("total", 1)
    return {**progress, "phase": "complete", "completed": total, "total": total, "label": "文件已完整写入"}


def save_job(job: dict[str, Any]) -> None:
    JOBS.mkdir(parents=True, exist_ok=True)
    target = JOBS / f"{job['id']}.json"
    temporary = target.with_suffix(".tmp")
    temporary.write_text(json.dumps(job, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, target)


def stop_process_tree(pid: int) -> None:
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True)
    else:
        try:
            os.killpg(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass


def process_command_line(pid: int) -> str | None:
    if os.name == "nt":
        result = subprocess.run(
            ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command",
             "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; "
             f"$p = Get-CimInstance Win32_Process -Filter 'ProcessId = {pid}'; if ($p) {{ [Console]::Write($p.CommandLine) }}"],
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=10,
        )
        return result.stdout if result.returncode == 0 and result.stdout else None
    result = subprocess.run(
        ["ps", "-p", str(pid), "-o", "command="],
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=10,
    )
    return result.stdout.strip() if result.returncode == 0 and result.stdout.strip() else None


def process_matches_job(job: dict[str, Any]) -> bool:
    try:
        pid = int(job["pid"])
        if pid <= 0:
            return False
        # A reused PID cannot identify a worker; its unique receipt argument can.
        marker = re.escape(f'--complete={job["completeFile"]}')
        command = process_command_line(pid) or ""
        flags = re.IGNORECASE if os.name == "nt" else 0
        return bool(re.search(rf'(?:^|\s)(?:"{marker}"|{marker})(?:\s|$)', command, flags))
    except (KeyError, OSError, subprocess.TimeoutExpired, TypeError, ValueError):
        return False


def completion_valid(job: dict[str, Any]) -> bool:
    try:
        receipt = json.loads(Path(job["completeFile"]).read_text(encoding="utf-8"))
        output = Path(job["output"])
        return receipt["output"] == str(output) and hashlib.sha256(output.read_bytes()).hexdigest() == receipt["sha256"]
    except (OSError, ValueError, KeyError, TypeError):
        return False


def make_job(kind: str, args: list[str], output: Path, lock_doc: str, job_id: str,
             complete_file: Path, cleanup: list[Path] | None = None, **meta: Any) -> dict[str, Any]:
    return {"id": job_id, "kind": kind, "args": args, "output": str(output), "lock_doc": lock_doc,
            "completeFile": str(complete_file), "cleanup": [str(path) for path in cleanup or []],
            "state": "queued", "lines": [], "started": time.time(),
            "progress": {"phase": "queued", "completed": 0, "total": 1, "label": "等待运行"}, **meta}


def dispatch_jobs() -> None:
    # 调用者持有 job_lock。同一文档的任务共享题库、记忆与检查点，必须串行提交。
    for job in jobs.values():
        doc_id = job["lock_doc"]
        if job["state"] != "queued" or doc_id in active_docs:
            continue
        job["state"] = "running"
        job.pop("activity", None)
        job.pop("failure", None)
        job["progress"] = {"phase": "starting", "completed": 0, "total": 1, "label": "开始运行"}
        job.setdefault("runStarted", time.time())
        job_trace.ensure(JOBS, job)
        job["traceExecution"] = {"spanId": secrets.token_hex(8), "startedAt": job_trace.now_ms(),
                                 "attempt": job.get("traceExecution", {}).get("attempt", 0) + 1}
        execution = job["traceExecution"]
        job_trace.lifecycle(JOBS, job, "worker", execution["spanId"], "start", parent=job["traceId"][:16],
                            attempt=execution["attempt"], queueMs=max(0, execution["startedAt"] - job.get("traceQueuedAt", job["traceStartedAt"])))
        save_job(job)
        active_docs.add(doc_id)
        threading.Thread(target=run_job, args=(job,), daemon=True).start()


def enqueue_job(job: dict[str, Any]) -> None:
    # Called with job_lock held, after checking the document and requested topics.
    job_trace.ensure(JOBS, job)
    save_job(job)
    jobs[job["id"]] = job


def run_job(job: dict[str, Any]) -> None:
    kind = job["kind"]
    output = Path(job["output"])
    completed = False
    try:
        if kind == 'gen' and job.get('topicId'):
            started = job_trace.now_ms()
            span = secrets.token_hex(8)
            worker = job["traceExecution"]["spanId"]
            job_trace.lifecycle(JOBS, job, "feedback", span, "start", parent=worker)
            try:
                prepare_feedback(job)
            except Exception:
                job_trace.lifecycle(JOBS, job, "feedback", span, "end", parent=worker, outcome="error", since=started)
                raise
            job_trace.lifecycle(JOBS, job, "feedback", span, "end", parent=worker, outcome="ok", since=started)
        cfg = config()
        env = os.environ.copy()
        env.update(GEN_API_KEY=cfg["key"], GEN_BASE_URL=cfg["baseUrl"], GEN_MODEL=cfg["model"],
                   COG_TRACE_ID=job["traceId"], COG_JOB_ID=job["id"],
                   COG_PARENT_SPAN_ID=job["traceExecution"]["spanId"])
        script = WORKERS / ("plan.mjs" if kind == "plan" else "gen.mjs")
        process = subprocess.Popen([node(), str(script), *job["args"]], cwd=ROOT, env=env,
                                   stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                   encoding="utf-8", errors="replace",
                                   start_new_session=os.name != "nt",
                                   creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0)
        job["pid"] = process.pid
        save_job(job)
        assert process.stdout is not None
        for line in process.stdout:
            line = line.strip()
            event, _, payload = line.partition(" ")
            if event == "@@trace":
                job_trace.accept_child(JOBS, job, payload)
                continue
            if event in {"@@progress", "@@activity", "@@failure"}:
                try:
                    data = json.loads(payload)
                except json.JSONDecodeError:
                    continue
                if not isinstance(data, dict):
                    continue
                with job_lock:
                    if event == "@@progress":
                        job["progress"] = data
                    elif event == "@@activity":
                        activity = job.setdefault("activity", [])
                        activity.append({**data, "ms": job_elapsed(job)})
                        del activity[:-8]
                    elif failure := job_failure.from_worker(data):
                        job["failure"] = failure
                    save_job(job)
                continue
            job["lines"].append(line)
            del job["lines"][:-200]
            save_job(job)
        code = process.wait()
        recover_bank_transaction(Path(job["output"]))
        completed = code == 0 and output.exists() and completion_valid(job)
        if completed and kind == "plan":
            plan = json.loads(output.read_text(encoding="utf-8"))
            job["plan"] = plan
    except Exception as exc:
        completed = False
        job["lines"].append(str(exc))
    finally:
        with job_lock:
            job["ms"] = job_elapsed(job)
            job["state"] = "done" if completed else "fail"
            if completed:
                job["progress"] = complete_progress(job)
            else:
                job["failure"] = job_failure.for_job(job)
            job.pop("pid", None)
            finish_trace(job, "ok" if completed else "error")
            save_job(job)
            for path in job["cleanup"]:
                try:
                    Path(path).unlink(missing_ok=True)
                except OSError:
                    pass
            active_docs.discard(job["lock_doc"])
            dispatch_jobs()
        trim_jobs()


def finish_trace(job: dict[str, Any], outcome: str, *, finished: bool = True) -> None:
    execution = job.get("traceExecution")
    if not execution:
        return
    trace_id = job["traceId"]
    job_trace.lifecycle(JOBS, job, "worker", execution["spanId"], "end", parent=trace_id[:16],
                        outcome=outcome, since=execution["startedAt"])
    if finished:
        job_trace.lifecycle(JOBS, job, "job", trace_id[:16], "end", outcome=outcome,
                            since=job["traceStartedAt"], executions=execution["attempt"],
                            **({"failureStage": job["failure"]["stage"], "failureCode": job["failure"]["code"]}
                               if outcome == "error" and job.get("failure") else {}))


@app.on_event("startup")
def startup() -> None:
    for directory in (GEN_BANKS, DOCS, PLANS, JOBS, ANSWERS):
        directory.mkdir(parents=True, exist_ok=True)
    with answer_store.connect(ANSWERS):
        pass
    if DESKTOP:
        required = [DIST / "index.html", Path(node()), POOL_HELPER, WORKERS / "plan.mjs", WORKERS / "gen.mjs",
                    PACKS / "words.md", ROOT / "tools" / "pdf2md.py"]
        missing = [str(path.relative_to(ROOT)) for path in required if not path.is_file()]
        if missing:
            raise RuntimeError("完整版文件缺失，请完整解压： " + ", ".join(missing))
    else:
        result = subprocess.run([npm(), "run", "service:build"], cwd=ROOT, capture_output=True, text=True)
        if result.returncode:
            raise RuntimeError("无法构建服务任务：" + result.stderr[-1200:])
    saved_jobs = []
    for file in JOBS.glob("job-*.json"):
        try:
            job = json.loads(file.read_text(encoding="utf-8"))
            job.pop("modelOutput", None)
            saved_jobs.append(job)
            if job.get("state") == "running" and not completion_valid(job) and process_matches_job(job):
                stop_process_tree(int(job["pid"]))
        except (OSError, ValueError, KeyError, TypeError):
            continue
    recover_bank_transaction()
    with job_lock:
        for job in sorted(saved_jobs, key=lambda job: job.get("started", 0)):
            try:
                if job["state"] == "running":
                    if completion_valid(job):
                        job["state"] = "done"
                        finish_trace(job, "ok")
                        job["progress"] = complete_progress(job)
                        job["ms"] = int((time.time() - job.get("runStarted", job["started"])) * 1000)
                        if job["kind"] == "plan":
                            job["plan"] = json.loads(Path(job["output"]).read_text(encoding="utf-8"))
                        for path in job.get("cleanup", []):
                            Path(path).unlink(missing_ok=True)
                    else:
                        finish_trace(job, "interrupted", finished=False)
                        job["state"] = "queued"
                        job["traceQueuedAt"] = job_trace.now_ms()
                    job.pop("pid", None)
                    save_job(job)
                jobs[job["id"]] = job
            except (OSError, ValueError, KeyError, TypeError):
                continue
        dispatch_jobs()
    trim_jobs()


@app.get("/api/health")
def health() -> dict[str, Any]:
    rows = [bank_row(bank) for bank in banks()]
    cfg = config()
    return {"ok": True, "version": app.version, "apiVersion": 1, "desktop": DESKTOP, "banks": len(rows), "generated": sum(row["kind"] == "generated" for row in rows), "canGenerate": bool(cfg["key"]), "model": cfg["model"], "baseUrl": cfg["baseUrl"]}


@app.get("/api/banks")
def list_banks() -> list[dict[str, Any]]:
    rows = [bank_row(bank) for bank in banks()]
    rows.sort(key=lambda row: (row["kind"] != "pack", row["id"]))
    return rows


@app.get("/api/banks/{bank_id}")
def get_bank(bank_id: str) -> Response:
    bank = next((bank for bank in banks() if bank["id"] == bank_id), None)
    if not bank:
        raise HTTPException(404, f"没有这份题库：{bank_id}")
    return PlainTextResponse(bank["file"].read_text(encoding="utf-8"), media_type="text/markdown")


@app.get("/api/banks/{bank_id}/topics/{topic_id}/questions/{qid}/source")
def get_question_source(bank_id: str, topic_id: str, qid: str, section: str | None = None) -> dict[str, Any]:
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", bank_id):
        raise HTTPException(400, "题库编号无效。")
    empty = {"source": None} if section is None else {"section": None}
    if not re.fullmatch(r"t_[a-f0-9]{24}", topic_id) or not 0 < len(qid) <= 128:
        return empty
    doc = question_source.read_object(DOCS / f"{bank_id}.json")
    if not doc or doc.get("docId") != bank_id or doc.get("kind") not in ("md", "pdf"):
        return empty
    name = doc.get("name")
    if not isinstance(name, str) or not (name := re.split(r"[/\\]", name)[-1].strip()):
        return empty
    catalog, index = question_source.topic_files(STORE / "memory" / bank_id, topic_id)
    saved = question_source.saved_question(catalog, qid)
    ids = saved.get("sectionIds")
    if not isinstance(ids, list) or not ids:
        return empty
    if section is not None and (not re.fullmatch(r"sec_[a-f0-9]{16}", section) or section not in ids):
        return empty
    try:
        text = (GEN_BANKS / f"{bank_id}.md").read_text(encoding="utf-8")
    except FileNotFoundError:
        return empty

    # The catalog can outlive a deleted/regenerated pack. Confirm the current question
    # with the same DSL parser used by the game, not a second interpretation of Markdown.
    try:
        result = subprocess.run(
            [node(), str(POOL_HELPER)], cwd=ROOT,
            input=json.dumps({"action": "find-question", "text": text, "topic": topic_id, "qid": qid}),
            capture_output=True, text=True, encoding="utf-8", timeout=5, check=True,
        )
        current = json.loads(result.stdout)["question"]
    except (OSError, subprocess.SubprocessError, ValueError, KeyError) as exc:
        raise HTTPException(503, "暂时无法核对题目出处。") from exc
    if not current or any(current.get(key) != saved.get(key) for key in ("stem", "options", "answer")):
        return empty
    sections = question_source.sections_for(STORE / "sections" / bank_id, index, ids, doc, only=section)
    if section is not None:
        return {"section": sections[0]} if sections else empty
    return {"source": {"documentName": name, "sections": sections}} if sections else empty


@app.post("/api/run-pool")
def create_run_pool(body: RunPoolInput) -> dict[str, Any]:
    bank_id = body.bankId
    bank = next((row for row in banks() if row["id"] == bank_id), None)
    if not bank:
        raise HTTPException(404, "题库不存在或已删除，请返回题库列表刷新。")
    topics, retired = body.topics, body.retired
    try:
        result = subprocess.run(
            [node(), str(POOL_HELPER)], cwd=ROOT,
            input=json.dumps({"text": bank["file"].read_text(encoding="utf-8"), "topics": topics,
                              "retired": retired, "quota": body.quota}),
            capture_output=True, text=True, encoding="utf-8", timeout=20,
        )
        if result.returncode:
            raise RuntimeError(result.stderr[-1200:])
        questions = json.loads(result.stdout).get("questions", [])
    except (OSError, subprocess.SubprocessError, json.JSONDecodeError, RuntimeError) as exc:
        raise HTTPException(500, "题库暂时无法读取：" + str(exc)) from exc
    if not questions:
        raise HTTPException(400, "所选主题没有可用题目，请重新选择主题。")
    return {"ok": True, "questions": questions}


@app.post("/api/banks/import")
def import_bank(body: ImportBankInput) -> dict[str, Any]:
    text = body.text
    if not text.strip():
        raise HTTPException(400, "题库内容为空或超过 1.5 MB。")
    try:
        result = subprocess.run(
            [node(), str(POOL_HELPER)], cwd=ROOT,
            input=json.dumps({"action": "inspect", "text": text}),
            capture_output=True, text=True, encoding="utf-8", timeout=20,
        )
        if result.returncode:
            raise RuntimeError(result.stderr[-1200:])
        parsed = json.loads(result.stdout)
    except (OSError, subprocess.SubprocessError, json.JSONDecodeError, RuntimeError) as exc:
        raise HTTPException(500, "题库校验失败：" + str(exc)) from exc
    if parsed.get("issues") or not parsed.get("total"):
        issues = parsed.get("issues") or ["没有解析出题目"]
        raise HTTPException(400, "；".join(str(issue) for issue in issues[:3]))
    bank_id = "import-" + hashlib.sha1(text.encode("utf-8")).hexdigest()[:12]
    GEN_BANKS.mkdir(parents=True, exist_ok=True)
    (GEN_BANKS / f"{bank_id}.md").write_text(text, encoding="utf-8")
    return {"ok": True, "id": bank_id, "name": parsed.get("name", bank_id), "total": parsed["total"]}


@app.post("/api/banks/delete")
def delete_bank(body: BankIdInput) -> dict[str, Any]:
    bank_id = body.id
    if bank_id == "words":
        raise HTTPException(400, "英语内置题库不能删除。")
    if not re.fullmatch(r"[A-Za-z0-9_-]+", bank_id):
        raise HTTPException(400, "题库编号无效。")
    target = GEN_BANKS / f"{bank_id}.md"
    if not target.is_file():
        raise HTTPException(404, "题库不存在或已删除。")
    with job_lock:
        if bank_id in active_docs:
            raise HTTPException(409, "这份文档还有任务在处理。")
        target.unlink(missing_ok=True)
    return {"ok": True, "id": bank_id}


@app.post("/api/config")
def save_config(body: ConfigInput) -> dict[str, Any]:
    old = config()
    saved = {"baseUrl": body.baseUrl.strip(), "key": body.key.strip() or old["key"], "model": body.model.strip()}
    STORE.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(json.dumps(saved, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": True, "canGenerate": bool(saved["key"]), "model": saved["model"], "baseUrl": saved["baseUrl"]}


def document(doc_id: str) -> dict[str, Any]:
    if not re.fullmatch(r"[A-Za-z0-9_-]+", doc_id):
        raise HTTPException(400, "文档编号无效。")
    path = DOCS / f"{doc_id}.json"
    if not path.is_file():
        raise HTTPException(404, "文档不存在。")
    return json.loads(path.read_text(encoding="utf-8"))


def imported_plan(row: dict[str, Any]) -> str:
    # 旧版保存的计划直接作为已导入主题继续使用。
    return row.get("importedPlanId", row.get("planId", ""))


@app.get("/api/docs")
def list_documents() -> list[dict[str, Any]]:
    rows = [json.loads(path.read_text(encoding="utf-8")) for path in DOCS.glob("*.json")]
    return sorted(({**row, "importedPlanId": imported_plan(row)} for row in rows),
                  key=lambda row: row["createdAt"], reverse=True)


@app.get("/api/docs/{doc_id}")
def get_document(doc_id: str) -> dict[str, Any]:
    with job_lock:
        row = document(doc_id)
        running = next((job_status(job, details=True) for job in jobs.values()
                        if job["kind"] == "plan" and job["lock_doc"] == doc_id and job["state"] == "running"), None)
        plan = json.loads((PLANS / f"{row['planId']}.json").read_text(encoding="utf-8")) if row.get("planId") else None
    return {**row, "importedPlanId": imported_plan(row), "plan": plan, "job": running}


def require_idle_document(doc_id: str) -> dict[str, Any]:
    # Caller holds job_lock so checking and cleaning are atomic with job submission.
    row = document(doc_id)
    if doc_id in active_docs or any(job.get("lock_doc") == doc_id and job.get("state") in {"queued", "running"}
                                    for job in jobs.values()):
        raise HTTPException(409, "这份文档还有任务在处理。")
    return row


def clear_document_artifacts(doc_id: str, row: dict[str, Any], *, delete_source: bool) -> None:
    # Document-derived artifacts use this validated doc_id as their namespace.
    for suffix in (".md", ".md.checkpoint.json"):
        (GEN_BANKS / f"{doc_id}{suffix}").unlink(missing_ok=True)
    for plan in PLANS.glob(f"{doc_id}-*.json") if PLANS.exists() else []:
        plan.unlink(missing_ok=True)
    for directory in (STORE / "memory" / doc_id, STORE / "sections" / doc_id):
        if directory.exists():
            shutil.rmtree(directory)
    for job in jobs.values():
        if job.get("lock_doc") == doc_id:
            (STORE / "feedback" / f"{job['id']}.json").unlink(missing_ok=True)
    if delete_source:
        for suffix in (".json", ".md", ".pdf", ".tmp"):
            (DOCS / f"{doc_id}{suffix}").unlink(missing_ok=True)
    else:
        row["planId"] = ""
        row["importedPlanId"] = ""
        manifest = DOCS / f"{doc_id}.json"
        temporary = manifest.with_suffix(".tmp")
        temporary.write_text(json.dumps(row, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.replace(temporary, manifest)


@app.post("/api/docs/{doc_id}/reset")
def reset_document(doc_id: str) -> dict[str, Any]:
    with job_lock:
        row = require_idle_document(doc_id)
        clear_document_artifacts(doc_id, row, delete_source=False)
    return {"ok": True, "docId": doc_id}


@app.delete("/api/docs/{doc_id}")
def delete_document(doc_id: str) -> dict[str, Any]:
    with job_lock:
        row = require_idle_document(doc_id)
        clear_document_artifacts(doc_id, row, delete_source=True)
    return {"ok": True, "docId": doc_id}


@app.post("/api/docs/{doc_id}/topics")
def import_topics(doc_id: str, body: ImportTopicsInput) -> dict[str, Any]:
    with job_lock:
        row = document(doc_id)
        if doc_id in active_docs:
            raise HTTPException(409, "请等待文档任务完成。")
        read_plan(row, body.plan)
        row["importedPlanId"] = body.plan
        path = DOCS / f"{doc_id}.json"
        temporary = path.with_suffix(".tmp")
        temporary.write_text(json.dumps(row, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.replace(temporary, path)
    return {"ok": True}


@app.post("/api/docs")
async def upload_doc(request: Request, x_doc_name: str = Header(default="doc.md")) -> dict[str, Any]:
    raw = await request.body()
    if len(raw) > 32 * 1024 * 1024:
        raise HTTPException(413, "请求体太大（上限 32 MB）")
    name = unquote(x_doc_name)
    doc_id = f"{slug(name)}-{secrets.token_hex(6)}"
    DOCS.mkdir(parents=True, exist_ok=True)
    md = DOCS / f"{doc_id}.md"
    manifest = DOCS / f"{doc_id}.json"
    kind = "pdf" if Path(name).suffix.lower() == ".pdf" else "md"
    extraction = None
    pdf = DOCS / f"{doc_id}.pdf"
    if kind == "pdf":
        incoming = DOCS / f"{doc_id}.upload.pdf"
        draft = DOCS / f"{doc_id}.upload.md"
        try:
            incoming.write_bytes(raw)
            extraction = await extract_pdf(incoming, draft)
            text = draft.read_text(encoding="utf-8")
            os.replace(incoming, pdf)
        finally:
            incoming.unlink(missing_ok=True)
            draft.unlink(missing_ok=True)
    else:
        try:
            text = raw.decode("utf-8-sig")
        except UnicodeDecodeError as exc:
            raise HTTPException(400, "请使用 UTF-8 编码的 Markdown 文档。") from exc
    if not text.strip():
        raise HTTPException(400, "这份文件是空的。")
    temporary = md.with_suffix(".tmp")
    temporary.write_text(text, encoding="utf-8")
    os.replace(temporary, md)
    row = {"docId": doc_id, "name": name, "kind": kind, "chars": len(text),
           "createdAt": datetime.now(timezone.utc).isoformat(), "planId": "", "importedPlanId": ""}
    if extraction is not None:
        row["pdfExtraction"] = extraction
    temporary = manifest.with_suffix(".tmp")
    temporary.write_text(json.dumps(row, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, manifest)
    return {"ok": True, **row}


async def extract_pdf(incoming: Path, draft: Path) -> dict[str, Any]:
    try:
        result = await run_in_threadpool(
            subprocess.run,
            [sys.executable, *(["-I", "-B"] if DESKTOP else []),
             str(ROOT / "tools" / "pdf2md.py"), "--report-json", str(incoming), str(draft)],
            cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=90,
        )
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(408, "PDF 文字提取超时，请拆分文档后重试。") from exc
    try:
        report = json.loads(result.stdout)
    except json.JSONDecodeError:
        report = None
    if isinstance(report, dict):
        if result.returncode == 1 and isinstance(report.get("error"), str):
            raise HTTPException(400, report["error"])
        if result.returncode == 0 and "pageCount" in report and draft.is_file() and draft.stat().st_size:
            return report
    raise HTTPException(500, "本机服务无法提取 PDF 文字，请检查 Python 依赖。")


@app.post("/api/plan")
def start_plan(body: PlanInput) -> dict[str, Any]:
    doc_id = body.docId
    with job_lock:
        saved = require_idle_document(doc_id)
        source = DOCS / f"{doc_id}.md"
        if not source.exists():
            raise HTTPException(404, "没有这份文档，可能已经清理掉了。")
        mode = body.mode
        cfg = config()
        if mode == "agentic" and not cfg["key"]:
            raise HTTPException(400, "模型分章要先用「设置 › 出题模型」配好模型。")
        size = max(500, min(20000, body.size))
        plan_id = f"{doc_id}-{secrets.token_hex(6)}"
        output = PLANS / f"{plan_id}.json"
        job_id = f"job-{secrets.token_hex(6)}"
        complete_file = JOBS / f"{job_id}.complete"
        args = [f"--src={source}", f"--out={output}", f"--mode={mode}", f"--size={size}",
                f"--window={body.agenticWindow}", f"--overlap={body.agenticOverlapChars}",
                f"--name={saved['name']}", f"--complete={complete_file}",
                f"--memory={STORE / 'memory' / doc_id}", f"--sections={STORE / 'sections' / doc_id}",
                f"--document={DOCS / (doc_id + '.json')}"]
        if not body.summaries:
            args.append("--no-summaries")
        job = make_job("plan", args, output, doc_id, job_id, complete_file, planId=plan_id,
                       docId=doc_id, name=saved["name"], taskType="plan", title="目录解析")
        enqueue_job(job)
        dispatch_jobs()
    return {"ok": True, "job": job_id, "planId": plan_id}


def read_plan(row: dict[str, Any], plan_id: str) -> tuple[Path, list[dict[str, Any]]]:
    if not plan_id or plan_id != row.get("planId"):
        raise HTTPException(400, "请打开文档使用当前的主题划分。")
    plan_file = PLANS / f"{plan_id}.json"
    try:
        plan = json.loads(plan_file.read_text(encoding="utf-8"))
        topics = plan['topics']
        if plan.get('v') != 2 or not topics or not all(re.fullmatch(r't_[a-f0-9]{24}', t['id']) for t in topics):
            raise ValueError("missing topics")
    except (OSError, ValueError, KeyError, TypeError):
        raise HTTPException(400, "划分计划无效，请重新划分文档。") from None
    return plan_file, topics


def prepare_feedback(job: dict[str, Any]) -> None:
    topic_id = job['topicId']
    bank_id = job['bankId']
    path = STORE / 'feedback' / f"{job['id']}.json"
    # A recovered task reuses the same input even if more answers have arrived.
    if not path.is_file():
        directory = STORE / 'memory' / bank_id
        progress = directory / f'{topic_id}.progress.json'
        version = 7
        if not progress.is_file():
            progress = directory / f'{topic_id}.json'
            version = 6
        after = 0
        if progress.is_file():
            memory = json.loads(progress.read_text(encoding='utf-8'))
            after = memory.get('cursor')
            if (memory.get('v') != version or memory.get('topicId') != topic_id
                    or type(after) is not int or not 0 <= after < (1 << 53)):
                raise ValueError(f'Invalid topic progress: {progress.name}')
        snapshot = answer_store.feedback(ANSWERS, bank_id, topic_id, after)
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix('.tmp')
        temporary.write_text(json.dumps(snapshot, ensure_ascii=False), encoding='utf-8')
        os.replace(temporary, path)


@app.post("/api/generate")
def start_generate(body: GenerateInput) -> dict[str, Any]:
    with job_lock:
        return {"ok": True, "jobs": queue_generation(body)}


def queue_generation(body: GenerateInput, previous: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    """Validate and enqueue under job_lock; retries use the same path as fresh jobs."""
    doc_id = body.docId
    row = document(doc_id)
    if imported_plan(row) != body.plan:
        raise HTTPException(409 if previous else 400, "已导入的主题划分已变更，请从文档重新选择主题。"
                            if previous else "请先导入文档主题。")
    plan_file, topics = read_plan(row, body.plan)
    selection = sorted(set(body.topics))
    if any(index < 0 or index >= len(topics) for index in selection):
        raise HTTPException(400, "所选主题不在当前划分计划中。")
    if previous and topics[selection[0]]["id"] != previous.get("topicId"):
        raise HTTPException(409, "原主题已变更，请从文档重新选择主题。")
    for job in jobs.values():
        if job["lock_doc"] != doc_id:
            continue
        same_topic = job.get("planId") == body.plan and job.get("topic") in selection
        if job["state"] in {"queued", "running"} and (job.get("topic") is None or same_topic):
            raise HTTPException(409, "所选主题已有任务，或文档正在划分。")
        if previous and same_topic and job["state"] == "done" and job["started"] >= previous["started"]:
            raise HTTPException(409, "这个主题之后已经成功出题，无需重试旧任务。")
    if not config()["key"]:
        raise HTTPException(400, "服务还没有模型配置。请在设置中配置。")
    source = DOCS / f"{doc_id}.md"
    if not source.is_file():
        raise HTTPException(404, "没有这份文档，可能已经清理掉了。")
    output = GEN_BANKS / f"{doc_id}.md"
    per = max(1, min(40, body.per))
    plan_trace_id = next((job.get("traceId") for job in jobs.values()
                          if job["kind"] == "plan" and job.get("planId") == body.plan and job.get("traceId")),
                         previous.get("planTraceId") if previous else None)
    retry = {"retryOfJobId": previous["id"], "retryOfTraceId": previous.get("traceId")} if previous else {}
    accepted = []
    for index in selection:
        topic = topics[index]
        job_id = f"job-{secrets.token_hex(6)}"
        complete_file = JOBS / f"{job_id}.complete"
        memory = STORE / "memory" / doc_id
        feedback = STORE / 'feedback' / f'{job_id}.json'
        args = [f"--src={source}", f"--out={output}", f"--memory={memory}",
                f"--sections={STORE / 'sections' / doc_id}", f"--per={per}",
                f"--complete={complete_file}", f"--plan={plan_file}", f"--topic-id={topic['id']}", f"--feedback={feedback}"]
        job = make_job("gen", args, output, doc_id, job_id, complete_file, [feedback],
                       bankId=doc_id, planId=body.plan, topic=index, topicId=topic['id'], taskType="generate",
                       title=topic['title'], name=row["name"], per=per, planTraceId=plan_trace_id, **retry)
        enqueue_job(job)
        accepted.append(job)
    dispatch_jobs()
    return [job_status(job) for job in accepted]


@app.post("/api/jobs/{job_id}/retry")
def retry_job(job_id: str) -> dict[str, Any]:
    """Reuse the direct successor on repeat submissions; never enqueue twice."""
    with job_lock:
        previous = jobs.get(job_id)
        if not previous:
            raise HTTPException(404, "没有这个任务。")
        if previous["state"] != "fail" or previous.get("taskType") != "generate" or previous.get("topic") is None:
            raise HTTPException(409, "只能重试失败的主题出题任务。")
        successor = next((job for job in jobs.values() if job.get("retryOfJobId") == job_id), None)
        if successor:
            return {"ok": True, "job": job_status(successor)}
        per = previous.get("per")
        if per is None:  # Jobs saved before the explicit per field.
            per = next((int(arg[6:]) for arg in previous["args"] if re.fullmatch(r"--per=\d{1,2}", arg)), 20)
        body = GenerateInput(docId=previous["lock_doc"], plan=previous["planId"], per=per, topics=[previous["topic"]])
        return {"ok": True, "job": queue_generation(body, previous)[0]}


@app.get("/api/jobs")
def list_jobs() -> list[dict[str, Any]]:
    with job_lock:
        return [job_status(job) for job in jobs.values()]


def job_elapsed(job: dict[str, Any]) -> int:
    return int((time.time() - job.get("runStarted", job["started"])) * 1000)


def job_status(job: dict[str, Any], details: bool = False) -> dict[str, Any]:
    result = {
        "id": job["id"],
        "state": job["state"],
        "taskType": job["taskType"],
        "title": job["title"],
        "bankId": job.get("bankId"),
        "ms": job.get("ms", job_elapsed(job) if job["state"] == "running" else 0),
        "planId": job.get("planId"),
        "topic": job.get("topic"),
        "name": job.get("name"),
        "tail": "\n".join(job["lines"][-6:]),
        "progress": job.get("progress", {"phase": "starting", "completed": 0, "total": 1}),
    }
    if job.get("traceId"):
        result["traceId"] = job["traceId"]
    if job.get("retryOfJobId"):
        result["retryOfJobId"] = job["retryOfJobId"]
    if job["state"] == "fail":
        result["failure"] = job_failure.for_job(job)
    if job.get("activity"):
        result["activity"] = list(job["activity"])
    if details and "plan" in job:
        result["plan"] = job["plan"]
    return result


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str) -> dict[str, Any]:
    with job_lock:
        job = jobs.get(job_id)
        if not job:
            raise HTTPException(404, "没有这个任务")
        return job_status(job, details=True)


@app.get("/api/traces/{trace_id}")
def get_trace(trace_id: str) -> Response:
    if not re.fullmatch(r"[0-9a-f]{32}", trace_id):
        raise HTTPException(404, "没有这条 Trace")
    try:
        data = job_trace.path_for(JOBS, trace_id).read_bytes()
    except FileNotFoundError:
        raise HTTPException(404, "没有这条 Trace") from None
    # A running child may be appending its final line while the browser downloads.
    return Response(data[:data.rfind(b"\n") + 1], media_type="application/x-ndjson",
                    headers={"Content-Disposition": f'attachment; filename="trace-{trace_id}.jsonl"',
                             "Cache-Control": "no-store"})


@app.get("/api/answers/runs")
def list_answer_runs(archived: bool = False, before: int = MAX_SEQ, limit: int = 40) -> list[dict[str, Any]]:
    return answer_store.runs(ANSWERS, archived, max(0, min(before, MAX_SEQ)), max(1, min(limit, 100)))


@app.get("/api/answers/runs/{bank_id}/{run_id}")
def answer_run_details(bank_id: str, run_id: str, before: int = MAX_SEQ, limit: int = 60) -> list[dict[str, Any]]:
    return answer_store.details(ANSWERS, bank_id, run_id, max(0, min(before, MAX_SEQ)), max(1, min(limit, 100)))


@app.post("/api/answers")
def save_answers(payload: AnswersInput) -> dict[str, Any]:
    if any(event.type == 'answer' and (event.right is None or event.choice is None) for event in payload.events):
        raise HTTPException(400, "答题记录格式无效。")
    if any(event.type != 'archive' and (not event.topic or not event.qid) for event in payload.events):
        raise HTTPException(400, "答题记录缺少主题或题号。")
    if any(event.type == 'archive' and not event.runId for event in payload.events):
        raise HTTPException(400, "归档记录缺少本局编号。")
    if not re.fullmatch(r"[A-Za-z0-9_-]+", payload.bankId):
        raise HTTPException(400, "题库编号无效。")
    if any(event.runId is not None and not re.fullmatch(r"run-[A-Za-z0-9_-]+", event.runId) for event in payload.events):
        raise HTTPException(400, "本局编号无效。")
    events = [event.model_dump(exclude_none=True) for event in payload.events]
    return {'ok': True, 'written': answer_store.write(ANSWERS, payload.bankId, events)}


@app.get("/{path:path}")
def static_page(path: str = "") -> Response:
    target = (DIST / (path or "index.html")).resolve()
    if target.is_relative_to(DIST.resolve()) and target.is_file():
        return FileResponse(target, headers={"Cache-Control": "no-store"})
    if path in {"", "index.html"}:
        return HTMLResponse('<!doctype html><meta charset="utf-8"><title>CogniRogue</title><body style="font:16px/1.8 system-ui;padding:14vh 8vw;background:#12100e;color:#e8e2d6"><h1>还没构建</h1><p>先运行 <code>npm run build</code>，然后刷新页面。</p></body>')
    return PlainTextResponse(f"没有这个文件：/{path}", status_code=404)
