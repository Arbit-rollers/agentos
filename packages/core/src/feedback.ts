import {
  deleteMemory as deleteMemoryRow,
  findAgent,
  findFeedbackEvent,
  findMemory,
  findMessageWithConversation,
  insertFeedbackEvent,
  updateFeedbackEvent,
  updateMemory,
  type Database,
  type FeedbackAction,
  type FeedbackEvent,
  type FeedbackSuggestion,
  type TenantContext,
} from '@agentos/db';
import { NEUTRAL_TRAITS, normalizeTraits, type Trait } from '@agentos/personality';
import { z } from 'zod';
import { updatePersonality } from './agents';
import { recordAudit } from './audit';
import { parse } from './auth';
import { AppError } from './errors';
import { createMemory } from './memory';
import type { ProviderDeps } from './providers';

/**
 * Feedback phrases (en + tr) that point at a personality trait. Matching is deliberately
 * simple and conservative: a suggestion only ever proposes; a person decides (PRD §13).
 */
const TRAIT_RULES: { trait: Trait; direction: 1 | -1; pattern: RegExp }[] = [
  {
    trait: 'concise',
    direction: 1,
    pattern:
      /too long|shorter|be brief|more brief|verbose|wordy|only the important|get to the point|çok uzun|daha kısa|kısa tut|özetle|lafı uzatma|sadece önemli/i,
  },
  {
    trait: 'detailed',
    direction: 1,
    pattern:
      /too short|more detail|too vague|more depth|elaborate|daha detaylı|daha ayrıntılı|ayrıntı ver|çok kısa|yüzeysel/i,
  },
  {
    trait: 'formal',
    direction: 1,
    pattern: /more formal|more professional|too casual|daha resmi|daha profesyonel|çok samimi/i,
  },
  {
    trait: 'formal',
    direction: -1,
    pattern: /less formal|too formal|more casual|too stiff|daha samimi|çok resmi/i,
  },
  {
    trait: 'humorous',
    direction: -1,
    pattern: /no jokes|not funny|stop joking|less humou?r|şaka yapma|espri yapma/i,
  },
  {
    trait: 'skeptical',
    direction: 1,
    pattern:
      /verify|fact[- ]?check|check (your|the) sources|cite sources|made (that|it) up|doğrula|kaynak göster|kontrol et/i,
  },
  {
    trait: 'cautious',
    direction: 1,
    pattern: /be careful|too risky|more careful|dikkatli ol|daha dikkatli|riskli/i,
  },
  {
    trait: 'creative',
    direction: 1,
    pattern: /more creative|too generic|boring|more original|daha yaratıcı|sıkıcı|çok sıradan/i,
  },
  {
    trait: 'proactive',
    direction: 1,
    pattern: /take (the )?initiative|be proactive|don'?t wait for me|inisiyatif al|daha proaktif/i,
  },
];

const TRAIT_STEP = 20;

/** Trait changes the comment points at, from the agent's current scores. */
export function suggestTraitChanges(
  comment: string,
  current: Record<Trait, number>,
): { trait: Trait; from: number; to: number }[] {
  const changes = new Map<Trait, { trait: Trait; from: number; to: number }>();
  for (const rule of TRAIT_RULES) {
    if (changes.has(rule.trait) || !rule.pattern.test(comment)) continue;
    const from = current[rule.trait];
    const to = Math.min(100, Math.max(0, from + rule.direction * TRAIT_STEP));
    if (to !== from) changes.set(rule.trait, { trait: rule.trait, from, to });
  }
  return [...changes.values()];
}

const feedbackSchema = z
  .object({
    messageId: z.uuid(),
    action: z.enum(['approve', 'reject', 'revise', 'feedback']),
    comment: z.string().trim().max(1_000, { error: 'comment_too_long' }).default(''),
  })
  .superRefine((value, ctx) => {
    if ((value.action === 'revise' || value.action === 'feedback') && !value.comment)
      ctx.addIssue({ code: 'custom', path: ['comment'], message: 'comment_required' });
  });

/**
 * Agent output → Approve / Reject / Revise / Feedback (PRD §13). A comment becomes a
 * suggested operating rule, plus any personality change it points at. Nothing applies until
 * the person accepts it.
 */
