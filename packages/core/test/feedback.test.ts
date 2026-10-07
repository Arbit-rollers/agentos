import { findAgent, listAuditLogs, listMemories, listMessages } from '@agentos/db';
import { NEUTRAL_TRAITS } from '@agentos/personality';
import { describe, expect, it } from 'vitest';
import { decideFeedbackSuggestion, submitFeedback, suggestTraitChanges } from '../src/feedback';
import { startChatTurn } from '../src/runtime';
import { useAgentFixture } from './agent-fixture';

const fx = useAgentFixture();

async function answered() {
  const setup = await fx.setup();
  const { conversationId } = await startChatTurn(fx.db, fx.deps, setup.ctx, setup.agent.id, {
    message: 'Explain our fleet plan',
  });
  await fx.drain(setup.ctx);
  const messages = await listMessages(fx.db, setup.ctx, conversationId, 10);
  return { ...setup, answer: messages.find((m) => m.role === 'assistant')! };
}

describe('suggestTraitChanges', () => {
  it('maps English and Turkish phrases to bounded trait steps', () => {
    expect(
      suggestTraitChanges('Too long. Give me only the important information.', NEUTRAL_TRAITS),
    ).toEqual([{ trait: 'concise', from: 50, to: 70 }]);
    expect(suggestTraitChanges('Çok uzun, lütfen kaynak göster', NEUTRAL_TRAITS)).toEqual([
      { trait: 'concise', from: 50, to: 70 },
      { trait: 'skeptical', from: 50, to: 70 },
    ]);
    expect(suggestTraitChanges('too formal', { ...NEUTRAL_TRAITS, formal: 10 })).toEqual([
      { trait: 'formal', from: 10, to: 0 },
    ]);
    expect(suggestTraitChanges('shorter please', { ...NEUTRAL_TRAITS, concise: 100 })).toEqual([]);
    expect(suggestTraitChanges('Nice work', NEUTRAL_TRAITS)).toEqual([]);
  });
});

describe('feedback learning (PRD §13)', () => {
  it('a rejection suggests a rule and a personality change; nothing applies before approval', async () => {
    const { ctx, agent, answer } = await answered();
    const event = await submitFeedback(fx.db, fx.deps, ctx, {
      messageId: answer.id,
      action: 'reject',
      comment: 'Too long. Give me only the important information.',
    });
    expect(event.promotionState).toBe('suggested');
    expect(event.suggestions).toMatchObject([
      {
        kind: 'memory',
        state: 'pending',
        content: 'Too long. Give me only the important information.',
      },
      { kind: 'personality', trait: 'concise', from: 50, to: 70, state: 'pending' },
    ]);
    // Not applied yet.
    const [suggested] = await listMemories(fx.db, ctx, {});
    expect(suggested).toMatchObject({ status: 'suggested', type: 'procedural', agentId: agent.id });
    expect((await findAgent(fx.db, ctx, agent.id))!.personality!.traitScores.concise).toBe(50);
    await startChatTurn(fx.db, fx.deps, ctx, agent.id, { message: 'again' });
    await fx.drain(ctx);
    const body = fx.llm.requests.filter((r) => r.path.endsWith('/chat/completions')).at(-1)!
      .body as {
      messages: { role: string; content: string }[];
    };
    expect(body.messages[0]!.content).not.toContain('only the important information');

    // Accept both.
    await decideFeedbackSuggestion(fx.db, ctx, event.id, 0, true);
    const done = await decideFeedbackSuggestion(fx.db, ctx, event.id, 1, true);
    expect(done).toMatchObject({ promotionState: 'accepted', decidedBy: ctx.userId });
    expect((await listMemories(fx.db, ctx, {}))[0]!.status).toBe('active');
    const after = (await findAgent(fx.db, ctx, agent.id))!.personality!;
    expect(after.traitScores.concise).toBe(70);
    const audit = await listAuditLogs(fx.db, ctx, { limit: 20 });
    expect(audit.find((a) => a.action === 'agent.personality_changed')!.metadata).toMatchObject({
      changes: { concise: [50, 70] },
    });
    await expect(decideFeedbackSuggestion(fx.db, ctx, event.id, 1, true)).rejects.toMatchObject({
      code: 'ALREADY_DECIDED',
    });
  });

  it('dismissing deletes the suggested memory and leaves the personality alone', async () => {
    const { ctx, agent, answer } = await answered();
    const event = await submitFeedback(fx.db, fx.deps, ctx, {
      messageId: answer.id,
      action: 'feedback',
      comment: 'More detail please',
    });
    await decideFeedbackSuggestion(fx.db, ctx, event.id, 0, false);
    const done = await decideFeedbackSuggestion(fx.db, ctx, event.id, 1, false);
    expect(done.promotionState).toBe('dismissed');
    expect(await listMemories(fx.db, ctx, {})).toHaveLength(0);
    expect((await findAgent(fx.db, ctx, agent.id))!.personality!.traitScores.detailed).toBe(50);
  });

  it('approve records the event without suggestions; revise needs a comment', async () => {
    const { ctx, answer } = await answered();
    const event = await submitFeedback(fx.db, fx.deps, ctx, {
      messageId: answer.id,
      action: 'approve',
    });
    expect(event).toMatchObject({ promotionState: 'none', suggestions: [] });
    await expect(
      submitFeedback(fx.db, fx.deps, ctx, { messageId: answer.id, action: 'revise', comment: ' ' }),
    ).rejects.toMatchObject({ details: { comment: ['comment_required'] } });
  });

  it("another member can't give feedback on, or decide, someone else's conversation", async () => {
    const { ctx, answer } = await answered();
    const other = { workspaceId: ctx.workspaceId, userId: (await fx.setup()).ctx.userId };
    await expect(
      submitFeedback(fx.db, fx.deps, other, {
        messageId: answer.id,
        action: 'reject',
        comment: 'x',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const event = await submitFeedback(fx.db, fx.deps, ctx, {
      messageId: answer.id,
      action: 'reject',
      comment: 'shorter',
    });
    await expect(decideFeedbackSuggestion(fx.db, other, event.id, 0, true)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
