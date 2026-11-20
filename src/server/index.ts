import express from 'express';
import { createServer } from 'http';
import { race, envSpec, type ProviderSpec } from './ai';
import { transcribe, hasWhisper, type WhisperSpec } from './stt';
import { parseDocument } from './documents';
import * as moonshine from './moonshine';
import * as whispercpp from './whispercpp';

/** Origins allowed to call the local API: the packaged app (file:// → "null") and the dev server. */
const ORIGINS = new Set(['null', 'file://', 'http://localhost:3000', 'http://127.0.0.1:3000']);

const KINDS = new Set(['openrouter', 'gemini', 'custom']);
const b64json = <T,>(h: unknown): T | undefined => {
  try { return typeof h === 'string' && h ? (JSON.parse(Buffer.from(h, 'base64').toString('utf8')) as T) : undefined; } catch { return undefined; }
};

export function createApp() {
  const app = express();

  // Local only: refuse browsers that are on some other website (CSRF / DNS-rebinding style calls).
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && !ORIGINS.has(origin)) { res.status(403).json({ message: 'Origin not allowed' }); return; }
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-stt-provider');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }
    if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
    next();
  });
  app.use(express.json({ limit: '2mb' }));
  app.use(['/api/stt', '/api/documents/parse'], express.raw({ type: 'application/octet-stream', limit: '20mb' }));

  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/config', (_req, res) => res.json({ ai: envSpec()?.kind ?? null, stt: hasWhisper() }));

  // ── Answers: one request in, a stream of tokens out (SSE). The first event says which model won.
  app.post('/api/ai/stream', async (req, res) => {
    const { messages, temperature, maxTokens, provider } = req.body ?? {};
    const spec: ProviderSpec | null = provider?.apiKey && KINDS.has(provider.kind) ? provider : envSpec();
    if (!spec || !Array.isArray(messages)) { res.status(503).json({ message: 'No AI key set — open Settings and add one.' }); return; }
    const ac = new AbortController();
    res.on('close', () => ac.abort());
    try {
      const w = await race(spec, { messages, temperature: temperature ?? 0.5, max_tokens: maxTokens ?? 500 }, ac.signal);
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });
      const send = (o: unknown) => res.write('data: ' + JSON.stringify(o) + '\n\n');
      send({ meta: { model: w.model, ttftMs: w.ttftMs } });
      send({ text: w.first });
      for await (const t of w.rest) send({ text: t });
      res.write('data: [DONE]\n\n');
      res.end();
    } catch (e) {
      if (!res.headersSent) res.status(502).json({ message: (e as Error).message });
      else res.end();
    }
  });

  // ── Cloud speech-to-text for engines that are not live-streamed (Whisper-compatible). Body: 16 kHz mono PCM.
  app.post('/api/stt', async (req, res) => {
    const spec = b64json<WhisperSpec>(req.headers['x-stt-provider']);
    if (!hasWhisper(spec)) { res.status(503).json({ message: 'No speech-to-text key set (Settings → Listening)' }); return; }
    const pcm = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (pcm.length < 3200) { res.json({ text: '' }); return; }
    try {
      const t0 = Date.now();
      res.json({ text: await transcribe(pcm, spec, typeof req.query.lang === 'string' ? req.query.lang : undefined), ms: Date.now() - t0 });
    } catch (e) {
      res.status(502).json({ message: (e as Error).message });
    }
  });

  // ── CV / documents → text
  app.post('/api/documents/parse', async (req, res) => {
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!buf.length) { res.status(400).json({ message: 'Empty file' }); return; }
    try {
      const doc = await parseDocument(buf, typeof req.query.name === 'string' ? req.query.name : 'file.txt');
      if (!doc.text) { res.status(422).json({ message: 'No text found (a scanned PDF?) — paste the text instead' }); return; }
      res.json(doc);
    } catch (e) {
      res.status(422).json({ message: `Could not read that file: ${(e as Error).message}` });
    }
  });

  // ── On-device listening (Moonshine sidecar)
  app.get('/api/moonshine', (_req, res) => res.json(moonshine.status()));
  const act = (fn: (size: moonshine.Arch) => Promise<unknown> | unknown) => async (req: express.Request, res: express.Response) => {
    try { await fn(req.body?.arch === 'tiny' ? 'tiny' : 'small'); res.json(moonshine.status()); }
    catch (e) { res.status(500).json({ message: (e as Error).message, ...moonshine.status() }); }
  };
  app.post('/api/moonshine/install', act(moonshine.install));
  app.post('/api/moonshine/start', act(moonshine.start));
  app.post('/api/moonshine/stop', act(() => moonshine.stop()));

  // ── On-device listening, whisper.cpp (no Python)
  app.get('/api/whispercpp', (_req, res) => res.json(whispercpp.status()));
  const actW = (fn: (size: whispercpp.Arch) => Promise<unknown> | unknown) => async (req: express.Request, res: express.Response) => {
    try { await fn(req.body?.arch === 'tiny' ? 'tiny' : 'small'); res.json(whispercpp.status()); }
    catch (e) { res.status(500).json({ message: (e as Error).message, ...whispercpp.status() }); }
  };
  app.post('/api/whispercpp/install', actW(whispercpp.install));
  app.post('/api/whispercpp/start', actW(whispercpp.start));
  app.post('/api/whispercpp/stop', actW(() => whispercpp.stop()));

  return app;
}

/** Listen on localhost only. port 0 = pick a free one. Resolves with the port. */
export function startServer(port = 0): Promise<{ port: number; close: () => void }> {
  const server = createServer(createApp());
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({ port: (server.address() as import('net').AddressInfo).port, close: () => server.close() }));
  });
}

// `node dist/server/index.js` (dev): fixed port so the Vite dev UI can find it
if (require.main === module) {
  startServer(Number(process.env.SOTTO_PORT) || 3001).then(({ port }) => console.log(`Sotto API on http://127.0.0.1:${port}`));
}
