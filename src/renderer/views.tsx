import { useEffect, useRef, useState } from 'react';
import { API, call } from './api';
import { listMics, type MicInfo } from './audio';
import type { Card, Line } from './hooks';
import { useStore, type AiKind, type Engine, type Source } from './store';
import { Check, Chev, Copy, Doc, Eye, EyeOff, Mic, Plus, Send, Trash, Seg, Switch, Field, toast } from './ui';

export interface Moon { installed: boolean; running: boolean; installing: boolean; error?: string }

/** "Zoom" → "Zoom call"; "a browser call" stays as is. */
const callName = (app: string) => (/call$/i.test(app) ? app : `${app} call`);

// ── Listen ────────────────────────────────────────────────────────────────────────────────────
interface ListenProps {
  on: boolean; busy: boolean; level: number; partial: { me: string; them: string }; last: Line | null;
  cards: Card[]; moon: Moon | null; lines: Line[]; meetingApp: string | null;
  onToggle: () => void; onInstall: () => void; onAskLine: (text: string) => void;
  onRevise: (c: Card, how: string, label: string) => void; onSummarize: () => void; onClearLines: () => void;
}

export function Listen({ on, busy, level, partial, last, cards, moon, lines, meetingApp, onToggle, onInstall, onAskLine, onRevise, onSummarize, onClearLines }: ListenProps) {
  const source = useStore((s) => s.listen.source);
  const engine = useStore((s) => s.listen.engine);
  const patch = useStore((s) => s.patch);
  const live = partial.them ? { who: 'Them', text: partial.them } : partial.me ? { who: 'You', text: partial.me } : null;
  const needSetup = engine === 'moonshine' && moon && !moon.installed;
  const view = useRef<HTMLDivElement>(null);
  const newest = cards[0]?.id;
  // a new answer should be in view without hunting for it
  useEffect(() => { if (newest) view.current?.scrollTo({ top: 0, behavior: 'smooth' }); }, [newest]);
  // Windows can be slow to hand over a microphone; say so instead of looking frozen
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!busy) { setSlow(false); return; }
    const t = setTimeout(() => setSlow(true), 3000);
    return () => clearTimeout(t);
  }, [busy]);

  return (
    <div className="view" ref={view}>
      <div className={`hero ${cards.length ? 'compact' : ''}`}>
        <button className={`orb ${on ? 'on' : ''}`} style={{ ['--lvl' as string]: level }} onClick={onToggle} aria-label={on ? 'Stop listening' : 'Start listening'} disabled={busy}>
          {busy ? <span className="spin" /> : on ? <span className="bars"><i /><i /><i /></span> : <Mic size={38} strokeWidth={1.6} />}
        </button>
        <div className="hint">
          {busy ? (slow ? 'Waiting for Windows to open your microphone…' : 'Starting…') : on ? (meetingApp ? `Listening · ${callName(meetingApp)}` : `Listening to ${source === 'both' ? 'the call and your mic' : source === 'system' ? 'the call' : 'your mic'}`) : meetingApp ? `${callName(meetingApp)} detected · tap to start` : 'Tap to start listening'}
        </div>
        {!on && !busy && (
          <Seg<Source> className="sources" label="What to listen to" value={source} onChange={(v) => patch('listen', { source: v })} options={[['both', 'Both'], ['system', 'Call'], ['mic', 'Mic']]} />
        )}
      </div>

      {needSetup && (
        <div className="setup">
          <p><b>One-time setup.</b> Sotto listens on your own computer: free, private, no account. It downloads a small speech model once.</p>
          <button className="btn" onClick={onInstall} disabled={moon.installing}>{moon.installing ? 'Setting up…' : 'Set up'}</button>
        </div>
      )}

      {(live || (on && last)) && (
        <div className="caption" key={live ? 'live' : 'last'}>
          <b>{live ? live.who : last!.who === 'them' ? 'Them' : 'You'}</b>
          <p className={live ? 'caret' : 'final'}>{live ? live.text : last!.text}</p>
        </div>
      )}

      <Transcript lines={lines} onAsk={onAskLine} onSummarize={onSummarize} onClear={onClearLines} />

      {!cards.length && !live && (
        <div className="empty">Answers appear here the moment a question is asked.<br />Or type one below.<br /><span style={{ opacity: 0.8 }}>Ctrl + Shift + A answers whatever was just asked.</span></div>
      )}
      <div className="cards">{cards.map((c, i) => <Answer key={c.id} c={c} newest={i === 0} onRevise={onRevise} />)}</div>
    </div>
  );
}

