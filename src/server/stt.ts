import fs from 'fs';
import path from 'path';

/**
 * Read keys from a .env file: next to where the app was started (development) or in the app's data folder
 * (installed: %APPDATA%\Sotto\.env). Real environment variables win.
 */
export function loadEnv(): void {
  const files = [path.resolve(process.cwd(), '.env'), ...(process.env.SOTTO_DATA_DIR ? [path.join(process.env.SOTTO_DATA_DIR, '.env')] : [])];
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
      if (!m || line.trim().startsWith('#')) continue;
      if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}
loadEnv();

/** Any OpenAI-compatible /audio/transcriptions endpoint (Groq, OpenAI, a local Whisper server...). */
export interface WhisperSpec { apiKey?: string; baseUrl?: string; model?: string }

function resolve(spec?: WhisperSpec) {
  // The on-device whisper.cpp server on this PC needs no key.
  const local = /^http:\/\/127\.0\.0\.1:\d+\//.test(spec?.baseUrl ?? '');
  const key = spec?.apiKey || (local ? 'local' : '') || process.env.STT_API_KEY || '';
  if (!key) return null;
  return {
    key,
    base: (spec?.baseUrl || process.env.STT_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/+$/, ''),
    model: spec?.model || process.env.STT_MODEL || 'whisper-large-v3-turbo',
  };
}

export const hasWhisper = (spec?: WhisperSpec) => !!resolve(spec);

/** Wrap 16 kHz mono s16le PCM in a WAV container. */
export function pcmToWav(pcm: Buffer, rate = 16000): Buffer {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/** Whisper-family models invent these on near-silence; drop them for short clips. */
const HALLUCINATIONS = /^(thank you\.?|thanks( for watching)?\.?|you\.?|bye\.?|\.+|okay\.?|\[.*\]|\(.*\)|subtitles? by.*)$/i;

export async function transcribe(pcm: Buffer, spec?: WhisperSpec, language?: string): Promise<string> {
  const r = resolve(spec);
  if (!r) throw new Error('No speech-to-text key set (Settings → Listening)');
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(pcmToWav(pcm))], { type: 'audio/wav' }), 'audio.wav');
  form.append('model', r.model);
  form.append('temperature', '0');
  form.append('response_format', 'json');
  if (language) form.append('language', language.slice(0, 2).toLowerCase());
  const res = await fetch(`${r.base}/audio/transcriptions`, { method: 'POST', headers: { Authorization: `Bearer ${r.key}` }, body: form });
  if (!res.ok) throw new Error(`Speech-to-text ${res.status}: ${(await res.text()).slice(0, 200).replace(r.key, '[key]')}`);
  const text = (((await res.json()) as { text?: string }).text ?? '').trim();
  return pcm.length < 16000 * 2 * 2 && HALLUCINATIONS.test(text) ? '' : text;
}
