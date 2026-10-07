'use client';

import { MessageSquare, RotateCcw, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import type { FeedbackAction, FeedbackSuggestion } from '@agentos/db';
import { Button, Textarea, cn } from '@agentos/ui';
import { submitFeedbackAction } from '@/app/(app)/agents/actions';
import { useErrorText } from '@/components/error-text';
import { SuggestionItems } from '@/components/memory/suggestion-list';

export type AnswerFeedbackView = {
  id: string;
  action: FeedbackAction;
  suggestions: FeedbackSuggestion[];
};

const BUTTONS = [
  { action: 'approve', icon: ThumbsUp },
  { action: 'reject', icon: ThumbsDown },
  { action: 'revise', icon: RotateCcw },
  { action: 'feedback', icon: MessageSquare },
] as const;

/** Approve / Reject / Revise / Feedback under an agent's answer (PRD §13). */
export function AnswerFeedback({
  agentId,
  conversationId,
  messageId,
  latest,
}: {
  agentId: string;
  conversationId: string;
  messageId: string;
  latest?: AnswerFeedbackView;
}) {
  const t = useTranslations('feedback');
  const errorText = useErrorText();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [composing, setComposing] = useState<Exclude<FeedbackAction, 'approve'> | null>(null);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string>();

  const send = (action: FeedbackAction, text = '') =>
    start(async () => {
      const result = await submitFeedbackAction({
        agentId,
        conversationId,
        messageId,
        action,
        comment: text,
      });
      setError(result.error ?? result.fieldErrors?.comment?.[0]);
      if (result.ok) {
        setComposing(null);
        setComment('');
        router.refresh();
      }
    });

  return (
    <div className="mt-2 space-y-2" data-testid="answer-feedback">
      <div role="group" aria-label={t('label')} className="flex flex-wrap gap-1">
        {BUTTONS.map(({ action, icon: Icon }) => (
          <Button
            key={action}
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            aria-pressed={latest?.action === action || composing === action}
            className={cn(
              'h-7 px-2 text-xs text-text-muted',
              (latest?.action === action || composing === action) && 'text-primary',
            )}
            onClick={() => (action === 'approve' ? send('approve') : setComposing(action))}
          >
            <Icon aria-hidden className="size-3.5" />
            {t(action)}
          </Button>
        ))}
      </div>
      {composing && (
        <form
          className="space-y-2 rounded-lg border border-border bg-surface-2 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            send(composing, comment);
          }}
        >
          <label htmlFor={`feedback-${messageId}`} className="text-xs text-text-muted">
            {t('comment')}
          </label>
          <Textarea
            id={`feedback-${messageId}`}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder={t('placeholder')}
            rows={2}
            maxLength={1000}
            autoFocus
          />
          <div className="flex gap-1.5">
            <Button type="submit" size="sm" disabled={pending}>
              {t('send')}
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => setComposing(null)}>
              {t('cancel')}
            </Button>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="text-xs text-danger">
          {errorText(error)}
        </p>
      )}
      {latest && !composing && (
        <div className="text-xs text-text-muted">
          {latest.action === 'approve' ? (
            <p>{t('approved')}</p>
          ) : latest.suggestions.length > 0 ? (
            <div className="space-y-1.5 rounded-lg border border-border p-3">
              <p className="font-medium text-text">{t('suggestions')}</p>
              <SuggestionItems feedbackId={latest.id} suggestions={latest.suggestions} />
            </div>
          ) : (
            <p>{t('recorded')}</p>
          )}
        </div>
      )}
    </div>
  );
}
