// The Android app before Google Play: every merge to main that touches the app
// publishes a signed APK to the GitHub release `android-latest`
// (.github/workflows/android.yml), and /android/download points at it, so the
// link on paddlesnitch.com never changes.
export const ANDROID_RELEASE_TAG = 'android-latest'
export const ANDROID_APK_NAME = 'paddlesnitch.apk'
export const ANDROID_APK_URL = `https://github.com/baldur/paddlesnitch/releases/download/${ANDROID_RELEASE_TAG}/${ANDROID_APK_NAME}`
