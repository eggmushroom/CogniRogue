import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const cache = resolve(root, '.cache', 'uv');

export function startService(port = '7777', env = process.env) {
  const value = String(port);
  if (!/^[0-9]{1,5}$/.test(value) || Number(value) < 1 || Number(value) > 65535) {
    throw new Error(`PORT must be an integer from 1 to 65535; received ${value}`);
  }
  mkdirSync(cache, { recursive: true });
  return spawn('uv', ['run', '--frozen', 'uvicorn', 'server.app:app', '--host', '127.0.0.1', '--port', value], {
    cwd: root,
    env: { ...env, UV_CACHE_DIR: cache },
    stdio: 'inherit',
  });
}
