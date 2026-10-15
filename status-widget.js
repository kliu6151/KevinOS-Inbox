// KevinOS SYSTEMS widget — for the free iOS app "Scriptable" (2026-10-14).
// Kevin: "Can I have the server status as a widget on my phone?"
// Setup: ops/specs/widget.md (private KevinOS repo) → "Systems widget". Copy this whole file
// into a new Scriptable script, run it once to paste the STATUS token, then add a Scriptable
// widget to the Home Screen and pick this script.
//
// Shows the Worker's live status (ops/specs/live-status.md): one big dot for the worst state,
// then each system — red first — with what it last said and how long ago. The token is the
// Worker's STATUS_TOKEN: READ-ONLY, valid for GET /status and nothing else; it lives in
// Scriptable's Keychain, never in this file. iOS refreshes widgets every ~15–60 min — the
// push notification is the alarm, this is the glance.

const WORKER = 'https://kevinos-ai-proxy.kevinos-ops.workers.dev';
const APP = 'https://kliu6151.github.io/KevinOS-Inbox/';
const KEY = 'kevinos_status_token';
const C = {
  bg: new Color('#0b0c0e'), text: new Color('#edf1f7'), muted: new Color('#9aa5b5'), faint: new Color('#727d8e'),
  green: new Color('#3ecf8e'), amber: new Color('#ffb020'), red: new Color('#ff5d51'),
};
const COL = { red: C.red, yellow: C.amber, green: C.green };
const RANK = { red: 0, yellow: 1, green: 2 };

async function token() {
  if (Keychain.contains(KEY)) return Keychain.get(KEY);
  if (config.runsInWidget) return null;
  const a = new Alert();
  a.title = 'KevinOS Systems widget';
  a.message = 'Paste the STATUS token (read-only — the one made for this widget, not the app token).';
  a.addSecureTextField('token');
  a.addAction('Save'); a.addCancelAction('Cancel');
  if ((await a.present()) === -1) return null;
  const t = a.textFieldValue(0).trim();
  if (t) Keychain.set(KEY, t);
  return t || null;
}
function txt(stack, s, font, color, lines) { const t = stack.addText(s); t.font = font; t.textColor = color; if (lines) t.lineLimit = lines; return t; }
const ago = (m) => (m < 1 ? 'now' : m < 90 ? m + 'm' : m < 48 * 60 ? Math.round(m / 60) + 'h' : Math.round(m / 1440) + 'd');
const why = (x) => (x.status === 'down' ? x.note || 'down' : x.state === 'red' ? 'silent ' + ago(x.ageMin) : x.note || 'ok');

async function build() {
  const w = new ListWidget();
  w.backgroundColor = C.bg; w.url = APP; w.setPadding(12, 14, 12, 14);
  w.refreshAfterDate = new Date(Date.now() + 10 * 60 * 1000);
  const fam = config.widgetFamily || 'small';
  const tok = await token();
  if (!tok) { txt(w, 'Systems', Font.boldSystemFont(15), C.text); txt(w, 'Open Scriptable and run this script once to add the status token.', Font.systemFont(11), C.muted); return w; }

  let j = null, err = '';
  try {
    const r = new Request(WORKER + '/status');
    r.headers = { Authorization: 'Bearer ' + tok };
    j = await r.loadJSON();
    if (r.response.statusCode !== 200) { err = j && j.error ? j.error : 'HTTP ' + r.response.statusCode; j = null; }
  } catch (e) { err = 'offline'; }

  const L = j ? (j.systems || []).slice().sort((a, b) => RANK[a.state] - RANK[b.state] || a.label.localeCompare(b.label)) : [];
  const red = L.filter((x) => x.state === 'red').length, yel = L.filter((x) => x.state === 'yellow').length;
  const worst = !j ? 'yellow' : red ? 'red' : yel ? 'yellow' : 'green';

  // header: big dot + headline
  const head = w.addStack(); head.layoutHorizontally(); head.centerAlignContent(); head.spacing = 6;
  txt(head, '●', Font.systemFont(fam === 'small' ? 18 : 16), COL[worst]);
  const headline = !j ? "Can't reach status" : !L.length ? 'No systems yet' : red ? `${red} down` : yel ? `${yel} warning${yel > 1 ? 's' : ''}` : 'All OK';
  txt(head, headline, Font.boldSystemFont(fam === 'small' ? 15 : 14), red ? C.red : C.text, 1);
  if (fam !== 'small') { head.addSpacer(); txt(head, 'SYSTEMS', Font.boldMonospacedSystemFont(10), C.amber); }
  w.addSpacer(6);

  if (!j) { txt(w, err, Font.systemFont(10), C.faint, 2); w.addSpacer(); return w; }

  const cap = fam === 'small' ? 4 : fam === 'medium' ? 5 : 12;
  L.slice(0, cap).forEach((x, i) => {
    const row = w.addStack(); row.layoutHorizontally(); row.centerAlignContent(); row.spacing = 5;
    txt(row, '●', Font.systemFont(7), COL[x.state]);
    const col = row.addStack(); col.layoutVertically();
    txt(col, x.label, Font.mediumSystemFont(fam === 'small' ? 11 : 12), x.state === 'green' ? C.text : COL[x.state], 1);
    if (fam !== 'small' || x.state !== 'green') txt(col, why(x) + (x.state === 'red' && x.status !== 'down' ? '' : ' · ' + ago(x.ageMin)), Font.systemFont(9.5), C.faint, 1);
    if (i < Math.min(cap, L.length) - 1) w.addSpacer(fam === 'small' ? 3 : 4);
  });
  if (L.length > cap) { w.addSpacer(3); txt(w, `+${L.length - cap} more`, Font.systemFont(9.5), C.faint); }
  w.addSpacer();
  const now = new Date();
  txt(w, 'checked ' + now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }), Font.systemFont(9), C.faint);
  return w;
}

const widget = await build();
if (config.runsInWidget) Script.setWidget(widget);
else await widget.presentSmall();
Script.complete();
