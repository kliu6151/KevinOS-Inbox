// KevinOS home-screen widget — for the free iOS app "Scriptable".
// Setup: ops/specs/widget.md in the private KevinOS repo (copy this whole file into
// a new Scriptable script, run it once to paste your GitHub token, then add a
// Scriptable widget to the Home Screen and pick this script).
//
// Shows: Top 3 progress ring · next appointment · streak · month level + bar.
// Reads the same private files the app reads (daily note, calendar, scoreboard)
// with the token stored in Scriptable's Keychain — never in this file. Numbers
// come from data/scoreboard.json; this script only displays them. Tap → the app.

const OWNER = 'kliu6151', REPO = 'KevinOS';
const APP = 'https://kliu6151.github.io/KevinOS-Inbox/';
const KEY = 'kevinos_gh_token';
const C = {
  bg: new Color('#0b0c0e'), panel: new Color('#141619'), text: new Color('#edf1f7'),
  muted: new Color('#9aa5b5'), faint: new Color('#727d8e'), amber: new Color('#ffb020'),
  green: new Color('#3ecf8e'), red: new Color('#ff5d51'), track: new Color('#343941'),
  audit: new Color('#199e70'), sales: new Color('#d95926'), job: new Color('#3987e5'), other: new Color('#c98500'),
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
function h12(hm) { let [h, m] = hm.split(':').map(Number); const ap = h >= 12 ? 'p' : 'a'; h = h % 12 || 12; return h + (m ? ':' + pad(m) : '') + ap; }
function money(v) { v = v || 0; return v >= 1e6 ? '$' + (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? '$' + Math.round(v / 1e3) + 'k' : '$' + Math.round(v); }

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
function nextEvent(cal, now) {
  if (!cal) return null;
  const t = ymd(now), hm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const end = ymd(new Date(now.getTime() + 7 * 864e5));
  const evs = cal.split('\n').map((l) => l.match(/^- \[ \] (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})\s*[—-]\s*(.+)$/)).filter(Boolean)
    .map((m) => ({ d: m[1], hm: m[2], title: m[3].split(' | ')[0].trim(), where: ((m[3].match(/where:\s*([^|]+)/) || [])[1] || '').trim() }))
    .filter((e) => (e.d > t || (e.d === t && e.hm >= hm)) && e.d <= end)
    .sort((a, b) => (a.d + a.hm).localeCompare(b.d + b.hm));
  return evs[0] || null;
}
function kindColor(title) {
  if (/^Energy audit:/i.test(title)) return C.audit;
  if (/^Sales visit:/i.test(title)) return C.sales;
  if (/^Job:/i.test(title)) return C.job;
  return C.other;
}

/* ring: n segments around a circle (DrawContext has no arc primitive — short line runs) */
function ring(done, total, size) {
  const dc = new DrawContext(); dc.size = new Size(size, size); dc.opaque = false; dc.respectScreenScale = true;
  const cx = size / 2, cy = size / 2, r = size / 2 - 7, w = 8, n = Math.max(1, total), gap = total > 1 ? 0.28 : 0;
  const all = total > 0 && done >= total;
  for (let i = 0; i < n; i++) {
    const a0 = -Math.PI / 2 + (i * 2 * Math.PI) / n + gap / 2, a1 = a0 + (2 * Math.PI) / n - gap;
    const p = new Path(); const steps = 24;
    for (let s = 0; s <= steps; s++) {
      const a = a0 + ((a1 - a0) * s) / steps, pt = new Point(cx + r * Math.cos(a), cy + r * Math.sin(a));
      if (s === 0) p.move(pt); else p.addLine(pt);
    }
    dc.addPath(p); dc.setLineWidth(w);
    dc.setStrokeColor(i < done ? (all ? C.green : C.amber) : C.track); dc.strokePath();
  }
  dc.setFont(Font.boldMonospacedSystemFont(size * 0.22)); dc.setTextColor(all ? C.green : C.text); dc.setTextAlignedCenter();
  dc.drawTextInRect(`${done}/${total}`, new Rect(0, cy - size * 0.17, size, size * 0.3));
  dc.setFont(Font.mediumMonospacedSystemFont(size * 0.09)); dc.setTextColor(C.muted);
  dc.drawTextInRect('TOP 3', new Rect(0, cy + size * 0.11, size, size * 0.14));
  return dc.getImage();
}
function bar(pct, w, h, color) {
  const dc = new DrawContext(); dc.size = new Size(w, h); dc.opaque = false; dc.respectScreenScale = true;
  const tr = new Path(); tr.addRoundedRect(new Rect(0, 0, w, h), h / 2, h / 2); dc.addPath(tr); dc.setFillColor(C.track); dc.fillPath();
  const fw = Math.max(h, w * Math.min(1, Math.max(0, pct)));
  const f = new Path(); f.addRoundedRect(new Rect(0, 0, fw, h), h / 2, h / 2); dc.addPath(f); dc.setFillColor(color); dc.fillPath();
  return dc.getImage();
}
function txt(stack, s, font, color, lines) { const t = stack.addText(s); t.font = font; t.textColor = color; if (lines) t.lineLimit = lines; return t; }

async function build() {
  const w = new ListWidget();
  w.backgroundColor = C.bg; w.url = APP; w.setPadding(14, 14, 14, 14);
  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
  const fam = config.widgetFamily || 'medium';
  const tok = await token();
  if (!tok) { txt(w, 'KevinOS', Font.boldSystemFont(15), C.text); txt(w, 'Open Scriptable and run this script once to add your token.', Font.systemFont(11), C.muted); return w; }

  const now = new Date();
  const [note, cal, sbs] = await Promise.all([file(tok, `daily/${ymd(now)}.md`), file(tok, 'data/calendar.md'), file(tok, 'data/scoreboard.json')]);
  let sb = null; try { sb = sbs ? JSON.parse(sbs) : null; } catch (e) {}
  const t3 = top3(note), done = t3 ? t3.filter((x) => x.done).length : 0, total = t3 ? t3.length : 0;
  const ev = nextEvent(cal, now);
  const m = sb && sb.month;
  const streak = sb && sb.streak ? (sb.streak.days || 0) + (done >= 1 ? 1 : 0) : null;

  const row = w.addStack(); row.layoutHorizontally(); row.centerAlignContent();
  const ringImg = row.addImage(ring(done, total || 3, fam === 'small' ? 70 : 84));
  ringImg.imageSize = fam === 'small' ? new Size(70, 70) : new Size(84, 84);

  if (fam === 'small') {
    w.addSpacer(6);
    if (m) {
      txt(w, `Lv ${m.level} · ${money(m.installed)}`, Font.boldMonospacedSystemFont(12), C.green);
      w.addSpacer(3);
      w.addImage(bar(((m.installed || 0) - (m.levelFloor || 0)) / Math.max(1, (m.nextLevelAt || 1) - (m.levelFloor || 0)), 120, 6, C.green));
    }
    if (ev) { w.addSpacer(4); txt(w, `${h12(ev.hm)} ${ev.title}`, Font.mediumSystemFont(10), C.muted, 1); }
    return w;
  }

  row.addSpacer(12);
  const right = row.addStack(); right.layoutVertically();
  if (ev) {
    const when = ev.d === ymd(now) ? h12(ev.hm) : new Date(ev.d + 'T12:00').toLocaleDateString(undefined, { weekday: 'short' }) + ' ' + h12(ev.hm);
    txt(right, `NEXT · ${when}`, Font.boldMonospacedSystemFont(10), kindColor(ev.title));
    txt(right, ev.title, Font.boldSystemFont(14), C.text, 1);
    if (ev.where) txt(right, ev.where, Font.systemFont(10.5), C.muted, 1);
  } else {
    txt(right, 'NEXT', Font.boldMonospacedSystemFont(10), C.amber);
    txt(right, 'Nothing booked', Font.boldSystemFont(14), C.text, 1);
  }
  right.addSpacer(6);
  const chips = right.addStack(); chips.layoutHorizontally(); chips.spacing = 8;
  if (streak !== null) txt(chips, `🔥 ${streak}`, Font.boldMonospacedSystemFont(11), sb.streak.dimmed && !done ? C.faint : new Color('#ff9a3c'));
  if (m) txt(chips, `Lv ${m.level} · ${money(m.installed)}`, Font.boldMonospacedSystemFont(11), C.green);
  if (m) { right.addSpacer(5); right.addImage(bar(((m.installed || 0) - (m.levelFloor || 0)) / Math.max(1, (m.nextLevelAt || 1) - (m.levelFloor || 0)), 180, 6, C.green)); }

  if (fam === 'large' && t3) {
    w.addSpacer(12);
    txt(w, 'TOP 3', Font.boldMonospacedSystemFont(10), C.amber);
    w.addSpacer(4);
    t3.forEach((x) => { txt(w, `${x.done ? '✓' : '○'}  ${x.title}`, Font.mediumSystemFont(13), x.done ? C.faint : C.text, 1); w.addSpacer(3); });
  }
  if (!note) { w.addSpacer(6); txt(w, 'No plan written yet today', Font.systemFont(10), C.faint); }
  return w;
}

const widget = await build();
if (config.runsInWidget) Script.setWidget(widget);
else await widget.presentMedium();
Script.complete();
