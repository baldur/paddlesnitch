// Digital Asset Links: tells Android that the paddlesnitch app may open
// paddlesnitch.com links itself (App Links; docs/features/android-app.md). Lists the SHA-256
// of each certificate the app is signed with. Public by design.
export const ANDROID_PACKAGE = 'com.paddlesnitch.app'
export const ANDROID_CERT_SHA256 = [
  // The upload key (~/.paddlesnitch-android on the owner's Mac; CI's
  // ANDROID_UPLOAD_* secrets). Add Play's app-signing key here once Play exists.
  'A5:06:9D:41:6F:CE:79:55:D0:F7:BE:8C:88:06:D6:27:9C:12:B5:D1:20:E2:FF:9E:EC:D2:BD:41:AC:7B:A3:25',
]

export function GET() {
  const statements = [{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: { namespace: 'android_app', package_name: ANDROID_PACKAGE, sha256_cert_fingerprints: ANDROID_CERT_SHA256 },
  }]
  return Response.json(statements, { headers: { 'Cache-Control': 'public, max-age=3600' } })
}
