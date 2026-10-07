import { getTranslations } from 'next-intl/server';

/** Shown to members where only owners and admins can make changes. */
export async function AdminOnlyNote() {
  const t = await getTranslations('team');
  return (
    <p
      className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-text-muted"
      data-testid="admin-only"
    >
      {t('adminOnly')}
    </p>
  );
}
