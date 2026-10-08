// How long an answer the server put in the first HTML (lib/trpc-server.ts)
// counts as fresh in the browser, so the page doesn't fetch it again the moment
// it mounts. Coming back to the page brings a newer one from the server anyway:
// these pages are rendered per request. Kept apart from trpc-server.ts so
// client components can import it without pulling in server code.
export const PREFILLED_FRESH_MS = 30_000
