'use client';

import { useTranslations } from 'next-intl';

/** Translates an error code from the server (validation code or AppError code). */
export function useErrorText() {
  const t = useTranslations('errors');
  return (code: string | undefined) => {
    if (!code) return undefined;
    return t.has(code as never) ? t(code as never) : t('generic');
  };
}
