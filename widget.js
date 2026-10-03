// KevinOS home-screen widget — for the free iOS app "Scriptable".
// Setup: ops/specs/widget.md in the private KevinOS repo (copy this whole file into
// a new Scriptable script, run it once to paste your GitHub token, then add a
// Scriptable widget to the Home Screen and pick this script).
//
// 2026-10-03 (Kevin): "I want it to show the calendar" — the widget is now the day's
// schedule: today's appointments in time order (visits handed off at the check-in are
// dimmed with the reason), tomorrow's on the large size, Top 3 count + streak as a footer.
// Reads the same private files the app reads (calendar, daily note, scoreboard) with the
// token stored in Scriptable's Keychain — never in this file. Tap → the KevinOS app.
//
// TAP TARGET: an https URL from a widget always opens Safari, not the home-screen app.
// So the tap runs a Shortcut named "KevinOS" whose only action is "Open App → KevinOS"
// (the home-screen web app shows up in that picker). Make it once in the Shortcuts app;
// see the spec. If you never made the shortcut, set OPEN_IN_SAFARI = true.

const OWNER = 'kliu6151', REPO = 'KevinOS';
const APP = 'https://kliu6151.github.io/KevinOS-Inbox/';
const OPEN_IN_SAFARI = false;
const TAP_URL = OPEN_IN_SAFARI ? APP : 'shortcuts://run-shortcut?name=' + encodeURIComponent('KevinOS');
const KEY = 'kevinos_gh_token';
const C = {
  bg: new Color('#0b0c0e'), panel: new Color('#141619'), text: new Color('#edf1f7'),
  muted: new Color('#9aa5b5'), faint: new Color('#727d8e'), amber: new Color('#ffb020'),
  green: new Color('#3ecf8e'), red: new Color('#ff5d51'), track: new Color('#343941'),
  audit: new Color('#199e70'), sales: new Color('#d95926'), job: new Color('#3987e5'), personal: new Color('#d55181'), other: new Color('#c98500'),
};

