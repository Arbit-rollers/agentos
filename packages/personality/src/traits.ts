/** The 15 personality traits, in PRD §6.2 order. Each is scored 0–100. */
export const TRAITS = [
  'analytical',
  'creative',
  'skeptical',
  'assertive',
  'empathetic',
  'cautious',
  'concise',
  'detailed',
  'autonomous',
  'collaborative',
  'proactive',
  'experimental',
  'persistent',
  'formal',
  'humorous',
] as const;

export type Trait = (typeof TRAITS)[number];
export type TraitScores = Record<Trait, number>;

export const NEUTRAL_SCORE = 50;

/** Every trait at 50: no directive fires, so the agent uses default model behaviour. */
export const NEUTRAL_TRAITS: TraitScores = Object.fromEntries(
  TRAITS.map((trait) => [trait, NEUTRAL_SCORE]),
) as TraitScores;

/** Clamps to an integer in 0–100. Missing or non-numeric values become neutral. */
export function normalizeScore(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return NEUTRAL_SCORE;
  return Math.min(100, Math.max(0, Math.round(number)));
}

/** Accepts any object and returns a complete, bounded score set. Unknown keys are dropped. */
export function normalizeTraits(input: unknown): TraitScores {
  const source = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  return Object.fromEntries(
    TRAITS.map((trait) => [trait, normalizeScore(source[trait] ?? NEUTRAL_SCORE)]),
  ) as TraitScores;
}
