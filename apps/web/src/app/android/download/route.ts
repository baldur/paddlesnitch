import { NextResponse } from 'next/server'
import { ANDROID_APK_URL } from '@/lib/android-download'

// The newest Android APK (lib/android-download.ts). Temporary redirect: the
// file behind it changes with every release.
export function GET() {
  return NextResponse.redirect(ANDROID_APK_URL, 302)
}
