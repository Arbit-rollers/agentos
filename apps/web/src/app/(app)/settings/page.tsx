import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Card, CardContent, CardHeader, CardTitle, PageHeader } from '@agentos/ui';
import { ProfileForm } from '@/components/settings/profile-form';
import { requireSession } from '@/server/session';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('settings'))('title') };
}

export default async function SettingsPage() {
  const { user } = await requireSession();
  const t = await getTranslations('settings');

  return (
    <>
      <PageHeader title={t('title')} description={t('subtitle')} />
      <Card>
        <CardHeader className="flex-col items-start gap-1">
          <CardTitle>{t('profile')}</CardTitle>
          <p className="text-sm text-text-muted">{t('profileDescription')}</p>
        </CardHeader>
        <CardContent>
          <ProfileForm displayName={user.displayName} email={user.email} locale={user.locale} />
        </CardContent>
      </Card>
    </>
  );
}
