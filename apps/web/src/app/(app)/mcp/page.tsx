import { Plug, Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import {
  countToolsByConnection,
  listMcpConnections,
  listProviderConnections,
  type McpConnection,
} from '@agentos/db';
import { Button, Card, EmptyState, PageHeader, StatusBadge, type StatusTone } from '@agentos/ui';
import { HubFilters } from '@/components/mcp/hub-filters';
import { HUB_TABS, type HubTab } from '@/components/mcp/hub-tabs';
import { ServerIcon } from '@/components/mcp/server-icon';
import { MCP_TEMPLATES } from '@/components/mcp/templates';
import { requireSession } from '@/server/session';
import { getServices } from '@/server/services';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('mcp'))('title') };
}

const TONE: Record<string, StatusTone> = {
  connected: 'success',
  error: 'danger',
  needs_auth: 'warning',
  untested: 'neutral',
  disabled: 'neutral',
};

const statusOf = (c: McpConnection) => (c.enabled ? c.status : 'disabled');

/** MCP Hub (PRD §8.1, Screen 2). */
export default async function McpHubPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; oauth?: string }>;
}) {
  const { ctx } = await requireSession();
  const { db } = getServices();
  const t = await getTranslations();
  const params = await searchParams;
  const tab: HubTab = HUB_TABS.includes(params.tab as HubTab) ? (params.tab as HubTab) : 'all';

  const [connections, toolCounts, providers] = await Promise.all([
    listMcpConnections(db, ctx),
    countToolsByConnection(db, ctx),
    listProviderConnections(db, ctx),
  ]);
  const connected = connections.filter((c) => c.enabled && c.status === 'connected');
  const custom = connections.filter((c) => c.serverType === 'custom');
  const counts: Record<HubTab, number> = {
    all: connections.length,
    connected: connected.length,
    available: MCP_TEMPLATES.length,
    custom: custom.length,
    providers: providers.length,
  };
  const shown = tab === 'connected' ? connected : tab === 'custom' ? custom : connections;

  const connect = (
    <Button asChild>
      <Link href="/mcp/new">
        <Plus aria-hidden />
        {t('mcp.connect')}
      </Link>
    </Button>
  );

  return (
    <>
      <PageHeader title={t('mcp.title')} description={t('mcp.subtitle')} actions={connect} />
      {params.oauth === 'error' && (
        <p role="alert" className="mb-4 rounded-lg bg-danger/15 px-3 py-2 text-sm text-danger">
          {t('mcp.detail.oauthError')}
        </p>
      )}
      <div className="mb-5">
        <HubFilters value={tab} counts={counts} />
      </div>

      {tab === 'available' ? (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {MCP_TEMPLATES.map((template) => (
            <li
              key={template.key}
              className="flex flex-col gap-3 rounded-(--radius-card) border border-border bg-surface p-4"
            >
              <div className="flex items-center gap-3">
                <ServerIcon serverType={template.key} />
                <p className="font-medium">{t(`mcp.templates.${template.key}.name`)}</p>
              </div>
              <p className="flex-1 text-sm text-text-muted">
                {t(`mcp.templates.${template.key}.description`)}
              </p>
              <div className="flex justify-end">
                <Button size="sm" asChild>
                  <Link href={`/mcp/new?template=${template.key}`}>{t('mcp.connectTemplate')}</Link>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : tab === 'providers' ? (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {providers.map((provider) => (
            <li
              key={provider.id}
              className="flex flex-col gap-3 rounded-(--radius-card) border border-border bg-surface p-4"
            >
              <div className="flex items-center gap-3">
                <span
                  aria-hidden
                  className="grid size-10 place-items-center rounded-lg bg-primary/15 text-xs font-bold text-primary"
                >
                  AI
                </span>
                <div className="min-w-0">
                  <p className="truncate font-medium">{provider.name}</p>
                  <p className="text-xs text-text-subtle">
                    {t('mcp.aiProvider')} · {t(`providers.kinds.${provider.provider}`)}
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <StatusBadge tone={TONE[provider.status] ?? 'neutral'}>
                  {t(`providers.status.${provider.status}`)}
                </StatusBadge>
                <Button size="sm" variant="secondary" asChild>
                  <Link href="/settings/providers">{t('mcp.manage')}</Link>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : shown.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Plug />}
            title={t('mcp.emptyTitle')}
            description={t('mcp.emptyDescription')}
            action={connect}
          />
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((connection) => {
            const status = statusOf(connection);
            return (
              <li
                key={connection.id}
                className="flex flex-col gap-3 rounded-(--radius-card) border border-border bg-surface p-4"
              >
                <div className="flex items-start gap-3">
                  <ServerIcon serverType={connection.serverType} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{connection.name}</p>
                    <div className="flex flex-wrap gap-1">
                      <StatusBadge tone={TONE[status] ?? 'neutral'}>
                        {t(`mcp.status.${status}`)}
                      </StatusBadge>
                      {connection.credentialMode === 'per_user' && (
                        <StatusBadge tone="info">{t('mcp.detail.perUserBadge')}</StatusBadge>
                      )}
                    </div>
                  </div>
                </div>
                <p className="line-clamp-2 flex-1 text-sm text-text-muted">
                  {connection.serverInfo?.title ??
                    connection.serverInfo?.name ??
                    connection.endpoint}
                </p>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-text-subtle">
                    {t('mcp.tools', { count: toolCounts.get(connection.id) ?? 0 })}
                  </span>
                  <Button size="sm" variant="secondary" asChild>
                    <Link
                      href={`/mcp/${connection.id}`}
                      aria-label={`${t('mcp.manage')} ${connection.name}`}
                    >
                      {t('mcp.manage')}
                    </Link>
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
