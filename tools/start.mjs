/** One command from a source checkout: prepare dependencies, build, open the game. */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const root = resolve(import.meta.dirname, '..');
const cache = resolve(root, '.cache', 'source-launch');
const projectEnv = resolve(root, process.env.UV_PROJECT_ENVIRONMENT || '.venv');
const python = resolve(projectEnv, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const port = process.env.PORT ?? '7777';
const host = '127.0.0.1';
const url = `http://${host}:${port}/`;
const npm = process.env.npm_execpath;
const args = process.argv.slice(2);
const env = {
  ...process.env,
  UV_CACHE_DIR: process.env.UV_CACHE_DIR || resolve(root, '.cache', 'uv'),
  UV_PROJECT_ENVIRONMENT: projectEnv,
};
const isWindows = process.platform === 'win32';

let active;
let requestedStop = false;

function stop() {
  requestedStop = true;
  const child = active;
  if (!child?.pid) return;
  if (process.platform !== 'win32') {
    child.kill('SIGTERM');
  } else {
    // A console Ctrl+C already reaches Windows console children. Wait briefly
    // for the running Python command, then terminate it if it didn't receive it.
    const timer = setTimeout(() => {
      if (active === child && child.exitCode === null && child.signalCode === null) child.kill();
    }, 2000);
    timer.unref();
  }
}

function launch(executable, commandArgs, childEnv = env) {
  if (requestedStop) throw new Error('Startup cancelled.');
  const child = spawn(executable, commandArgs, { cwd: root, env: childEnv, stdio: 'inherit' });
  active = child;
  const state = { child, result: undefined };
  const complete = (result) => {
    state.result = result;
    if (active === child) active = undefined;
    return result;
  };
  state.exited = new Promise((done) => {
    child.once('error', (error) => done(complete({ error })));
    child.once('close', (code, signal) => {
      if (!state.result) done(complete({ code, signal }));
    });
  });
  return state;
}

function ensureSuccess(result, name) {
  if (result.error) throw new Error(`${name}: ${result.error.message}`, { cause: result.error });
  if (result.code !== 0) throw new Error(`${name} exited with ${result.signal ?? result.code}.`);
}

async function run(name, executable, commandArgs, childEnv) {
  ensureSuccess(await launch(executable, commandArgs, childEnv).exited, name);
}

async function checkPort() {
  await new Promise((done, fail) => {
    const probe = createServer().once('error', fail);
    probe.listen({ host, port: Number(port), exclusive: true }, () => probe.close(done));
  }).catch((error) => {
    if (error.code === 'EADDRINUSE') {
      throw new Error(`Port ${port} is already in use. Stop the other server, or set PORT to start on a different port.`);
    }
    throw error;
  });
}

async function preparePython() {
  const pythonArgs = env.UV_PYTHON ? [] : ['--python', '3.12'];
  if (!isWindows) {
    await run('uv sync (install uv first if it is missing)', 'uv',
      ['sync', '--locked', ...(existsSync(python) ? [] : pythonArgs)]);
    return;
  }

  // Do not depend on renaming a shared wheel-cache directory on Windows.
  // uv validates the project lock and chooses Python; pip verifies the
  // exported hashes and installs those exact wheels into this checkout.
  const marker = resolve(projectEnv, '.cognirogue-python-lock');
  const fingerprint = createHash('sha256')
    .update(readFileSync(resolve(root, 'pyproject.toml')))
    .update(readFileSync(resolve(root, 'uv.lock')))
    .digest('hex');
  if (existsSync(python) && existsSync(resolve(projectEnv, 'Lib/site-packages/uvicorn/__main__.py')) &&
      existsSync(marker) && readFileSync(marker, 'utf8') === fingerprint) return;

  const temp = resolve(cache, 'tmp');
  mkdirSync(temp, { recursive: true });
  const installEnv = { ...env, TEMP: temp, TMP: temp };
  const requirements = resolve(cache, 'requirements.txt');
  await run('uv export (install uv first if it is missing)', 'uv',
    ['export', '--locked', '--no-dev', '--no-emit-project', '--quiet', '--output-file', requirements], installEnv);
  if (!existsSync(python)) await run('uv venv', 'uv', ['venv', '--allow-existing', ...pythonArgs, projectEnv], installEnv);
  await run('ensurepip', python, ['-m', 'ensurepip', '--upgrade'], installEnv);
  await run('pip install', python, [
    '-m', 'pip', 'install', '--disable-pip-version-check', '--require-hashes', '--only-binary=:all:',
    '-r', requirements,
  ], installEnv);
  writeFileSync(marker, fingerprint);
}

function launchBrowser() {
  const commands = {
    win32: ['rundll32.exe', ['url.dll,FileProtocolHandler', url]],
    darwin: ['open', [url]],
    linux: ['xdg-open', [url]],
  };
  const command = commands[process.platform];
  if (!command) return;
  const child = spawn(...command, { stdio: 'ignore' });
  const failed = () => console.warn(`Could not open the browser automatically. Visit ${url}`);
  child.on('error', failed);
  child.on('exit', (code) => { if (code !== 0) failed(); });
  child.unref();
}

async function prepare() {
  mkdirSync(cache, { recursive: true });
  const marker = resolve(cache, 'npm-lock');
  const vite = resolve(root, 'node_modules', 'vite', 'bin', 'vite.js');
  const fingerprint = createHash('sha256')
    .update(readFileSync(resolve(root, 'package.json')))
    .update(readFileSync(resolve(root, 'package-lock.json')))
    .update(`${process.platform}-${process.arch}-${process.versions.modules}`)
    .digest('hex');
  if (!existsSync(vite) || !existsSync(marker) || readFileSync(marker, 'utf8') !== fingerprint) {
    console.log('[1/3] Installing project JavaScript dependencies...');
    await run('npm ci', process.execPath, [npm, 'ci', '--include=dev', '--no-audit', '--no-fund']);
    writeFileSync(marker, fingerprint);
  } else {
    console.log('[1/3] JavaScript dependencies are ready.');
  }

  console.log('[2/3] Preparing Python dependencies...');
  await preparePython();
  console.log('[3/3] Building the game...');
  await run('Vite build', process.execPath, [vite, 'build']);
}

async function main() {
  if (Number(process.versions.node.split('.')[0]) < 22 || !npm) {
    throw new Error('Use Node.js 22+ and run npm start (or use Start-CogniRogue.cmd on Windows).');
  }
  if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error('PORT must be an integer from 1 to 65535.');
  }
  if (args.some((arg) => arg !== '--no-browser')) throw new Error('Usage: npm start [-- --no-browser]');

  await checkPort();
  await prepare();
  const service = launch(python, ['-m', 'uvicorn', 'server.app:app', '--host', host, '--port', port]);
  try {
    const deadline = Date.now() + 45_000;
    let ready = false;
    while (!requestedStop && !service.result && Date.now() < deadline) {
      try {
        const response = await fetch(url + 'api/health', { signal: AbortSignal.timeout(750) });
        if (response.ok && (await response.json()).apiVersion === 1) {
          ready = true;
          break;
        }
      } catch { /* Wait for the child to finish startup. */ }
      await sleep(150);
    }
    if (requestedStop) return;
    if (service.result) {
      ensureSuccess(service.result, 'Local service');
      throw new Error('The local service stopped before it became ready.');
    }
    if (!ready) throw new Error('The local service did not become ready. Check the output above.');

    console.log(`CogniRogue: ${url}  (Ctrl+C to stop)`);
    if (!args.includes('--no-browser')) launchBrowser();
    const result = await service.exited;
    if (!requestedStop) ensureSuccess(result, 'Local service');
  } finally {
    if (!service.result && !requestedStop) service.child.kill();
  }
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
await main().catch((error) => {
  if (requestedStop) return;
  console.error(`CogniRogue startup failed: ${error.message}`);
  process.exitCode = 1;
});
