/** Exercise the source start command with a real build and API, without opening a browser. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const root = resolve(import.meta.dirname, '..');
const probe = createServer().listen(0, '127.0.0.1');
await once(probe, 'listening');
const { port } = probe.address();
await new Promise((done, fail) => probe.close((error) => error ? fail(error) : done()));

const store = resolve(root, '.cache', 'source-launch', 'checks', randomUUID());
mkdirSync(store, { recursive: true });
const env = { ...process.env, PORT: String(port), COG_DESKTOP: '0', COG_SOURCE_DATA: store };
const url = `http://127.0.0.1:${port}/`;
const start = process.platform === 'win32'
  ? ['cmd.exe', ['/d', '/s', '/c', 'Start-CogniRogue.cmd --no-browser']]
  : [process.execPath, [resolve(root, 'tools/start.mjs'), '--no-browser']];
const app = spawn(...start, { cwd: root, env, stdio: ['ignore', 'inherit', 'inherit'] });
const exited = once(app, 'exit');
// A spawn error is also reported below via the same promise, without an unhandled rejection.
exited.catch(() => {});
const deadline = Date.now() + 7 * 60_000;

try {
  let health;
  while (Date.now() < deadline) {
    if (app.exitCode !== null || app.signalCode !== null || !app.pid) {
      const [code, signal] = await exited;
      throw new Error(`Source launcher exited before readiness (${signal ?? code}).`);
    }
    try {
      const response = await fetch(url + 'api/health', { signal: AbortSignal.timeout(800) });
      if (response.ok) { health = await response.json(); break; }
    } catch { /* Dependencies may still be installing. */ }
    await sleep(200);
  }
  assert.equal(health?.apiVersion, 1, 'Timed out waiting for the source service.');
  assert.equal(health.desktop, false, 'Expected source mode, not the packaged service.');
  const page = await fetch(url, { signal: AbortSignal.timeout(3000) });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<script\b/, 'Expected the built game, not the unbuilt fallback.');
  const banks = await fetch(url + 'api/banks', { signal: AbortSignal.timeout(3000) });
  assert.ok((await banks.json()).some((bank) => bank.id === 'words'));

  const busy = spawn(...start, { cwd: root, env, stdio: ['ignore', 'ignore', 'pipe'] });
  let error = '';
  busy.stderr.setEncoding('utf8').on('data', (chunk) => { error += chunk; });
  const [code] = await once(busy, 'close');
  assert.equal(code, 1);
  assert.match(error, /already in use/);
  console.log('Source launch verified: built game + local API, with a useful occupied-port error.');
} finally {
  if (app.pid && app.exitCode === null && app.signalCode === null) {
    if (process.platform === 'win32') {
      const cleanup = spawn('taskkill.exe', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' });
      await once(cleanup, 'exit');
    } else {
      app.kill('SIGTERM');
    }
    await exited;
  }
  rmSync(store, { recursive: true, force: true, maxRetries: 3 });
}
