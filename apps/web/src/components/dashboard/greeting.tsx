'use client';

import { useTranslations } from 'next-intl';
import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

/** Time-of-day greeting in the viewer's own timezone (the server doesn't know it). */
export function Greeting({ name }: { name: string }) {
  const t = useTranslations('dashboard');
  // The server renders the afternoon greeting; the client switches to the local time of day.
  const hour = useSyncExternalStore(
    subscribe,
    () => new Date().getHours(),
    () => 12,
  );
  const key = hour < 12 ? 'greetingMorning' : hour < 18 ? 'greetingAfternoon' : 'greetingEvening';
  return <>{t(key, { name })}</>;
}
