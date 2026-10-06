import 'server-only';
import type { AuthenticatedSession } from '@agentos/core';
import { getSession } from './session';

export const unauthorized = () => Response.json({ error: 'unauthorized' }, { status: 401 });
/** Used for both "missing" and "not yours", so ids from other tenants reveal nothing (AC 2). */
export const notFound = () => Response.json({ error: 'not_found' }, { status: 404 });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string) => UUID.test(value);

/** Runs an API handler with the caller's session, or answers 401. */
export async function withSession(
  handler: (session: AuthenticatedSession) => Promise<Response>,
): Promise<Response> {
  const session = await getSession();
  return session ? handler(session) : unauthorized();
}
