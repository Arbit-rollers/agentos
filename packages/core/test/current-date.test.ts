import { describe, expect, it } from 'vitest';
import { rememberDetectedTimezone, updateProfile } from '../src/profile';
import { startChatTurn } from '../src/runtime';
import { useAgentFixture } from './agent-fixture';

const fx = useAgentFixture();

const lastSystemPrompt = () => {
  const body = fx.llm.requests.filter((r) => r.path.endsWith('/chat/completions')).at(-1)!.body as {
    messages: { role: string; content: string }[];
  };
  return body.messages.find((m) => m.role === 'system')!.content;
};

const localDate = (timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

describe('current date in the prompt', () => {
  it("uses the person's timezone, detected from the browser until they choose one", async () => {
    const { ctx, agent } = await fx.setup();
    await startChatTurn(fx.db, fx.deps, ctx, agent.id, { message: 'What day is it?' });
    await fx.drain(ctx);
    expect(lastSystemPrompt()).toContain('## Current date and time');
    expect(lastSystemPrompt()).toContain(`, ${localDate('UTC')}, `);
    expect(lastSystemPrompt()).toContain('in UTC (UTC+00:00)');

    await rememberDetectedTimezone(fx.db, ctx, 'Europe/Istanbul');
    await startChatTurn(fx.db, fx.deps, ctx, agent.id, { message: 'And now?' });
    await fx.drain(ctx);
    expect(lastSystemPrompt()).toContain(`, ${localDate('Europe/Istanbul')}, `);
    expect(lastSystemPrompt()).toContain('in Europe/Istanbul (UTC+03:00)');

    // An explicit choice wins over later browser detection.
    await updateProfile(fx.db, ctx, {
      displayName: 'Test User',
      locale: 'en',
      timezone: 'Asia/Tokyo',
    });
    await rememberDetectedTimezone(fx.db, ctx, 'Europe/Istanbul');
    await startChatTurn(fx.db, fx.deps, ctx, agent.id, { message: 'Again?' });
    await fx.drain(ctx);
    expect(lastSystemPrompt()).toContain('in Asia/Tokyo (UTC+09:00)');
  });

  it('rejects an unknown timezone in the profile', async () => {
    const { ctx } = await fx.setup();
    await expect(
      updateProfile(fx.db, ctx, { displayName: 'x', locale: 'en', timezone: 'Mars/Base' }),
    ).rejects.toMatchObject({ details: { timezone: ['invalid_timezone'] } });
  });
});
