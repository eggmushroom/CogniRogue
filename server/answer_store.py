"""The local ledger: events own attempts, runs own archive state."""

import json
import sqlite3
from contextlib import closing, contextmanager
from datetime import datetime, timezone
from pathlib import Path


SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
    bankId TEXT NOT NULL, runId TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0,
    latest INTEGER NOT NULL DEFAULT 0, at TEXT NOT NULL DEFAULT '',
    total INTEGER NOT NULL DEFAULT 0, correct INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (bankId, runId)
);
CREATE INDEX IF NOT EXISTS run_list ON runs (archived, latest DESC);
CREATE TABLE IF NOT EXISTS answers (
    seq INTEGER PRIMARY KEY, bankId TEXT NOT NULL, clientId TEXT NOT NULL,
    runId TEXT, topic TEXT NOT NULL, qid TEXT NOT NULL, type TEXT NOT NULL,
    choice INTEGER, right INTEGER, at TEXT NOT NULL,
    UNIQUE (bankId, clientId)
);
CREATE INDEX IF NOT EXISTS by_run ON answers (bankId, runId, seq DESC);
CREATE INDEX IF NOT EXISTS by_topic ON answers (bankId, topic, seq);
CREATE INDEX IF NOT EXISTS by_question ON answers (bankId, qid, seq);
"""


def archive(db, bank_id, run_id):
    db.execute("INSERT INTO runs (bankId, runId, archived) VALUES (?, ?, 1) "
               "ON CONFLICT (bankId, runId) DO UPDATE SET archived = 1", (bank_id, run_id))


def append(db, bank_id, event, at):
    run_id = event.get('runId')
    if run_id and (event.get('archived') or event['type'] == 'archive'):
        archive(db, bank_id, run_id)
    if event['type'] == 'archive':
        return 0
    cursor = db.execute("""
        INSERT INTO answers (bankId, clientId, runId, topic, qid, type, choice, right, at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (bankId, clientId) DO NOTHING
    """, (bank_id, event.get('clientId', event['id']), run_id, event['topic'], event['qid'],
          event['type'], event.get('choice'), event.get('right'), at))
    if cursor.rowcount and run_id:
        db.execute("""
            INSERT INTO runs (bankId, runId, latest, at, total, correct) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT (bankId, runId) DO UPDATE SET latest = excluded.latest, at = excluded.at,
                total = total + excluded.total, correct = correct + excluded.correct
        """, (bank_id, run_id, cursor.lastrowid, at, int(event['type'] == 'answer'), int(bool(event.get('right')))))
    return cursor.rowcount


def migrate(db, root):
    # Keep the original files. The schema version and the import commit together.
    for directory in root.iterdir():
        if not directory.is_dir() or directory.name.startswith('.'):
            continue
        rows = []
        for path in directory.glob('*.json'):
            event = json.loads(path.read_text(encoding='utf-8'))
            rows.append({'id': path.stem, **event})
        for path in (directory / 'questions').glob('*.json'):
            rows.extend(json.loads(path.read_text(encoding='utf-8'))['events'])
        for event in sorted(rows, key=lambda row: (row.get('at', ''), row['id'])):
            if event.get('type') in ('answer', 'reset') and event.get('qid') and event.get('topic'):
                append(db, directory.name, event, event.get('at', ''))
        for path in (directory / '.runs').glob('*.json'):
            archive(db, directory.name, json.loads(path.read_text(encoding='utf-8'))['runId'])


@contextmanager
def connect(root: Path):
    root.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(root / 'ledger.sqlite3', timeout=10)) as db:
        db.row_factory = sqlite3.Row
        if db.execute('PRAGMA user_version').fetchone()[0] == 0:
            db.executescript(SCHEMA)
            with db:
                db.execute('BEGIN IMMEDIATE')
                if db.execute('PRAGMA user_version').fetchone()[0] == 0:
                    migrate(db, root)
                    db.execute('PRAGMA user_version = 1')
        yield db


def write(root, bank_id, events):
    with connect(root) as db, db:
        at = datetime.now(timezone.utc).isoformat()
        return sum(append(db, bank_id, event, at) for event in events)


def runs(root, archived, before, limit):
    with connect(root) as db:
        return [dict(row) for row in db.execute("""
            SELECT bankId, runId, latest, at, total, correct FROM runs
            WHERE archived = ? AND latest <= ? AND latest > 0 ORDER BY latest DESC LIMIT ?
        """, (archived, before, limit))]


def details(root, bank_id, run_id, before, limit):
    with connect(root) as db:
        return [{**dict(row), 'id': str(row['seq']), 'right': bool(row['right'])} for row in db.execute("""
            SELECT seq, clientId, bankId, runId, topic, qid, type, choice, right, at
            FROM answers WHERE bankId = ? AND runId = ? AND seq < ? ORDER BY seq DESC LIMIT ?
        """, (bank_id, run_id, before, limit))]


def feedback(root, bank_id, topic_id, after):
    with connect(root) as db:
        rows = [dict(row) for row in db.execute("""
            SELECT seq, qid, type, choice, right FROM answers
            WHERE bankId = ? AND topic = ? AND seq > ? ORDER BY seq
        """, (bank_id, topic_id, after))]
        return {'v': 3, 'topicId': topic_id, 'after': after, 'through': rows[-1]['seq'] if rows else after, 'records': rows}
