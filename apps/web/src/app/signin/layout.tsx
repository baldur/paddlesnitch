// Sign-in is the whole site's, not Trials' (it lived at /att/auth until the
// 2026-10 site review); its pages are client components, so the title is here.
export const metadata = { title: 'Sign in' }

export default function SignInLayout({ children }: { children: React.ReactNode }) {
  return children
}
