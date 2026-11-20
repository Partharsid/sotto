import { contextBridge, ipcRenderer } from 'electron';

const on = <T,>(channel: string, cb: (v: T) => void) => {
  const h = (_e: unknown, v: T) => cb(v);
  ipcRenderer.on(channel, h);
  return () => { ipcRenderer.removeListener(channel, h); };
};

/** The tiny surface the UI gets from the desktop shell. */
contextBridge.exposeInMainWorld('sotto', {
  apiBase: ipcRenderer.sendSync('sotto:api') as string,
  setPrivate: (v: boolean) => ipcRenderer.invoke('sotto:private', v),
  setPin: (v: boolean) => ipcRenderer.invoke('sotto:pin', v),
  onAnswerLast: (cb: () => void) => on('sotto:answer-last', cb),
  dock: {
    publish: (st: unknown) => ipcRenderer.send('sotto:dock-state', st),
    onState: (cb: (st: unknown) => void) => on('sotto:dock-state', cb),
    onView: (cb: (v: unknown) => void) => on('sotto:dock-view', cb),
    onCmd: (cb: (c: unknown) => void) => on('sotto:dock-cmd', cb),
    cmd: (c: unknown) => ipcRenderer.send('sotto:dock-cmd', c),
    ready: () => ipcRenderer.send('sotto:dock-ready'),
    ctl: (action: string, value?: number) => ipcRenderer.invoke('sotto:dock-ctl', action, value),
    copy: (t: string) => ipcRenderer.invoke('sotto:copy', t),
  },
  meeting: {
    configure: (c: { mode: string; ignore: string[] }) => ipcRenderer.send('sotto:meeting-config', c),
    onStart: (cb: (m: { app: string }) => void) => on('sotto:meeting-start', cb),
    onEnd: (cb: (m: { app: string }) => void) => on('sotto:meeting-end', cb),
    onNever: (cb: (app: string) => void) => on('sotto:meeting-never', cb),
    info: () => ipcRenderer.invoke('sotto:meeting-info') as Promise<{ app: string } | null>,
    micApps: () => ipcRenderer.invoke('sotto:mic-apps') as Promise<string[]>,
    reply: (a: 'start' | 'later' | 'never') => ipcRenderer.send('sotto:meeting-reply', a),
  },
});
