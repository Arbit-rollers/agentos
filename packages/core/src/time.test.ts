import { describe, expect, it } from 'vitest';
import { describeNow, isValidTimezone } from './time';

describe('describeNow', () => {
  const now = new Date('2026-10-07T21:30:00Z');
  it('states the local date, time and offset', () => {
    expect(describeNow(now, 'Europe/Istanbul')).toContain(
      'It is Thursday, 2026-10-08, 00:30 in Europe/Istanbul (UTC+03:00).',
    );
    expect(describeNow(now, 'America/New_York')).toContain(
      'It is Wednesday, 2026-10-07, 17:30 in America/New_York (UTC-04:00).',
    );
  });
  it('falls back to UTC for an unknown zone', () => {
    expect(describeNow(now, 'Mars/Base')).toContain('2026-10-07, 21:30 in UTC (UTC+00:00).');
    expect(isValidTimezone('Mars/Base')).toBe(false);
  });
});
