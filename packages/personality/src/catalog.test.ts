// Every trait, preset and directive the engine can emit needs UI text in each locale.
import { locales, messages } from '@agentos/i18n';
import { describe, expect, it } from 'vitest';
import { DIRECTIVE_TEXT } from './compiler';
import { PRESETS } from './presets';
import { TRAITS } from './traits';

describe.each(locales)('%s catalog covers the personality engine', (locale) => {
  const catalog = messages[locale];

  it('has a name and hint for every trait', () => {
    expect(Object.keys(catalog.traits).sort()).toEqual([...TRAITS].sort());
  });

  it('names every preset', () => {
    expect(Object.keys(catalog.presets).sort()).toEqual([...PRESETS].sort());
  });

  it('describes every directive', () => {
    expect(Object.keys(catalog.directives).sort()).toEqual(Object.keys(DIRECTIVE_TEXT).sort());
  });
});
