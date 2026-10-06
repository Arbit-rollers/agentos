import { redact } from './redact';

type Level = 'debug' | 'info' | 'warn' | 'error';
type Fields = Record<string, unknown>;

export type Logger = Record<Level, (message: string, fields?: Fields) => void> & {
  child(fields: Fields): Logger;
};

/** Structured JSON logger. Every line passes through `redact`, so secrets never reach logs. */
export function createLogger(
  base: Fields = {},
  write = (line: string) => console.log(line),
): Logger {
  const log =
    (level: Level) =>
    (message: string, fields: Fields = {}) =>
      write(
        JSON.stringify(
          redact({ time: new Date().toISOString(), level, message, ...base, ...fields }),
        ),
      );
  return {
    debug: log('debug'),
    info: log('info'),
    warn: log('warn'),
    error: log('error'),
    child: (fields) => createLogger({ ...base, ...fields }, write),
  };
}

export const logger = createLogger();
