import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Card, CardContent, CardHeader, CardTitle } from '@agentos/ui';
import { findUserById } from '@agentos/db';
import { ProfileForm } from '@/components/settings/profile-form';
import { getServices } from '@/server/services';
import { requireSession } from '@/server/session';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('settings'))('title') };
}

export default async function SettingsPage() {
  const { user, ctx } = await requireSession();
  const profile = await findUserById(getServices().db, ctx.userId);
  const zones = Intl.supportedValuesOf('timeZone');
  const t = await getTranslations('settings');

  return (
    <>
      <Card>
        <CardHeader className="flex-col items-start gap-1">
          <CardTitle>{t('profile')}</CardTitle>
          <p className="text-sm text-text-muted">{t('profileDescription')}</p>
        </CardHeader>
        <CardContent>
          <ProfileForm
            displayName={user.displayName}
            email={user.email}
            locale={user.locale}
            timezone={profile?.timezone ?? 'UTC'}
            timezones={zones.includes('UTC') ? zones : ['UTC', ...zones]}
          />
        </CardContent>
      </Card>
    </>
  );
}
