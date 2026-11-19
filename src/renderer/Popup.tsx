import { useEffect, useState } from 'react';
import { Logo } from './ui';

/** The small "a call was detected" window. It never takes focus and is hidden from screen sharing. */
export default function Popup() {
  const [app, setApp] = useState('A');
  useEffect(() => {
    document.documentElement.classList.add('popup');
    void window.sotto?.meeting.info().then((m) => { if (m) setApp(m.app); });
  }, []);
  const reply = (a: 'start' | 'later' | 'never') => window.sotto?.meeting.reply(a);

  return (
    <div className="pop" role="alertdialog" aria-label="Call detected">
      <div className="pop-head">
        <Logo />
        <div>
          <b>{app === 'a browser call' ? 'A call' : `${app} call`} detected</b>
          <span>Want Sotto to listen and help?</span>
        </div>
      </div>
      <div className="pop-btns">
        <button className="btn" onClick={() => reply('start')}>Yes, help me</button>
        <button className="btn ghost" onClick={() => reply('later')}>Not now</button>
      </div>
      <button className="pop-never" onClick={() => reply('never')}>Never ask for {app === 'a browser call' ? 'browser calls' : app}</button>
      <i className="pop-timer" />
    </div>
  );
}
