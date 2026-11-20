# Changelog

## 0.1.7 � 2026-11-21

- Fix: the transcript was full of short fragments. Sotto now waits for a real pause (0.9 s instead of 0.55 s) and glues the pieces of one thought into a single line; a finished question is sent immediately.

## 0.1.6 � 2026-11-21

- New: pick your answer model. Settings > Answers > Load models fetches the list from your provider (OpenRouter, Gemini or any OpenAI-compatible API), with search and a free tag. Tick several and they race.
- New: strong background-noise removal. Your voice goes through a small neural denoiser (GTCRN, with RNNoise as backup; open source, about 200 KB) before the speech engine, so fans, hiss, keyboards and loud rooms are removed instead of transcribed. In a deliberately brutal test (loud noise, music and other voices) the background dropped about 20x in level.
- New: the answer dock. A translucent strip pinned to the screen edge shows live words and answers (Auto, Clear, Answer, Shorter/More/Example, Copy). It never takes focus and is invisible to screen sharing. Ctrl+Alt+D hides it, Ctrl+Alt+E tucks it into a small tab, Ctrl+Alt+Up/Down fades it, Ctrl+Alt+T makes it click-through.

## 0.1.5 � 2026-11-20

- New default on-device speech engine: whisper.cpp (the most-starred open-source speech runtime that runs on a plain CPU). No Python needed; about 80 MB downloaded once from Settings > Listening > Set up. Text appears about a second after you pause.
- The previous engine is still available as "Live" (word-by-word, needs Python).
- The noise gate now sits in front of every engine.

## 0.1.4 � 2026-11-20

- Fix: the speech model wrote random text out of background noise. Sotto now learns how loud your room is and only lets sound through when something clearly louder (speech) happens; key clicks and coughs are ignored.
- The microphone no longer uses automatic gain, which was turning the room hiss up between words.
- Made-up lines such as "Thank you.", "[music]", lone "uh"/"you" or a stuck "the the the" are dropped before they show up or trigger an answer.

## 0.1.3 — 2026-11-20

- Call detection no longer depends on Windows' microphone-use log, which some Windows builds stop updating (on one PC it had not recorded anything for weeks, so no call was ever detected). Sotto now also asks Windows' audio engine which apps have an open capture stream.

## 0.1.2 — 2026-11-20

- Fix: PDF CVs failed to upload in the installed app ("bad XRef entry"); Word and text files were fine. PDF parsing now works inside Electron.
- The installed app reads API keys from `%APPDATA%\Sotto\.env` as well as the working folder, so keys no longer have to be pasted into Settings.
- The window is hidden from screen capture and the taskbar from the first frame, not just after the page loads.

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
