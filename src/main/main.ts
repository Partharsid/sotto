import { app, BrowserWindow, Menu, desktopCapturer, globalShortcut, ipcMain, nativeTheme, screen, session, shell } from 'electron';
import fs from 'fs';
import path from 'path';
import { micApps, stopCaptureWatcher, watchMeetings, type Meeting } from './meeting';

// Packaged: the speech engine lives in the user's data dir and its script ships in resources (read by the server code).
// In development both are ./stt-sidecar.
if (app.isPackaged) {
  process.env.SOTTO_DATA_DIR ||= app.getPath('userData');
  process.env.SOTTO_RESOURCES_DIR ||= process.resourcesPath;
}

/** Opt-in diagnostics: set SOTTO_DEBUG=<file> to append what the call detector does. */
const dbg = (m: string) => { if (process.env.SOTTO_DEBUG) fs.appendFileSync(process.env.SOTTO_DEBUG, `${new Date().toISOString().slice(11, 23)} ${m}\n`); };

const DEV_URL = process.env.SOTTO_DEV ? 'http://localhost:3000' : '';
let win: BrowserWindow | null = null;
let popup: BrowserWindow | null = null;
let apiBase = '';
let privateMode = true;

// Meeting detection settings, pushed from the UI: ask (popup), auto (just start) or off; apps the user said "never" for.
let meetingCfg: { mode: 'ask' | 'auto' | 'off'; ignore: string[] } = { mode: 'ask', ignore: [] };
let meeting: Meeting | null = null;
let snoozed = false; // user said "not now" for the current call

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (win) { win.show(); win.focus(); } });

