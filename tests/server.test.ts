import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
// Tests must never use (or spend) a developer's real keys from .env
for (const k of ['OPENROUTER_API_KEY', 'GEMINI_API_KEY', 'AI_API_KEY', 'AI_BASE_URL', 'STT_API_KEY']) process.env[k] = '';

let api = '';
let stop = () => {};
let upstream: http.Server;
let up = '';

/** A pretend OpenAI-compatible provider: model names decide how it behaves. */
before(async () => {
  upstream = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const { model } = JSON.parse(body || '{}');
      if (/bad/.test(model)) { res.writeHead(429); return res.end('rate limited'); }
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        for (const w of [`${model} says `, 'hi']) res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: w } }] }) + '\n\n');
        res.end('data: [DONE]\n\n');
      }, /slow/.test(model) ? 700 : 30);
    });
  });
  await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
  up = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/v1`;
  const { startServer } = await import('../src/server/index');
  const s = await startServer(0);
  api = `http://127.0.0.1:${s.port}`;
  stop = s.close;
});
after(() => { stop(); upstream.close(); });

const stream = (models: string[]) =>
  fetch(`${api}/api/ai/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], provider: { kind: 'custom', apiKey: 'k', baseUrl: up, models } }),
  });

async function readEvents(r: Response) {
  const text = await r.text();
  return text.split('\n\n').filter((l) => l.startsWith('data: ') && !l.includes('[DONE]')).map((l) => JSON.parse(l.slice(6)));
}

test('racing models: the fastest wins and the answer streams', async () => {
  const t0 = Date.now();
  const ev = await readEvents(await stream(['slow-model', 'fast-model']));
  assert.equal(ev[0].meta.model, 'fast-model');
  assert.equal(ev.filter((e) => e.text).map((e) => e.text).join(''), 'fast-model says hi');
  assert.ok(Date.now() - t0 < 600, 'should not wait for the slow model');
});

test('racing models: a failing model just loses', async () => {
  const ev = await readEvents(await stream(['bad-model', 'ok-model']));
  assert.equal(ev[0].meta.model, 'ok-model');
});

test('all models failing gives a clear 502', async () => {
  const r = await stream(['bad-1', 'bad-2']);
  assert.equal(r.status, 502);
  assert.match((await r.json()).message, /429/);
});

test('no key anywhere gives a 503 that says what to do', async () => {
  const r = await fetch(`${api}/api/ai/stream`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }) });
  assert.equal(r.status, 503);
  assert.match((await r.json()).message, /Settings/);
});

test('refuses requests from other websites', async () => {
  const r = await fetch(`${api}/api/config`, { headers: { Origin: 'https://evil.example' } });
  assert.equal(r.status, 403);
  const ok = await fetch(`${api}/api/config`, { headers: { Origin: 'http://localhost:3000' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('access-control-allow-origin'), 'http://localhost:3000');
  // the packaged app is a page loaded from disk
  for (const o of ['null', 'file://']) assert.equal((await fetch(`${api}/api/config`, { headers: { Origin: o } })).status, 200, o);
});

test('listens on localhost only', () => {
  assert.match(api, /^http:\/\/127\.0\.0\.1:/);
});

test('documents: plain text is cleaned, empty and unreadable files get clear errors', async () => {
  const post = (name: string, body: Buffer) => fetch(`${api}/api/documents/parse?name=${name}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body });
  const ok = await post('cv.txt', Buffer.from('Jane Doe\r\nEngineer\n\n\n\nGo'));
  assert.deepEqual((await ok.json()).text, 'Jane Doe\nEngineer\n\nGo');
  const empty = await post('x.txt', Buffer.alloc(0));
  assert.equal(empty.status, 400);
  const bad = await post('x.pdf', Buffer.from('%PDF-1.4 not really a pdf'));
  assert.equal(bad.status, 422);
  assert.match((await bad.json()).message, /Could not read/);
});

test('speech-to-text without a key explains itself', async () => {
  const r = await fetch(`${api}/api/stt`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: Buffer.alloc(8000) });
  assert.equal(r.status, 503);
  assert.match((await r.json()).message, /speech-to-text/i);
});
