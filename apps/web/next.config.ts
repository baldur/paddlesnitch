import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
      // The device's claim QR carries an UPPERCASE URL on purpose: all-caps
      // puts it in QR alphanumeric mode, which packs 2 characters per 11 bits
      // and drops the code from version 2 to version 1 -- fewer modules and a
      // wider quiet zone on a 64 px panel, which is what makes it scannable.
      // Domains are case-insensitive but Next path segments are not, so /L/
      // needs routing to /l/.
      { source: '/L/:code', destination: '/l/:code', permanent: false },
      { source: '/att/u/:id', destination: '/profile/:id', permanent: true },
      { source: '/att/account', destination: '/profile/me/settings', permanent: true },
      // The Analyse section moved to /paddles ("Analyse" was a verb; paddles are
      // the thing). Keep old links / bookmarks / shared-paddle URLs working.
      { source: '/analyse', destination: '/paddles', permanent: true },
      { source: '/analyse/:path*', destination: '/paddles/:path*', permanent: true },
    ]
  },
};

export default nextConfig;