export async function submitFeedback(
  db: Database,
  deps: ProviderDeps,
  ctx: TenantContext,
  input: { messageId: string; action: FeedbackAction; comment?: string },
): Promise<FeedbackEvent> {
  const data = parse(feedbackSchema, input);
  const found = await findMessageWithConversation(db, ctx, data.messageId);
  // Only the conversation's own user can give feedback on its answers.
  if (!found || found.conversation.userId !== ctx.userId || found.message.role !== 'assistant')
    throw new AppError('NOT_FOUND', 'Message not found');
  const agent = await findAgent(db, ctx, found.conversation.agentId);
  if (!agent) throw new AppError('NOT_FOUND', 'Agent not found');

  let event = await insertFeedbackEvent(db, ctx, {
    agentId: agent.id,
    messageId: found.message.id,
    runId: found.message.runId,
    taskId: null,
    action: data.action,
    comment: data.comment,
    promotionState: 'none',
    suggestions: [],
  });

  const suggestions: FeedbackSuggestion[] = [];
  if (data.action !== 'approve' && data.comment) {
    const memory = await createMemory(
      db,
      deps,
      ctx,
      { type: 'procedural', content: data.comment, agentId: agent.id },
      {
        kind: 'feedback',
        feedbackId: event.id,
        messageId: found.message.id,
        runId: found.message.runId,
      },
      'suggested',
    );
    suggestions.push({
      kind: 'memory',
      memoryId: memory.id,
      content: memory.content,
      state: 'pending',
    });
    const traits = normalizeTraits(agent.personality?.traitScores ?? NEUTRAL_TRAITS);
    for (const change of suggestTraitChanges(data.comment, traits))
      suggestions.push({ kind: 'personality', ...change, state: 'pending' });
  }
  if (suggestions.length > 0) {
    event = (await updateFeedbackEvent(db, ctx, event.id, {
      suggestions,
      promotionState: 'suggested',
    }))!;
  }
  await recordAudit(db, {
    workspaceId: ctx.workspaceId,
    actorUserId: ctx.userId,
    agentId: agent.id,
    action: 'feedback.submitted',
    targetType: 'feedback_event',
    targetId: event.id,
    outcome: 'success',
    metadata: { action: data.action, suggestions: suggestions.map((s) => s.kind) },
  });
  return event;
}

/**
 * Accepts or dismisses one suggestion. Accepting a memory activates it; accepting a
 * personality change saves the new score (versioned and audited with before/after).
 */
export async function decideFeedbackSuggestion(
  db: Database,
  ctx: TenantContext,
  feedbackId: string,
  index: number,
  accept: boolean,
): Promise<FeedbackEvent> {
  const event = await findFeedbackEvent(db, ctx, feedbackId);
  if (!event || event.userId !== ctx.userId) throw new AppError('NOT_FOUND', 'Feedback not found');
  const suggestion = event.suggestions[index];
  if (!suggestion) throw new AppError('NOT_FOUND', 'Suggestion not found');
  if (suggestion.state !== 'pending') throw new AppError('ALREADY_DECIDED', 'Already decided');

  if (suggestion.kind === 'memory') {
    const memory = await findMemory(db, ctx, suggestion.memoryId);
    if (accept) {
      if (!memory) throw new AppError('NOT_FOUND', 'Memory not found');
      await updateMemory(db, ctx, memory.id, { status: 'active' });
    } else if (memory) {
      await deleteMemoryRow(db, ctx, memory.id);
    }
  } else if (accept) {
    const agent = await findAgent(db, ctx, event.agentId);
    if (!agent) throw new AppError('NOT_FOUND', 'Agent not found');
    const traits = normalizeTraits(agent.personality?.traitScores ?? NEUTRAL_TRAITS);
    await updatePersonality(db, ctx, agent.id, {
      traits: { ...traits, [suggestion.trait]: suggestion.to },
    });
  }

  const suggestions = event.suggestions.map((s, i) =>
    i === index ? { ...s, state: accept ? ('accepted' as const) : ('dismissed' as const) } : s,
  );
  const done = suggestions.every((s) => s.state !== 'pending');
  const updated = (await updateFeedbackEvent(db, ctx, feedbackId, {
    suggestions,
    ...(done && {
      promotionState: suggestions.some((s) => s.state === 'accepted') ? 'accepted' : 'dismissed',
      decidedBy: ctx.userId,
      decidedAt: new Date(),
    }),
  }))!;
  await recordAudit(db, {
    workspaceId: ctx.workspaceId,
    actorUserId: ctx.userId,
    agentId: event.agentId,
    action: accept ? 'feedback.suggestion_accepted' : 'feedback.suggestion_dismissed',
    targetType: 'feedback_event',
    targetId: feedbackId,
    outcome: 'success',
    metadata:
      suggestion.kind === 'memory'
        ? { kind: 'memory', memoryId: suggestion.memoryId }
        : {
            kind: 'personality',
            trait: suggestion.trait,
            from: suggestion.from,
            to: suggestion.to,
          },
  });
  return updated;
}
