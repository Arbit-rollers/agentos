'use client';

import { Loader2, Plus, Search, Send } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef, useState } from 'react';
import { Button, Input, StatusBadge, Textarea, cn, type StatusTone } from '@agentos/ui';
import { sendMessageAction, type ChatFormState } from '@/app/(app)/agents/actions';
import { ApprovalCard, type ApprovalView } from '@/components/approvals/approval-card';
import { useErrorText } from '@/components/error-text';
import { Markdown } from '@/components/markdown';
import { AgentAvatar } from '../agent-avatar';
import { AnswerFeedback, type AnswerFeedbackView } from './answer-feedback';

export type ChatItem =
  | { kind: 'user'; id: string; content: string }
  | { kind: 'assistant'; id: string; content: string; feedback?: AnswerFeedbackView }
  | {
      kind: 'run';
      id: string;
      status: string;
      error: string | null;
      toolCalls: { id: string; name: string; status: string }[];
      approvals: ApprovalView[];
    };

export type OfferedTool = { name: string; server: string; mode: string };

const TOOL_TONE: Record<string, StatusTone> = {
  succeeded: 'success',
  approved: 'info',
  approval_required: 'warning',
  rejected: 'danger',
  blocked: 'danger',
  failed: 'danger',
};

type Live = { runId: string; status: string; note?: string };

