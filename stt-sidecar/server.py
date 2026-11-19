"""
Moonshine streaming STT sidecar for ParakeetAI.

Listens on ws://127.0.0.1:<port>/ and speaks a tiny protocol:
  client -> server : binary frames of 16 kHz mono signed-16-bit PCM
                     text  {"type":"flush"}   force-finish the current line
  server -> client : {"type":"ready","arch":"small-streaming"}
                     {"type":"partial","id":N,"text":"..."}   (text so far, refined as you speak)
                     {"type":"final","id":N,"text":"..."}     (speaker finished the line)
                     {"type":"error","message":"..."}
Everything runs on-device; no network is used after the model is downloaded once.
"""
import argparse
import asyncio
import json
import sys
import time

import numpy as np
import websockets
from moonshine_voice import ModelArch, get_model_for_language
from moonshine_voice.transcriber import LineCompleted, LineStarted, LineTextChanged, Transcriber

ARCHS = {"tiny": ModelArch.TINY_STREAMING, "small": ModelArch.SMALL_STREAMING}
# The packaged app is a page loaded from disk: browsers call its origin "file://" (WebSocket) or "null" (fetch).
ALLOWED_ORIGINS = {None, "null", "file://", "http://localhost:3000", "http://127.0.0.1:3000"}


def log(*a):
    print(*a, file=sys.stderr, flush=True)


async def main(port: int, arch_name: str, language: str) -> None:
    t0 = time.time()
    path, arch = get_model_for_language(language, ARCHS[arch_name])
    transcriber = Transcriber(model_path=path, model_arch=arch, update_interval=0.1)
    log(f"model {arch.name} loaded in {time.time() - t0:.1f}s")

    async def handler(ws):
        origin = ws.request.headers.get("Origin") if ws.request else None
        if origin not in ALLOWED_ORIGINS:
            await ws.close(code=1008, reason="origin not allowed")
            return
        loop = asyncio.get_running_loop()
        stream = transcriber.create_stream(update_interval=0.1)
        last_text = {}

        def send(obj):
            loop.create_task(ws.send(json.dumps(obj)))

        def on_event(ev):
            line = ev.line
            lid = getattr(line, "id", None) or getattr(line, "line_id", 0)
            text = (line.text or "").strip()
            if isinstance(ev, LineCompleted):
                last_text.pop(lid, None)
                if text:
                    send({"type": "final", "id": lid, "text": text})
            elif isinstance(ev, (LineTextChanged, LineStarted)):
                if text and last_text.get(lid) != text:
                    last_text[lid] = text
                    send({"type": "partial", "id": lid, "text": text})

        stream.add_listener(on_event)
        stream.start()
        send({"type": "ready", "arch": arch.name.lower().replace("_", "-")})
        try:
            async for msg in ws:
                if isinstance(msg, (bytes, bytearray)):
                    pcm = np.frombuffer(msg, dtype=np.int16).astype(np.float32) / 32768.0
                    stream.add_audio(pcm.tolist(), 16000)
                else:
                    try:
                        if json.loads(msg).get("type") == "flush":
                            stream.stop()
                            stream.start()
                    except Exception:
                        pass
        except websockets.ConnectionClosed:
            pass
        finally:
            try:
                stream.stop()
                stream.close()
            except Exception:
                pass

    async with websockets.serve(handler, "127.0.0.1", port, max_size=2**22):
        log(f"READY ws://127.0.0.1:{port}")
        await asyncio.Future()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=3002)
    ap.add_argument("--arch", choices=list(ARCHS), default="small")
    ap.add_argument("--lang", default="en")
    a = ap.parse_args()
    asyncio.run(main(a.port, a.arch, a.lang))
