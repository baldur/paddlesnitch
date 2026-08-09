import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship untranspiled TypeScript — Next must transpile them.
  transpilePackages: ['@paddlesnitch/core', '@paddlesnitch/timing', '@paddlesnitch/ui'],
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
      { source: '/att/u/:id', destination: '/profile/:id', permanent: true },
      { source: '/att/account', destination: '/profile/me/settings', permanent: true },
    ]
  },
};

export default nextConfig;
