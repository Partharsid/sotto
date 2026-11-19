import test from 'node:test';
import assert from 'node:assert/strict';
import { context, isQuestion, systemPrompt } from '../src/renderer/brain';

test('isQuestion: spots questions and requests, ignores statements', () => {
  for (const q of ['Tell me about yourself and your background.', 'How would you design a rate limiter', 'Can you walk me through your last project?', 'What is your greatest weakness?', 'Describe a time you led a team']) {
    assert.equal(isQuestion(q), true, q);
  }
  for (const s of ['Okay, sounds good.', 'Thanks for joining everyone', 'I think we should ship on Friday.', 'Yes', 'The deployment finished an hour ago']) {
    assert.equal(isQuestion(s), false, s);
  }
});

const CV = `Jane Doe
Senior Backend Engineer

SUMMARY
Backend engineer with 6 years building high-throughput payment systems in Go and Kubernetes.

EXPERIENCE
Stripe - Senior Engineer (2022-2026)
Led migration of the payments ledger to microservices, cutting p99 latency 40%.
Mentored 4 engineers.

Acme Corp - Software Engineer (2019-2022)
Introduced PostgreSQL partitioning that reduced report time from 40s to 3s.

EDUCATION
B.Tech Computer Science, VIT-AP University, 2019.

SKILLS
Go, Kubernetes, PostgreSQL, Redis, Kafka, React, Node.js, AWS`;
const docs = [{ id: '1', name: 'cv', text: CV, on: true }];

test('context: finds the relevant passage, even through synonyms', () => {
  assert.match(context('What is your education background?', docs).join('\n'), /VIT-AP/);
  assert.match(context('Tell me about a time you improved performance', docs).join('\n'), /partitioning|p99/);
  assert.match(context('Which databases have you used?', docs).join('\n'), /PostgreSQL/);
});

test('context: always includes the opening of the CV', () => {
  assert.match(context('Tell me about yourself', docs)[0], /Jane Doe/);
});

test('context: switched-off documents are not used', () => {
  assert.deepEqual(context('anything', [{ ...docs[0], on: false }]), []);
});

test('systemPrompt: carries the user notes and the length rule', () => {
  const p = systemPrompt(false, ['Led payments migration']);
  assert.match(p, /Led payments migration/);
  assert.match(p, /2-4 sentences/);
  assert.match(systemPrompt(true, []), /about 120 words/);
});

test('systemPrompt: without a CV it must not invent a personal history', () => {
  const p = systemPrompt(false, []);
  assert.match(p, /do NOT invent/);
  assert.match(p, /square brackets/);
  assert.doesNotMatch(systemPrompt(false, ['Led payments migration']), /do NOT invent/);
});
