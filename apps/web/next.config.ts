import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Don't let `next dev` write AGENTS.md + CLAUDE.md here when an AI agent runs
  // it (it re-creates them if deleted). The root CLAUDE.md covers this repo.
  agentRules: false,
  // Workspace packages ship untranspiled TypeScript — Next must transpile them.
  transpilePackages: ['@paddlesnitch/analysis', '@paddlesnitch/api', '@paddlesnitch/core', '@paddlesnitch/timing', '@paddlesnitch/ui'],
  // Bundle @aws-sdk into server chunks (Turbopack otherwise externalizes it,
  // creating .next/node_modules/ copies that require @smithy/* deps to be present)
  serverExternalPackages: [],
  // Prevent file tracer from pulling in the whole project tree
  outputFileTracingExcludes: {
    '**': ['infra/**', '.open-next/**', 'examples/**', 'scripts/**', '.local-data/**'],
  },
  // Profile/account moved to platform-level routes (docs/features/profile-routes.md):
  // keep the old att URLs working via permanent redirects so existing links /
  // bookmarks / the Strava app config don't break.
  async redirects() {
    return [
      // (The tracker QR's uppercase /L/<code> is routed in src/proxy.ts: a rule
      // here matches case-insensitively and would loop /l/ onto itself.)
      { source: '/att/u/:id', destination: '/profile/:id', permanent: true },
      // Account settings moved twice: /att/account → /profile/me/settings → /account.
      // Both old URLs go straight to /account (no chained hops).
      { source: '/att/account', destination: '/account', permanent: true },
      { source: '/profile/me/settings', destination: '/account', permanent: true },
      // Trackers moved from /profile/me/devices to /devices. (The old recording
      // URL /profile/me/devices/<sessionId> is a page that looks up the tracker.)
      { source: '/profile/me/devices', destination: '/devices', permanent: true },
      { source: '/profile/me/devices/d/:deviceId', destination: '/devices/:deviceId', permanent: true },
      // The Analyse section moved to /paddles ("Analyse" was a verb; paddles are
      // the thing). Keep old links / bookmarks / shared-paddle URLs working.
      { source: '/analyse', destination: '/paddles', permanent: true },
      // The paddle list and the dashboard were two pages; /paddles is both now.
      // /analyse/library is listed so it lands in one hop, not via /paddles/library.
      { source: '/analyse/library', destination: '/paddles', permanent: true },
      { source: '/paddles/library', destination: '/paddles', permanent: true },
      { source: '/analyse/:path*', destination: '/paddles/:path*', permanent: true },
      // Sign-in, help and the legal pages are the whole site's, not Trials'
      // (site review, 2026-10). Queries such as ?next= come along.
      { source: '/att/auth', destination: '/signin', permanent: true },
      { source: '/att/auth/:path*', destination: '/signin/:path*', permanent: true },
      { source: '/att/faq', destination: '/help', permanent: true },
      { source: '/att/privacy', destination: '/privacy', permanent: true },
      { source: '/att/tos', destination: '/terms', permanent: true },
      { source: '/att/tos/:path*', destination: '/terms/:path*', permanent: true },
    ]
  },
};

export default nextConfig;
