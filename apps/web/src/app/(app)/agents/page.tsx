import { Bot, Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { countAgentsByStatus, listAgents } from '@agentos/db';
import { Button, Card, EmptyState, PageHeader } from '@agentos/ui';
import { AgentCard } from '@/components/agents/agent-card';
import { AgentFilters } from '@/components/agents/agent-filters';
import { AGENT_FILTERS, type AgentFilter } from '@/components/agents/filters';
import { requireSession } from '@/server/session';
import { getServices } from '@/server/services';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('agents'))('title') };
}

export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { ctx } = await requireSession();
  const db = getServices().db;
  const t = await getTranslations('agents');
  const requested = (await searchParams).status;
  const filter: AgentFilter = AGENT_FILTERS.includes(requested as AgentFilter)
    ? (requested as AgentFilter)
    : 'all';

  const [counts, all] = await Promise.all([countAgentsByStatus(db, ctx), listAgents(db, ctx)]);
  // "All" means everything still in use; archived agents have their own tab.
  const shown = all.filter((agent) =>
    filter === 'all' ? agent.status !== 'archived' : agent.status === filter,
  );
  const names = new Map(all.map((agent) => [agent.id, agent.name]));

  const newAgent = (
    <Button asChild>
      <Link href="/agents/new">
        <Plus aria-hidden />
        {t('newAgent')}
      </Link>
    </Button>
  );

  return (
    <>
      <PageHeader title={t('title')} description={t('subtitle')} actions={newAgent} />
      <div className="mb-5">
        <AgentFilters value={filter} counts={{ ...counts, all: all.length - counts.archived }} />
      </div>
      {shown.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Bot />}
            title={t('emptyTitle')}
            description={t('emptyDescription')}
            action={filter === 'all' ? newAgent : undefined}
          />
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((agent) => (
            <li key={agent.id} className="flex">
              <AgentCard
                agent={agent}
                parentName={agent.parentAgentId ? names.get(agent.parentAgentId) : undefined}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
