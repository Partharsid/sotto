import type { Settings } from './store';

/** What the main window shares with the dock. */
export interface DockCard { id: number; q: string; a: string; state: 'thinking' | 'streaming' | 'done' | 'error'; model?: string; ms?: number; kind?: 'answer' | 'summary'; tag?: string }
export interface DockState { on: boolean; auto: boolean; partial: { me: string; them: string }; cards: DockCard[]; lastLine: string }
export type DockCmd = { t: 'answer' } | { t: 'clear' } | { t: 'listen' } | { t: 'auto' } | { t: 'revise'; id: number; how: string; label: string };
export interface DockView { collapsed: boolean; through: boolean; opacity: number }

declare global {
  interface Window {
    /** Provided by the desktop shell (preload). Absent when the UI runs in a plain browser (dev). */
    sotto?: {
      apiBase: string;
      setPrivate(on: boolean): Promise<void>;
      setPin(on: boolean): Promise<void>;
      onAnswerLast(cb: () => void): () => void;
      dock: {
        publish(st: DockState): void;
        onState(cb: (st: DockState) => void): () => void;
        onView(cb: (v: DockView) => void): () => void;
        onCmd(cb: (c: DockCmd) => void): () => void;
        cmd(c: DockCmd): void;
        ready(): void;
        ctl(action: string, value?: number): Promise<void>;
        copy(t: string): Promise<void>;
      };
      meeting: {
        configure(c: { mode: string; ignore: string[] }): void;
        onStart(cb: (m: { app: string }) => void): () => void;
        onEnd(cb: (m: { app: string }) => void): () => void;
        onNever(cb: (app: string) => void): () => void;
        info(): Promise<{ app: string } | null>;
        micApps(): Promise<string[]>;
        reply(a: 'start' | 'later' | 'never'): void;
      };
    };
  }
}

export const API = window.sotto?.apiBase || 'http://127.0.0.1:3001';

export async function call<T = unknown>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(API + path, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { message?: string }).message || `Request failed (${r.status})`);
  return j as T;
}

/** Turn provider/server error text into something a person can act on. */
export function friendly(msg: string): string {
  if (/\b(401|403)\b|invalid.{0,12}key|user not found|no auth|unauthorized/i.test(msg)) return 'The AI provider rejected your key. Check it in Settings → Answers.';
  if (/\b429\b|rate.?limit/i.test(msg)) return 'The free models are busy right now (rate limit). Try again in a few seconds.';
  if (/fetch failed|ENOTFOUND|ECONN|network|Failed to fetch/i.test(msg)) return "Couldn't reach the AI provider. Check your connection.";
  return msg.length > 200 ? msg.slice(0, 200) + '…' : msg;
}

export interface Chat { role: 'system' | 'user' | 'assistant'; content: string }
export interface Meta { model: string; ttftMs: number }

/** Streams one answer. Yields `{ meta }` first (who won the race), then `{ text }` pieces. */
export async function* streamAnswer(messages: Chat[], s: Settings, signal: AbortSignal, maxTokens?: number): AsyncGenerator<{ meta?: Meta; text?: string }> {
  const kind = s.ai.kind;
  const provider = s.ai.keys[kind]
    ? { kind, apiKey: s.ai.keys[kind], baseUrl: kind === 'custom' ? s.ai.baseUrl : undefined, models: s.ai.models.split(',').map((m) => m.trim()).filter(Boolean) }
    : undefined; // no key typed in the app → the server falls back to keys in its own .env
  const r = await fetch(API + '/api/ai/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, maxTokens: maxTokens ?? (s.ui.length === 'long' ? 600 : 260), provider }),
    signal,
  });
  if (!r.ok || !r.body) throw new Error(((await r.json().catch(() => ({}))) as { message?: string }).message || `Answer failed (${r.status})`);
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('data:') || line.includes('[DONE]')) continue;
      try { yield JSON.parse(line.slice(5)); } catch { /* partial */ }
    }
  }
}
