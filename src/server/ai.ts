/**
 * Answer models. Bring your own key: OpenRouter (free models), Gemini, or any OpenAI-compatible API.
 * Speed first: reasoning is switched off where supported, and several models can be "raced":
 * the same prompt goes to all of them and the first token wins, the rest are cancelled.
 */
import './stt'; // loads .env

export type ProviderKind = 'openrouter' | 'gemini' | 'custom';

export interface ProviderSpec {
  kind: ProviderKind;
  apiKey?: string;
  /** One model, or several to race */
  models?: string[];
  /** custom only */
  baseUrl?: string;
}

interface Target { baseUrl: string; headers: Record<string, string>; model: string; fast: Record<string, unknown> }

/** Fastest free OpenRouter models when measured on 2026-11-19 (~0.6 s to first token each). Lineups change, so
 *  `OPENROUTER_MODELS` / the Models field override this; a model that has gone away simply loses the race. */
const DEFAULT_MODELS: Record<ProviderKind, string[]> = {
  openrouter: ['nvidia/nemotron-3.5-super-vl:free', 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free'],
  gemini: ['gemini-2.5-flash-lite'],
  custom: [],
};

const list = (v?: string) => (v ? v.split(',').map((x) => x.trim()).filter(Boolean) : undefined);

/** Keys in the server's own .env work with no UI setup. */
export function envSpec(): ProviderSpec | null {
  const e = process.env;
  if (e.OPENROUTER_API_KEY) return { kind: 'openrouter', apiKey: e.OPENROUTER_API_KEY, models: list(e.OPENROUTER_MODELS) };
  if (e.GEMINI_API_KEY) return { kind: 'gemini', apiKey: e.GEMINI_API_KEY, models: list(e.GEMINI_MODELS) };
  if (e.AI_API_KEY && e.AI_BASE_URL) return { kind: 'custom', apiKey: e.AI_API_KEY, baseUrl: e.AI_BASE_URL, models: list(e.AI_MODEL) };
  return null;
}

function targets(spec: ProviderSpec): Target[] {
  if (!spec.apiKey) return [];
  const models = spec.models?.filter(Boolean).length ? spec.models!.filter(Boolean) : DEFAULT_MODELS[spec.kind];
  return models.map((model): Target => {
    const auth = { Authorization: `Bearer ${spec.apiKey}` };
    if (spec.kind === 'gemini') {
      return { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', headers: auth, model, fast: /2\.5-flash|3.*flash/.test(model) ? { reasoning_effort: 'none' } : {} };
    }
    if (spec.kind === 'openrouter') {
      return { baseUrl: 'https://openrouter.ai/api/v1', headers: { ...auth, 'X-Title': 'Sotto' }, model, fast: { reasoning: { enabled: false } } };
    }
    return { baseUrl: (spec.baseUrl || '').replace(/\/+$/, ''), headers: auth, model, fast: {} };
  });
}

/** Content deltas of an OpenAI-style SSE body (reasoning deltas are ignored). */
async function* deltas(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
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
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return;
      try {
        const c = JSON.parse(data).choices?.[0]?.delta?.content;
        if (typeof c === 'string' && c) yield c;
      } catch { /* keep-alive / partial line */ }
    }
  }
}

async function open(t: Target, body: object, signal: AbortSignal, fast = true): Promise<AsyncGenerator<string>> {
  const res = await fetch(`${t.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...t.headers },
    body: JSON.stringify({ ...body, model: t.model, stream: true, ...(fast ? t.fast : {}) }),
    signal,
  });
  if (!res.ok || !res.body) {
    // some models insist on thinking: retry once without the "no reasoning" extras
    if (res.status === 400 && fast && Object.keys(t.fast).length) return open(t, body, signal, false);
    throw new Error(`${t.model}: ${res.status} ${(await res.text().catch(() => '')).slice(0, 160)}`);
  }
  return deltas(res.body);
}

export interface Winner { model: string; first: string; rest: AsyncGenerator<string>; ttftMs: number }

/** Start every model; resolve with the first one that produces a token. Losers are cancelled. */
export function race(spec: ProviderSpec, body: object, signal: AbortSignal): Promise<Winner> {
  const ts = targets(spec);
  if (!ts.length) return Promise.reject(new Error('No AI key set — open Settings and add one.'));
  const t0 = Date.now();
  const ctl = ts.map(() => new AbortController());
  signal.addEventListener('abort', () => ctl.forEach((c) => c.abort()));
  const errors: string[] = [];
  return new Promise((resolve, reject) => {
    let won = false;
    let failed = 0;
    ts.forEach((t, i) => {
      (async () => {
        try {
          const gen = await open(t, body, ctl[i].signal);
          const first = await gen.next();
          if (first.done) throw new Error(`${t.model}: empty reply`);
          if (won) return ctl[i].abort();
          won = true;
          ctl.forEach((c, j) => j !== i && c.abort());
          resolve({ model: t.model, first: first.value, rest: gen, ttftMs: Date.now() - t0 });
        } catch (e) {
          if (ctl[i].signal.aborted) return;
          errors.push((e as Error).message);
          if (++failed === ts.length && !won) reject(new Error(errors.join(' | ')));
        }
      })();
    });
  });
}

export interface ModelInfo { id: string; name: string; free?: boolean }

/** The models this provider/key can use (asked of the provider itself, so the list is never stale). */
export async function listModels(spec: ProviderSpec): Promise<ModelInfo[]> {
  const auth = { Authorization: `Bearer ${spec.apiKey}` };
  let url: string;
  if (spec.kind === 'openrouter') url = 'https://openrouter.ai/api/v1/models';
  else if (spec.kind === 'gemini') url = 'https://generativelanguage.googleapis.com/v1beta/openai/models';
  else if (spec.baseUrl) url = spec.baseUrl.replace(/\/+$/, '') + '/models';
  else throw new Error('Enter the Base URL first');
  const res = await fetch(url, { headers: auth, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text().catch(() => '')).slice(0, 120)}`);
  const body = (await res.json()) as { data?: { id: string; name?: string; pricing?: { prompt?: string; completion?: string }; architecture?: { output_modalities?: string[] } }[] };
  return (body.data ?? [])
    .filter((m) => m.id && (!m.architecture?.output_modalities || m.architecture.output_modalities.includes('text')) && !/embed|whisper|tts|image|moderation|guard/i.test(m.id))
    .map((m) => ({ id: m.id.replace(/^models\//, ''), name: m.name || m.id.replace(/^models\//, ''), free: m.pricing ? Number(m.pricing.prompt) === 0 && Number(m.pricing.completion) === 0 : undefined }))
    .sort((a, b) => Number(!!b.free) - Number(!!a.free) || a.id.localeCompare(b.id));
}