async function token() {
  if (Keychain.contains(KEY)) return Keychain.get(KEY);
  if (config.runsInWidget) return null;
  const a = new Alert();
  a.title = 'KevinOS widget';
  a.message = 'Paste the same GitHub token the KevinOS app uses (Dump tab → show token → Copy).';
  a.addSecureTextField('token');
  a.addAction('Save'); a.addCancelAction('Cancel');
  if ((await a.present()) === -1) return null;
  const t = a.textFieldValue(0).trim();
  if (t) Keychain.set(KEY, t);
  return t || null;
}
async function file(tok, path) {
  const r = new Request(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`);
  r.headers = { Authorization: `Bearer ${tok}`, Accept: 'application/vnd.github.raw' };
  try { const s = await r.loadString(); return r.response.statusCode === 200 ? s : null; } catch (e) { return null; }
}
const pad = (n) => String(n).padStart(2, '0');
function ymd(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function plus(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function h12(hm) { let [h, m] = hm.split(':').map(Number); const ap = h >= 12 ? 'p' : 'a'; h = h % 12 || 12; return h + (m ? ':' + pad(m) : '') + ap; }
const meta = (s, k) => { const m = s.match(new RegExp(k + ':\\s*([^|]+)')); return m ? m[1].trim() : ''; };

function top3(note) {
  if (!note) return null;
  const lines = note.split('\n'); const i = lines.findIndex((l) => /^## Top 3/i.test(l));
  if (i < 0) return null;
  const items = [];
  for (let k = i + 1; k < lines.length && !/^## /.test(lines[k]); k++) {
    const m = lines[k].match(/^- \[( |x)\] (.*)$/);
    if (m) items.push({ done: m[1] === 'x', title: m[2].split(' — ')[0].split(' | ')[0].replace(/\*\*/g, '').trim() });
  }
  return items.length ? items : null;
}
/* visits Kevin handed off at the evening check-in: '- Not in plan: HH:MM Title — reason' */
function covered(note) {
  const out = {};
  if (note) for (const m of note.matchAll(/^- Not in plan: (\d{2}:\d{2}) (.+?) — (.+)$/gm)) out[m[1] + '|' + m[2].trim()] = m[3].trim();
  return out;
}
/* every open calendar line on a date, timed first (HH:MM order), untimed after */
function dayEvents(cal, date) {
  if (!cal) return [];
  const evs = [];
  for (const l of cal.split('\n')) {
    const m = l.match(/^- \[ \] (\d{4}-\d{2}-\d{2})(?: (\d{2}:\d{2}))?\s*[—-]\s*(.+)$/);
    if (!m || m[1] !== date) continue;
    const body = m[3];
    evs.push({ d: m[1], hm: m[2] || '', title: body.split(' | ')[0].trim(), where: meta(body, 'where'), personal: /type:\s*personal/i.test(body) });
  }
  return evs.sort((a, b) => (a.hm || '99:99').localeCompare(b.hm || '99:99'));
}
function kindColor(e) {
  if (/^Energy audit:/i.test(e.title)) return C.audit;
  if (/^Sales visit:/i.test(e.title)) return C.sales;
  if (/^Job:/i.test(e.title)) return C.job;
  if (e.personal) return C.personal;
  return C.other;
}
function txt(stack, s, font, color, lines) { const t = stack.addText(s); t.font = font; t.textColor = color; if (lines) t.lineLimit = lines; return t; }
function dot(stack, color, size) { const d = stack.addText('●'); d.font = Font.systemFont(size); d.textColor = color; return d; }

/* one schedule row: time · colored dot · title (· where). Covered rows dim with the reason. */
function eventRow(stack, e, cov, fam) {
  const row = stack.addStack(); row.layoutHorizontally(); row.centerAlignContent(); row.spacing = 6;
  // fixed-width time column so the dots and titles line up down the list
  const ts = row.addStack(); ts.size = new Size(fam === 'small' ? 36 : 44, 0);
  const t = txt(ts, e.hm ? h12(e.hm) : '—', Font.boldMonospacedSystemFont(fam === 'small' ? 10 : 11), cov ? C.faint : C.muted, 1);
  t.minimumScaleFactor = 0.7;
  dot(row, cov ? C.track : kindColor(e), 7);
  const col = row.addStack(); col.layoutVertically();
  const title = txt(col, e.title.replace(/^(Energy audit|Sales visit|Job):\s*/i, (m, k) => ({ 'Energy audit': 'Audit · ', 'Sales visit': 'Sales · ', Job: 'Job · ' })[k]), Font.mediumSystemFont(fam === 'small' ? 11 : 12.5), cov ? C.faint : C.text, 1);
  if (cov) title.font = Font.systemFont(fam === 'small' ? 11 : 12.5);
  const sub = cov ? cov : (fam === 'small' ? '' : e.where);
  if (sub) txt(col, cov ? `covered — ${sub}` : sub, Font.systemFont(9.5), C.faint, 1);
}

async function build() {
  const w = new ListWidget();
  w.backgroundColor = C.bg; w.url = TAP_URL; w.setPadding(12, 14, 12, 14);
  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
  const fam = config.widgetFamily || 'medium';
  const tok = await token();
  if (!tok) { txt(w, 'KevinOS', Font.boldSystemFont(15), C.text); txt(w, 'Open Scriptable and run this script once to add your token.', Font.systemFont(11), C.muted); return w; }

  const now = new Date(), today = ymd(now), tomorrow = ymd(plus(now, 1));
  const [note, cal, sbs] = await Promise.all([file(tok, `daily/${today}.md`), file(tok, 'data/calendar.md'), file(tok, 'data/scoreboard.json')]);
  let sb = null; try { sb = sbs ? JSON.parse(sbs) : null; } catch (e) {}
  const t3 = top3(note), done = t3 ? t3.filter((x) => x.done).length : 0, total = t3 ? t3.length : 0;
  const cov = covered(note);
  const hm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const todays = dayEvents(cal, today);
  const left = todays.filter((e) => !e.hm || e.hm >= hm); // still ahead of now (untimed items stay)
  const streak = sb && sb.streak ? (sb.streak.days || 0) + (done >= 1 ? 1 : 0) : null;

  // header: weekday + date, right side Top 3 count + streak
  const head = w.addStack(); head.layoutHorizontally(); head.centerAlignContent();
  txt(head, now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase(), Font.boldMonospacedSystemFont(10), C.amber);
  head.addSpacer();
  if (total) txt(head, `${done}/${total} TOP 3`, Font.boldMonospacedSystemFont(10), done >= total ? C.green : C.muted);
  if (streak !== null && fam !== 'small') { head.addSpacer(8); txt(head, `🔥${streak}`, Font.boldMonospacedSystemFont(10), sb.streak.dimmed && !done ? C.faint : new Color('#ff9a3c')); }
  w.addSpacer(6);

  const cap = fam === 'small' ? 3 : fam === 'medium' ? 4 : 9;
  const list = left.length ? left : todays; // after the last visit, keep showing the day rather than a blank
  if (!todays.length) {
    txt(w, left.length ? 'Nothing scheduled' : 'Nothing scheduled today', Font.mediumSystemFont(13), C.text);
    txt(w, 'open day — plan it tonight', Font.systemFont(10), C.faint);
  } else {
    list.slice(0, cap).forEach((e, i) => { eventRow(w, e, cov[e.hm + '|' + e.title] || '', fam); if (i < Math.min(cap, list.length) - 1) w.addSpacer(fam === 'small' ? 3 : 5); });
    if (list.length > cap) { w.addSpacer(3); txt(w, `+${list.length - cap} more`, Font.systemFont(9.5), C.faint); }
  }

  if (fam === 'large') {
    const tm = dayEvents(cal, tomorrow);
    w.addSpacer(10);
    txt(w, `TOMORROW · ${plus(now, 1).toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase()}`, Font.boldMonospacedSystemFont(10), C.muted);
    w.addSpacer(4);
    if (!tm.length) txt(w, 'nothing booked', Font.systemFont(11), C.faint);
    tm.slice(0, 4).forEach((e, i) => { eventRow(w, e, '', fam); if (i < Math.min(4, tm.length) - 1) w.addSpacer(4); });
    if (t3) {
      w.addSpacer(10);
      txt(w, 'TOP 3', Font.boldMonospacedSystemFont(10), C.amber);
      w.addSpacer(3);
      t3.forEach((x) => { txt(w, `${x.done ? '✓' : '○'}  ${x.title}`, Font.mediumSystemFont(12), x.done ? C.faint : C.text, 1); });
    }
  }
  w.addSpacer();
  if (!note) txt(w, 'No plan written yet today', Font.systemFont(9.5), C.faint);
  return w;
}

const widget = await build();
if (config.runsInWidget) Script.setWidget(widget);
else await widget.presentMedium();
Script.complete();
