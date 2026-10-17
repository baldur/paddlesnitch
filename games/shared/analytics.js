// Counts a visit: one pageview sent to paddlesnitch's analytics endpoint, so
// games show up in the paddlesnitch-app dashboard (pageviews by path). Same
// session id key as the rest of the site, so going from the site into a game
// is one session. No cookies, nothing about the player. Every game page loads
// this with <script src="../shared/analytics.js" defer>.
try {
  const KEY = 'tt_sid';
  let sid = sessionStorage.getItem(KEY);
  if (!sid) {
    sid = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random())).slice(0, 32);
    sessionStorage.setItem(KEY, sid);
  }
  // Only on the real site: locally there is no endpoint to send to.
  if (location.hostname === 'paddlesnitch.com' || location.hostname === 'www.paddlesnitch.com') {
    navigator.sendBeacon('/att/api/track', JSON.stringify({
      sid,
      events: [{ event: 'pageview', t: Date.now(), path: location.pathname }],
    }));
  }
} catch {
  // Storage blocked (private mode) or no sendBeacon: skip the count, never the game.
}
