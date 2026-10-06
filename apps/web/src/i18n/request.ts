import { getRequestConfig } from 'next-intl/server';
import { messages } from '@agentos/i18n';
import { resolveLocale } from './locale';

export default getRequestConfig(async () => {
  const locale = await resolveLocale();
  return { locale, messages: messages[locale] };
});
