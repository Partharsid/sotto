/**
 * Meeting detection (Windows). A call is "on" when a known meeting app is using the microphone — the same
 * signal that lights up Windows' mic-in-use indicator (the CapabilityAccessManager consent store). Zoom's
 * helper process is used as a second signal because Zoom can release the mic while you are muted. A third signal asks
 * Windows' audio engine which processes hold an open capture stream — it works even where the consent store is not
 * being updated (it is not, on some Windows builds).
 * Nothing is recorded or read: only "which app has the mic open right now".
 */
import { execFile, spawn, type ChildProcess } from 'child_process';
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


// ── Which processes hold an open capture stream (WASAPI sessions), via one long-lived PowerShell helper ───────────
const CAPTURE_CS = `using System;using System.Collections.Generic;using System.Runtime.InteropServices;
[ComImport,Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]class MMDeviceEnumeratorCom{}
[ComImport,Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]interface IMMDeviceEnumerator{
 [PreserveSig]int EnumAudioEndpoints(int flow,int mask,out IMMDeviceCollection c);
 [PreserveSig]int GetDefaultAudioEndpoint(int flow,int role,out IMMDevice d);
 [PreserveSig]int GetDevice([MarshalAs(UnmanagedType.LPWStr)]string id,out IMMDevice d);
 [PreserveSig]int RegisterEndpointNotificationCallback(IntPtr p);
 [PreserveSig]int UnregisterEndpointNotificationCallback(IntPtr p);}
[ComImport,Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]interface IMMDeviceCollection{
 [PreserveSig]int GetCount(out int n);[PreserveSig]int Item(int i,out IMMDevice d);}
[ComImport,Guid("D666063F-1587-4E43-81F1-B948E807363F"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]interface IMMDevice{
 [PreserveSig]int Activate(ref Guid iid,int ctx,IntPtr p,[MarshalAs(UnmanagedType.IUnknown)]out object o);
 [PreserveSig]int OpenPropertyStore(int a,out IntPtr s);[PreserveSig]int GetId([MarshalAs(UnmanagedType.LPWStr)]out string id);[PreserveSig]int GetState(out int s);}
[ComImport,Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]interface IAudioSessionManager2{
 [PreserveSig]int GetAudioSessionControl(IntPtr g,int f,out IntPtr c);[PreserveSig]int GetSimpleAudioVolume(IntPtr g,int f,out IntPtr v);
 [PreserveSig]int GetSessionEnumerator(out IAudioSessionEnumerator e);}
[ComImport,Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]interface IAudioSessionEnumerator{
 [PreserveSig]int GetCount(out int n);[PreserveSig]int GetSession(int i,out IAudioSessionControl2 s);}
[ComImport,Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]interface IAudioSessionControl2{
 [PreserveSig]int GetState(out int s);[PreserveSig]int GetDisplayName(IntPtr a);[PreserveSig]int SetDisplayName(IntPtr a,IntPtr b);
 [PreserveSig]int GetIconPath(IntPtr a);[PreserveSig]int SetIconPath(IntPtr a,IntPtr b);[PreserveSig]int GetGroupingParam(IntPtr a);[PreserveSig]int SetGroupingParam(IntPtr a,IntPtr b);
 [PreserveSig]int RegisterAudioSessionNotification(IntPtr a);[PreserveSig]int UnregisterAudioSessionNotification(IntPtr a);
 [PreserveSig]int GetSessionIdentifier(IntPtr a);[PreserveSig]int GetSessionInstanceIdentifier(IntPtr a);[PreserveSig]int GetProcessId(out uint pid);
 [PreserveSig]int IsSystemSoundsSession();[PreserveSig]int SetDuckingPreference(int b);}
public static class Cap{
 public static List<uint> ActivePids(){
  var res=new List<uint>();var en=(IMMDeviceEnumerator)new MMDeviceEnumeratorCom();IMMDeviceCollection col;
  if(en.EnumAudioEndpoints(1,1,out col)!=0)return res; // eCapture, DEVICE_STATE_ACTIVE
  int n;col.GetCount(out n);var iid=new Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F");
  for(int i=0;i<n;i++){IMMDevice d;col.Item(i,out d);object o;if(d.Activate(ref iid,23,IntPtr.Zero,out o)!=0)continue;
   var mgr=(IAudioSessionManager2)o;IAudioSessionEnumerator se;if(mgr.GetSessionEnumerator(out se)!=0)continue;int c;se.GetCount(out c);
   for(int j=0;j<c;j++){IAudioSessionControl2 s;if(se.GetSession(j,out s)!=0)continue;int st;s.GetState(out st);uint pid;s.GetProcessId(out pid);if(st==1&&pid!=0)res.Add(pid);}}
  return res;}}`;

let capProc: ChildProcess | null = null;
let capNames: string[] = [];

/** Lines look like `SOTTO-CAP:chrome,Zoom`; anything else is ignored. */
export function parseCaptureLine(line: string): string[] | null {
  const m = line.match(/^SOTTO-CAP:(.*)$/);
  return m ? m[1].split(',').map((x) => x.trim()).filter(Boolean) : null;
}

function startCaptureWatcher() {
  if (capProc || process.platform !== 'win32') return;
  const script = `Add-Type -TypeDefinition @"
${CAPTURE_CS}
"@
$parent = ${process.pid}
while ($true) {
  if (-not (Get-Process -Id $parent -ErrorAction SilentlyContinue)) { exit }
  try { $n = (([Cap]::ActivePids()) | Sort-Object -Unique | ForEach-Object { (Get-Process -Id $_ -ErrorAction SilentlyContinue).ProcessName }) -join ',' } catch { $n = '' }
  [Console]::Out.WriteLine('SOTTO-CAP:' + $n); [Console]::Out.Flush()
  Start-Sleep -Milliseconds 2000
}`;
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  let buf = '';
  child.stdout!.on('data', (d: Buffer) => {
    buf += d.toString();
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) { const names = parseCaptureLine(buf.slice(0, i).trim()); buf = buf.slice(i + 1); if (names) capNames = names; }
  });
  child.on('exit', () => { if (capProc === child) { capProc = null; capNames = []; } });
  capProc = child;
}

export function stopCaptureWatcher() { capProc?.kill(); capProc = null; capNames = []; }

async function snapshot() {
  startCaptureWatcher();
  const [reg, tasks] = await Promise.all([run('reg', ['query', MIC_KEY, '/s']), run('tasklist', ['/FO', 'CSV', '/NH'])]);
  return { mic: [...new Set([...parseActiveMicApps(reg), ...capNames])], tasks };
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
