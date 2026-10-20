import { listCourses, listTrials } from '@/lib/catalogue'
import { sitemap } from '@/lib/discovery'

// Public pages plus every public course and trial (#513).
export const dynamic = 'force-dynamic'

export default async function Sitemap() {
  const [trials, courses] = await Promise.all([listTrials(), listCourses()])
  return sitemap(trials, courses)
}
