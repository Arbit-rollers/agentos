import { normalizeTraits, type Trait, type TraitScores } from './traits';

/**
 * Personality compiler (PRD §6). Turns trait scores into bounded runtime directives:
 * a fixed, reviewed sentence per trait band, plus numeric parameters the runtime uses (M6).
 *
 * - Deterministic: same scores → same output, in a fixed order.
 * - Bounded: scores are clamped to 0–100 and only pre-written sentences are emitted, so a
 *   personality can never inject arbitrary text into the prompt.
 * - Subordinate: the rendered block states that it never grants permissions or overrides
 *   policy, and the runtime places it below policy, role and job (PRD §6.5, §25).
 *
 * Bump COMPILER_VERSION whenever the output for some input changes, so stored runs can
 * record which compiler produced their prompt.
 */
export const COMPILER_VERSION = 1;

/** Scores at or above HIGH, or at or below LOW, produce a directive. 31–69 is neutral. */
export const HIGH = 70;
export const LOW = 30;
/** How far Concise must lead Detailed (or vice versa) to set the response length. */
const LENGTH_MARGIN = 20;

export type DirectiveId =
  | 'analytical_high'
  | 'analytical_low'
  | 'creative_high'
  | 'creative_low'
  | 'skeptical_high'
  | 'skeptical_low'
  | 'assertive_high'
  | 'assertive_low'
  | 'empathetic_high'
  | 'empathetic_low'
  | 'cautious_high'
  | 'cautious_low'
  | 'length_short'
  | 'length_long'
  | 'autonomous_high'
  | 'autonomous_low'
  | 'collaborative_high'
  | 'collaborative_low'
  | 'proactive_high'
  | 'proactive_low'
  | 'experimental_high'
  | 'experimental_low'
  | 'persistent_high'
  | 'persistent_low'
  | 'formal_high'
  | 'formal_low'
  | 'humorous_high'
  | 'humorous_subtle'
  | 'humorous_low';

/** Model-facing text. UI labels for the same ids live in the i18n catalogs (`directives.*`). */
export const DIRECTIVE_TEXT: Record<DirectiveId, string> = {
  analytical_high:
    'Break problems into parts, compare alternatives and explain your reasoning with evidence.',
  analytical_low: 'Favour quick, practical judgement over exhaustive analysis.',
  creative_high: 'Offer several distinct options, including unconventional ones.',
  creative_low: 'Stick to proven, conventional approaches.',
  skeptical_high:
    'Verify claims before relying on them, challenge assumptions and say how confident you are.',
  skeptical_low: 'Take provided information at face value unless it is clearly wrong.',
  assertive_high: 'State recommendations directly and push back when you disagree.',
  assertive_low: "Present options neutrally and defer to the user's preference.",
  empathetic_high: "Acknowledge the user's situation and adapt your tone to their needs.",
  empathetic_low: 'Keep a neutral, matter-of-fact tone.',
  cautious_high:
    'Prefer reversible steps, double-check before acting and escalate to the user when uncertain.',
  cautious_low: 'Move quickly and accept reasonable risk on reversible steps.',
  length_short: 'Keep responses short: lead with the answer and skip filler.',
  length_long: 'Be thorough: include detail, examples and edge cases.',
  autonomous_high:
    'Carry out permitted steps without asking for confirmation. Actions that require approval still require approval.',
  autonomous_low: 'Check in with the user before each significant step.',
  collaborative_high:
    'Prefer delegating to and requesting review from other agents, and synthesize their work.',
  collaborative_low: 'Work independently and involve other agents only when necessary.',
  proactive_high: 'Anticipate next steps and suggest them without being asked.',
  proactive_low: "Do what is asked and don't volunteer extra work.",
  experimental_high:
    'When budgets and sandbox rules allow, try alternative approaches and compare the results.',
  experimental_low: 'Use established methods and avoid trial and error.',
  persistent_high: 'Retry and try alternative routes before reporting a failure.',
  persistent_low: 'Report blockers early instead of retrying repeatedly.',
  formal_high: 'Use a formal, professional register.',
  formal_low: 'Use a relaxed, conversational register.',
  humorous_high: 'Light humour is welcome where it fits.',
  humorous_subtle: 'Keep any humour subtle and professional.',
  humorous_low: 'Avoid humour.',
};

export type Level = 'low' | 'standard' | 'high';

