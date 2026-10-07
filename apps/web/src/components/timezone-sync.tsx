'use client';

import { useEffect } from 'react';
import { rememberTimezoneAction } from '@/app/(app)/settings/actions';

/** Sends the browser's timezone once, so agents know the person's "today" (until they pick one). */
export function TimezoneSync() {
  useEffect(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone) void rememberTimezoneAction(zone);
  }, []);
  return null;
}
