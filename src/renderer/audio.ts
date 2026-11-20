/** Audio capture: the microphone ("me") and the computer's sound ("them"), as 16 kHz mono 50 ms frames. */

export type Who = 'me' | 'them';
export const FRAME = 800; // samples = 50 ms @ 16 kHz

export interface MicInfo { id: string; label: string }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The microphones Windows knows about (without the duplicate "Default"/"Communications" aliases). */
export async function listMics(): Promise<MicInfo[]> {
  const all = await navigator.mediaDevices.enumerateDevices();
  return all.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications').map((d) => ({ id: d.deviceId, label: d.label || 'Microphone' }));
}

const openMic = (id?: string) =>
  navigator.mediaDevices.getUserMedia({ audio: { deviceId: id ? { exact: id } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });

/** A muted or unplugged device hands over a track that never "unmutes". */
async function delivers(s: MediaStream): Promise<boolean> {
  const t = s.getAudioTracks()[0];
  for (let i = 0; i < 10 && t?.muted; i++) await sleep(100);
  return !!t && !t.muted;
}

const stopAll = (s: MediaStream) => s.getTracks().forEach((t) => t.stop());

/** Opens all of `mics` at once; resolves with the first that delivers sound (the rest are closed as they finish), else null. */
function firstWorking(mics: MicInfo[]): Promise<{ m: MicInfo; c: MediaStream } | null> {
  return new Promise((resolve) => {
    let won = false, left = mics.length;
    if (!left) return resolve(null);
    for (const m of mics) {
      openMic(m.id).catch(() => null).then(async (c) => {
        const ok = !!c && (await delivers(c));
        if (c && (!ok || won)) stopAll(c);
        else if (c && ok) { won = true; resolve({ m, c }); }
        if (--left === 0 && !won) resolve(null);
      });
    }
  });
}

/**
 * Opens a call-audio ("them") or microphone ("me") stream. For the mic: use the one chosen in Settings; with
 * "system default", if that device is muted/silent, switch to the first one that works and say so via `notify`.
 */
export async function openStream(who: Who, micId = '', notify: (msg: string) => void = () => {}, onPick: (id: string) => void = () => {}): Promise<MediaStream> {
  if (who === 'me') {
    if (micId) {
      const s = await openMic(micId).catch(async (e: Error) => {
        if (/NotFound|Overconstrained/i.test(e.name)) { notify('The microphone you chose is not connected, so Sotto is using the system default.'); return openMic(); }
        throw e;
      });
      if (!(await delivers(s))) notify('Your microphone looks muted or silent. Unmute it, or pick another one in Settings → Listening.');
      return s;
    }
    // "System default": if that device is muted, try every other microphone at once — the first that delivers sound wins.
    const s = await openMic();
    if (await delivers(s)) return s;
    const alt = await firstWorking((await listMics()).filter((m) => m.id));
    if (alt) {
      stopAll(s);
      onPick(alt.m.id);
      notify(`Your default microphone looks muted, so Sotto is using “${alt.m.label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)/i, '')}”. You can change it in Settings → Listening.`);
      return alt.c;
    }
    notify('Your microphone looks muted or silent. Unmute it, or pick another one in Settings → Listening.');
    return s;
  }
  // The desktop shell answers this with the screen's audio loopback; the video track is thrown away.
  const s = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
  s.getVideoTracks().forEach((t) => { t.stop(); s.removeTrack(t); });
  if (!s.getAudioTracks().length) throw new Error('No system audio available');
  return s;
}

/** Calls onFrame for every 50 ms of audio and onLevel (0–1) a few times a second. Returns a stop function. */
export function tap(stream: MediaStream, onFrame: (pcm: Int16Array) => void, onLevel: (v: number) => void): () => void {
  const ctx = new AudioContext({ sampleRate: 16000 });
  const src = ctx.createMediaStreamSource(stream);
  const node = ctx.createScriptProcessor(2048, 1, 1);
  const mute = ctx.createGain(); // keep the graph alive without playing the audio back
  mute.gain.value = 0;
  let carry = new Float32Array(0);
  let last = 0;

  node.onaudioprocess = (e) => {
    const x = e.inputBuffer.getChannelData(0);
    const buf = new Float32Array(carry.length + x.length);
    buf.set(carry);
    buf.set(x, carry.length);
    let o = 0;
    for (; o + FRAME <= buf.length; o += FRAME) {
      const out = new Int16Array(FRAME);
      let sum = 0;
      for (let i = 0; i < FRAME; i++) {
        const v = Math.max(-1, Math.min(1, buf[o + i]));
        out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
        sum += v * v;
      }
      onFrame(out);
      const now = performance.now();
      if (now - last > 80) { last = now; onLevel(Math.min(1, Math.sqrt(sum / FRAME) * 6)); }
    }
    carry = buf.slice(o);
  };

  src.connect(node);
  node.connect(mute);
  mute.connect(ctx.destination);
  return () => {
    node.onaudioprocess = null;
    try { src.disconnect(); node.disconnect(); mute.disconnect(); } catch { /* already closed */ }
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close();
    onLevel(0);
  };
}
