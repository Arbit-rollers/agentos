import { Pencil } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { canAgentRun } from '@agentos/core';
import {
  agentSpendSince,
  findAgent,
  findConversation,
  latestConversation,
  listAgentToolGrants,
  listApprovalRequests,
  listChildAgents,
  listMessages,
  listProviderConnections,
  listRunsWithDetails,
  listTasks,
  listToolCallsForRuns,
} from '@agentos/db';
import { stricter } from '@agentos/policy';
import {
  Button,
  Card,
  CardContent,
  EmptyState,
  StatusBadge,
  cn,
  type StatusTone,
} from '@agentos/ui';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { AgentOverview } from '@/components/agents/agent-overview';
import { ChatPanel, type ChatItem } from '@/components/agents/chat/chat-panel';
import { SettingsDrawer } from '@/components/agents/settings-drawer';
import { stepHref } from '@/components/agents/wizard/steps';
import { toApprovalView } from '@/components/approvals/approval-view';
import { RunLog } from '@/components/runs/run-log';
import { TaskTable } from '@/components/tasks/task-table';
import { loadAgentOr404 } from '@/server/agents';
import { brainValue } from '@/server/models';
import { requireSession } from '@/server/session';
import { getServices } from '@/server/services';

const TABS = ['chat', 'tasks', 'tools', 'files', 'memory', 'logs'] as const;
type Tab = (typeof TABS)[number];

type Params = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; c?: string; settings?: string }>;
};

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { ctx } = await requireSession();
  return { title: (await loadAgentOr404(ctx, (await params).id)).name };
}

