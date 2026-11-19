/**
 * Meeting detection (Windows). A call is "on" when a known meeting app is using the microphone — the same
 * signal that lights up Windows' mic-in-use indicator (the CapabilityAccessManager consent store). Zoom's
 * helper process is used as a second signal because Zoom can release the mic while you are muted.
 * Nothing is recorded or read: only "which app has the mic open right now".
 */
import { execFile } from 'child_process';
import fs from 'fs';

export interface Meeting { app: string }

const MIC_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone';

/** [pattern on the app's registry name, friendly name]. Order matters: native apps beat browsers. */
const KNOWN: [RegExp, string][] = [
  [/zoom/i, 'Zoom'],
  [/ms-?teams|msteams|teams\.exe/i, 'Microsoft Teams'],
  [/webex|ciscocollab/i, 'Webex'],
  [/slack/i, 'Slack'],
  [/discord/i, 'Discord'],
  [/skype/i, 'Skype'],
  [/chrome|msedge|firefox|brave|opera|vivaldi|arc\.exe/i, 'a browser call'],
];
const SELF = /sotto|electron/i;

const run = (cmd: string, args: string[]) =>
  new Promise<string>((resolve) => execFile(cmd, args, { windowsHide: true, timeout: 5000, maxBuffer: 4 << 20 }, (err, out) => resolve(err ? '' : String(out))));

/** Names of apps whose microphone session is open right now, parsed from `reg query ... /s`. */
export function parseActiveMicApps(reg: string): string[] {
  const active: string[] = [];
  let key = '';
  let start = 0n;
  let stop = 0n;
  const flush = () => { if (key && start > 0n && stop === 0n) active.push(key); };
  for (const line of reg.split(/\r?\n/)) {
    if (/^HKEY/i.test(line)) {
      flush();
      const i = line.toLowerCase().indexOf('\\microphone\\');
      key = i < 0 ? '' : line.slice(i + 12).replace(/^NonPackaged\\?/i, '').replace(/#/g, '\\');
      start = 0n; stop = 0n;
      continue;
    }
    const s = line.match(/LastUsedTimeStart\s+REG_QWORD\s+(0x[0-9a-f]+)/i);
    if (s) start = BigInt(s[1]);
    const e = line.match(/LastUsedTimeStop\s+REG_QWORD\s+(0x[0-9a-f]+)/i);
    if (e) stop = BigInt(e[1]);
  }
  flush();
  return active;
}

/** Pick the meeting app out of the apps using the mic (or null). */
export function pickMeeting(micApps: string[], processes: string): Meeting | null {
  // Match the program's own name, not its folder ("C:\\Zoom Recordings\\x.exe" is not Zoom). Store apps have no path.
  const apps = micApps.map((a) => a.split('\\').pop() ?? a).filter((a) => !SELF.test(a));
  for (const [re, name] of KNOWN) if (apps.some((a) => re.test(a))) return { app: name };
  if (/cpthost\.exe/i.test(processes)) return { app: 'Zoom' }; // only runs while a Zoom meeting is open
  return null;
}

async function snapshot() {
  const [reg, tasks] = await Promise.all([run('reg', ['query', MIC_KEY, '/s']), run('tasklist', ['/FO', 'CSV', '/NH'])]);
  return { mic: parseActiveMicApps(reg), tasks };
}

/** Program names currently using the microphone (for the "is detection working?" line in Settings). */
export async function micApps(): Promise<string[]> {
  if (process.platform !== 'win32') return [];
  return (await snapshot()).mic.map((a) => a.split('\\').pop() ?? a).filter((a) => !SELF.test(a));
}

export async function activeMeeting(): Promise<Meeting | null> {
  // Test stand-in: a call is "on" while this file exists; its text is the app name.
  const f = process.env.SOTTO_FAKE_MEETING_FILE;
  if (f) { try { return { app: fs.readFileSync(f, 'utf8').trim() || 'Test' }; } catch { return null; } }
  if (process.platform !== 'win32') return null;
  const { mic, tasks } = await snapshot();
  return pickMeeting(mic, tasks);
}

/** Polls; calls onStart when a meeting begins and onEnd once it has been gone for ~12 s (ignores brief mic toggles). */
export function watchMeetings(onStart: (m: Meeting) => void, onEnd: (m: Meeting) => void, everyMs = 4000): () => void {
  let cur: Meeting | null = null;
  let misses = 0;
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const m = await activeMeeting();
      if (m && !cur) { cur = m; misses = 0; onStart(m); }
      else if (m) misses = 0;
      else if (cur && ++misses >= 3) { const ended = cur; cur = null; onEnd(ended); }
    } finally { busy = false; }
  };
  const t = setInterval(tick, everyMs);
  void tick();
  return () => clearInterval(t);
}
