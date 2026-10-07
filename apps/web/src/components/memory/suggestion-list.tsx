'use client';

import { Check, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import type { FeedbackSuggestion } from '@agentos/db';
import { Button, StatusBadge } from '@agentos/ui';
import { decideSuggestionAction } from '@/app/(app)/memory/actions';

/** One suggestion's text: a new rule, or a personality trait change. */
export function useSuggestionText() {
  const t = useTranslations();
  return (s: FeedbackSuggestion) =>
    s.kind === 'memory'
      ? t('memoryPage.ruleSuggestion', { content: s.content })
      : t('memoryPage.traitSuggestion', {
          trait: t(`traits.${s.trait}.name` as never),
          from: s.from,
          to: s.to,
        });
}

/** Accept / Dismiss for each suggestion made from one piece of feedback (PRD §13). */
export function SuggestionItems({
  feedbackId,
  suggestions,
  onDecided,
}: {
  feedbackId: string;
  suggestions: FeedbackSuggestion[];
  onDecided?: (index: number, accepted: boolean) => void;
}) {
  const t = useTranslations();
  const text = useSuggestionText();
  const router = useRouter();
  const [pending, start] = useTransition();
  const decide = (index: number, accept: boolean) =>
    start(async () => {
      const result = await decideSuggestionAction(feedbackId, index, accept);
      if (result.ok) onDecided?.(index, accept);
      router.refresh();
    });
  return (
    <ul className="space-y-2">
      {suggestions.map((s, index) => (
        <li
          key={index}
          className="flex flex-wrap items-center justify-between gap-2 text-sm"
          data-suggestion={s.kind}
        >
          <span className="min-w-0">{text(s)}</span>
          {s.state === 'pending' ? (
            <span className="flex gap-1.5">
              <Button size="sm" disabled={pending} onClick={() => decide(index, true)}>
                <Check aria-hidden />
                {t('memoryPage.accept')}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={pending}
                onClick={() => decide(index, false)}
              >
                <X aria-hidden />
                {t('memoryPage.dismiss')}
              </Button>
            </span>
          ) : (
            <StatusBadge tone={s.state === 'accepted' ? 'success' : 'neutral'}>
              {t(`feedback.${s.state}`)}
            </StatusBadge>
          )}
        </li>
      ))}
    </ul>
  );
}
