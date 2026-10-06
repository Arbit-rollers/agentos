import { ArrowLeft, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Button } from '@agentos/ui';

/** Back link + primary action at the bottom of a step. */
export function WizardNav({
  backHref,
  nextHref,
  pending,
  primary,
}: {
  backHref?: string;
  /** Plain link to the next step (steps without a form). */
  nextHref?: string;
  pending?: boolean;
  /** Custom primary control; defaults to a "Next" submit button. */
  primary?: ReactNode;
}) {
  const t = useTranslations('wizard');
  return (
    <div className="mt-6 flex items-center justify-between gap-3 border-t border-border pt-5">
      {backHref ? (
        <Button variant="secondary" asChild>
          <Link href={backHref}>
            <ArrowLeft aria-hidden />
            {t('back')}
          </Link>
        </Button>
      ) : (
        <span />
      )}
      {primary ??
        (nextHref ? (
          <Button asChild>
            <Link href={nextHref}>
              {t('next')}
              <ArrowRight aria-hidden />
            </Link>
          </Button>
        ) : (
          <Button type="submit" disabled={pending}>
            {pending ? t('saving') : t('next')}
            {!pending && <ArrowRight aria-hidden />}
          </Button>
        ))}
    </div>
  );
}
