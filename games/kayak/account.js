// The player's paddlesnitch account, and the site's API (tRPC, plain JSON over
// fetch). The game is served from the same origin as the site, under /games/,
// so the sign-in cookie comes along. Served on its own (`pnpm games`, the
// browser tests: /kayak/) there's no site and no API: then nobody is signed in
// and nothing is gated (see `whoAmI`).

export const SIGN_IN = '/signin?next=/games/kayak/';

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// One tRPC call: a query (GET, input in the URL) or a mutation (POST).
export async function call(path, input, { mutation = false } = {}) {
  const query = !mutation && input !== undefined ? `?input=${encodeURIComponent(JSON.stringify(input))}` : '';
  const res = await fetch(`/api/trpc/${path}${query}`, mutation
    ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input ?? null), credentials: 'same-origin' }
    : { credentials: 'same-origin' });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.result) throw new ApiError(body?.error?.message ?? `HTTP ${res.status}`, res.status);
  return body.result.data;
}

// { user } when the site answers (user null when signed out), or { offline: true }
// when there's no API to ask (the game served on its own): races stay open then.
export async function whoAmI() {
  if (!location.pathname.startsWith('/games/')) return { offline: true, user: null };
  try {
    return { user: (await call('me')).user ?? null };
  } catch {
    return { offline: true, user: null };
  }
}
