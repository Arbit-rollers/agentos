import { describe, expect, it } from 'vitest';
import { fetchDocument, isPrivateAddress } from './fetch-url';

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.20.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '::1',
    'fd00::1',
    '::ffff:127.0.0.1',
    '0.0.0.0',
    'not-an-ip',
  ])('blocks %s', (address) => expect(isPrivateAddress(address)).toBe(true));
  it.each(['93.184.216.34', '1.1.1.1', '2606:4700:4700::1111'])('allows %s', (address) =>
    expect(isPrivateAddress(address)).toBe(false),
  );
});

describe('fetchDocument', () => {
  const okFetch = (async () =>
    new Response('hello', {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    })) as typeof fetch;

  it('refuses private hosts and non-http schemes before fetching', async () => {
    await expect(
      fetchDocument('http://127.0.0.1/x', { allowPrivate: false, fetchImpl: okFetch }),
    ).rejects.toMatchObject({ details: { url: ['url_private'] } });
    await expect(
      fetchDocument('http://[::1]/x', { allowPrivate: false, fetchImpl: okFetch }),
    ).rejects.toMatchObject({ details: { url: ['url_private'] } });
    await expect(
      fetchDocument('file:///etc/passwd', { allowPrivate: true, fetchImpl: okFetch }),
    ).rejects.toMatchObject({ details: { url: ['invalid_url'] } });
  });

  it('re-checks every redirect hop', async () => {
    const redirecting = (async () =>
      new Response(null, {
        status: 302,
        headers: { location: 'http://169.254.169.254/latest' },
      })) as typeof fetch;
    await expect(
      fetchDocument('http://93.184.216.34/', { allowPrivate: false, fetchImpl: redirecting }),
    ).rejects.toMatchObject({ details: { url: ['url_private'] } });
  });

  it('returns the body and content type', async () => {
    const doc = await fetchDocument('http://93.184.216.34/page', {
      allowPrivate: false,
      fetchImpl: okFetch,
    });
    expect(doc).toMatchObject({ contentType: 'text/plain', url: 'http://93.184.216.34/page' });
    expect(doc.body.toString()).toBe('hello');
  });

  it('stops reading past the size limit', async () => {
    const huge = (async () => new Response(new Uint8Array(6 * 1024 * 1024))) as typeof fetch;
    await expect(
      fetchDocument('http://93.184.216.34/', { allowPrivate: false, fetchImpl: huge }),
    ).rejects.toMatchObject({ details: { url: ['source_too_large'] } });
  });
});
