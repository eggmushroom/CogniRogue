"""Append-only local task traces. The job runner is the only file writer."""
from __future__ import annotations

import json
import logging
import secrets
import time
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)


def now_ms() -> int:
    return time.time_ns() // 1_000_000


def path_for(job_dir: Path, trace_id: str) -> Path:
    return job_dir / "traces" / f"{trace_id}.jsonl"


def append(job_dir: Path, job: dict[str, Any], event: dict[str, Any]) -> None:
    path = path_for(job_dir, job["traceId"])
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8", newline="\n") as file:
            file.write(json.dumps(event, separators=(",", ":")) + "\n")
    except OSError as exc:
        log.warning("Cannot write job trace %s (%s)", job["traceId"], type(exc).__name__)


def lifecycle(job_dir: Path, job: dict[str, Any], name: str, span_id: str, event: str, *,
              parent: str | None = None, outcome: str | None = None, since: int | None = None,
              **attrs: Any) -> None:
    at = now_ms()
    record = {"v": 1, "traceId": job["traceId"], "jobId": job["id"], "spanId": span_id,
              "parentSpanId": parent, "name": name, "event": event, "at": at, "attrs": attrs}
    if outcome:
        record["outcome"] = outcome
    if since is not None:
        record["durationMs"] = max(0, at - since)
    append(job_dir, job, record)


def ensure(job_dir: Path, job: dict[str, Any]) -> None:
    if job.get("traceId"):
        return
    job["traceId"] = secrets.token_hex(16)
    job["traceStartedAt"] = now_ms()
    lifecycle(job_dir, job, "job", job["traceId"][:16], "start", taskType=job["taskType"],
              docId=job.get("lock_doc"), planId=job.get("planId"), topicId=job.get("topicId"),
              planTraceId=job.get("planTraceId"))


def accept_child(job_dir: Path, job: dict[str, Any], payload: str) -> None:
    if len(payload) > 16_384:
        return
    try:
        record = json.loads(payload)
    except (ValueError, RecursionError):
        return
    if (isinstance(record, dict) and record.get("v") == 1
            and record.get("traceId") == job.get("traceId") and record.get("jobId") == job["id"]
            and record.get("event") in ("start", "end")):
        append(job_dir, job, record)
