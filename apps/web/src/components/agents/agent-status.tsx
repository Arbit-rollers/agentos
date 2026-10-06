import { useTranslations } from 'next-intl';
import type { AgentStatus } from '@agentos/db';
import { StatusBadge, type StatusTone } from '@agentos/ui';

const TONE: Record<AgentStatus, StatusTone> = {
  draft: 'neutral',
  configured: 'info',
  active: 'success',
  paused: 'warning',
  archived: 'neutral',
};

export function AgentStatusBadge({ status }: { status: AgentStatus }) {
  const t = useTranslations('agents.status');
  return <StatusBadge tone={TONE[status]}>{t(status)}</StatusBadge>;
}
