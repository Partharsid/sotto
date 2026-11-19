/** Audio capture: the microphone ("me") and the computer's sound ("them"), as 16 kHz mono 50 ms frames. */

export type Who = 'me' | 'them';
export const FRAME = 800; // samples = 50 ms @ 16 kHz

export async function openStream(who: Who): Promise<MediaStream> {
  if (who === 'me') {
    return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
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
