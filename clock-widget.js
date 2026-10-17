// KevinOS ⏱ Airsync clock — for the free iOS app "Scriptable" (2026-10-16).
// Kevin: "for the clock can I have a widget or an easy way to turn it on?"
// Setup: ops/specs/widget.md → "Airsync clock" in the private KevinOS repo. In short: paste this
// whole file into a new Scriptable script named exactly  Airsync Clock , run it once (it asks for
// the same GitHub token the KevinOS app uses and keeps it in Scriptable's Keychain — never in this
// file), then (1) add a small Scriptable widget showing this script, and (2) make a Shortcut named
// Airsync clock with one action: Scriptable → Run Script → Airsync Clock (turn "Run In App" OFF).
// That shortcut is the one-tap switch: Action Button, Back Tap, Control Center, Lock Screen, or
// "Hey Siri, Airsync clock". The widget shows the live timer; tapping it runs the same shortcut.
//
// It flips the same state the app's ⏱ row uses: data/hours.md in the private repo carries
// `- running: <ISO start>` while the clock runs and one `- YYYY-MM-DD · H h` line per day. A session
// is booked to the day it started. Same format as the app (hoursParse/hoursText) and
// ops/hours-log.js — change all three together.

const OWNER = 'kliu6151', REPO = 'KevinOS', FILE = 'data/hours.md';
const KEY = 'kevinos_gh_token';
const SHORTCUT = 'Airsync clock';
const HEAD = '# Airsync hours — script-owned (ops/hours-log.js, from the evening check-in; do not hand-edit)';
const C = { bg: new Color('#0b0c0e'), text: new Color('#edf1f7'), muted: new Color('#9aa5b5'), amber: new Color('#ffb020'), green: new Color('#3ecf8e'), red: new Color('#ff5d51') };

