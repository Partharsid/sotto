/**
 * On-device speech-to-text with whisper.cpp (MIT, ~55k GitHub stars): plain C++, CPU only, no Python.
 * First setup downloads the official Windows build and one small quantized model into the user's data
 * folder; after that `whisper-server` runs on a free localhost port and speaks an OpenAI-style
 * /v1/audio/transcriptions endpoint, which Sotto's utterance engine already knows how to call.
 */
import { spawn, execFile, execFileSync, type ChildProcess } from 'child_process';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

export type Arch = 'tiny' | 'small';

const RELEASE = 'b5454'; // pinned: a build known to ship whisper-server.exe
const BIN_URL = `https://github.com/ggml-org/whisper.cpp/releases/download/${RELEASE}/whisper-bin-x64.zip`;
const MODELS: Record<Arch, string> = { tiny: 'ggml-tiny.en-q5_1.bin', small: 'ggml-base.en-q5_1.bin' };
const MODEL_URL = (f: string) => `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${f}`;

const DATA = path.join(process.env.SOTTO_DATA_DIR || path.resolve('stt-sidecar'), 'whispercpp');
const BIN_DIR = path.join(DATA, 'bin');
const SERVER = path.join(BIN_DIR, 'whisper-server.exe');
const modelPath = (a: Arch) => path.join(DATA, MODELS[a]);

let child: ChildProcess | null = null;
let port = 0;
let arch: Arch | null = null;
let starting: Promise<void> | null = null;
let installing: Promise<void> | null = null;
let lastError = '';

const alive = () => !!child && child.exitCode === null;
const installed = () => process.platform === 'win32' && fs.existsSync(SERVER) && (Object.keys(MODELS) as Arch[]).some((a) => fs.existsSync(modelPath(a)));

export const status = () => ({ installed: installed(), running: alive() && port > 0, port: alive() ? port : 0, arch, installing: !!installing, error: lastError || undefined });

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); });
  });

async function download(url: string, to: string) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}) — check your internet connection`);
  const tmp = `${to}.part`;
  await pipeline(Readable.fromWeb(res.body as never), fs.createWriteStream(tmp));
  fs.renameSync(tmp, to);
}

const untar = (zip: string, dir: string) =>
  new Promise<void>((resolve, reject) => execFile(path.join(process.env.SystemRoot || 'C:/Windows', 'System32', 'tar.exe'), ['-xf', zip, '-C', dir], { windowsHide: true }, (e) => (e ? reject(new Error(`Could not unpack the speech engine: ${e.message}`)) : resolve())));

async function ensureFiles(size: Arch) {
  fs.mkdirSync(DATA, { recursive: true });
  if (!fs.existsSync(SERVER)) {
    const zip = path.join(DATA, 'engine.zip');
    const tmp = path.join(DATA, 'unpack');
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    await download(BIN_URL, zip);
    await untar(zip, tmp);
    const rel = fs.existsSync(path.join(tmp, 'Release')) ? path.join(tmp, 'Release') : tmp;
    fs.rmSync(BIN_DIR, { recursive: true, force: true });
    fs.mkdirSync(BIN_DIR, { recursive: true });
    // keep only what the server needs (the package also holds ~30 demo programs)
    for (const f of fs.readdirSync(rel)) if (/\.dll$/i.test(f) || f.toLowerCase() === 'whisper-server.exe') fs.copyFileSync(path.join(rel, f), path.join(BIN_DIR, f));
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(zip, { force: true });
    if (!fs.existsSync(SERVER)) throw new Error('The downloaded speech engine did not contain whisper-server.exe');
  }
  if (!fs.existsSync(modelPath(size))) await download(MODEL_URL(MODELS[size]), modelPath(size));
}

/** One-time setup: download the engine and the chosen model (about 80 MB in total). */
export function install(size: Arch = 'small'): Promise<void> {
  installing ??= (async () => {
    try {
      lastError = '';
      if (process.platform !== 'win32') throw new Error('Whisper.cpp setup is only built for Windows');
      await ensureFiles(size);
    } catch (e) {
      lastError = (e as Error).message;
      throw e;
    } finally {
      installing = null;
    }
  })();
  return installing;
}

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

const waitOpen = (p: number, ms: number) =>
  new Promise<void>((resolve, reject) => {
    const t0 = Date.now();
    const tryOnce = () => {
      const s = net.connect(p, '127.0.0.1');
      s.once('connect', () => { s.destroy(); resolve(); });
      s.once('error', () => { s.destroy(); if (Date.now() - t0 > ms) reject(new Error('The speech engine did not start')); else setTimeout(tryOnce, 200); });
    };
    tryOnce();
  });

/** Start the server (restarting it for a different model). Resolves once it accepts connections. */
export function start(size: Arch = 'small'): Promise<void> {
  if (!installed()) return Promise.reject(new Error('On-device listening is not set up yet — open Settings → Listening and press “Set up”.'));
  starting ??= (async () => {
    try {
      lastError = '';
      if (alive() && arch === size) return;
      stop();
      await ensureFiles(size);
      const p = await freePort();
      const threads = String(Math.max(2, Math.min(4, os.cpus().length - 2)));
      const proc = spawn(SERVER, ['-m', modelPath(size), '--host', '127.0.0.1', '--port', String(p), '--inference-path', '/v1/audio/transcriptions', '-t', threads, '-sns', '-nth', '0.6'], { cwd: BIN_DIR, windowsHide: true, stdio: 'ignore' });
      child = proc; port = p; arch = size;
      let died = '';
      proc.once('exit', (code) => { died = `The speech engine stopped (exit ${code})`; });
      await waitOpen(p, 30_000).catch((e) => { throw new Error(died || e.message); });
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
