import { useCallback, useEffect, useRef, useState } from 'react';
import { call } from './api';
import { isQuestion } from './brain';
import { useAnswers, useListen, type Card, type Line } from './hooks';
import { useStore } from './store';
import { Eye, EyeOff, Logo, Pin, Send, Seg, Toasts, toast } from './ui';
import { fetchMoon, Listen, Notes, Settings, type Moon } from './views';

type Tab = 'listen' | 'notes' | 'settings';

export default function App() {
  const [tab, setTab] = useState<Tab>('listen');
  const [last, setLast] = useState<Line | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [text, setText] = useState('');
  const [moon, setMoon] = useState<Moon | null>(null);
  const [meetingApp, setMeetingApp] = useState<string | null>(null);
  const { cards, ask } = useAnswers();
  const ui = useStore((s) => s.ui);
  const meeting = useStore((s) => s.meeting);
  const source = useStore((s) => s.listen.source);
  const engine = useStore((s) => s.listen.engine);
  const size = useStore((s) => s.listen.size);
  const patch = useStore((s) => s.patch);
  const asked = useRef('');
  const linesRef = useRef<Line[]>([]);
  linesRef.current = lines;
  const startedByCall = useRef(false);

  // Whose questions get answered: the call's — or your own mic when that is all there is (practice).
  const askWho = meetingApp || source !== 'mic' ? 'them' : 'me';
  const askWhoRef = useRef(askWho);
  askWhoRef.current = askWho;

  const onLine = useCallback((l: Line) => {
    setLast(l);
    setLines((x) => [...x, l].slice(-300));
    if (useStore.getState().ui.auto && l.who === askWhoRef.current && isQuestion(l.text) && l.text !== asked.current) { asked.current = l.text; void ask(l.text); }
  }, [ask]);
  const listen = useListen(onLine, toast);
  const listenRef = useRef(listen);
  listenRef.current = listen;

  // ── desktop shell: hide-from-capture, keep-on-top, meeting detection, the answer hotkey ──────
  useEffect(() => { void window.sotto?.setPrivate(ui.private); }, [ui.private]);
  useEffect(() => { void window.sotto?.setPin(ui.pin); }, [ui.pin]);
  useEffect(() => { window.sotto?.meeting.configure({ mode: meeting.mode, ignore: meeting.ignore }); }, [meeting.mode, meeting.ignore]);

  const answerLast = useCallback(() => {
    const mine = [...linesRef.current].reverse().filter((l) => l.who === askWhoRef.current);
    const pick = mine.find((l) => isQuestion(l.text)) ?? mine[0];
    if (!pick) return toast('Nothing to answer yet');
    asked.current = pick.text;
    void ask(pick.text);
  }, [ask]);

  useEffect(() => {
    const s = window.sotto;
    if (!s) return;
    const offs = [
      s.onAnswerLast(answerLast),
      s.meeting.onStart((m) => { setMeetingApp(m.app); startedByCall.current = true; setTab('listen'); void listenRef.current.start('both'); toast(`${m.app === 'a browser call' ? 'Call' : m.app + ' call'} detected — listening`); }),
      s.meeting.onEnd(() => { setMeetingApp(null); if (startedByCall.current) { startedByCall.current = false; listenRef.current.stop(); toast('The call ended — listening stopped'); } }),
      s.meeting.onNever((app) => patch('meeting', { ignore: [...new Set([...useStore.getState().meeting.ignore, app])] })),
    ];
    return () => offs.forEach((o) => o());
  }, [answerLast, patch]);

  // ── on-device engine status ──────────────────────────────────────────────────────────────────
  const refreshMoon = useCallback(() => { fetchMoon().then(setMoon).catch(() => setMoon(null)); }, []);
  useEffect(() => { if (engine === 'moonshine') refreshMoon(); }, [engine, refreshMoon]);
  // Start the on-device engine quietly once it is installed, so the first question is not lost to a cold start.
  useEffect(() => {
    if (engine === 'moonshine' && moon?.installed && !moon.running && !moon.installing) call('/api/moonshine/start', { arch: size }).then(refreshMoon).catch(() => {});
  }, [engine, size, moon?.installed, moon?.running, moon?.installing, refreshMoon]);

  async function install() {
    setMoon((m) => ({ installed: false, running: false, ...m, installing: true }));
    try { setMoon(await call<Moon>('/api/moonshine/install', { arch: size })); toast('Ready — tap the circle to listen'); }
    catch (e) { toast((e as Error).message); refreshMoon(); }
  }

  const toggle = () => {
    if (listen.on) { startedByCall.current = false; return listen.stop(); }
    if (engine === 'moonshine' && moon && !moon.installed) { toast('Set up on-device listening first'); return; }
    void listen.start();
  };
  const submit = () => { const q = text.trim(); if (q) { asked.current = q; void ask(q); setText(''); } };

  const revise = (c: Card, how: string, label: string) => void ask(c.q, { revise: { answer: c.a, how, label } });
  const summarize = () => {
    const t = linesRef.current.map((l) => (l.who === 'them' ? 'Them: ' : 'You: ') + l.text).join('\n').slice(-14000);
    if (t.length < 40) return toast('Not enough conversation yet');
    void ask('Meeting summary', { summary: t });
  };

  return (
    <div className="app">
      <header className="top">
        <div className="brand"><Logo />Sotto</div>
        <span className="spacer" />
        <button className={`icon-btn ${ui.pin ? 'on' : ''}`} onClick={() => patch('ui', { pin: !ui.pin })} title={ui.pin ? 'Stop keeping on top' : 'Keep on top'} aria-label="Keep on top" aria-pressed={ui.pin}><Pin /></button>
        <button className={`icon-btn ${ui.private ? 'on' : ''}`} onClick={() => patch('ui', { private: !ui.private })} title={ui.private ? 'Hidden from screen sharing' : 'Visible to screen sharing'} aria-label="Hide from screen sharing" aria-pressed={ui.private}>{ui.private ? <EyeOff /> : <Eye />}</button>
      </header>

      <Seg<Tab> className="tabs" label="Sections" value={tab} onChange={setTab} options={[['listen', 'Listen'], ['notes', 'Notes'], ['settings', 'Settings']]} />

      {tab === 'listen' && (
        <Listen key="listen" {...listen} last={last} cards={cards} moon={moon} lines={lines} meetingApp={meetingApp}
          onToggle={toggle} onInstall={install} onAskLine={(t) => { asked.current = t; void ask(t); }} onRevise={revise} onSummarize={summarize} onClearLines={() => { setLines([]); setLast(null); }} />
      )}
      {tab === 'notes' && <Notes key="notes" />}
      {tab === 'settings' && <Settings key="settings" moon={moon} onInstall={install} />}

      {tab === 'listen' && (
        <form className="ask" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <input className="input" placeholder="Or type a question…" value={text} onChange={(e) => setText(e.target.value)} aria-label="Ask a question" />
          <button className="send" type="submit" disabled={!text.trim()} aria-label="Get an answer"><Send /></button>
        </form>
      )}
      <Toasts />
    </div>
  );
}
