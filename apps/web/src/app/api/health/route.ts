import { checkHealth } from '@agentos/core';
import { pingDb } from '@agentos/db';
import { getServices } from '@/server/services';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { sql, redis } = getServices();
  const report = await checkHealth({
    database: () => pingDb(sql),
    redis: () => redis.ping(),
  });
  return Response.json(report, { status: report.ok ? 200 : 503 });
}
