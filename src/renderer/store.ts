import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type AiKind = 'openrouter' | 'gemini' | 'custom';
export type Engine = 'moonshine' | 'deepgram' | 'whisper';
export type Source = 'both' | 'system' | 'mic';

export interface Settings {
  ai: { kind: AiKind; keys: Record<AiKind, string>; models: string; baseUrl: string };
  listen: { engine: Engine; size: 'tiny' | 'small'; source: Source; keys: { deepgram: string; whisper: string }; whisperBase: string };
  ui: { private: boolean; pin: boolean; auto: boolean; length: 'short' | 'long' };
  /** ask = pop up when a call starts; auto = just start helping; off = never. `ignore` = apps the user said never for. */
  meeting: { mode: 'ask' | 'auto' | 'off'; ignore: string[] };
}

export interface Doc { id: string; name: string; text: string; on: boolean }

interface State extends Settings {
  docs: Doc[];
  patch: <K extends keyof Settings>(section: K, p: Partial<Settings[K]>) => void;
  setKey: (kind: AiKind, key: string) => void;
  setListenKey: (k: 'deepgram' | 'whisper', key: string) => void;
  addDoc: (name: string, text: string) => void;
  toggleDoc: (id: string) => void;
  removeDoc: (id: string) => void;
}

const uid = () => Math.random().toString(36).slice(2, 10);

export const useStore = create<State>()(
  persist(
    (set) => ({
      ai: { kind: 'openrouter', keys: { openrouter: '', gemini: '', custom: '' }, models: '', baseUrl: '' },
      listen: { engine: 'moonshine', size: 'small', source: 'both', keys: { deepgram: '', whisper: '' }, whisperBase: 'https://api.groq.com/openai/v1' },
      ui: { private: true, pin: false, auto: true, length: 'short' },
      meeting: { mode: 'ask', ignore: [] },
      docs: [],
      patch: (section, p) => set((s) => ({ [section]: { ...s[section], ...p } }) as Partial<State>),
      setKey: (kind, key) => set((s) => ({ ai: { ...s.ai, keys: { ...s.ai.keys, [kind]: key.trim() } } })),
      setListenKey: (k, key) => set((s) => ({ listen: { ...s.listen, keys: { ...s.listen.keys, [k]: key.trim() } } })),
      addDoc: (name, text) => set((s) => ({ docs: [{ id: uid(), name, text, on: true }, ...s.docs] })),
      toggleDoc: (id) => set((s) => ({ docs: s.docs.map((d) => (d.id === id ? { ...d, on: !d.on } : d)) })),
      removeDoc: (id) => set((s) => ({ docs: s.docs.filter((d) => d.id !== id) })),
    }),
    { name: 'sotto', version: 2, migrate: (p: any) => ({ ...p, meeting: p?.meeting ?? { mode: 'ask', ignore: [] } }) },
  ),
);
