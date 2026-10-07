import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import {
  findMcpConnection,
  findMyMcpCredential,
  listAgentsUsingConnection,
  listMcpConnectedMembers,
  listAuditLogsForTargets,
  listMcpTools,
} from '@agentos/db';
import { Card, CardContent, StatusBadge, cn, type StatusTone } from '@agentos/ui';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { EnabledSwitch, ReauthorizeButton } from '@/components/mcp/connection-controls';
import { ChangeSignInForm } from '@/components/mcp/change-sign-in-form';
import { DetailActions } from '@/components/mcp/detail-actions';
import { MyAccount } from '@/components/mcp/my-account';
import { ServerIcon } from '@/components/mcp/server-icon';
import { ToolsTable } from '@/components/mcp/tools-table';
import { isUuid } from '@/server/api';
import { requireSession } from '@/server/session';
import { getServices } from '@/server/services';

const TABS = ['overview', 'tools', 'authentication', 'settings', 'logs'] as const;
type Tab = (typeof TABS)[number];

const TONE: Record<string, StatusTone> = {
  connected: 'success',
  error: 'danger',
  needs_auth: 'warning',
  untested: 'neutral',
  disabled: 'neutral',
};

type Params = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; connected?: string }>;
};

async function load(id: string) {
  const { ctx } = await requireSession();
  const connection = isUuid(id) ? await findMcpConnection(getServices().db, ctx, id) : undefined;
  if (!connection) notFound();
  return { ctx, connection };
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  return { title: (await load((await params).id)).connection.name };
}

