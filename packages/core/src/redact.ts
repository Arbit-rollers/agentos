const SENSITIVE_KEY =
  /pass(word)?|secret|token|api[-_]?key|authorization|cookie|credential|private[-_]?key|dek/i;

// Values that look like credentials even under an innocent key name.
const SENSITIVE_VALUE = [
  /\bsk-[A-Za-z0-9_-]{16,}/g, // OpenAI / Anthropic style keys
  /\bAIza[0-9A-Za-z_-]{30,}/g, // Google API keys
  /\bgh[pousr]_[A-Za-z0-9]{30,}/g, // GitHub tokens
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, // Slack tokens
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
];

export const REDACTED = '[REDACTED]';

function redactString(value: string): string {
  return SENSITIVE_VALUE.reduce((text, pattern) => text.replace(pattern, REDACTED), value);
}

/**
 * Deep-copies a value with secrets removed: values under sensitive keys are replaced, and
 * credential-shaped substrings are masked anywhere (PRD §7.4, §21).
 */
export function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  if (Buffer.isBuffer(value)) return REDACTED;
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message) };
  }
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redact(item, seen));
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_KEY.test(key) ? REDACTED : redact(item, seen),
    ]),
  );
}
