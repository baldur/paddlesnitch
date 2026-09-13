// Public surface of the shared API package.
// - Servers (the Next mount, tests) import `appRouter` / `createCaller` (values).
// - Clients (web browser, mobile) import ONLY `type AppRouter` — a type-only
//   import erases at build time, so no server code (trpc/server, storage) leaks
//   into a client bundle.
export { appRouter, createCaller } from './root'
export type { AppRouter } from './root'
export type { Context } from './trpc'
