// Shared by server code and the proxy (which cannot import server-only modules).
export const SESSION_COOKIE = 'agentos_session';
/** Matches SESSION_TTL_MS in @agentos/core. */
export const SESSION_COOKIE_MAX_AGE_S = 30 * 24 * 60 * 60;
