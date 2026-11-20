import { API, call } from './api';
import type { Settings } from './store';

/** A speech engine takes 16 kHz PCM frames and reports live ("partial") and finished ("final") text. */
export interface Engine { push(frame: Int16Array): void; close(): void }
export interface Events { partial(text: string): void; final(text: string): void; error(err: Error): void }

const MAX_QUEUE = 200; // 10 s of 50 ms frames, held while an engine is still connecting

// ── Moonshine: open-source, on-device, streams words while you speak ─────────────────────────
function moonshine(s: Settings['listen'], ev: Events): Engine {
  let ws: WebSocket | null = null;
  let open = false;
  let connecting = false;
  const queue: Int16Array[] = [];

  async function connect() {
    connecting = true;
    try {
      const st = await call<{ port: number }>('/api/moonshine/start', { arch: s.size });
      const sock = new WebSocket(`ws://127.0.0.1:${st.port}/`);
      sock.binaryType = 'arraybuffer';
      sock.onopen = () => { open = true; connecting = false; queue.splice(0).forEach((f) => sock.send(f)); };
      sock.onmessage = (m) => {
        if (typeof m.data !== 'string') return;
        const j = JSON.parse(m.data) as { type: string; text?: string };
        if (j.type === 'partial' && j.text) ev.partial(j.text);
        else if (j.type === 'final' && j.text) { ev.partial(''); ev.final(j.text); }
      };
      sock.onclose = () => { open = false; connecting = false; if (ws === sock) ws = null; };
      ws = sock;
    } catch (e) {
      connecting = false;
      ev.error(e as Error);
    }
  }

  return {
    push(f) {
      if (ws && open) return void ws.send(f);
      if (!ws && !connecting) void connect();
      queue.push(f);
      if (queue.length > MAX_QUEUE) queue.shift();
    },
    close() { ws?.close(); ws = null; open = false; queue.length = 0; },
  };
}

// ── Deepgram: cloud, true streaming ──────────────────────────────────────────────────────────
function deepgram(s: Settings['listen'], ev: Events): Engine {
  let ws: WebSocket | null = null;
  let open = false;
  let finals: string[] = [];
  let keepAlive: ReturnType<typeof setInterval> | undefined;
  let lastSend = 0;
  const queue: Int16Array[] = [];

  const flushFinals = () => { const t = finals.join(' ').trim(); finals = []; ev.partial(''); if (t) ev.final(t); };

  function connect() {
    if (!s.keys.deepgram) return ev.error(new Error('Add your Deepgram key in Settings → Listening'));
    const q = 'model=nova-3&language=en&encoding=linear16&sample_rate=16000&channels=1&interim_results=true&endpointing=300&smart_format=true&punctuate=true';
    const sock = new WebSocket(`wss://api.deepgram.com/v1/listen?${q}`, ['token', s.keys.deepgram]);
    sock.binaryType = 'arraybuffer';
    sock.onopen = () => {
      open = true;
      queue.splice(0).forEach((f) => sock.send(f));
      keepAlive = setInterval(() => { if (Date.now() - lastSend > 5000 && sock.readyState === 1) sock.send('{"type":"KeepAlive"}'); }, 4000);
    };
    sock.onmessage = (m) => {
      if (typeof m.data !== 'string') return;
      const j = JSON.parse(m.data);
      if (j.type !== 'Results') return;
      const alt: string = j.channel?.alternatives?.[0]?.transcript?.trim() ?? '';
      if (j.is_final) {
        if (alt) finals.push(alt);
        if (j.speech_final) flushFinals(); else ev.partial(finals.join(' '));
      } else if (alt) ev.partial([...finals, alt].join(' '));
    };
    sock.onerror = () => ev.error(new Error('Deepgram connection failed — check the key'));
    sock.onclose = () => { open = false; clearInterval(keepAlive); if (ws === sock) ws = null; if (finals.length) flushFinals(); };
    ws = sock;
  }

  return {
    push(f) {
      if (ws && open) { lastSend = Date.now(); return void ws.send(f); }
      if (!ws) connect();
      queue.push(f);
      if (queue.length > MAX_QUEUE) queue.shift();
    },
    close() { clearInterval(keepAlive); ws?.close(); ws = null; open = false; queue.length = 0; },
  };
}

// ── Whisper API (Groq, OpenAI, ...): cut speech into utterances, upload each one ──────────────
function whisper(getSpec: () => Promise<{ apiKey?: string; baseUrl?: string }>, ev: Events): Engine {
  const SPEECH = 0.012, SILENCE_MS = 550, MIN_MS = 300, MAX_MS = 20000;
  let buf: Int16Array[] = [];
  let pre: Int16Array[] = [];
  let speech = 0, silence = 0, total = 0, inSpeech = false;

  const rms = (f: Int16Array) => { let n = 0; for (let i = 0; i < f.length; i++) { const v = f[i] / 32768; n += v * v; } return Math.sqrt(n / f.length); };

  async function flush() {
    const parts = buf, ms = speech;
    buf = []; speech = silence = total = 0; inSpeech = false;
    if (ms < MIN_MS || !parts.length) return;
    const all = new Int16Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) { all.set(p, o); o += p.length; }
    try {
      const spec = await getSpec();
      const r = await fetch(`${API}/api/stt`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'x-stt-provider': btoa(JSON.stringify(spec)) }, body: all.buffer });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message || `Speech-to-text failed (${r.status})`);
      if (j.text) ev.final(j.text);
    } catch (e) { ev.error(e as Error); }
  }

  return {
    push(f) {
      const loud = rms(f) > SPEECH;
      if (!inSpeech) {
        pre.push(f); if (pre.length > 3) pre.shift();
        if (!loud) return;
        inSpeech = true; buf = [...pre]; pre = []; speech = 50; total = buf.length * 50;
        return;
      }
      buf.push(f); total += 50;
      if (loud) { speech += 50; silence = 0; } else silence += 50;
      if (silence >= SILENCE_MS || total >= MAX_MS) void flush();
    },
    close() { buf = []; pre = []; inSpeech = false; },
  };
}

// ── whisper.cpp on this PC: same utterance engine, pointed at the local server (no key, no Python) ──
function local(s: Settings['listen'], ev: Events): Engine {
  let base: Promise<string> | null = null;
  const spec = async () => {
    base ??= call<{ port: number }>('/api/whispercpp/start', { arch: s.size }).then((st) => `http://127.0.0.1:${st.port}/v1`).catch((e) => { base = null; throw e; });
    return { baseUrl: await base };
  };
  return whisper(spec, ev);
}

export function createEngine(s: Settings['listen'], ev: Events): Engine {
  return s.engine === 'local' ? local(s, ev) : s.engine === 'moonshine' ? moonshine(s, ev) : s.engine === 'deepgram' ? deepgram(s, ev) : whisper(async () => ({ apiKey: s.keys.whisper, baseUrl: s.whisperBase }), ev);
}
