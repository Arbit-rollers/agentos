'use client';

import { Pin } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import type { MemoryType } from '@agentos/db';
import { Button, Select, StatusBadge, Textarea, type StatusTone } from '@agentos/ui';
import {
  deleteMemoryAction,
  editMemoryAction,
  setMemoryFlagsAction,
} from '@/app/(app)/memory/actions';
import { useErrorText } from '@/components/error-text';

export type MemoryView = {
  id: string;
  type: MemoryType;
  content: string;
  pinned: boolean;
  status: 'active' | 'disabled' | 'suggested';
  agentId: string | null;
  agentName: string | null;
  provenance: { kind?: string; taskId?: string };
  /** Pre-formatted on the server. */
  lastUsed: string | null;
};

const TONE: Record<MemoryType, StatusTone> = {
  procedural: 'info',
  semantic: 'success',
  episodic: 'neutral',
};
const TYPES = ['procedural', 'semantic', 'episodic'] as const;

/** One memory with inspect / edit / pin / disable / delete (PRD §12). */
export function MemoryItem({ memory }: { memory: MemoryView }) {
  const t = useTranslations('memoryPage');
  const errorText = useErrorText();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(memory.content);
  const [type, setType] = useState<MemoryType>(memory.type);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();
  const run = (
    fn: () => Promise<{
      ok?: boolean;
      error?: string;
      fieldErrors?: Record<string, string[] | undefined>;
    }>,
    after?: () => void,
  ) =>
    start(async () => {
      const result = await fn();
      setError(result.error ?? result.fieldErrors?.content?.[0]);
      if (result.ok) after?.();
      router.refresh();
    });
  const provenance = memory.provenance.kind as 'manual' | 'feedback' | 'run' | undefined;

  return (
    <li className="space-y-2 py-3" data-memory={memory.content} aria-label={memory.content}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <StatusBadge tone={TONE[memory.type]}>{t(`types.${memory.type}`)}</StatusBadge>
        {memory.pinned && (
          <span className="flex items-center gap-1 text-primary">
            <Pin className="size-3" aria-hidden />
            {t('pinned')}
          </span>
        )}
        {memory.status === 'disabled' && <StatusBadge tone="warning">{t('disabled')}</StatusBadge>}
        <span className="text-text-muted">
          {memory.agentId ? (
            <Link href={`/agents/${memory.agentId}?tab=memory`} className="hover:text-primary">
              {memory.agentName}
            </Link>
          ) : (
            t('allAgents')
          )}
          {provenance && (
            <>
              {' · '}
              {provenance === 'run' && memory.provenance.taskId ? (
                <Link href={`/tasks/${memory.provenance.taskId}`} className="hover:text-primary">
                  {t('provenance.run')}
                </Link>
              ) : (
                t(`provenance.${provenance}`)
              )}
            </>
          )}
          {' · '}
          {memory.lastUsed ? t('lastUsed', { time: memory.lastUsed }) : t('neverUsed')}
        </span>
      </div>
      {editing ? (
        <div className="space-y-2">
          <Select
            aria-label={t('type')}
            value={type}
            onValueChange={(value) => setType(value as MemoryType)}
            options={TYPES.map((value) => ({ value, label: t(`types.${value}`) }))}
            className="max-w-48"
          />
          <Textarea
            aria-label={t('content')}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            rows={3}
            maxLength={2000}
          />
          <div className="flex gap-1.5">
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                run(
                  () => editMemoryAction(memory.id, { content, type }),
                  () => setEditing(false),
                )
              }
            >
              {t('save')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() => setEditing(false)}
            >
              {t('cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <p
          className={
            memory.status === 'disabled' ? 'text-sm text-text-muted line-through' : 'text-sm'
          }
        >
          {memory.content}
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-danger">
          {errorText(error)}
        </p>
      )}
      {!editing && (
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => setEditing(true)}>
            {t('edit')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => run(() => setMemoryFlagsAction(memory.id, { pinned: !memory.pinned }))}
          >
            {memory.pinned ? t('unpin') : t('pin')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() =>
              run(() => setMemoryFlagsAction(memory.id, { enabled: memory.status !== 'active' }))
            }
          >
            {memory.status === 'active' ? t('disable') : t('enable')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-danger"
            disabled={pending}
            onClick={() =>
              confirming ? run(() => deleteMemoryAction(memory.id)) : setConfirming(true)
            }
          >
            {confirming ? t('confirmDelete') : t('delete')}
          </Button>
        </div>
      )}
    </li>
  );
}