function Transcript({ lines, onAsk, onSummarize, onClear }: { lines: Line[]; onAsk: (t: string) => void; onSummarize: () => void; onClear: () => void }) {
  const [open, setOpen] = useState(false);
  if (!lines.length) return null;
  return (
    <div className="tr">
      <button className="tr-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        Transcript <span className="chip">{lines.length}</span><span style={{ flex: 1 }} /><Chev className={open ? 'flip' : ''} />
      </button>
      {open && (
        <div className="tr-body">
          {lines.slice(-40).map((l) => (
            <div className="tl" key={l.id}>
              <b>{l.who === 'them' ? 'Them' : 'You'}</b>
              <span>{l.text}</span>
              {l.who === 'them' && <button className="icon-btn sm" title="Answer this" aria-label="Answer this" onClick={() => onAsk(l.text)}><Send size={14} /></button>}
            </div>
          ))}
          <div className="tr-actions">
            {lines.length >= 2 && <button className="btn soft" onClick={onSummarize}>Summarize</button>}
            <button className="btn ghost" onClick={onClear}>Clear</button>
          </div>
        </div>
      )}
    </div>
  );
}

const REVISIONS: [string, string, string][] = [['Shorter', 'make it shorter and punchier', 'shorter'], ['More detail', 'give more detail', 'more detail'], ['Example', 'add a concrete example from my experience', 'with an example']];

function Answer({ c, newest, onRevise }: { c: Card; newest: boolean; onRevise: (c: Card, how: string, label: string) => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <article className="card">
      <div className="q">{c.kind === 'summary' ? 'Meeting summary' : c.q}{c.tag && <em> · {c.tag}</em>}</div>
      {c.state === 'thinking' ? (
        <div aria-label="Thinking"><div className="sk" /><div className="sk" /><div className="sk" /></div>
      ) : (
        <div className={`a ${c.state === 'streaming' ? 'caret' : ''} ${c.state === 'error' ? 'err' : ''}`}>{c.a}</div>
      )}
      {(c.model || c.state === 'done') && c.state !== 'error' && (
        <div className="foot">
          {c.model && <span className="chip">{c.model}</span>}
          {c.ms != null && <span className="chip ok">{c.ms} ms</span>}
          <span style={{ flex: 1 }} />
          {c.state === 'done' && (
            <button className="icon-btn" title="Copy" aria-label="Copy answer" onClick={() => { void navigator.clipboard.writeText(c.a); setCopied(true); setTimeout(() => setCopied(false), 1400); }}>
              {copied ? <Check /> : <Copy />}
            </button>
          )}
        </div>
      )}
      {newest && c.state === 'done' && c.kind !== 'summary' && (
        <div className="quick">{REVISIONS.map(([label, how, tag]) => <button key={label} onClick={() => onRevise(c, how, tag)}>{label}</button>)}</div>
      )}
    </article>
  );
}

