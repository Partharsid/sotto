import { useEffect, useRef, useState } from 'react';
import type { DockCard, DockState, DockView } from './api';
import { Logo } from './ui';

const EMPTY: DockState = { on: false, auto: true, partial: { me: '', them: '' }, cards: [], lastLine: '' };
const REV: [string, string, string][] = [['Shorter', 'make it shorter and punchier', 'shorter'], ['More', 'give more detail', 'more detail'], ['Example', 'add a concrete example from my experience', 'with an example']];
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/**
 * The answer dock: a translucent strip pinned to the screen edge. It never takes focus, is invisible to screen
 * sharing, can be tucked away to a small tab (Ctrl+Alt+E), faded (Ctrl+Alt+Up/Down), made click-through
 * (Ctrl+Alt+T) or hidden outright (Ctrl+Alt+D).
 */
export default function Dock() {
  const [st, setSt] = useState<DockState>(EMPTY);
  const [view, setView] = useState<DockView>({ collapsed: false, through: false, opacity: 0.95 });
  const [secs, setSecs] = useState(0);
  const [copied, setCopied] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const d = window.sotto?.dock;

  useEffect(() => {
    document.documentElement.classList.add('dock');
    if (!d) return;
    const offs = [d.onState(setSt), d.onView(setView)];
    d.ready();
    return () => offs.forEach((o) => o());
  }, [d]);

  useEffect(() => {
    if (!st.on) return;
    setSecs(0);
    const t = setInterval(() => setSecs((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [st.on]);

  useEffect(() => { list.current?.scrollTo({ top: 0 }); }, [st.cards[0]?.id]);

  const live = st.partial.them || st.partial.me;
  const status = st.on ? (live ? 'Hearing you…' : 'Listening…') : 'Not listening';

  if (view.collapsed) {
    return (
      <button className={`dock-tab ${st.on ? 'live' : ''}`} onClick={() => void d?.ctl('expand')} aria-label="Open Sotto dock" title="Open (Ctrl+Alt+E)">
        <i className="dot" />
        <span>Sotto</span>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>
      </button>
    );
  }

  const copy = (c: DockCard) => { void d?.copy(c.a); setCopied(c.id); setTimeout(() => setCopied(0), 1300); };

  return (
    <div className="dock-wrap">
      <header className="dock-head">
        <Logo />
        <div className="dock-status">
          <b><i className={`dot ${st.on ? 'on' : ''}`} />{status}</b>
          {st.on && <span>{mmss(secs)}</span>}
        </div>
        <span style={{ flex: 1 }} />
        <button className={`dk-chip ${st.auto ? 'on' : ''}`} onClick={() => d?.cmd({ t: 'auto' })} title="Answer questions automatically">Auto</button>
        <button className="dk-chip" onClick={() => d?.cmd({ t: 'clear' })} title="Clear answers">Clear</button>
        <button className="dk-chip primary" onClick={() => d?.cmd({ t: 'answer' })} title="Answer the last question (Ctrl+Shift+A)">Answer</button>
        <button className="dk-icon" onClick={() => void d?.ctl('collapse')} aria-label="Tuck away" title="Tuck away (Ctrl+Alt+E)">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
        </button>
      </header>

      {(live || st.lastLine) && <div className={`dock-live ${live ? 'now' : ''}`}>{live || st.lastLine}</div>}

      <div className="dock-list" ref={list}>
        {!st.cards.length && (
          <div className="dock-empty">
            <b>Answers show up here</b>
            <span>Ctrl+Alt+D hide · Ctrl+Alt+E tuck away · Ctrl+Alt+T click-through</span>
          </div>
        )}
        {st.cards.map((c, i) => (
          <article key={c.id} className={`dk-card ${i === 0 ? 'new' : ''}`}>
            <div className="dk-q">{c.kind === 'summary' ? 'Meeting summary' : c.q}{c.tag && <em> · {c.tag}</em>}</div>
            {c.state === 'thinking' ? <div className="dk-sk"><i /><i /><i /></div> : <div className={`dk-a ${c.state === 'streaming' ? 'caret' : ''} ${c.state === 'error' ? 'err' : ''}`}>{c.a}</div>}
            {c.state === 'done' && (
              <div className="dk-foot">
                {c.model && <span>{c.model}</span>}
                {c.ms != null && <span>{c.ms} ms</span>}
                <span style={{ flex: 1 }} />
                {i === 0 && c.kind !== 'summary' && REV.map(([l, how, tag]) => <button key={l} className="dk-mini" onClick={() => d?.cmd({ t: 'revise', id: c.id, how, label: tag })}>{l}</button>)}
                <button className="dk-mini" onClick={() => copy(c)}>{copied === c.id ? 'Copied' : 'Copy'}</button>
              </div>
            )}
          </article>
        ))}
      </div>

      <footer className="dock-foot">
        <label className="dk-op" title="Transparency (Ctrl+Alt+Up/Down)">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" /></svg>
          <input type="range" min={30} max={100} value={Math.round(view.opacity * 100)} onChange={(e) => void d?.ctl('opacity', Number(e.target.value) / 100)} aria-label="Dock opacity" />
        </label>
        <button className={`dk-chip ${view.through ? 'on' : ''}`} onClick={() => void d?.ctl('through')} title="Let clicks pass through to the app behind (Ctrl+Alt+T to undo)">Click-through</button>
        <button className="dk-chip" onClick={() => d?.cmd({ t: 'listen' })}>{st.on ? 'Stop' : 'Listen'}</button>
        <button className="dk-chip" onClick={() => void d?.ctl('open-main')}>Open Sotto</button>
        <button className="dk-chip" onClick={() => void d?.ctl('hide')} title="Hide (Ctrl+Alt+D)">Hide</button>
      </footer>
      {view.through && <div className="dock-through">Click-through is on · Ctrl+Alt+T to turn off</div>}
    </div>
  );
}
