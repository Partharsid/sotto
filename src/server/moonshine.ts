/**
 * On-device streaming speech-to-text (Moonshine, MIT licensed) via a small Python sidecar.
 * This module installs the sidecar's venv on demand, starts it on a free local port when
 * the app needs it, and kills it (and its children) when the server exits.
 */
import { spawn, execFile, execFileSync, type ChildProcess } from 'child_process';
import fs from 'fs';
import net from 'net';
import path from 'path';

export type Arch = 'tiny' | 'small';

// Packaged app: the script ships in resources, the venv lives in the user's data dir. Dev: ./stt-sidecar for both.
const SCRIPT = path.join(process.env.SOTTO_RESOURCES_DIR ? path.join(process.env.SOTTO_RESOURCES_DIR, 'stt-sidecar') : path.resolve('stt-sidecar'), 'server.py');
const DATA = process.env.SOTTO_DATA_DIR ? path.join(process.env.SOTTO_DATA_DIR, 'moonshine') : path.resolve('stt-sidecar');
const PY = path.join(DATA, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');

let child: ChildProcess | null = null;
let port = 0;
let arch: Arch | null = null;
let starting: Promise<void> | null = null;
let installing: Promise<void> | null = null;
let lastError = '';

const installed = () => fs.existsSync(PY) && fs.existsSync(SCRIPT);

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); });
  });

const alive = () => !!child && child.exitCode === null;

export const status = () => ({ installed: installed(), running: alive() && port > 0, port: alive() ? port : 0, arch, installing: !!installing, error: lastError || undefined });

function run(cmd: string, args: string[], cwd = DATA): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, maxBuffer: 32 << 20, windowsHide: true }, (err, _o, stderr) =>
      err ? reject(new Error(`${cmd} ${args.slice(0, 3).join(' ')} failed: ${String(stderr || err.message).slice(-300)}`)) : resolve());
  });
}

async function findPython(): Promise<string> {
  for (const c of process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python']) {
    try { await run(c, ['--version'], process.cwd()); return c; } catch { /* try the next one */ }
  }
  throw new Error('Python 3.9+ was not found. Install it from python.org, then try again.');
}

/** One-time setup: venv + moonshine-voice, then download the model. */
export function install(size: Arch = 'small'): Promise<void> {
  installing ??= (async () => {
    try {
      lastError = '';
      fs.mkdirSync(DATA, { recursive: true });
      if (!fs.existsSync(PY)) await run(await findPython(), ['-m', 'venv', '.venv']);
      await run(PY, ['-m', 'pip', 'install', '--quiet', '--upgrade', 'pip']);
      await run(PY, ['-m', 'pip', 'install', '--quiet', 'moonshine-voice', 'websockets', 'numpy']);
      await run(PY, ['-c', `from moonshine_voice import get_model_for_language, ModelArch; get_model_for_language('en', ModelArch.${size.toUpperCase()}_STREAMING)`]);
    } catch (e) {
      lastError = (e as Error).message;
      throw e;
    } finally {
      installing = null;
    }
  })();
  return installing;
}

/** Kill the process tree (a Windows venv python.exe is only a launcher for the real interpreter). */
function killTree(p: ChildProcess | null) {
  if (!p?.pid) return;
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    else p.kill('SIGKILL');
  } catch { /* already gone */ }
}

export function stop() {
  killTree(child);
  child = null; port = 0; arch = null;
}

/** Start the sidecar (restarting it for a different model size). Resolves once it accepts connections. */
export function start(size: Arch = 'small'): Promise<void> {
  if (!installed()) return Promise.reject(new Error('On-device listening is not set up yet — open Settings → Listening and press “Set up”.'));
  starting ??= (async () => {
    try {
      lastError = '';
      if (alive() && arch === size) return;
      stop();
      const p = await freePort();
      const proc = spawn(PY, [SCRIPT, '--port', String(p), '--arch', size], { cwd: path.dirname(SCRIPT), windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
      child = proc; port = p; arch = size;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('The speech engine did not start within 90 s')), 90_000);
        let tail = '';
        proc.stderr!.on('data', (d: Buffer) => {
          tail = (tail + d.toString()).slice(-500);
          if (tail.includes('READY')) { clearTimeout(timer); resolve(); }
        });
        proc.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Speech engine exited (${code}): ${tail.trim().split('\n').slice(-2).join(' ')}`)); });
      });
    } catch (e) {
      lastError = (e as Error).message;
      stop();
      throw e;
    } finally {
      starting = null;
    }
  })();
  return starting;
}

for (const sig of ['exit', 'SIGINT', 'SIGTERM'] as const) process.on(sig, () => { killTree(child); if (sig !== 'exit') process.exit(0); });
