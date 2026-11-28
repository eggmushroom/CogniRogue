"""Summarize an exported CogniRogue trace locally (no network or provider calls)."""
from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Any


def _counts(rows: list[dict], attribute: str) -> dict[str, int]:
    return dict(Counter(str(value) for row in rows if (value := row.get(attribute)) is not None))


def summarize(path: Path) -> dict[str, Any]:
    starts, ends = {}, {}
    trace_id, job_id = None, None
    ignored = 0
    with path.open("rb") as file:
        for line in file:
            # An interrupted writer or a live export can end with a partial record.
            try:
                if not line.endswith(b"\n"):
                    raise ValueError("incomplete line")
                event = json.loads(line)
                if (not isinstance(event, dict) or event.get("v") != 1
                        or not isinstance(event.get("spanId"), str)
                        or not isinstance(event.get("name"), str)
                        or not isinstance(event.get("traceId"), str)
                        or not isinstance(event.get("jobId"), str)
                        or event.get("event") not in ("start", "end")
                        or not isinstance(event.get("attrs", {}), dict)):
                    raise ValueError("invalid event")
                if trace_id is None:
                    trace_id, job_id = event["traceId"], event["jobId"]
                if (trace_id, job_id) != (event["traceId"], event["jobId"]):
                    raise ValueError("mixed traces")
            except (ValueError, RecursionError):
                ignored += 1
                continue
            table = starts if event["event"] == "start" else ends
            table[event["spanId"]] = event
    if trace_id is None:
        raise ValueError("No valid trace events")
    root_id = trace_id[:16]
    root_start, root_end = starts.get(root_id, {}), ends.get(root_id, {})
    root_attrs, result = root_start.get("attrs", {}), root_end.get("attrs", {})
    models = [event for event in ends.values() if event["name"] == "model.request"]
    requests = [event.get("attrs", {}) for event in models]
    reviews = [event for event in ends.values() if event["name"] == "question.review"]
    queues = [event.get("attrs", {}).get("queueMs") for event in starts.values() if event["name"] == "worker"]
    phases = {}
    for event in ends.values():
        name = event["name"]
        if name in {"job", "worker", "model.request"}:
            continue
        phase = phases.setdefault(name, {"completedSpans": 0, "summedDurationMs": 0})
        phase["completedSpans"] += 1
        ms = event.get("durationMs")
        if type(ms) is int and ms >= 0:
            phase["summedDurationMs"] += ms
    return {
        "traceId": trace_id,
        "jobId": job_id,
        "planTraceId": root_attrs.get("planTraceId"),
        "retryOfJobId": root_attrs.get("retryOfJobId"),
        "retryOfTraceId": root_attrs.get("retryOfTraceId"),
        "outcome": root_end.get("outcome", "unfinished"),
        "failure": ({"stage": result.get("failureStage"), "code": result.get("failureCode")}
                    if result.get("failureCode") else None),
        "wallMs": root_end.get("durationMs"),
        "workerQueueMs": queues,
        "unclosedSpans": len(starts.keys() - ends.keys()),
        "ignoredLines": ignored,
        "stages": phases,
        "review": {"outcomes": _counts(reviews, "outcome"),
                   "failureCodes": _counts([event.get("attrs", {}) for event in reviews], "failureCode")},
        "model": {
            "completedRequests": len(models),
            "outcomes": _counts(models, "outcome"),
            "httpStatuses": _counts(requests, "status"),
            "errors": _counts(requests, "errorKind"),
            "usageReportedRequests": sum(
                type(row.get("inputTokens")) is int or type(row.get("outputTokens")) is int for row in requests
            ),
            "reportedInputTokens": sum(row["inputTokens"] for row in requests if type(row.get("inputTokens")) is int),
            "reportedOutputTokens": sum(row["outputTokens"] for row in requests if type(row.get("outputTokens")) is int),
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file", type=Path, help="trace JSONL file")
    args = parser.parse_args()
    try:
        print(json.dumps(summarize(args.file), ensure_ascii=True, indent=2))
    except (OSError, ValueError) as error:
        parser.exit(1, f"Cannot summarize trace: {error}\n")


if __name__ == "__main__":
    main()
