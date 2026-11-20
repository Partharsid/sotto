# Changelog

## 0.1.1 — 2026-11-20

- Microphone fix: if Windows' default microphone is muted (common with USB headsets/webcams), Sotto now tries your other microphones, uses the first that picks up sound, tells you which one, and remembers it.
- New Settings → Listening → Microphone picker (re-lists when you plug something in).
- If Windows is slow to open the microphone, the Listen screen says so instead of sitting on "Starting…".

## 0.1.0 — 2026-11-19

First public release.

- One-window app with three screens: Listen, Notes, Settings. Light theme, plain CSS, no component library.
- Listens to the call's sound and your microphone; on-device streaming speech recognition (Moonshine) or Deepgram / a Whisper API.
- Answers streamed from free OpenRouter models (raced, first reply wins), Gemini, or any OpenAI-compatible API; grounded in your CV and notes (PDF, Word, text).
- Call detection: a popup when Zoom, Teams, Webex, Slack, Discord, Skype or a browser call starts using the microphone; stops by itself when the call ends. Ask / start by itself / off, plus "never for this app".
- Live transcript with "Answer this", quick Shorter / More detail / Example re-asks, one-click meeting summary, global hotkeys (Ctrl+Shift+A answer, Ctrl+Shift+H hide).
- Hide-from-screen-sharing switch (also applied to the call popup).
- Local API bound to 127.0.0.1 and closed to web pages; strict Content-Security-Policy.
- Simplified from an earlier prototype: 27,300 lines → ~2,000, 87 dependencies → 3 at runtime.
