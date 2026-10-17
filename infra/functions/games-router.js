// CloudFront Function (cloudfront-js-2.0, viewer request) on /games/*.
// S3 has no directory index, so a folder URL gets its index.html; a folder
// URL without the trailing slash is redirected to have one, because the games
// load their siblings with relative URLs (../shared/audio.js). Tested in
// apps/web/src/tests/games-router.test.ts.
function handler(event) {
  var request = event.request
  var uri = request.uri
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
