/* KevinOS service worker — push reminders ONLY.
 *
 * Deliberately has NO fetch handler: the app already has three cache layers
 * (localStorage fc_ cache, the Pages CDN, the phone's PWA cache) and this must
 * not become a fourth. It does exactly two things:
 *
 *   push              → fetch today's reminders from GitHub and show one
 *                        notification per line
 *   push              → see the handler: 9am reminders, 8pm check-in, 1-hour block heads-ups
 *   notificationclick → focus the app if it is open, else open it
 *
 * The push itself is EMPTY (see ops/ai-proxy/worker.js in the private repo):
 * the Worker only rings the phone. The text comes from
 * data/reminders-today.txt, fetched here with the GitHub PAT the app mirrors
 * into IndexedDB (a service worker cannot read localStorage). Same origin,
 * same secret, same exposure as the app itself.
 *
 * iOS shows a push only if the handler shows a notification, and quietly
 * revokes subscriptions that keep failing to — so every path below ends in
 * showNotification, including "nothing due" and "could not fetch".
 */
const APP = '/KevinOS-Inbox/';
const REM_URL = 'https://api.github.com/repos/kliu6151/KevinOS/contents/data/reminders-today.txt?ref=main';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

function tokenFromIdb() {
  return new Promise((res) => {
    try {
      const r = indexedDB.open('kevinos-push', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => {
        try {
          const g = r.result.transaction('kv').objectStore('kv').get('gh_token');
          g.onsuccess = () => res(g.result || null);
          g.onerror = () => res(null);
        } catch (_) { res(null); }
      };
      r.onerror = () => res(null);
    } catch (_) { res(null); }
  });
}

/* One empty push every time the Worker's 5-minute cron has a reason (2026-10-01):
 * 09:00 → the day's reminders · 20:00 → "Plan tomorrow" · any block of today's plan
 * starting in ~1 hour → "In 1 hr · …". The push carries nothing, so this handler works
 * out which of those apply from the phone's clock and today's plan (same rule as
 * todaysBlocks() in ops/ai-proxy/worker.js — keep the two in step). */
const GH = 'https://api.github.com/repos/kliu6151/KevinOS/contents/';
const pad = (n) => String(n).padStart(2, '0');
const h12 = (hm) => { let [h, m] = hm.split(':').map(Number); const ap = h >= 12 ? 'p' : 'a'; h = h % 12 || 12; return h + (m ? ':' + pad(m) : '') + ap; };
async function ghText(t, path) {
  const r = await fetch(GH + path + '?ref=main', { headers: { 'Authorization': 'Bearer ' + t, 'Accept': 'application/vnd.github.raw+json' }, cache: 'no-store' });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('GitHub ' + r.status);
  return r.text();
}
function planBlocks(note, cal, ymd) {
  const out = [];
  let inPlan = false;
  for (const l of (note || '').split(/\r?\n/)) {
    if (/^## /.test(l)) { inPlan = /^## Day plan\b/i.test(l); continue; }
    if (!inPlan) continue;
    const m = l.match(/^- (\d{2}):(\d{2})[–-](\d{2}:\d{2}) — (.+)$/);
    if (!m) continue;
    const kind = (m[4].match(/kind:(\w+)/) || [])[1] || 'task';
    if (/^(buffer|break)$/.test(kind) || /status:(done|skipped)/.test(m[4])) continue;
    out.push({ start: m[1] + ':' + m[2], min: (+m[1]) * 60 + (+m[2]), title: m[4].split(' | ')[0].replace(/^📌\s*/, '').trim() });
  }
  if (!out.length) for (const l of (cal || '').split(/\r?\n/)) {
    const m = l.match(/^- \[ \] (\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})\s*[—-]\s*(.+)$/);
    if (m && m[1] === ymd) out.push({ start: m[2] + ':' + m[3], min: (+m[2]) * 60 + (+m[3]), title: m[4].split(' | ')[0].trim() });
  }
  return out;
}

self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    const note = (title, body, tag, data) => self.registration.showNotification(title, {
      body, tag, data: Object.assign({ url: APP }, data || {}), badge: 'icon-192.png', icon: 'icon-192.png',
    });
    const now = new Date(), h = now.getHours(), mnow = h * 60 + now.getMinutes();
    const ymd = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
    let shown = 0;
    try {
      const t = await tokenFromIdb();
      if (!t) throw new Error('no token on phone — open KevinOS once');
      // 1-hour heads-up for blocks starting 40–80 min from now (the cron rings at start−60)
      const [plan, cal] = await Promise.all([ghText(t, 'daily/' + ymd + '.md'), ghText(t, 'data/calendar.md')]);
      for (const b of planBlocks(plan, cal, ymd)) {
        const d = b.min - mnow;
        if (d < 40 || d > 80) continue;
        await note('In 1 hr · ' + h12(b.start), b.title + ' — tap to update', 'kevinos-blk-' + ymd + '-' + b.start, { url: APP + '?block=' + b.start });
        shown++;
      }
      if (h === 20 && now.getMinutes() < 15) {
        await note('Plan tomorrow', '2 minutes in Claude: type /checkin in your KevinOS session.', 'kevinos-checkin', { url: APP + '?checkin=1', checkin: true });
        shown++;
      }
      if (h === 9 && now.getMinutes() < 15) {
        const raw = await ghText(t, 'data/reminders-today.txt');
        const lines = (raw || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
        if (!lines.length) { await note('KevinOS', 'Nothing due today.', 'kevinos-empty'); shown++; }
        for (let i = 0; i < lines.length; i++) {
          const m = /^(Top 3|Follow-up):\s*(.*)$/.exec(lines[i]);
          // a distinct tag per line, or iOS collapses them into one
          await note(m ? m[1] : 'Today', m ? m[2] : lines[i], 'kevinos-' + i);
          shown++;
        }
      }
    } catch (err) {
      await note('KevinOS', 'Open for today\'s plan (' + (err && err.message || err) + ')', 'kevinos-fallback');
      return;
    }
    // iOS revokes subscriptions whose pushes show nothing — always show something
    if (!shown) await note('KevinOS', 'Open for today\'s plan.', 'kevinos-fallback');
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const d = e.notification.data || {};
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) if (c.url.includes(APP) && 'focus' in c) {
      // app already open: focus it; a block push also points Today at that block's card
      const bm = (d.url || '').match(/[?&]block=(\d{2}:\d{2})/);
      if (bm) c.postMessage({ block: bm[1] });
      return c.focus();
    }
    return self.clients.openWindow(d.url || APP);
  })());
});
