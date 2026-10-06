import { NEUTRAL_TRAITS, type Trait, type TraitScores } from './traits';

/** PRD §6.4. Presets are starting points; every score stays editable. */
export const PRESETS = [
  'analyst',
  'creative_director',
  'executive_assistant',
  'skeptical_reviewer',
  'researcher',
  'engineer',
  'operator',
  'coach',
  'custom',
] as const;

export type Preset = (typeof PRESETS)[number];

const preset = (scores: Partial<Record<Trait, number>>): TraitScores => ({
  ...NEUTRAL_TRAITS,
  ...scores,
});

export const PRESET_TRAITS: Record<Preset, TraitScores> = {
  analyst: preset({
    analytical: 90,
    skeptical: 75,
    cautious: 65,
    detailed: 70,
    concise: 40,
    creative: 35,
    formal: 65,
    humorous: 20,
  }),
  creative_director: preset({
    creative: 95,
    experimental: 85,
    assertive: 75,
    proactive: 85,
    collaborative: 80,
    analytical: 55,
    cautious: 35,
    concise: 70,
    humorous: 55,
  }),
  executive_assistant: preset({
    concise: 85,
    proactive: 80,
    empathetic: 70,
    formal: 70,
    cautious: 65,
    autonomous: 60,
    detailed: 30,
    humorous: 25,
  }),
  skeptical_reviewer: preset({
    skeptical: 95,
    analytical: 85,
    cautious: 85,
    assertive: 75,
    creative: 20,
    detailed: 70,
    autonomous: 35,
    humorous: 15,
  }),
  researcher: preset({
    analytical: 85,
    detailed: 85,
    concise: 25,
    skeptical: 75,
    persistent: 80,
    creative: 60,
    proactive: 65,
  }),
  engineer: preset({
    analytical: 90,
    persistent: 80,
    concise: 70,
    detailed: 40,
    experimental: 65,
    cautious: 65,
    autonomous: 70,
    formal: 40,
    humorous: 30,
  }),
  operator: preset({
    autonomous: 80,
    proactive: 80,
    persistent: 80,
    concise: 80,
    detailed: 25,
    cautious: 60,
    creative: 30,
    humorous: 20,
  }),
  coach: preset({
    empathetic: 90,
    collaborative: 80,
    proactive: 70,
    assertive: 55,
    formal: 30,
    humorous: 60,
    skeptical: 35,
  }),
  custom: { ...NEUTRAL_TRAITS },
};

/** The preset whose scores exactly match, or `custom` once the user edits a slider. */
export function detectPreset(traits: TraitScores): Preset {
  return (
    PRESETS.find(
      (name) =>
        name !== 'custom' &&
        (Object.keys(traits) as Trait[]).every((t) => PRESET_TRAITS[name][t] === traits[t]),
    ) ?? 'custom'
  );
}