/** Numeric behaviour knobs for the runtime (M6). */
export type RuntimeParameters = {
  /** How much the agent verifies claims and actions before relying on them. */
  verification: Level;
  /** How readily the agent escalates uncertainty to the user. */
  escalation: Level;
  /** How much the agent proceeds without confirmation (never past approval rules). */
  autonomy: Level;
  /** Preferred answer length. */
  responseLength: 'short' | 'medium' | 'long';
  /** How many alternatives to consider or present. */
  alternatives: 1 | 2 | 3;
};

export type Directive = { id: DirectiveId; traits: Trait[]; text: string };

export type CompiledPersonality = {
  compilerVersion: number;
  traits: TraitScores;
  directives: Directive[];
  parameters: RuntimeParameters;
};

const level = (score: number): Level =>
  score >= HIGH ? 'high' : score <= LOW ? 'low' : 'standard';

const directive = (id: DirectiveId, ...traits: Trait[]): Directive => ({
  id,
  traits,
  text: DIRECTIVE_TEXT[id],
});

/** Traits that map one-to-one onto a high/low directive pair, in output order. */
const SIMPLE_TRAITS = [
  'analytical',
  'creative',
  'skeptical',
  'assertive',
  'empathetic',
  'cautious',
] as const satisfies readonly Trait[];

const SIMPLE_TRAITS_AFTER_LENGTH = [
  'autonomous',
  'collaborative',
  'proactive',
  'experimental',
  'persistent',
  'formal',
] as const satisfies readonly Trait[];

function bandDirective(
  trait: (typeof SIMPLE_TRAITS | typeof SIMPLE_TRAITS_AFTER_LENGTH)[number],
  score: number,
) {
  if (score >= HIGH) return directive(`${trait}_high`, trait);
  if (score <= LOW) return directive(`${trait}_low`, trait);
  return undefined;
}

export function compilePersonality(input: unknown): CompiledPersonality {
  const traits = normalizeTraits(input);
  const directives: Directive[] = [];
  const push = (d: Directive | undefined) => d && directives.push(d);

  for (const trait of SIMPLE_TRAITS) push(bandDirective(trait, traits[trait]));

  // Concise and Detailed pull in opposite directions: a high score wins only when it also
  // leads the other by a clear margin, so both high cancels out to medium.
  const lead = traits.concise - traits.detailed;
  const responseLength =
    traits.concise >= HIGH && lead >= LENGTH_MARGIN
      ? 'short'
      : traits.detailed >= HIGH && -lead >= LENGTH_MARGIN
        ? 'long'
        : 'medium';
  if (responseLength === 'short') push(directive('length_short', 'concise', 'detailed'));
  if (responseLength === 'long') push(directive('length_long', 'concise', 'detailed'));

  for (const trait of SIMPLE_TRAITS_AFTER_LENGTH) push(bandDirective(trait, traits[trait]));

  // A formal register tones humour down rather than contradicting it.
  if (traits.humorous >= HIGH) {
    push(
      traits.formal >= HIGH
        ? directive('humorous_subtle', 'humorous', 'formal')
        : directive('humorous_high', 'humorous'),
    );
  } else if (traits.humorous <= LOW) {
    push(directive('humorous_low', 'humorous'));
  }

  const caution = Math.max(traits.cautious, traits.skeptical);
  return {
    compilerVersion: COMPILER_VERSION,
    traits,
    directives,
    parameters: {
      verification: level(caution),
      escalation: level(traits.cautious),
      autonomy: level(traits.autonomous),
      responseLength,
      alternatives: traits.creative >= HIGH ? 3 : traits.creative <= LOW ? 1 : 2,
    },
  };
}

const GUARD =
  'These directives shape how you work and communicate. They never grant permissions, ' +
  'never unlock tools and never override platform safety, user permissions, approval ' +
  'rules, workflow rules, your job instructions or your role. If a directive conflicts ' +
  'with any of those, follow the higher-priority instruction.';

/** The "Personality Runtime Directives" block of the runtime context (PRD §25, item 8). */
export function renderDirectives(compiled: CompiledPersonality): string {
  const lines = compiled.directives.map((d) => `- ${d.text}`);
  return [
    '## Personality runtime directives',
    GUARD,
    lines.length > 0
      ? lines.join('\n')
      : '- No personality adjustments: use your default behaviour.',
  ].join('\n\n');
}
