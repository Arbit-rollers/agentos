import { describe, expect, it } from 'vitest';
import { locales, matchLocale, messages } from './index';

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out.set(path, value);
    else for (const [k, v] of flatten(value, path)) out.set(k, v);
  }
  return out;
}

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)/g)].map((m) => m[1]).sort();

const reference = flatten(messages.en as unknown as Tree);

describe.each(locales.filter((locale) => locale !== 'en'))('%s catalog', (locale) => {
  const catalog = flatten(messages[locale] as unknown as Tree);

  it('has exactly the same keys as English', () => {
    expect([...catalog.keys()].sort()).toEqual([...reference.keys()].sort());
  });

  it('uses the same placeholders as English', () => {
    for (const [key, text] of reference) {
      expect({ key, placeholders: placeholders(catalog.get(key) ?? '') }).toEqual({
        key,
        placeholders: placeholders(text),
      });
    }
  });

  it('has no empty strings', () => {
    expect([...catalog].filter(([, text]) => !text.trim())).toEqual([]);
  });
});

describe('matchLocale', () => {
  it('picks the highest-ranked supported language', () => {
    expect(matchLocale('tr-TR,tr;q=0.9,en;q=0.8')).toBe('tr');
    expect(matchLocale('de-DE,de;q=0.9,tr;q=0.5,en;q=0.4')).toBe('tr');
    expect(matchLocale('en-US,en;q=0.9')).toBe('en');
  });

  it('falls back to English', () => {
    expect(matchLocale(undefined)).toBe('en');
    expect(matchLocale('fr-FR')).toBe('en');
    expect(matchLocale('tr;q=0')).toBe('en');
  });
});
