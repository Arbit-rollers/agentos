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

/** Milliseconds `timezone` is ahead of UTC at `date`. */
function zoneOffsetMs(date: Date, timezone: string): number {
  const parts: Record<string, number> = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(date)
      .map((p) => [p.type, Number(p.value)]),
  );
  const part = (type: string) => parts[type] ?? 0;
  const asUtc = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  );
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** The instant local midnight starts `day` (YYYY-MM-DD) in `timezone`. */
export function startOfDayIn(day: string, timezone: string): Date {
  const utcMidnight = Date.parse(`${day}T00:00:00Z`);
  let instant = utcMidnight - zoneOffsetMs(new Date(utcMidnight), timezone);
  // A second pass settles days where the offset changes overnight (DST).
  instant = utcMidnight - zoneOffsetMs(new Date(instant), timezone);
  return new Date(instant);
}

/** YYYY-MM-DD of `date` on the calendar of `timezone`. */
export function dayIn(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}