/** Agent Workspace (PRD §20, Screen 7): six tabs plus a settings drawer. */
export default async function AgentWorkspacePage({ params, searchParams }: Params) {
  const { id } = await params;
  const query = await searchParams;
  const tab: Tab = TABS.includes(query.tab as Tab) ? (query.tab as Tab) : 'chat';
  const { ctx } = await requireSession();
  const db = getServices().db;
  const agent = await loadAgentOr404(ctx, id);
  const t = await getTranslations();
  const format = await getFormatter();
  const now = new Date();
  const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const [parent, children, brain, connections, canRun, grants, tasks, spentToday] =
    await Promise.all([
      agent.parentAgentId ? findAgent(db, ctx, agent.parentAgentId) : undefined,
      listChildAgents(db, ctx, id),
      brainValue(ctx, id),
      listProviderConnections(db, ctx),
      canAgentRun(db, ctx, id),
      listAgentToolGrants(db, ctx, id),
      listTasks(db, ctx, { agentId: id, limit: 100 }),
      agentSpendSince(db, ctx, id, startOfDay),
    ]);
  const connectionNames = new Map(connections.map((c) => [c.id, c.name]));
  const working = tasks.some((task) =>
    ['queued', 'running', 'waiting_for_approval'].includes(task.state),
  );
  const presence = working
    ? 'working'
    : agent.status === 'active'
      ? 'online'
      : agent.status === 'configured'
        ? 'idle'
        : 'offline';
  const presenceTone: StatusTone =
    presence === 'working'
      ? 'info'
      : presence === 'online'
        ? 'success'
        : presence === 'idle'
          ? 'warning'
          : 'neutral';
  const offered = grants
    .map((g) => ({ g, mode: stricter(g.permissionMode, g.tool.defaultPermission) }))
    .filter(
      ({ g, mode }) =>
        mode !== 'BLOCKED' && g.tool.enabled && g.tool.available && g.connection.enabled,
    );

  let body: React.ReactNode;
  switch (tab) {
    case 'chat': {
      const conversation =
        query.c === 'new'
          ? undefined
          : query.c
            ? await findConversation(db, ctx, query.c)
            : await latestConversation(db, ctx, id);
      const messages =
        conversation && conversation.agentId === id
          ? await listMessages(db, ctx, conversation.id, 100)
          : [];
      const runIds = [
        ...new Set(messages.map((m) => m.runId).filter((r): r is string => Boolean(r))),
      ];
      const [runs, calls, approvals] = await Promise.all([
        runIds.length ? listRunsWithDetails(db, ctx, { agentId: id, limit: 200 }) : [],
        listToolCallsForRuns(db, ctx, runIds),
        listApprovalRequests(db, ctx, { runIds }),
      ]);
      const items: ChatItem[] = [];
      for (const message of messages) {
        if (message.role === 'user') {
          items.push({ kind: 'user', id: message.id, content: message.content });
          const run = runs.find((r) => r.id === message.runId);
          if (run) {
            items.push({
              kind: 'run',
              id: run.id,
              status: run.status,
              error: run.error,
              toolCalls: calls
                .filter((c) => c.runId === run.id)
                .map((c) => ({ id: c.id, name: c.toolName, status: c.status })),
              approvals: approvals.filter((a) => a.runId === run.id).map(toApprovalView),
            });
          }
        } else {
          items.push({ kind: 'assistant', id: message.id, content: message.content });
        }
      }
      body = (
        <ChatPanel
          agentId={id}
          agentName={agent.name}
          avatar={agent.avatar}
          conversationId={conversation && conversation.agentId === id ? conversation.id : null}
          items={items}
          canChat={canRun && ['active', 'configured'].includes(agent.status)}
          tools={offered.map(({ g, mode }) => ({
            name: g.tool.name,
            server: g.connection.name,
            mode,
          }))}
        />
      );
      break;
    }
    case 'tasks':
      body = (
        <Card>
          <CardContent className="pt-5">
            <TaskTable tasks={tasks} showAgent={false} />
          </CardContent>
        </Card>
      );
      break;
    case 'tools':
      body = (
        <Card>
          <CardContent className="pt-5">
            <div className="mb-3 flex justify-end">
              <Button variant="secondary" size="sm" asChild>
                <Link href={stepHref(id, 'tools')}>
                  <Pencil aria-hidden />
                  {t('agentTools.manage')}
                </Link>
              </Button>
            </div>
            {grants.length === 0 ? (
              <p className="text-sm text-text-muted">{t('agentTools.none')}</p>
            ) : (
              <ul className="divide-y divide-border">
                {grants.map((grant) => {
                  // What actually applies: the stricter of the agent's mode and the workspace default.
                  const mode = stricter(grant.permissionMode, grant.tool.defaultPermission);
                  return (
                    <li
                      key={grant.tool.id}
                      className="flex items-center justify-between gap-3 py-2 text-sm"
                    >
                      <span className="min-w-0">
                        <span className="font-mono text-xs">{grant.tool.name}</span>
                        <span className="ml-2 text-text-muted">{grant.connection.name}</span>
                      </span>
                      <StatusBadge
                        tone={
                          mode === 'AUTO_ALLOW'
                            ? 'success'
                            : mode === 'APPROVAL_REQUIRED'
                              ? 'warning'
                              : 'danger'
                        }
                      >
                        {t(`permissions.${mode}`)}
                      </StatusBadge>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      );
      break;
    case 'files':
    case 'memory':
      body = (
        <Card>
          <EmptyState
            title={t('workspace.comingSoon', { milestone: 'v0.3' })}
            description={t(`pages.${tab === 'files' ? 'knowledge' : 'memory'}.description`)}
          />
        </Card>
      );
      break;
    case 'logs':
      body = (
        <Card>
          <CardContent className="pt-5">
            <RunLog runs={await listRunsWithDetails(db, ctx, { agentId: id, limit: 30 })} />
          </CardContent>
        </Card>
      );
      break;
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <AgentAvatar avatar={agent.avatar} size="md" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight">{agent.name}</h1>
              <StatusBadge tone={presenceTone}>{t(`workspace.presence.${presence}`)}</StatusBadge>
            </div>
            <p className="text-sm text-text-muted">
              {agent.role || t(`agents.types.${agent.agentType}`)}
              {brain && <span className="ml-2 font-mono text-xs">{brain.primary.model}</span>}
              <span className="ml-2">
                ·{' '}
                {t('workspace.costToday', {
                  cost: format.number(spentToday, {
                    style: 'currency',
                    currency: 'USD',
                    maximumFractionDigits: 4,
                  }),
                })}
              </span>
            </p>
          </div>
        </div>
        <SettingsDrawer defaultOpen={query.settings === '1'}>
          <AgentOverview
            agent={agent}
            parent={parent}
            children={children}
            brain={brain}
            connectionNames={connectionNames}
            canRun={canRun}
          />
        </SettingsDrawer>
      </div>

      <nav
        aria-label={t('workspace.tabsLabel')}
        className="mb-4 flex gap-1 overflow-x-auto border-b border-border"
      >
        {TABS.map((name) => (
          <Link
            key={name}
            href={name === 'chat' ? `/agents/${id}` : `/agents/${id}?tab=${name}`}
            aria-current={tab === name ? 'page' : undefined}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap',
              tab === name
                ? 'border-primary text-text'
                : 'border-transparent text-text-muted hover:text-text',
            )}
          >
            {t(`workspace.tabs.${name}`)}
            {name === 'tasks' && <span className="ml-1 text-text-subtle">({tasks.length})</span>}
          </Link>
        ))}
      </nav>
      {body}
    </>
  );
}
