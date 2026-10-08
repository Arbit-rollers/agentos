'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { Button } from '@agentos/ui';
import {
  cancelWorkflowRunAction,
  deleteWorkflowAction,
  restoreVersionAction,
} from '@/app/(app)/workflows/actions';

export function CancelRunButton({ workflowId, runId }: { workflowId: string; runId: string }) {
  const t = useTranslations('workflows');
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={pending}
      onClick={(e) => {
        e.preventDefault();
        start(async () => {
          await cancelWorkflowRunAction(workflowId, runId);
          router.refresh();
        });
      }}
    >
      {t('cancelRun')}
    </Button>
  );
}

export function RestoreVersionButton({
  workflowId,
  versionId,
  version,
}: {
  workflowId: string;
  versionId: string;
  version: number;
}) {
  const t = useTranslations('workflows');
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={pending}
      aria-label={`${t('restore')}: ${t('version', { version })}`}
      onClick={() =>
        start(async () => {
          await restoreVersionAction(workflowId, versionId);
          // A full load: the builder starts from the restored graph.
          window.location.assign(`/workflows/${workflowId}`);
        })
      }
    >
      {t('restore')}
    </Button>
  );
}

export function DeleteWorkflowButton({ id }: { id: string }) {
  const t = useTranslations('workflows');
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="danger"
      disabled={pending}
      onClick={() => start(async () => void (await deleteWorkflowAction(id)))}
    >
      {t('delete')}
    </Button>
  );
}