async function token() {
  if (Keychain.contains(KEY)) return Keychain.get(KEY);
  if (config.runsInWidget) return null;
  const a = new Alert();
  a.title = 'Airsync clock';
  a.message = 'Paste the same GitHub token the KevinOS app uses (Dump tab → show token → Copy).';
  a.addSecureTextField('token');
  a.addAction('Save'); a.addCancelAction('Cancel');
  if ((await a.present()) === -1) return null;
  const t = a.textFieldValue(0).trim();
  if (t) Keychain.set(KEY, t);
  return t || null;
}
const b64 = (s) => Data.fromString(s).toBase64String();
const unb64 = (s) => Data.fromBase64String(s.replace(/\n/g, '')).toRawString();
async function api(tok, method, body) {
  const r = new Request(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE}`);
  r.method = method;
  r.headers = { Authorization: `Bearer ${tok}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' };
  if (body) r.body = JSON.stringify(body);
  const j = await r.loadJSON();
  return { status: r.response.statusCode, j };
}
function parse(text) {
  const days = new Map(); let running = null;
  for (const l of String(text || '').split('\n')) {
    const r = l.match(/^- running: (\S+)/); if (r) { running = r[1]; continue; }
    const m = l.match(/^- (\d{4}-\d{2}-\d{2}) · ([\d.]+) h/); if (m) days.set(m[1], +m[2]);
  }
  return { days, running };
}
function render(days, running) {
  const body = [...days.keys()].sort().map((k) => `- ${k} · ${days.get(k)} h`).join('\n');
  return HEAD + '\n\n' + (running ? `- running: ${running}\n\n` : '') + body + '\n';
}
const ymd = (d) => { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
function week(days) { let t = 0; for (let i = 0; i < 7; i++) { const d = new Date(); d.setDate(d.getDate() - i); t += days.get(ymd(d)) || 0; } return Math.round(t * 10) / 10; }

async function load(tok) {
  const { status, j } = await api(tok, 'GET');
  if (status === 404) return { sha: null, ...parse('') };
  if (status !== 200) throw new Error(`GitHub ${status}: ${(j && j.message) || ''}`);
  return { sha: j.sha, ...parse(unb64(j.content)) };
}

async function toggle(tok) {
  for (let attempt = 0; attempt < 2; attempt++) {           // one retry if the app wrote in between
    const s = await load(tok);
    let msg, out;
    if (s.running) {
      const start = new Date(s.running), h = Math.max(0.1, Math.round((Date.now() - start) / 3.6e5) / 10), day = ymd(start);
      s.days.set(day, Math.round(((s.days.get(day) || 0) + h) * 10) / 10);
      msg = `hours via widget: ${day} +${h} h`;
      out = `Stopped: +${h} h · today ${s.days.get(ymd(new Date())) || 0} h · week ${week(s.days)}/15`;
      s.running = null;
    } else {
      s.running = new Date().toISOString();
      msg = 'hours via widget: clock started';
      out = `Airsync clock started · week so far ${week(s.days)}/15 h`;
    }
    const { status } = await api(tok, 'PUT', Object.assign({ message: msg, content: b64(render(s.days, s.running)) }, s.sha ? { sha: s.sha } : {}));
    if (status === 200 || status === 201) return out;
    if (status !== 409) throw new Error(`GitHub ${status}`);
  }
  throw new Error('the file changed twice while saving — try again');
}

async function widget(tok) {
  const w = new ListWidget();
  w.backgroundColor = C.bg; w.setPadding(12, 14, 12, 14);
  w.url = 'shortcuts://run-shortcut?name=' + encodeURIComponent(SHORTCUT);
  const t = w.addText('⏱ AIRSYNC'); t.font = Font.boldSystemFont(11); t.textColor = C.muted;
  w.addSpacer(6);
  if (!tok) { const x = w.addText('Open the script once to add the token'); x.font = Font.systemFont(12); x.textColor = C.muted; return w; }
  let s; try { s = await load(tok); } catch (e) { const x = w.addText('Could not read: ' + e.message); x.font = Font.systemFont(11); x.textColor = C.red; return w; }
  const wk = week(s.days), today = s.days.get(ymd(new Date())) || 0;
  if (s.running) {
    const d = w.addDate(new Date(s.running)); d.applyTimerStyle(); d.font = Font.boldMonospacedSystemFont(26); d.textColor = C.amber;
    const l = w.addText('working · tap to stop'); l.font = Font.systemFont(11); l.textColor = C.muted;
    w.refreshAfterDate = new Date(Date.now() + 15 * 60e3);
  } else {
    const o = w.addText(`${today} h today`); o.font = Font.boldSystemFont(22); o.textColor = C.text;
    const l = w.addText('off · tap to start'); l.font = Font.systemFont(11); l.textColor = C.muted;
  }
  w.addSpacer();
  const f = w.addText(`week ${wk} / 15 h`); f.font = Font.mediumSystemFont(12); f.textColor = wk > 15 ? C.red : C.green;
  return w;
}

const tok = await token();
if (config.runsInWidget) {
  Script.setWidget(await widget(tok));
} else if (!tok) {
  Script.setShortcutOutput('No token saved — open the Airsync Clock script in Scriptable once.');
} else if (config.runsInApp) {
  // opened in Scriptable itself (setup, or a manual run): ask, so the first run doesn't start a session by surprise
  let s = null; try { s = await load(tok); } catch (e) {}
  const a = new Alert(); a.title = '⏱ Airsync clock';
  a.message = s ? (s.running ? `Running since ${new Date(s.running).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.` : `Off. Week so far ${week(s.days)}/15 h.`) : 'Could not read the clock (token or network).';
  a.addAction(s && s.running ? 'Stop' : 'Start'); a.addCancelAction('Close');
  if (s && (await a.present()) === 0) { let out; try { out = await toggle(tok); } catch (e) { out = 'Failed: ' + e.message; } const b = new Alert(); b.title = 'Airsync clock'; b.message = out; b.addAction('OK'); await b.present(); }
} else {
  // from the Shortcut (Action Button, Siri, widget tap): flip it, say what happened
  let out;
  try { out = await toggle(tok); } catch (e) { out = 'Airsync clock failed: ' + e.message; }
  Script.setShortcutOutput(out);
  const n = new Notification(); n.title = '⏱ Airsync clock'; n.body = out; await n.schedule();
}
Script.complete();
