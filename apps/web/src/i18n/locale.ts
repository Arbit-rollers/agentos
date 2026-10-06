import 'server-only';
import { cookies, headers } from 'next/headers';
import { isLocale, matchLocale, type Locale } from '@agentos/i18n';
import { getSession } from '@/server/session';

/** Remembers a signed-out visitor's language choice (signed-in users use their profile). */
export const LOCALE_COOKIE = 'agentos_locale';

/** Signed-in user's profile locale → locale cookie → Accept-Language → English (PRD §33). */
export async function resolveLocale(): Promise<Locale> {
  const session = await getSession();
  if (session) return session.user.locale;
  const cookieLocale = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(cookieLocale)) return cookieLocale;
  return matchLocale((await headers()).get('accept-language'));
}
