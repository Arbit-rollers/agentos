import { Construction } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Card, EmptyState, PageHeader } from '@agentos/ui';
import type { NavKey } from '@/components/shell/nav-items';

// Sections that are in the navigation but not built yet, with the roadmap milestone that
// delivers each (docs/ROADMAP.md). A real page at the same path replaces its entry here.
const UPCOMING = {
  agents: { nav: 'agents', milestone: 'M3' },
  mcp: { nav: 'mcpHub', milestone: 'M5' },
  tasks: { nav: 'tasks', milestone: 'v0.2' },
  workflows: { nav: 'workflows', milestone: 'v0.5' },
  knowledge: { nav: 'knowledge', milestone: 'v0.3' },
  memory: { nav: 'memory', milestone: 'v0.3' },
  approvals: { nav: 'approvals', milestone: 'M6' },
  schedules: { nav: 'schedules', milestone: 'v0.2' },
  logs: { nav: 'logs', milestone: 'M6' },
  analytics: { nav: 'analytics', milestone: 'v0.6' },
} as const satisfies Record<
  string,
  { nav: Exclude<NavKey, 'dashboard' | 'settings'>; milestone: string }
>;

type Params = { params: Promise<{ section: string }> };

function lookup(section: string) {
  return Object.hasOwn(UPCOMING, section) ? UPCOMING[section as keyof typeof UPCOMING] : undefined;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const entry = lookup((await params).section);
  return entry ? { title: (await getTranslations('nav'))(entry.nav) } : {};
}

export default async function UpcomingSectionPage({ params }: Params) {
  const entry = lookup((await params).section);
  if (!entry) notFound();
  const t = await getTranslations();

  return (
    <>
      <PageHeader title={t(`nav.${entry.nav}`)} description={t(`pages.${entry.nav}.description`)} />
      <Card>
        <EmptyState
          icon={<Construction />}
          title={t('common.comingIn', { milestone: entry.milestone })}
        />
      </Card>
    </>
  );
}
