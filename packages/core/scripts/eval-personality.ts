// Personality eval (ROADMAP M6 DoD, AC 5): do opposite personalities produce measurably
// different answers from a real model? Needs a real provider and spends a little money.
//
//   ANTHROPIC_API_KEY=… pnpm --filter @agentos/core eval:personality
//   OPENAI_API_KEY=… EVAL_MODEL=gpt-… pnpm --filter @agentos/core eval:personality
//   EVAL_PROVIDER=ollama EVAL_MODEL=llama3.1 pnpm --filter @agentos/core eval:personality
//
// It compares a terse, skeptical agent with a verbose, credulous one on the same prompts and
// checks two measurable effects: answer length (Concise/Detailed) and hedging or verification
// language (Skeptical). Exits non-zero if either effect is missing.
import { createAdapter, type ProviderKind } from '@agentos/model-gateway';
import { NEUTRAL_TRAITS, compilePersonality, renderDirectives } from '@agentos/personality';

const provider = (process.env.EVAL_PROVIDER ??
  (process.env.ANTHROPIC_API_KEY
    ? 'anthropic'
    : process.env.OPENAI_API_KEY
      ? 'openai'
      : '')) as ProviderKind;
if (!provider) {
  console.error('Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or EVAL_PROVIDER=ollama (see the header).');
  process.exit(2);
}
const model = process.env.EVAL_MODEL ?? (provider === 'anthropic' ? 'claude-opus-5-5' : '');
if (!model) {
  console.error('Set EVAL_MODEL for this provider.');
  process.exit(2);
}
const adapter = createAdapter({
  provider,
  apiKey: provider === 'anthropic' ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY,
  endpoint:
    provider === 'ollama' ? (process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434') : null,
});

const PROMPTS = [
  'A blog says the Boeing 747 first flew in 1969. Is that right, and why did it matter?',
  'Someone claims airplanes fly because air on top "has to catch up" with air below. Explain lift.',
  'Give me ideas for a short video about why planes leave contrails.',
];

const personalities = {
  terse_skeptic: { ...NEUTRAL_TRAITS, concise: 95, detailed: 5, skeptical: 95, cautious: 80 },
  verbose_credulous: { ...NEUTRAL_TRAITS, concise: 5, detailed: 95, skeptical: 5, cautious: 20 },
};

const HEDGES =
  /\b(verify|verified|source|sources|evidence|according to|likely|uncertain|not sure|confiden\w*|check|actually|misconception|myth|however)\b/gi;

const system = (traits: Record<string, number>) =>
  `You are an aviation content assistant.\n\n${renderDirectives(compilePersonality(traits))}`;

const results: Record<string, { words: number; hedges: number }[]> = {};
for (const [name, traits] of Object.entries(personalities)) {
  results[name] = [];
  for (const prompt of PROMPTS) {
    const reply = await adapter.generate({
      model,
      system: system(traits),
      messages: [{ role: 'user', content: prompt }],
      maxOutputTokens: 2000,
    });
    const words = reply.text.split(/\s+/).filter(Boolean).length;
    const hedges = reply.text.match(HEDGES)?.length ?? 0;
    results[name]!.push({ words, hedges: hedges / Math.max(1, words / 100) });
  }
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const terse = results.terse_skeptic!;
const verbose = results.verbose_credulous!;
const report = {
  provider,
  model,
  meanWords: {
    terse_skeptic: Math.round(mean(terse.map((r) => r.words))),
    verbose_credulous: Math.round(mean(verbose.map((r) => r.words))),
  },
  hedgesPer100Words: {
    terse_skeptic: +mean(terse.map((r) => r.hedges)).toFixed(2),
    verbose_credulous: +mean(verbose.map((r) => r.hedges)).toFixed(2),
  },
};
const shorter = report.meanWords.terse_skeptic < report.meanWords.verbose_credulous * 0.6;
const moreSkeptical =
  report.hedgesPer100Words.terse_skeptic > report.hedgesPer100Words.verbose_credulous;
console.log(JSON.stringify({ ...report, checks: { shorter, moreSkeptical } }, null, 2));
process.exit(shorter && moreSkeptical ? 0 : 1);
