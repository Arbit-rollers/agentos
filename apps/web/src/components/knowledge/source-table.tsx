import { getFormatter, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import type { KnowledgeSource } from '@agentos/db';
import {
  StatusBadge,
  Table,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  type StatusTone,
} from '@agentos/ui';
import { AutoRefresh } from '@/components/auto-refresh';
import { SourceActions } from './source-actions';

const TONE: Record<KnowledgeSource['status'], StatusTone> = {
  pending: 'neutral',
  processing: 'info',
  ready: 'success',
  failed: 'danger',
};

/** Knowledge sources with indexing status (PRD §11). Refreshes while any is indexing. */
export async function SourceTable({
  sources,
  showScope = true,
}: {
  sources: (KnowledgeSource & { agentName: string | null })[];
  showScope?: boolean;
}) {
  const t = await getTranslations();
  const format = await getFormatter();
  const busy = sources.some((s) => s.status === 'pending' || s.status === 'processing');
  return (
    <>
      <AutoRefresh active={busy} />
      <Table>
        <TableHead>
          <tr>
            <TableHeaderCell>{t('knowledge.source')}</TableHeaderCell>
            {showScope && <TableHeaderCell>{t('knowledge.scope')}</TableHeaderCell>}
            <TableHeaderCell>{t('tasksPage.state')}</TableHeaderCell>
            <TableHeaderCell>{t('knowledge.added')}</TableHeaderCell>
            <TableHeaderCell />
          </tr>
        </TableHead>
        <tbody>
          {sources.map((source) => {
            const indexing = source.status === 'pending' || source.status === 'processing';
            return (
              <TableRow key={source.id} data-source={source.name}>
                <TableCell>
                  <p className="font-medium">{source.name}</p>
                  <p className="truncate text-xs text-text-muted">
                    {t(`knowledge.types.${source.type}`)}
                    {source.type === 'url' && source.sourceRef && (
                      <>
                        {' · '}
                        <a
                          href={source.sourceRef}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="hover:text-primary"
                        >
                          {new URL(source.sourceRef).hostname}
                        </a>
                      </>
                    )}
                    {source.status === 'ready' &&
                      ` · ${t('knowledge.excerpts', { count: source.chunkCount })}`}
                  </p>
                </TableCell>
                {showScope && (
                  <TableCell className="text-sm">
                    {source.scope === 'agent' && source.agentId ? (
                      <Link
                        href={`/agents/${source.agentId}?tab=files`}
                        className="hover:text-primary"
                      >
                        {source.agentName}
                      </Link>
                    ) : (
                      t(`knowledge.scopes.${source.scope}`)
                    )}
                  </TableCell>
                )}
                <TableCell>
                  <StatusBadge tone={TONE[source.status]}>
                    {t(`knowledge.status.${source.status}`)}
                  </StatusBadge>
                  {source.error && (
                    <p className="mt-1 max-w-64 text-xs text-danger">
                      {t.has(`errors.${source.error}` as never)
                        ? t(`errors.${source.error}` as never)
                        : source.error}
                    </p>
                  )}
                  {source.status === 'ready' && !source.embeddingModel && !source.error && (
                    <p className="mt-1 text-xs text-text-subtle">{t('knowledge.keywordOnly')}</p>
                  )}
                </TableCell>
                <TableCell className="text-sm text-text-muted">
                  {format.dateTime(source.createdAt, { dateStyle: 'medium' })}
                </TableCell>
                <TableCell>
                  <SourceActions
                    id={source.id}
                    name={source.name}
                    type={source.type}
                    busy={indexing}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </tbody>
      </Table>
    </>
  );
}
