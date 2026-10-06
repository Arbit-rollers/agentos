import { NextResponse, type NextRequest } from 'next/server';
import { AppError, completeMcpAuthorization } from '@agentos/core';
import { getSession } from '@/server/session';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

/**
 * OAuth redirect target for MCP servers. The `state` is looked up inside the signed-in user's
 * workspace only, so a callback can never attach tokens to another tenant's connection.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  const url = request.nextUrl;
  if (!session) return NextResponse.redirect(new URL('/login', url));
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  if (!state || !code) return NextResponse.redirect(new URL('/mcp?oauth=error', url));

  const { db, mcpDeps } = getServices();
  try {
    const connection = await completeMcpAuthorization(db, mcpDeps, session.ctx, { state, code });
    return NextResponse.redirect(new URL(`/mcp/${connection.id}?connected=1`, url));
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return NextResponse.redirect(new URL('/mcp?oauth=error', url));
  }
}
