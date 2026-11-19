import test from 'node:test';
import assert from 'node:assert/strict';
import { parseActiveMicApps, pickMeeting } from '../src/main/meeting';

const H = 'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone';
const entry = (name: string, start: string, stop: string) => `${H}\\${name}\r\n    LastUsedTimeStart    REG_QWORD    ${start}\r\n    LastUsedTimeStop    REG_QWORD    ${stop}\r\n`;
const reg = (...e: string[]) => `${H}\r\n    Value    REG_SZ    Allow\r\n\r\n` + e.join('\r\n');
const OPEN = '0x0';
const T = '0x1dd4feb94acfa8b';

test('reads which apps have the mic open right now (Stop = 0)', () => {
  const apps = parseActiveMicApps(reg(
    entry('NonPackaged\\C:#Users#me#AppData#Roaming#Zoom#bin#Zoom.exe', T, OPEN),
    entry('MSTeams_8wekyb3d8bbwe', T, '0x1dd4ff563dc629f'), // released
    entry('NonPackaged\\C:#Program Files#Google#Chrome#Application#chrome.exe', T, OPEN),
  ));
  assert.deepEqual(apps, ['C:\\Users\\me\\AppData\\Roaming\\Zoom\\bin\\Zoom.exe', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe']);
});

test('picks the right app, native apps before browsers', () => {
  assert.deepEqual(pickMeeting(['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\x\\Zoom.exe'], ''), { app: 'Zoom' });
  assert.deepEqual(pickMeeting(['MSTeams_8wekyb3d8bbwe'], ''), { app: 'Microsoft Teams' });
  assert.deepEqual(pickMeeting(['C:\\Users\\me\\AppData\\Local\\Discord\\app-1.0.9\\Discord.exe'], ''), { app: 'Discord' });
  assert.deepEqual(pickMeeting(['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'], ''), { app: 'a browser call' });
});

test('ignores Sotto itself and unrelated apps', () => {
  assert.equal(pickMeeting(['C:\\Users\\me\\AppData\\Local\\Programs\\Sotto\\Sotto.exe', 'C:\\x\\electron.exe'], ''), null);
  assert.equal(pickMeeting(['C:\\Program Files\\Audacity\\audacity.exe', 'Microsoft.WindowsSoundRecorder_8wekyb3d8bbwe'], ''), null);
});

test('matches the program, not its folder name', () => {
  assert.equal(pickMeeting(['C:\\Zoom Recordings\\convert.exe'], ''), null);
});

test("Zoom's helper process counts even when the mic is released (muted)", () => {
  assert.deepEqual(pickMeeting([], '"CptHost.exe","4242","Console"'), { app: 'Zoom' });
  assert.equal(pickMeeting([], '"explorer.exe","1"'), null);
});

test('real registry output on this machine parses without throwing', () => {
  assert.doesNotThrow(() => parseActiveMicApps(''));
  assert.deepEqual(parseActiveMicApps('garbage\r\n\r\nHKEY_NOPE'), []);
});
