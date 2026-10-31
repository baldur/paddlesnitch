// Analytics for the games, sent to paddlesnitch's endpoint (/att/api/track,
// the site's own: same session id key, so going from the site into a game is
// one session). No cookies, nothing about the player: an event name, the
// page's path, small string props and the random per-tab session id.
//
// Counts a visit (one pageview) on load. A game adds its own events with
// `window.gameMetrics.track(event, props)`: they're queued and sent together
// in one beacon when the page is hidden or left, or once a minute while
// there's something waiting (20 at most per send). `beforeSend(fn)` lets a
// game add a last event (how long it was played) just before each send.
// Only sent on the real site; elsewhere (`pnpm games`, the tests) the batches
// are kept in `gameMetrics.sent` to look at. Every game page loads this with
// <script src="../shared/analytics.js" defer>.
(() => {
  const live = location.hostname === 'paddlesnitch.com' || location.hostname === 'www.paddlesnitch.com';
  const queue = [];
  const before = [];
  const sent = [];
  let sid = '';
  try {
    const KEY = 'tt_sid';
    sid = sessionStorage.getItem(KEY) || '';
    if (!sid) {
      sid = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random())).slice(0, 32);
      sessionStorage.setItem(KEY, sid);
    }
  } catch {
    // Storage blocked (private mode): a session id for this page only.
    sid = String(Math.random()).slice(2, 18);
  }
  const MAX = 20;
  function send() {
    for (const fn of before) {
      try { fn(); } catch {}
    }
    while (queue.length) {
      const events = queue.splice(0, MAX);
      const batch = { sid, events };
      sent.push(batch);
      if (live) {
        try { navigator.sendBeacon('/att/api/track', JSON.stringify(batch)); } catch {}
      }
    }
  }
  function track(event, props) {
    queue.push({ event, t: Date.now(), path: location.pathname, ...(props ? { props } : {}) });
    if (queue.length >= MAX) send();
  }
  window.gameMetrics = { track, send, beforeSend: (fn) => before.push(fn), sent };
  track('pageview');
  send(); // the visit counts at once, as before
  setInterval(() => { if (queue.length) send(); }, 60_000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') send(); });
  addEventListener('pagehide', send);
})();
