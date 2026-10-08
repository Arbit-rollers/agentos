import { z } from 'zod';

const masterKey = z.string().refine((value) => Buffer.from(value, 'base64').length === 32, {
  message: 'must be 32 bytes, base64-encoded (openssl rand -base64 32)',
});

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  AGENTOS_MASTER_KEY: masterKey,
  OLLAMA_BASE_URL: z.url().default('http://localhost:11434'),
  APP_URL: z.url().default('http://localhost:3000'),
  /** Optional: AgentOS's own Google OAuth client for Google Workspace connections. */
  AGENTOS_GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  AGENTOS_GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  /** Sign-in, sign-up and run-start rate limits; on by default only in production. */
  AGENTOS_RATE_LIMITS: z.enum(['on', 'off']).optional(),
  /** Backpressure per workspace: queued runs before new chats/tasks are refused. */
  AGENTOS_MAX_QUEUED_RUNS: z.coerce.number().int().positive().default(100),
  /** Runs one workspace may execute at once; the rest wait for a free slot. */
  AGENTOS_MAX_RUNNING_RUNS: z.coerce.number().int().positive().default(3),
});

export type Env = z.infer<typeof envSchema>;

/** Whether rate limits apply: explicitly configured, else only in production. */
export const rateLimitsEnabled = (env: Env) =>
  env.AGENTOS_RATE_LIMITS ? env.AGENTOS_RATE_LIMITS === 'on' : env.NODE_ENV === 'production';

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
