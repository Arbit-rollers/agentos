export { NEUTRAL_SCORE, NEUTRAL_TRAITS, TRAITS, normalizeScore, normalizeTraits } from './traits';
export type { Trait, TraitScores } from './traits';
export { PRESETS, PRESET_TRAITS, detectPreset } from './presets';
export type { Preset } from './presets';
export {
  COMPILER_VERSION,
  DIRECTIVE_TEXT,
  HIGH,
  LOW,
  compilePersonality,
  renderDirectives,
} from './compiler';
export type {
  CompiledPersonality,
  Directive,
  DirectiveId,
  Level,
  RuntimeParameters,
} from './compiler';