/** MCP connection detail (PRD §8.1, Screen 3). */
export default async function McpConnectionPage({ params, searchParams }: Params) {
  const { id } = await params;
  const query = await searchParams;
  const { ctx, connection } = await load(id);
  const db = getServices().db;
  const t = await getTranslations();
  const format = await getFormatter();
  const tab: Tab = TABS.includes(query.tab as Tab) ? (query.tab as Tab) : 'overview';
  const [tools, agents] = await Promise.all([
    listMcpTools(db, ctx, { connectionId: id }),
    listAgentsUsingConnection(db, ctx, id),
  ]);
  const status = connection.enabled ? connection.status : 'disabled';

  const row = (label: string, value: React.ReactNode) => (
    <div className="grid gap-1 py-2 sm:grid-cols-[10rem_1fr]">
      <dt className="text-sm text-text-muted">{label}</dt>
      <dd className="text-sm break-all">{value}</dd>
    </div>
  );

  let body: React.ReactNode;
  switch (tab) {
    case 'overview':
      body = (
        <div className="grid gap-6 lg:grid-cols-2">
          <dl className="divide-y divide-border">
            {row(
              t('mcp.detail.server'),
              connection.serverInfo
                ? `${connection.serverInfo.title ?? connection.serverInfo.name} ${connection.serverInfo.version}`
                : '—',
            )}
            {row(t('mcp.detail.transport'), t(`mcp.form.transports.${connection.transport}`))}
            {row(
              t('mcp.detail.endpoint'),
              <span className="font-mono text-xs">{connection.endpoint}</span>,
            )}
            {row(
              t('mcp.detail.lastChecked'),
              connection.lastCheckedAt
                ? format.relativeTime(connection.lastCheckedAt, new Date())
                : t('mcp.detail.never'),
            )}
            {row(
              t('mcp.detail.tabs.tools'),
              t('mcp.tools', { count: tools.filter((tool) => tool.available).length }),
            )}
          </dl>
          <div className="space-y-5">
            <div>
              <h3 className="mb-2 text-sm font-medium">{t('mcp.detail.assignedAgents')}</h3>
              {agents.length === 0 ? (
                <p className="text-sm text-text-muted">{t('mcp.detail.noAgents')}</p>
              ) : (
                <ul className="space-y-2">
                  {agents.map((agent) => (
                    <li key={agent.id}>
                      <Link
                        href={`/agents/${agent.id}`}
                        className="flex items-center gap-2 text-sm hover:text-primary"
                      >
                        <AgentAvatar avatar={agent.avatar} size="sm" />
                        {agent.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3 className="mb-2 text-sm font-medium">{t('mcp.detail.resources')}</h3>
              {connection.resources.length === 0 ? (
                <p className="text-sm text-text-muted">{t('mcp.detail.noResources')}</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {connection.resources.map((r) => (
                    <li key={r.uri}>
                      <span className="font-mono text-xs">{r.name}</span>
                      {r.description && <span className="text-text-muted"> — {r.description}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      );
      break;
    case 'tools':
      body = (
        <ToolsTable
          connectionId={id}
          tools={tools.map((tool) => ({
            id: tool.id,
            name: tool.name,
            description: tool.description,
            defaultPermission: tool.defaultPermission,
            enabled: tool.enabled,
            available: tool.available,
          }))}
        />
      );
      break;
    case 'authentication': {
      const perUser = connection.credentialMode === 'per_user';
      const [mine, members] = perUser
        ? await Promise.all([
            findMyMcpCredential(db, ctx, id),
            listMcpConnectedMembers(db, ctx, id),
          ])
        : [undefined, []];
      const redirectUri = `${getServices().env.APP_URL.replace(/\/+$/, '')}/api/mcp/oauth/callback`;
      body = (
        <div className="max-w-2xl space-y-5">
          <dl className="divide-y divide-border">
            {row(t('mcp.detail.authType'), t(`mcp.form.authTypes.${connection.authType}`))}
            {row(
              t('mcp.detail.credentialMode'),
              t(`mcp.form.credentialModes.${connection.credentialMode}`),
            )}
            {connection.oauthScopes &&
              row(
                t('mcp.detail.scopes'),
                <span className="font-mono text-xs">{connection.oauthScopes}</span>,
              )}
          </dl>
          {perUser && (connection.authType === 'oauth' || connection.authType === 'bearer') && (
            <>
              <MyAccount
                id={id}
                authType={connection.authType}
                connected={mine?.status === 'connected'}
              />
              <section aria-label={t('mcp.detail.members')}>
                <h3 className="mb-2 text-sm font-medium">{t('mcp.detail.members')}</h3>
                {members.length === 0 ? (
                  <p className="text-sm text-text-muted">{t('mcp.detail.noMembers')}</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {members.map((member) => (
                      <li key={member.userId}>
                        {member.displayName || member.email}
                        <span className="ml-2 text-xs text-text-subtle">{member.email}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
          {!perUser && connection.authType === 'oauth' && (
            <>
              <p className="text-sm text-text-muted">
                {connection.status === 'needs_auth'
                  ? t('mcp.detail.needsAuth')
                  : t('mcp.detail.authOk')}
              </p>
              <ReauthorizeButton id={id} />
            </>
          )}
          <ChangeSignInForm
            id={id}
            authType={connection.authType}
            credentialMode={connection.credentialMode}
            redirectUri={redirectUri}
          />
        </div>
      );
      break;
    }
    case 'settings':
      body = <EnabledSwitch id={id} enabled={connection.enabled} />;
      break;
    case 'logs': {
      const logs = await listAuditLogsForTargets(db, ctx, [id, ...tools.map((tool) => tool.id)]);
      body =
        logs.length === 0 ? (
          <p className="text-sm text-text-muted">{t('mcp.detail.noLogs')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {logs.map((log) => {
              const key = log.action.replaceAll('.', '_');
              const specific = `activity.${key}_${log.outcome}`;
              const label = t.has(specific as never)
                ? t(specific as never)
                : t.has(`activity.${key}` as never)
                  ? t(`activity.${key}` as never)
                  : log.action;
              const meta = log.metadata as { tool?: string; reason?: string };
              return (
                <li
                  key={log.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                >
                  <span>
                    {label}
                    {meta.tool && (
                      <span className="ml-2 font-mono text-xs text-text-muted">{meta.tool}</span>
                    )}
                  </span>
                  <time className="text-xs text-text-subtle" dateTime={log.createdAt.toISOString()}>
                    {format.relativeTime(log.createdAt, new Date())}
                  </time>
                </li>
              );
            })}
          </ul>
        );
      break;
    }
  }

  return (
    <>
      <Link
        href="/mcp"
        className="mb-4 inline-flex items-center gap-1 text-sm text-text-muted hover:text-text"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t('mcp.title')}
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <ServerIcon serverType={connection.serverType} size="lg" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{connection.name}</h1>
              <StatusBadge tone={TONE[status] ?? 'neutral'}>
                {t(`mcp.status.${status}`)}
              </StatusBadge>
            </div>
            <p className="text-text-muted">
              {connection.serverInfo?.instructions ?? connection.endpoint}
            </p>
            {connection.lastError && connection.status !== 'connected' && (
              <p className="text-sm text-danger">
                {t(`mcp.errorCodes.${connection.lastError as 'auth'}`)}
              </p>
            )}
          </div>
        </div>
        <DetailActions id={id} />
      </div>
      {query.connected && (
        <p role="status" className="mb-4 rounded-lg bg-success/15 px-3 py-2 text-sm text-success">
          {t('mcp.detail.connectedNotice')}
        </p>
      )}
      <nav
        aria-label={connection.name}
        className="mb-5 flex gap-1 overflow-x-auto border-b border-border"
      >
        {TABS.map((name) => (
          <Link
            key={name}
            href={name === 'overview' ? `/mcp/${id}` : `/mcp/${id}?tab=${name}`}
            aria-current={tab === name ? 'page' : undefined}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap',
              tab === name
                ? 'border-primary text-text'
                : 'border-transparent text-text-muted hover:text-text',
            )}
          >
            {t(`mcp.detail.tabs.${name}`)}
            {name === 'tools' && <span className="ml-1 text-text-subtle">({tools.length})</span>}
          </Link>
        ))}
      </nav>
      <Card>
        <CardContent className="pt-5">{body}</CardContent>
      </Card>
    </>
  );
}
