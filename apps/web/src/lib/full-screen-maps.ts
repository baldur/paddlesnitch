// The full-screen paddle views (a paddle, a shared paddle), not /paddles/new
// or /paddles/compare. The floating REPORT AN ISSUE button sat on top of their
// replay bar, so the root layout leaves it off there.
export const FULL_SCREEN_MAPS = ['^/paddles/(?!new$|compare)[^/]+$', '^/paddles/shared/']
