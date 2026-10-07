import { describe, expect, it } from 'vitest';
import { estimateTokens } from '@agentos/model-gateway';
import { chunkText, htmlToText, toTsquery } from './text';

describe('chunkText', () => {
  it('keeps short text as one chunk and drops empty input', () => {
    expect(chunkText('Hello world.')).toEqual(['Hello world.']);
    expect(chunkText('  \n\n ')).toEqual([]);
  });

  it('splits long text into bounded chunks that cover everything, with overlap', () => {
    const paragraphs = Array.from(
      { length: 30 },
      (_, i) => `Paragraph ${i} talks about topic${i} in some detail. It has two sentences.`,
    );
    const chunks = chunkText(paragraphs.join('\n\n'), 100, 10);
    expect(chunks.length).toBeGreaterThan(5);
    for (const chunk of chunks) expect(estimateTokens(chunk)).toBeLessThanOrEqual(115);
    for (let i = 0; i < 30; i += 1) expect(chunks.some((c) => c.includes(`topic${i} `))).toBe(true);
    // The start of each later chunk repeats the end of the previous one.
    const lastWord = chunks[0]!.split(/\s+/).pop()!;
    expect(chunks[1]!.includes(lastWord)).toBe(true);
  });

  it('hard-cuts a single enormous token', () => {
    const chunks = chunkText('x'.repeat(5000), 100, 0);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toBe('x'.repeat(5000));
  });
});

describe('toTsquery', () => {
  it('ORs meaningful words and strips anything that is not a letter or digit', () => {
    expect(toTsquery("What are the aviation trends? (2026) & ') | !")).toBe(
      'aviation | trends | 2026',
    );
  });
  it('handles Turkish and drops Turkish stopwords', () => {
    expect(toTsquery('Havacılık ve İstanbul için trendler')).toBe(
      'havacılık | i̇stanbul | trendler',
    );
  });
  it('is empty when nothing meaningful is left', () => {
    expect(toTsquery('the and of ?')).toBe('');
  });
});

describe('htmlToText', () => {
  it('extracts title and readable body text', () => {
    const page = `<html><head><title>Fleet &amp; Routes</title><style>p{}</style></head>
      <body><nav>Menu</nav><h1>Aviation</h1><p>Jet&nbsp;fuel prices &#8212; up.</p>
      <script>alert(1)</script><ul><li>One</li><li>Two</li></ul></body></html>`;
    const { title, text } = htmlToText(page);
    expect(title).toBe('Fleet & Routes');
    expect(text).toContain('Aviation');
    expect(text).toContain('Jet fuel prices — up.');
    expect(text).toContain('- One');
    expect(text).not.toContain('alert');
    expect(text).not.toContain('Menu');
  });
});
