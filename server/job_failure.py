"""Stable task failure metadata, without raw provider responses."""
from __future__ import annotations

import re
from typing import Any

STAGES = {"plan", "prepare", "generate", "review", "commit"}
CODES = {"balance", "auth", "forbidden", "rate-limit", "timeout", "unavailable",
         "network", "invalid-response", "configuration", "no-candidates", "rejected",
         "review-pending", "invalid-bank", "unknown"}


def from_worker(data: dict[str, Any]) -> dict[str, str] | None:
    stage, code = data.get("stage"), data.get("code")
    if isinstance(stage, str) and isinstance(code, str) and stage in STAGES and code in CODES:
        return {"stage": stage, "code": code}
    return None


def for_job(job: dict[str, Any]) -> dict[str, str]:
    """Classify old jobs too; never include log lines in the diagnostic payload."""
    saved = job.get("failure")
    if isinstance(saved, dict) and (failure := from_worker(saved)):
        return failure
    phase = job.get("progress", {}).get("phase")
    last_activity = (job.get("activity") or [{}])[-1]
    stage = ("plan" if job["taskType"] == "plan" else "commit" if phase == "commit"
             else "review" if phase == "review" or last_activity.get("kind") in {"review", "reviewed"}
             else "prepare" if phase in {"queued", "starting"} else "generate")
    message = "\n".join(line for line in job["lines"] if line.startswith("✗"))
    for code, pattern in (
        ("balance", r"insufficient[_ ](?:account[_ ])?(?:balance|quota)|余额不足"),
        ("configuration", r"REVIEW_API_KEY|GEN_API_KEY|模型配置"),
        ("auth", r"HTTP 401\b|invalid_api_key|incorrect api key"),
        ("forbidden", r"HTTP 403\b"),
        ("rate-limit", r"HTTP 429\b|rate.?limit|too many requests"),
        ("timeout", r"timeout|timed out|请求超时"),
        ("unavailable", r"HTTP 5\d\d\b"),
        ("invalid-bank", r"题库没通过"),
        ("review-pending", r"仍待审核"),
        ("no-candidates", r"没有产出可审核|没有通过审核的新题"),
    ):
        if re.search(pattern, message, re.I):
            if code == "invalid-bank":
                stage = "commit"
            elif code == "configuration" and stage != "plan" and "REVIEW_API_KEY" in message:
                stage = "review"
            return {"stage": stage, "code": code}
    return {"stage": stage, "code": "unknown"}
