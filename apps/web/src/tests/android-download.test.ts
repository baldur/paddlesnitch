// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { GET } from '@/app/android/download/route'
import { ANDROID_APK_NAME, ANDROID_RELEASE_TAG } from '@/lib/android-download'

describe('/android/download', () => {
  it('sends you to the newest APK, without caching where that is', () => {
    const res = GET()
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(`https://github.com/baldur/paddlesnitch/releases/download/${ANDROID_RELEASE_TAG}/${ANDROID_APK_NAME}`)
  })

  // The link only works while CI publishes to the same release and file name.
  it('points where the Android workflow publishes', () => {
    const workflow = readFileSync(path.join(__dirname, '../../../../.github/workflows/android.yml'), 'utf8')
    expect(workflow).toContain(`RELEASE_TAG: ${ANDROID_RELEASE_TAG}`)
    expect(workflow).toContain(`APK_NAME: ${ANDROID_APK_NAME}`)
  })
})
