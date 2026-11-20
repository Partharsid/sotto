import test from 'node:test';
import assert from 'node:assert/strict';
import { gated, isJunk, joiner, MIC_GATE } from '../src/renderer/gate';

const frame = (amp: number) => Int16Array.from({ length: 800 }, (_, i) => Math.round(Math.sin(i / 3) * amp * 32768));
const peak = (f: Int16Array) => f.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

test('gate: sends silence for steady room noise and passes speech through', () => {
    const out: Int16Array[] = [];
    const g = gated((f) => out.push(f), MIC_GATE);
    for (let i = 0; i < 100; i++) g(frame(0.003)); // hiss
    assert.ok(out.every((f) => peak(f) === 0));
    out.length = 0;
    for (let i = 0; i < 10; i++) g(frame(0.2)); // speech
    assert.ok(out.some((f) => peak(f) > 0));
  });
test('gate: ignores a single key click but keeps the frame count one-to-one', () => {
    const out: Int16Array[] = [];
    const g = gated((f) => out.push(f), MIC_GATE);
    for (let i = 0; i < 20; i++) g(frame(0.003));
    g(frame(0.5));
    for (let i = 0; i < 20; i++) g(frame(0.003));
    assert.equal(out.length, 41);
    assert.ok(out.every((f) => peak(f) === 0));
  });
test('gate: keeps the lead-in and the tail of a sentence', () => {
    const out: Int16Array[] = [];
    const g = gated((f) => out.push(f), MIC_GATE);
    for (let i = 0; i < 20; i++) g(frame(0.003));
    for (let i = 0; i < 10; i++) g(frame(0.2));
    for (let i = 0; i < 5; i++) g(frame(0.003)); // short pause stays open
    assert.ok(out.slice(-5).every((f) => peak(f) > 0));
  });

for (const t of ['', '.', 'Uh.', 'you', 'Thank you.', 'Thanks for watching!', '[music]', 'the the the the the', 'hmm mm']) test(`junk: drops ${JSON.stringify(t)}`, () => assert.equal(isJunk(t), true));
for (const t of ['Tell me about yourself.', 'What is a closure in JavaScript?', 'I worked on Kubernetes']) test(`junk: keeps ${JSON.stringify(t)}`, () => assert.equal(isJunk(t), false));

test('joiner: glues short pieces into one line and sends a finished question at once', async () => {
  const out: string[] = [];
  const j = joiner((t) => out.push(t), 40);
  j.add('So I was thinking');
  j.add('about the design');
  j.add('of the cache');
  assert.equal(out.length, 0);
  await new Promise((r) => setTimeout(r, 90));
  assert.deepEqual(out, ['So I was thinking about the design of the cache']);
  j.add('Can you explain a closure?');
  assert.equal(out.length, 2);
  j.add('Thank you.'); // lone made-up phrase
  j.flush();
  assert.equal(out.length, 2);
});
