import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { Agent } from '@agentos/db';
import { AgentAvatar } from './agent-avatar';
import { AgentStatusBadge } from './agent-status';

export function AgentCard({ agent, parentName }: { agent: Agent; parentName?: string }) {
  const t = useTranslations('agents');
  return (
    <Link
      href={`/agents/${agent.id}`}
      className="flex w-full flex-col gap-3 rounded-(--radius-card) border border-border bg-surface p-4 transition-colors hover:border-border-strong hover:bg-surface-2/60"
    >
      <div className="flex items-start gap-3">
        <AgentAvatar avatar={agent.avatar} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{agent.name}</p>
          <p className="truncate text-sm text-text-muted">
            {agent.role || t(`types.${agent.agentType}`)}
          </p>
        </div>
        <AgentStatusBadge status={agent.status} />
      </div>
      <p className="line-clamp-2 text-sm text-text-muted">{agent.description}</p>
      <div className="mt-auto flex flex-wrap items-center gap-1.5 text-xs text-text-subtle">
        <span className="rounded-md bg-surface-2 px-1.5 py-0.5">
          {t(`types.${agent.agentType}`)}
        </span>
        {parentName && (
          <span className="truncate">
            {t('reportsTo')}: {parentName}
          </span>
        )}
      </div>
    </Link>
  );
}
