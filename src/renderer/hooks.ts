import { useCallback, useEffect, useRef, useState } from 'react';
import { friendly, streamAnswer, type Chat } from './api';
import { openStream, tap, type Who } from './audio';
import { context, systemPrompt } from './brain';
import { createEngine, type Engine } from './engines';
import { useStore, type Source } from './store';

// ── Listening ────────────────────────────────────────────────────────────────────────────────
export interface Line { id: number; who: Who; text: string }
let lineId = 0;

export function useListen(onLine: (l: Line) => void, onProblem: (msg: string) => void) {
  const [on, setOn] = useState(false);
  const [level, setLevel] = useState(0);
  const [partial, setPartial] = useState({ me: '', them: '' });
  const [busy, setBusy] = useState(false);
  const stops = useRef<(() => void)[]>([]);
  const engines = useRef<Engine[]>([]);
  const levels = useRef({ me: 0, them: 0 });
  const running = useRef(false);
  const cb = useRef({ onLine, onProblem });
  cb.current = { onLine, onProblem };

  const stop = useCallback(() => {
    stops.current.forEach((s) => s());
    engines.current.forEach((e) => e.close());
    stops.current = []; engines.current = [];
    levels.current = { me: 0, them: 0 };
    running.current = false;
    setOn(false); setLevel(0); setPartial({ me: '', them: '' });
  }, []);

  /** `source` overrides the saved choice (a detected meeting always listens to both sides). */
  const start = useCallback(async (source?: Source) => {
    if (running.current) return;
    running.current = true;
    const { listen } = useStore.getState();
    const src = source ?? listen.source;
    const who: Who[] = src === 'both' ? ['them', 'me'] : src === 'system' ? ['them'] : ['me'];
    setBusy(true);
    const failed: string[] = [];
    let told = false;
    for (const w of who) {
      try {
        const stream = await openStream(w);
        const engine = createEngine(listen, {
          partial: (text) => setPartial((p) => (p[w] === text ? p : { ...p, [w]: text })),
          final: (text) => cb.current.onLine({ id: ++lineId, who: w, text }),
          error: (e) => { if (!told) { told = true; cb.current.onProblem(e.message); } },
        });
        engines.current.push(engine);
        stops.current.push(tap(stream, engine.push, (v) => { levels.current[w] = v; setLevel(Math.max(levels.current.me, levels.current.them)); }));
      } catch (e) {
        failed.push(`${w === 'them' ? 'Computer sound' : 'Microphone'}: ${(e as Error).message}`);
      }
    }
    setBusy(false);
    if (!stops.current.length) { running.current = false; cb.current.onProblem(failed.join(' · ') || 'Could not start listening'); return; }
    if (failed.length) cb.current.onProblem(failed.join(' · '));
    setOn(true);
  }, []);

  useEffect(() => stop, [stop]);
  return { on, busy, level, partial, start, stop };
}

// ── Answering ────────────────────────────────────────────────────────────────────────────────
export interface Card { id: number; q: string; a: string; state: 'thinking' | 'streaming' | 'done' | 'error'; model?: string; ms?: number; kind?: 'answer' | 'summary'; tag?: string }
let cardId = 0;

const SUMMARY_PROMPT =
  'You write meeting notes from a raw transcript ("Them" = the other people, "You" = the user). ' +
  'Reply in plain text with exactly these labelled sections, using "- " bullets and no markdown symbols:\n' +
  'Key points\nDecisions\nAction items (say who owns each one if it was said)\n' +
  'Be concise, and never invent anything that is not in the transcript. If a section is empty write "- none".';

export interface AskOptions {
  /** rewrite the previous answer: "shorter", "more detail", "give an example" */
  revise?: { answer: string; how: string; label: string };
  /** summarize this transcript instead of answering a question */
  summary?: string;
}

export function useAnswers() {
  const [cards, setCards] = useState<Card[]>([]);
  const ctl = useRef<AbortController | null>(null);
  const cardsRef = useRef<Card[]>([]);
  cardsRef.current = cards;

  const ask = useCallback(async (q: string, opts: AskOptions = {}) => {
    ctl.current?.abort();
    const ac = new AbortController();
    ctl.current = ac;
    const s = useStore.getState();
    const id = ++cardId;
    const kind = opts.summary ? 'summary' : 'answer';
    const patch = (p: Partial<Card>) => setCards((cs) => cs.map((c) => (c.id === id ? { ...c, ...p } : c)));
    setCards((cs) => [{ id, q, a: '', state: 'thinking' as const, kind: kind as Card['kind'], tag: opts.revise?.label }, ...cs.map((c) => (c.state === 'streaming' || c.state === 'thinking' ? { ...c, state: 'done' as const } : c))].slice(0, 12));

    let messages: Chat[];
    if (opts.summary) {
      messages = [{ role: 'system', content: SUMMARY_PROMPT }, { role: 'user', content: opts.summary }];
    } else {
      const history: Chat[] = cardsRef.current.filter((c) => c.state === 'done' && c.a && c.kind !== 'summary').slice(0, 3).reverse().flatMap((c) => [{ role: 'user', content: c.q }, { role: 'assistant', content: c.a }] as Chat[]);
      messages = [{ role: 'system', content: systemPrompt(s.ui.length === 'long', context(q, s.docs)) }, ...history, { role: 'user', content: q }];
      if (opts.revise) messages.push({ role: 'assistant', content: opts.revise.answer }, { role: 'user', content: `Same question, but ${opts.revise.how}. Reply with only the new answer.` });
    }

    let text = '';
    let timer = 0;
    const flush = () => { timer = 0; patch({ a: text, state: 'streaming' }); };
    try {
      for await (const part of streamAnswer(messages, s, ac.signal, opts.summary ? 700 : undefined)) {
        if (part.meta) patch({ model: part.meta.model.replace(/^.*\//, '').replace(/:free$/, ''), ms: part.meta.ttftMs });
        if (part.text) { text += part.text; if (!timer) timer = window.setTimeout(flush, 40); }
      }
      window.clearTimeout(timer);
      patch({ a: text.trim(), state: 'done' });
    } catch (e) {
      window.clearTimeout(timer);
      if (ac.signal.aborted) return;
      patch({ a: friendly((e as Error).message), state: 'error' });
    }
  }, []);

  const clear = useCallback(() => { ctl.current?.abort(); setCards([]); }, []);
  return { cards, ask, clear };
}