// ── Notes (CV + documents) ────────────────────────────────────────────────────────────────────
export function Notes() {
  const { docs, addDoc, toggleDoc, removeDoc } = useStore();
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [paste, setPaste] = useState(false);
  const [text, setText] = useState('');
  const file = useRef<HTMLInputElement>(null);

  async function read(files: File[]) {
    setBusy(true);
    for (const f of files) {
      try {
        if (f.size > 10 << 20) throw new Error(`${f.name} is larger than 10 MB`);
        const r = await fetch(`${API}/api/documents/parse?name=${encodeURIComponent(f.name)}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: await f.arrayBuffer() });
        const j = await r.json();
        if (!r.ok) throw new Error(j.message);
        addDoc(f.name.replace(/\.[^.]+$/, ''), j.text);
      } catch (e) { toast((e as Error).message); }
    }
    setBusy(false);
  }

  return (
    <div className="view">
      <div className={`drop ${over ? 'over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); void read([...e.dataTransfer.files]); }}>
        <strong>{busy ? 'Reading…' : 'Add your CV or notes'}</strong>
        PDF, Word or text. Answers will draw on them.
        <div className="btns">
          <button className="btn" onClick={() => file.current?.click()} disabled={busy}><Plus size={16} /> Choose file</button>
          <button className="btn ghost" onClick={() => setPaste((p) => !p)}>Paste text</button>
        </div>
        <input ref={file} type="file" hidden multiple accept=".pdf,.docx,.txt,.md" onChange={(e) => { void read([...(e.target.files ?? [])]); e.target.value = ''; }} />
      </div>

      {paste && (
        <div className="field">
          <textarea className="input" autoFocus placeholder="Paste your CV or any notes…" value={text} onChange={(e) => setText(e.target.value)} />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn" disabled={text.trim().length < 20} onClick={() => { addDoc(text.trim().split('\n')[0].slice(0, 40) || 'Notes', text.trim()); setText(''); setPaste(false); }}>Save</button>
            <button className="btn ghost" onClick={() => setPaste(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="docs">
        {docs.map((d) => (
          <div className="doc" key={d.id}>
            <Doc style={{ color: 'var(--muted)', flex: 'none' }} />
            <div className="t"><b>{d.name}</b><span>{d.text.length.toLocaleString()} characters</span></div>
            <Switch on={d.on} onChange={() => toggleDoc(d.id)} label={`Use ${d.name}`} />
            <button className="icon-btn" aria-label={`Delete ${d.name}`} title="Delete" onClick={() => removeDoc(d.id)}><Trash /></button>
          </div>
        ))}
      </div>
      {!docs.length && <div className="empty">Nothing yet. Without a CV, answers stay general.</div>}
    </div>
  );
}

// ── Settings ──────────────────────────────────────────────────────────────────────────────────
const KEY_LINKS: Record<AiKind, [string, string]> = {
  openrouter: ['https://openrouter.ai/keys', 'Free models, no card needed'],
  gemini: ['https://aistudio.google.com/apikey', 'Generous free tier'],
  custom: ['', 'Any OpenAI-compatible API'],
};

function Secret({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <input className="input" style={{ paddingRight: 42 }} type={show ? 'text' : 'password'} value={value} placeholder={placeholder} autoComplete="off" spellCheck={false} onChange={(e) => onChange(e.target.value)} />
      <button className="icon-btn" style={{ position: 'absolute', right: 3, top: 3 }} onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide key' : 'Show key'}>{show ? <EyeOff /> : <Eye />}</button>
    </div>
  );
}

function MicPicker() {
  const micId = useStore((s) => s.listen.micId ?? '');
  const patch = useStore((s) => s.patch);
  const [mics, setMics] = useState<MicInfo[]>([]);
  useEffect(() => {
    const load = () => listMics().then(setMics).catch(() => setMics([]));
    load();
    navigator.mediaDevices.addEventListener('devicechange', load);
    return () => navigator.mediaDevices.removeEventListener('devicechange', load);
  }, []);
  return (
    <Field label="Microphone" hint="Used for what you say. If the system default is muted, Sotto switches to one that works.">
      <select className="input" value={micId} onChange={(e) => patch('listen', { micId: e.target.value })} aria-label="Microphone">
        <option value="">System default</option>
        {mics.map((m) => <option key={m.id} value={m.id}>{m.label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)/i, '')}</option>)}
      </select>
    </Field>
  );
}

function MicNow() {
  const [apps, setApps] = useState<string[] | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = () => window.sotto?.meeting.micApps().then((a) => alive && setApps(a)).catch(() => {});
    tick();
    const t = setInterval(tick, 3000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  if (apps === null) return null;
  return <div className="micnow"><i className={apps.length ? 'live' : ''} />{apps.length ? `Using your microphone now: ${apps.join(', ')}` : 'No app is using your microphone right now'}</div>;
}

export function Settings({ moon, onInstall }: { moon: Moon | null; onInstall: () => void }) {
  const { ai, listen, ui, meeting, patch, setKey, setListenKey } = useStore();
  const [link, hint] = KEY_LINKS[ai.kind];

  return (
    <div className="view">
      <section className="sec">
        <h3>Answers</h3>
        <Seg<AiKind> label="Answer provider" value={ai.kind} onChange={(v) => patch('ai', { kind: v })} options={[['openrouter', 'OpenRouter'], ['gemini', 'Gemini'], ['custom', 'Custom']]} />
        {ai.kind === 'custom' && (
          <Field label="Base URL"><input className="input" placeholder="https://api.groq.com/openai/v1" value={ai.baseUrl} onChange={(e) => patch('ai', { baseUrl: e.target.value })} /></Field>
        )}
        <Field label="API key" hint={<>{hint}{link && <> · <a href={link} target="_blank" rel="noreferrer">Get a key</a></>}</>}>
          <Secret value={ai.keys[ai.kind]} onChange={(v) => setKey(ai.kind, v)} placeholder="Paste your key" />
        </Field>
        <Field label={ai.kind === 'custom' ? 'Model' : 'Models (optional)'} hint={ai.kind === 'custom' ? undefined : 'Leave empty for the fastest defaults. Several, separated by commas, race each other and the first answer wins.'}>
          <input className="input" placeholder={ai.kind === 'custom' ? 'e.g. llama-3.1-8b-instant' : 'Default'} value={ai.models} onChange={(e) => patch('ai', { models: e.target.value })} />
        </Field>
      </section>

      <section className="sec">
        <h3>Listening</h3>
        <Seg<Engine> label="Speech engine" value={listen.engine} onChange={(v) => patch('listen', { engine: v })} options={[['moonshine', 'On-device'], ['deepgram', 'Deepgram'], ['whisper', 'Whisper API']]} />
        <MicPicker />
        {listen.engine === 'moonshine' && (
          <>
            <Field label="Model size" hint="Tiny is fastest; Small is more accurate.">
              <Seg label="Model size" value={listen.size} onChange={(v) => patch('listen', { size: v })} options={[['tiny', 'Tiny'], ['small', 'Small']]} />
            </Field>
            <div className="row" style={{ marginTop: 6 }}>
              <div>{moon?.installed ? 'Ready' : 'Not set up yet'}<small>Free and private. Needs Python 3.9+, about 100 MB, once.</small></div>
              {!moon?.installed && <button className="btn soft" onClick={onInstall} disabled={moon?.installing}>{moon?.installing ? 'Setting up…' : 'Set up'}</button>}
            </div>
            {moon?.error && <small style={{ color: 'var(--err)' }}>{moon.error}</small>}
          </>
        )}
        {listen.engine === 'deepgram' && (
          <Field label="Deepgram key" hint={<>Live streaming in the cloud · <a href="https://console.deepgram.com/signup" target="_blank" rel="noreferrer">Get a key</a></>}>
            <Secret value={listen.keys.deepgram} onChange={(v) => setListenKey('deepgram', v)} placeholder="Paste your key" />
          </Field>
        )}
        {listen.engine === 'whisper' && (
          <>
            <Field label="Base URL"><input className="input" value={listen.whisperBase} onChange={(e) => patch('listen', { whisperBase: e.target.value })} /></Field>
            <Field label="API key" hint={<>Groq's Whisper is fast and has a free tier · <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer">Get a key</a></>}>
              <Secret value={listen.keys.whisper} onChange={(v) => setListenKey('whisper', v)} placeholder="Paste your key" />
            </Field>
          </>
        )}
      </section>

      <section className="sec">
        <h3>Meetings</h3>
        <Seg<'ask' | 'auto' | 'off'> label="When a call starts" value={meeting.mode} onChange={(v) => patch('meeting', { mode: v })} options={[['ask', 'Ask me'], ['auto', 'Start by itself'], ['off', 'Off']]} />
        <MicNow />
        <Field label="" hint="Sotto notices when Zoom, Teams, Webex, Meet and similar calls start using your microphone, then offers to help. Nothing is recorded to notice a call.">
          {meeting.ignore.length > 0 && (
            <div className="chips">{meeting.ignore.map((a) => <button key={a} className="chip tag" onClick={() => patch('meeting', { ignore: meeting.ignore.filter((x) => x !== a) })} title="Ask again for this app">{a} ✕</button>)}</div>
          )}
        </Field>
      </section>

      <section className="sec">
        <h3>Behavior</h3>
        <div className="row"><div>Answer questions automatically<small>When someone asks you something</small></div><Switch on={ui.auto} onChange={(v) => patch('ui', { auto: v })} label="Answer automatically" /></div>
        <div className="row"><div>Answer length</div><Seg className="" label="Answer length" value={ui.length} onChange={(v) => patch('ui', { length: v })} options={[['short', 'Short'], ['long', 'Detailed']]} /></div>
        <div className="row"><div>Hide from screen sharing<small>Recorders and screen shares can't see this window</small></div><Switch on={ui.private} onChange={(v) => patch('ui', { private: v })} label="Hide from screen sharing" /></div>
        <div className="row"><div>Keep on top</div><Switch on={ui.pin} onChange={(v) => patch('ui', { pin: v })} label="Keep on top" /></div>
      </section>

      <p className="hint" style={{ marginTop: 6 }}>Press <b>Ctrl + Shift + H</b> anywhere to hide or show Sotto instantly.</p>
    </div>
  );
}

export const fetchMoon = () => call<Moon>('/api/moonshine');
