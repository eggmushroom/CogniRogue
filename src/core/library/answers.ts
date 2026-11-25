import { pendingAnswerEvents, markAnswersUploaded } from './stagemem';

export interface AnswerEvent {
  id: string;
  type: 'answer' | 'reset' | 'archive';
  topic: string;
  qid: string;
  runId?: string;
  right?: boolean;
  choice?: number;
  archived: boolean;
}

export interface AnswerUpload {
  v: 2;
  bankId: string;
  events: AnswerEvent[];
}

let sending: AnswerUpload | null = null;
let retryAt = 0;

export function takeAnswerUpload(now = Date.now()): AnswerUpload | null {
  if (sending || now < retryAt) return null;
  const rows = pendingAnswerEvents().slice(0, 200);
  const bankId = rows[0]?.bankId;
  if (!bankId) return null;
  const events = rows.filter((row) => row.bankId === bankId).map((row) =>
    row.type === 'answer'
      ? { id: row.id, type: row.type, topic: row.topic, qid: row.qid, runId: row.runId, right: row.right, choice: row.choice, archived: row.archived }
      : { id: row.id, type: row.type, topic: row.topic, qid: row.qid, runId: row.runId, archived: row.archived });
  sending = { v: 2, bankId, events };
  return sending;
}

export function finishAnswerUpload(upload: AnswerUpload, ok: boolean) {
  if (sending !== upload) return;
  sending = null;
  if (ok) {
    markAnswersUploaded(upload.events.map((event) => ({ id: event.id, archived: event.archived })));
    retryAt = 0;
  } else {
    retryAt = Date.now() + 5000;
  }
}
