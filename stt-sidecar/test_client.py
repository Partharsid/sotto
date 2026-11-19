"""Stream a WAV to the sidecar at real-time pace and report when text appears relative to the audio."""
import asyncio, json, sys, time, wave
import numpy as np
import websockets

async def main(path, port=3002):
    w = wave.open(path)
    sr = w.getframerate()
    pcm = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32)
    if w.getnchannels() > 1:
        pcm = pcm.reshape(-1, w.getnchannels()).mean(axis=1)
    if sr != 16000:
        pcm = np.interp(np.arange(0, len(pcm), sr / 16000), np.arange(len(pcm)), pcm)
    pcm = pcm.astype(np.int16)
    dur = len(pcm) / 16000
    frames = pcm[: (len(pcm) // 1600) * 1600].reshape(-1, 1600).astype(np.float32) / 32768.0
    loud = np.sqrt((frames ** 2).mean(axis=1)) > 0.012
    onset = float(np.argmax(loud)) * 0.1
    offset = (len(loud) - float(np.argmax(loud[::-1]))) * 0.1
    print(f"speech in file: {onset:.1f}s -> {offset:.1f}s")
    events = []
    async with websockets.connect(f"ws://127.0.0.1:{port}/", origin="http://localhost:3000") as ws:
        first = json.loads(await ws.recv())
        print("server:", first)
        t0 = time.time()

        async def reader():
            async for m in ws:
                j = json.loads(m)
                events.append((time.time() - t0, j))
                print(f"  t={time.time()-t0:5.2f}s (audio {dur:.1f}s)  {j['type']:8s} {j.get('text','')!r}")

        r = asyncio.create_task(reader())
        CH = 800  # 50 ms frames
        for i in range(0, len(pcm), CH):
            # a microphone delivers a frame when it has finished recording it
            await asyncio.sleep(max(0.0, t0 + (i + CH) / 16000 - time.time()))
            await ws.send(pcm[i:i + CH].tobytes())
        await asyncio.sleep(1.5)
        r.cancel()
        parts = [t for t, j in events if j.get('type') == 'partial']
        finals = [t for t, j in events if j.get('type') == 'final']
        if parts: print(f"first words appeared {parts[0] - onset:.2f}s after speech began")
        if finals: print(f"final text {finals[0] - offset:+.2f}s relative to the end of speech")

asyncio.run(main(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 3002))