/** Agent Workspace → Chat (PRD §20, Screen 7). */
export function ChatPanel({
  agentId,
  agentName,
  avatar,
  conversationId,
  items,
  tools,
  canChat,
}: {
  agentId: string;
  agentName: string;
  avatar: string;
  conversationId: string | null;
  items: ChatItem[];
  tools: OfferedTool[];
  canChat: boolean;
}) {
  const t = useTranslations();
  const errorText = useErrorText();
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [toolQuery, setToolQuery] = useState('');
  const [state, action, pending] = useActionState<ChatFormState, FormData>(
    sendMessageAction.bind(null, agentId, conversationId),
    {},
  );
  const [live, setLive] = useState<Live | null>(null);
  // Runs still in progress when the page rendered get a live view too.
  const unsettled = items.find(
    (i) => i.kind === 'run' && (i.status === 'queued' || i.status === 'running'),
  );
  const followRunId = state.runId ?? (unsettled?.id || undefined);

  useEffect(() => {
    if (state.runId) formRef.current?.reset();
    if (state.conversationId && state.conversationId !== conversationId) {
      router.replace(`/agents/${agentId}?c=${state.conversationId}`);
    }
  }, [state.runId, state.sentAt, state.conversationId, conversationId, agentId, router]);

  useEffect(() => {
    if (!followRunId) return;
    const source = new EventSource(`/api/runs/${followRunId}/events`);
    source.addEventListener('update', (message) => {
      const data = JSON.parse((message as MessageEvent).data) as {
        status: string;
        events: { type: string; payload: { tool?: string } }[];
      };
      const toolEvent = [...data.events].reverse().find((e) => e.type === 'tool.call');
      setLive((current) => ({
        runId: followRunId,
        status: data.status,
        note:
          toolEvent?.payload.tool ?? (current?.runId === followRunId ? current.note : undefined),
      }));
    });
    source.addEventListener('done', () => {
      source.close();
      setLive(null);
      router.refresh();
    });
    // A dropped connection reconnects on its own (the server re-sends the current status and
    // `done` if the run has settled). Only a permanently closed stream falls back to a refresh.
    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) {
        setLive(null);
        router.refresh();
      }
    };
    return () => source.close();
  }, [followRunId, router]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [items.length, live?.status]);

  const shownTools = tools.filter((tool) =>
    `${tool.name} ${tool.server}`.toLowerCase().includes(toolQuery.toLowerCase()),
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="flex min-h-[32rem] flex-col rounded-(--radius-card) border border-border bg-surface">
        <div className="flex items-center justify-end border-b border-border px-4 py-2">
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/agents/${agentId}?c=new`}>
              <Plus aria-hidden />
              {t('workspace.newChat')}
            </Link>
          </Button>
        </div>
        <ol className="flex-1 space-y-4 overflow-y-auto p-4" aria-live="polite">
          {items.length === 0 && (
            <li className="py-12 text-center text-sm text-text-muted">
              {t('workspace.emptyChat')}
            </li>
          )}
          {items.map((item) =>
            item.kind === 'user' ? (
              <li key={item.id} className="flex justify-end">
                <p className="max-w-[80%] rounded-2xl rounded-br-sm bg-primary px-4 py-2 text-sm whitespace-pre-wrap text-primary-fg">
                  {item.content}
                </p>
              </li>
            ) : item.kind === 'assistant' ? (
              <li key={item.id} className="flex gap-3">
                <AgentAvatar avatar={avatar} size="sm" />
                <div className="min-w-0 flex-1" data-testid="assistant-message">
                  <p className="mb-1 text-xs text-text-muted">{agentName}</p>
                  <Markdown>{item.content}</Markdown>
                  {conversationId && (
                    <AnswerFeedback
                      agentId={agentId}
                      conversationId={conversationId}
                      messageId={item.id}
                      latest={item.feedback}
                    />
                  )}
                </div>
              </li>
            ) : (
              <li key={item.id} className="space-y-2 pl-11" data-run={item.id}>
                {item.toolCalls.length > 0 && (
                  <ul className="flex flex-wrap gap-1.5">
                    {item.toolCalls.map((call) => (
                      <li key={call.id}>
                        <StatusBadge tone={TOOL_TONE[call.status] ?? 'neutral'}>
                          <span className="font-mono">{call.name}</span> ·{' '}
                          {t(`workspace.toolStatus.${call.status as 'failed'}`)}
                        </StatusBadge>
                      </li>
                    ))}
                  </ul>
                )}
                {item.approvals
                  .filter((a) => a.status === 'pending')
                  .map((approval) => (
                    <ApprovalCard key={approval.id} approval={approval} compact />
                  ))}
                {item.status === 'failed' && (
                  <p role="alert" className="text-sm text-danger">
                    {t('workspace.failed', {
                      reason: errorText(item.error ?? 'internal_error') ?? '',
                    })}
                  </p>
                )}
              </li>
            ),
          )}
          {live && live.status !== 'waiting_approval' && (
            <li className="flex items-center gap-2 pl-11 text-sm text-text-muted" role="status">
              <Loader2 aria-hidden className="size-4 animate-spin" />
              {live.note ? <span className="font-mono">{live.note}</span> : t('workspace.thinking')}
            </li>
          )}
          <div ref={endRef} />
        </ol>
        <form ref={formRef} action={action} className="border-t border-border p-3">
          {!canChat && <p className="mb-2 text-sm text-text-muted">{t('workspace.notRunnable')}</p>}
          {state.error && (
            <p role="alert" className="mb-2 text-sm text-danger">
              {errorText(state.error)}
            </p>
          )}
          <div className="flex items-end gap-2">
            <Textarea
              name="message"
              aria-label={t('workspace.placeholder')}
              placeholder={t('workspace.placeholder')}
              rows={2}
              maxLength={20000}
              disabled={!canChat}
              className="min-h-0 flex-1"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  formRef.current?.requestSubmit();
                }
              }}
            />
            <Button type="submit" disabled={!canChat || pending}>
              <Send aria-hidden />
              {pending ? t('workspace.sending') : t('workspace.send')}
            </Button>
          </div>
        </form>
      </div>

      <aside
        className={cn('self-start rounded-(--radius-card) border border-border bg-surface p-4')}
        aria-label={t('workspace.availableTools')}
      >
        <h2 className="mb-3 font-semibold">{t('workspace.availableTools')}</h2>
        <div className="relative mb-3">
          <Search aria-hidden className="absolute top-2.5 left-3 size-4 text-text-subtle" />
          <Input
            aria-label={t('workspace.searchTools')}
            placeholder={t('workspace.searchTools')}
            value={toolQuery}
            onChange={(e) => setToolQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        {tools.length === 0 ? (
          <p className="text-sm text-text-muted">{t('workspace.noTools')}</p>
        ) : (
          <ul className="space-y-1.5">
            {shownTools.map((tool) => (
              <li
                key={`${tool.server}/${tool.name}`}
                className="flex items-center justify-between gap-2 rounded-lg bg-surface-2 px-2.5 py-1.5 text-sm"
              >
                <span className="min-w-0">
                  <span className="block truncate font-mono text-xs">{tool.name}</span>
                  <span className="block truncate text-xs text-text-subtle">{tool.server}</span>
                </span>
                <span
                  className={cn(
                    'h-2 w-2 shrink-0 rounded-full',
                    tool.mode === 'AUTO_ALLOW' ? 'bg-success' : 'bg-warning',
                  )}
                  title={t(`permissions.${tool.mode as 'AUTO_ALLOW'}`)}
                />
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}
