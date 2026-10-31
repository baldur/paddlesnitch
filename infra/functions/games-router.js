// CloudFront Function (cloudfront-js-2.0, viewer request) on /games/*.
// S3 has no directory index, so a folder URL gets its index.html; a folder
// URL without the trailing slash is redirected to have one, because the games
// load their siblings with relative URLs (../shared/audio.js). Tested in
// apps/web/src/tests/games-router.test.ts. /games/ itself is the games index,
// a Next page at /games.
function handler(event) {
  var request = event.request
  var uri = request.uri
  // The river game moved from /games/kayak/ (owner, 2026-10-31): old links and
  // shared #race= links (the browser keeps the fragment) still arrive.
  if (uri === '/games/kayak' || uri.indexOf('/games/kayak/') === 0) {
    var qs0 = request.querystring || {}
    var q0 = Object.keys(qs0).map(function (k) { return k + '=' + qs0[k].value }).join('&')
    var rest = uri === '/games/kayak' ? '/' : uri.substring('/games/kayak'.length)
    return {
      statusCode: 301,
      statusDescription: 'Moved Permanently',
      headers: { location: { value: '/games/reading-thames' + rest + (q0 ? '?' + q0 : '') } },
    }
  }
  if (uri === '/games/') {
    return { statusCode: 301, statusDescription: 'Moved Permanently', headers: { location: { value: '/games' } } }
  }
  if (uri.endsWith('/')) {
    request.uri = uri + 'index.html'
    return request
  }
  var last = uri.substring(uri.lastIndexOf('/') + 1)
  if (last.indexOf('.') === -1) {
    var qs = request.querystring || {}
    var query = Object.keys(qs).map(function (k) { return k + '=' + qs[k].value }).join('&')
    return {
      statusCode: 301,
      statusDescription: 'Moved Permanently',
      headers: { location: { value: uri + '/' + (query ? '?' + query : '') } },
    }
  }
  return request
}
