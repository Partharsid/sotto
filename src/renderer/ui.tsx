import { useCallback, useEffect, useState, type ReactNode, type SVGProps } from 'react';

// ── Icons (24×24, stroke) ─────────────────────────────────────────────────────────────────────
const I = (d: ReactNode) => (p: SVGProps<SVGSVGElement> & { size?: number }) => (
  <svg width={p.size ?? 18} height={p.size ?? 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...p}>{d}</svg>
);
export const Mic = I(<><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>);
export const Pin = I(<><path d="M9 4h6l-1 6 3 3v2H7v-2l3-3z" /><path d="M12 15v6" /></>);
export const Eye = I(<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>);
export const EyeOff = I(<><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 4.3-1" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>);
export const Copy = I(<><rect x="9" y="9" width="11" height="11" rx="2.5" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></>);
export const Check = I(<path d="M5 12.5l4.5 4.5L19 7.5" />);
export const Trash = I(<><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></>);
export const Send = I(<path d="M5 12h14M13 6l6 6-6 6" />);
export const Plus = I(<path d="M12 5v14M5 12h14" />);
export const Chev = I(<path d="M6 9l6 6 6-6" />);
export const Doc = I(<><path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" /><path d="M14 3v5h5" /></>);

export function Logo() {
  return (
    <span className="mark" aria-hidden>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="#fff"><rect x="2" y="6" width="2.4" height="4" rx="1.2" /><rect x="6.8" y="3" width="2.4" height="10" rx="1.2" /><rect x="11.6" y="5" width="2.4" height="6" rx="1.2" /></svg>
    </span>
  );
}

// ── Controls ──────────────────────────────────────────────────────────────────────────────────
export function Seg<T extends string>({ value, options, onChange, className, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; className?: string; label?: string }) {
  const i = Math.max(0, options.findIndex(([v]) => v === value));
  return (
    <div className={`seg ${className ?? ''}`} style={{ ['--n' as string]: options.length, ['--i' as string]: i }} role="group" aria-label={label}>
      <i />
      {options.map(([v, text]) => (
        <button key={v} aria-pressed={v === value} onClick={() => onChange(v)}>{text}</button>
      ))}
    </div>
  );
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button className="switch" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && <small>{hint}</small>}
    </div>
  );
}

// ── Toasts ────────────────────────────────────────────────────────────────────────────────────
let push: (m: string) => void = () => {};
export const toast = (m: string) => push(m);

export function Toasts() {
  const [items, setItems] = useState<{ id: number; m: string }[]>([]);
  const add = useCallback((m: string) => {
    const id = Math.random();
    setItems((x) => [...x.filter((t) => t.m !== m), { id, m }].slice(-3));
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 5200);
  }, []);
  useEffect(() => { push = add; return () => { push = () => {}; }; }, [add]);
  return <div className="toasts" role="status" aria-live="polite">{items.map((t) => <div key={t.id} className="toast">{t.m}</div>)}</div>;
}