// Content-Security-Policy: only this app's files, the local API/engine, and the one cloud streaming host.
const CSP = [
  "default-src 'self'",
  `script-src 'self'${DEV_URL ? " 'unsafe-inline'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:* wss://api.deepgram.com" + (DEV_URL ? ' http://localhost:* ws://localhost:*' : ''),
].join('; ');

const webPrefs = { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false };

function load(w: BrowserWindow, hash = '') {
  if (DEV_URL) void w.loadURL(DEV_URL + (hash ? '#' + hash : ''));
  else void w.loadFile(path.join(__dirname, '../renderer/index.html'), hash ? { hash } : undefined);
}

function lockDown(w: BrowserWindow) {
  // Never navigate away from the app; open links in the user's browser.
  w.webContents.on('will-navigate', (e) => e.preventDefault());
  w.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) void shell.openExternal(url); return { action: 'deny' }; });
}

function createWindow() {
  nativeTheme.themeSource = 'light';
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 460, height: 760, minWidth: 380, minHeight: 520,
    title: 'Sotto', backgroundColor: '#faf9f7', autoHideMenuBar: true, show: false, skipTaskbar: privateMode,
    icon: path.join(__dirname, '../../assets/icon.png'),
    webPreferences: webPrefs,
  });
  win.setContentProtection(privateMode); // hidden from screen capture from the very first frame, not after the page loads
  win.once('ready-to-show', () => win?.show());
  win.on('closed', () => { win = null; });
  lockDown(win);
  load(win);
}

// ── "A call was detected — want help?" ───────────────────────────────────────────────────────
let popupTimer: ReturnType<typeof setTimeout> | undefined;
function closePrompt() { clearTimeout(popupTimer); if (popup && !popup.isDestroyed()) popup.close(); popup = null; }

function showPrompt() {
  closePrompt();
  const wa = screen.getPrimaryDisplay().workArea;
  popup = new BrowserWindow({
    width: 372, height: 190, x: wa.x + wa.width - 372 - 12, y: wa.y + wa.height - 190 - 12,
    frame: false, transparent: true, resizable: false, movable: false, skipTaskbar: true, hasShadow: false,
    focusable: false, show: false, alwaysOnTop: true, webPreferences: webPrefs,
  });
  popup.setAlwaysOnTop(true, 'screen-saver');
  popup.setContentProtection(true); // other people on the call must never see it
  lockDown(popup);
  popup.once('ready-to-show', () => popup?.showInactive());
  popup.on('closed', () => { popup = null; });
  load(popup, 'popup');
  popupTimer = setTimeout(closePrompt, 24_000);
}

/** Bring the main window forward without stealing focus from the call, and tell the UI to start listening. */
function startHelping() {
  if (!win) createWindow();
  if (win!.isMinimized()) win!.restore();
  if (!win!.isVisible()) win!.showInactive();
  win!.setContentProtection(privateMode);
  const send = () => win?.webContents.send('sotto:meeting-start', meeting);
  if (win!.webContents.isLoading()) win!.webContents.once('did-finish-load', send); else send();
}

function onMeetingStart(m: Meeting) {
  meeting = m;
  snoozed = false;
  dbg(`call started: ${m.app} (mode ${meetingCfg.mode}, ignored: ${meetingCfg.ignore.join(',') || '-'})`);
  if (meetingCfg.mode === 'off' || meetingCfg.ignore.includes(m.app)) return;
  if (meetingCfg.mode === 'auto') startHelping(); else showPrompt();
}

function onMeetingEnd(m: Meeting) {
  dbg(`call ended: ${m.app}`);
  closePrompt();
  meeting = null;
  win?.webContents.send('sotto:meeting-end', m);
}

function wireIpc() {
  ipcMain.on('sotto:api', (e) => { e.returnValue = apiBase; });
  // Private: hidden from screen sharing / recording (and from the taskbar). Pin: stay on top of other windows.
  ipcMain.handle('sotto:private', (_e, on: boolean) => { privateMode = !!on; win?.setContentProtection(privateMode); win?.setSkipTaskbar(privateMode); });
  ipcMain.handle('sotto:pin', (_e, on: boolean) => { win?.setAlwaysOnTop(!!on, 'screen-saver'); });

  ipcMain.on('sotto:meeting-config', (_e, c: typeof meetingCfg) => { meetingCfg = { mode: c.mode, ignore: c.ignore ?? [] }; dbg(`config: ${c.mode}`); });
  ipcMain.handle('sotto:meeting-info', () => meeting);
  ipcMain.handle('sotto:mic-apps', () => micApps());
  ipcMain.on('sotto:meeting-reply', (_e, a: 'start' | 'later' | 'never') => {
    dbg(`reply: ${a}`);
    closePrompt();
    if (a === 'start') startHelping();
    else if (a === 'never' && meeting) win?.webContents.send('sotto:meeting-never', meeting.app);
    else snoozed = true;
  });
}

function wireSecurityAndAudio() {
  const ses = session.defaultSession;
  ses.webRequest.onHeadersReceived((d, cb) => cb({ responseHeaders: { ...d.responseHeaders, 'Content-Security-Policy': [CSP] } }));
  // The window may use the microphone and system-audio capture; nothing else.
  ses.setPermissionCheckHandler((_wc, perm) => perm === 'media'); // also lets the page list microphone names before first use
  ses.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'media' || perm === 'display-capture'));
  // System audio ("what the other person says"): share the screen's audio loopback, no picker, no video used.
  ses.setDisplayMediaRequestHandler((_req, cb) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((s) => cb({ video: s[0], audio: 'loopback' })).catch(() => cb({}));
  });
}

app.whenReady().then(async () => {
  app.setAppUserModelId('dev.sotto.app');
  const { startServer } = require('../server/index') as typeof import('../server/index');
  const { port } = await startServer(Number(process.env.SOTTO_PORT) || 0);
  apiBase = `http://127.0.0.1:${port}`;

  wireSecurityAndAudio();
  wireIpc();
  createWindow();

  // Panic key: hide / show the window instantly. Answer key: answer whatever was just asked, without touching the mouse.
  globalShortcut.register('CommandOrControl+Shift+H', () => { if (!win) return; if (win.isVisible()) win.hide(); else { win.show(); win.focus(); } });
  globalShortcut.register('CommandOrControl+Shift+A', () => win?.webContents.send('sotto:answer-last'));

  watchMeetings(onMeetingStart, onMeetingEnd);
});

app.on('will-quit', () => { globalShortcut.unregisterAll(); stopCaptureWatcher(); });
app.on('window-all-closed', () => app.quit());
