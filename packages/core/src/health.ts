export type ComponentStatus = { ok: true } | { ok: false; error: string };

export type HealthReport = {
  ok: boolean;
  components: Record<string, ComponentStatus>;
};

type Check = () => Promise<unknown>;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Runs every check concurrently. A failing or hanging component never throws past this
 * function; it is reported as not ok.
 */
export async function checkHealth(
  checks: Record<string, Check>,
  options: { timeoutMs?: number } = {},
): Promise<HealthReport> {
  const timeoutMs = options.timeoutMs ?? 2000;
  const entries = await Promise.all(
    Object.entries(checks).map(async ([name, check]): Promise<[string, ComponentStatus]> => {
      try {
        await withTimeout(check(), timeoutMs);
        return [name, { ok: true }];
      } catch (error) {
        return [name, { ok: false, error: error instanceof Error ? error.message : String(error) }];
      }
    }),
  );
  const components = Object.fromEntries(entries);
  return { ok: entries.every(([, status]) => status.ok), components };
}
