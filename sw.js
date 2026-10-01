/* KevinOS service worker — push reminders ONLY.
 *
 * Deliberately has NO fetch handler: the app already has three cache layers
 * (localStorage fc_ cache, the Pages CDN, the phone's PWA cache) and this must
 * not become a fourth. It does exactly two things:
 *
 *   push              → fetch today's reminders from GitHub and show one
 *                        notification per line
 *   push after 17:00  → ONE "Plan tomorrow" banner (evening check-in)
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

self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    const show = (title, body, tag) => self.registration.showNotification(title, {
      body, tag, data: { url: APP }, badge: 'icon-192.png', icon: 'icon-192.png',
    });
    // EVENING push (8pm cron, 2026-09-30): one banner that opens the check-in.
    // The push is empty, so the phone's own clock decides which reminder this is.
    if (new Date().getHours() >= 17) {
      await self.registration.showNotification('Plan tomorrow', {
        body: '2 minutes in Claude: type /checkin in your KevinOS session.',
        tag: 'kevinos-checkin', data: { url: APP + '?checkin=1', checkin: true },
        badge: 'icon-192.png', icon: 'icon-192.png',
      });
      return;
    }
    let lines = [];
    try {
      const t = await tokenFromIdb();
      if (!t) throw new Error('no token on phone — open KevinOS once');
      const r = await fetch(REM_URL, {
        headers: { 'Authorization': 'Bearer ' + t, 'Accept': 'application/vnd.github.raw+json' },
        cache: 'no-store',
      });
      if (!r.ok) throw new Error('GitHub ' + r.status);
      lines = (await r.text()).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    } catch (err) {
      await show('KevinOS', 'Open for today\'s plan (' + (err && err.message || err) + ')', 'kevinos-fallback');
      return;
    }
    if (!lines.length) { await show('KevinOS', 'Nothing due today.', 'kevinos-empty'); return; }
    for (let i = 0; i < lines.length; i++) {
      const m = /^(Top 3|Follow-up):\s*(.*)$/.exec(lines[i]);
      // a distinct tag per line, or iOS collapses them into one
      await show(m ? m[1] : 'Today', m ? m[2] : lines[i], 'kevinos-' + i);
    }
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const d = e.notification.data || {};
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) if (c.url.includes(APP) && 'focus' in c) {
      // app already open: just focus it — the Today card offers the Claude /checkin hand-off
      return c.focus();
    }
    return self.clients.openWindow(d.url || APP);
  })());
});
