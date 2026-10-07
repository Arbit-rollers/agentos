/** True for an IANA timezone the runtime knows (e.g. "Europe/Istanbul"). */
export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The "current date and time" section of an agent's prompt (PRD §25 runtime context). Models
 * don't know today's date; without this they answer "today" from their training data.
 */
export function describeNow(now: Date, timezone: string): string {
  const zone = isValidTimezone(timezone) ? timezone : 'UTC';
  const part = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-US', { timeZone: zone, ...options }).format(now);
  // en-CA formats dates as YYYY-MM-DD.
  const iso = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const offset = part({ timeZoneName: 'longOffset' }).split(' ').pop()!.replace('GMT', 'UTC');
  return [
    '## Current date and time',
    `It is ${part({ weekday: 'long' })}, ${iso}, ${part({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })} in ${zone} (${offset === 'UTC' ? 'UTC+00:00' : offset}).`,
    'Use this for "today", "tomorrow", "this week" and every other relative date; never assume a date from your training data.',
  ].join('\n');
}
