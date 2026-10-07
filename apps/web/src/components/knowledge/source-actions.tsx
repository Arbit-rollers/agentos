'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@agentos/ui';
import { deleteKnowledgeAction, reindexKnowledgeAction } from '@/app/(app)/knowledge/actions';

export function SourceActions({
  id,
  name,
  type,
  busy,
}: {
  id: string;
  name: string;
  type: string;
  busy: boolean;
}) {
  const t = useTranslations('knowledge');
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const run = (fn: () => Promise<unknown>) =>
    start(async () => {
      await fn();
      router.refresh();
    });
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      <Button
        size="sm"
        variant="secondary"
        disabled={pending || busy}
        aria-label={`${t('reindex')}: ${name}`}
        onClick={() => run(() => reindexKnowledgeAction(id, type === 'url'))}
      >
        {type === 'url' ? t('refetch') : t('reindex')}
      </Button>
      <Button
        size="sm"
        variant="danger"
        disabled={pending}
        aria-label={`${confirming ? t('confirmDelete') : t('delete')}: ${name}`}
        onClick={() => (confirming ? run(() => deleteKnowledgeAction(id)) : setConfirming(true))}
      >
        {confirming ? t('confirmDelete') : t('delete')}
      </Button>
    </div>
  );
}
