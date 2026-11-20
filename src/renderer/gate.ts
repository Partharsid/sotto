/**
 * Noise gate + junk filter that sit in front of the speech engines.
 *
 * Speech models write words for room noise, fans and key clicks. The gate learns how loud the room is when nobody
 * speaks and only lets audio through while something clearly louder happens. Closed frames are sent as silence (not
 * dropped) so the engine still sees the pauses it needs to finish a sentence.
 */
const rms = (f: Int16Array) => { let n = 0; for (let i = 0; i < f.length; i++) { const v = f[i] / 32768; n += v * v; } return Math.sqrt(n / f.length); };

export interface GateOptions {
  /** never open below this level (0–1 RMS); the mic is noisier than the computer's sound */
  min: number;
  /** how many times louder than the learned room noise counts as speech */
  ratio: number;
}

// After RNNoise the room is ~0.0005 and speech 0.01+, so these sit well clear of both (the plain-mic fallback learns its floor on its own).
export const MIC_GATE: GateOptions = { min: 0.006, ratio: 4 };
export const SYSTEM_GATE: GateOptions = { min: 0.003, ratio: 4 };

const HANG_FRAMES = 12;  // keep open 600 ms after the last loud frame, so word endings and short pauses survive
const PRE_FRAMES = 6;    // 300 ms of lead-in, so the first syllable is not clipped
const OPEN_FRAMES = 2;   // need 100 ms of loud audio in a row to open: key clicks and coughs are shorter

export function gated(push: (f: Int16Array) => void, o: GateOptions): (f: Int16Array) => void {
  let floor = o.min / o.ratio; // learned background level
  let open = false, hang = 0, run = 0;
  const pre: Int16Array[] = [];
  let silent: Int16Array | null = null;

  return (f) => {
    const v = rms(f);
    const threshold = Math.max(o.min, floor * o.ratio);
    const loud = v > threshold;
    if (!loud) floor = Math.min(0.05, floor * 0.97 + v * 0.03); // only learn from quiet frames, so speech never raises it

    if (open) {
      if (loud) hang = HANG_FRAMES; else if (--hang <= 0) open = false;
      return push(f);
    }

    pre.push(f);
    if (pre.length > PRE_FRAMES + OPEN_FRAMES) pre.shift();
    run = loud ? run + 1 : 0;
    if (run >= OPEN_FRAMES) {
      open = true; hang = HANG_FRAMES; run = 0;
      for (const p of pre.splice(0)) push(p);
      return;
    }
    silent ??= new Int16Array(f.length);
    push(silent);
  };
}

const FILLER = new Set(['uh', 'um', 'uhh', 'umm', 'hmm', 'hm', 'mm', 'mmm', 'ah', 'oh', 'eh', 'huh', 'the', 'a', 'and', 'so', 'i', 'you', 'it', 'is', 'to', 'of', 'okay', 'ok', 'yeah', 'yes', 'no', 'bye', 'thanks', 'thank', 'you.']);
const PHRASES = /^(thank you( so much| very much)?( for watching)?|thanks for watching|please subscribe|subtitles? by.*|transcribed by.*|(\[|\().*(\]|\)))$/i;

/** True for text a speech model makes up from noise: empty, a lone filler, a stuck repeat, or a stock phrase. */
export function isJunk(text: string): boolean {
  const t = text.trim();
  const letters = t.replace(/[^\p{L}]/gu, '');
  if (letters.length < 2) return true;
  if (PHRASES.test(t.replace(/[.!?]+$/, ''))) return true;
  const words = t.toLowerCase().replace(/[^\p{L}\p{N}'\s]/gu, ' ').split(/\s+/).filter(Boolean);
  if (words.length <= 2 && words.every((w) => FILLER.has(w))) return true;
  if (words.length >= 4 && new Set(words).size <= Math.ceil(words.length / 4)) return true; // "the the the the"
  return false;
}

/**
 * Glues the short pieces a speech engine returns (it cuts at every breath) back into whole sentences. A piece that
 * ends a question goes out at once; anything else waits `hold` ms for the next piece, so one thought = one line.
 * Returns `add(piece)` and `flush()` (call on stop).
 */
export function joiner(emit: (text: string) => void, hold = 1600, maxChars = 280) {
  let pend = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    clearTimeout(timer);
    const t = pend.trim();
    pend = '';
    if (t && !isJunk(t)) emit(t);
  };
  const add = (piece: string) => {
    const t = piece.trim();
    if (!t) return;
    if (!pend && isJunk(t)) return; // a lone "Thank you." / "uh" made up from noise
    pend = pend ? `${pend} ${t}` : t;
    clearTimeout(timer);
    if (/\?\s*$/.test(pend) || pend.length >= maxChars) flush();
    else timer = setTimeout(flush, hold);
  };
  return { add, flush };
}
