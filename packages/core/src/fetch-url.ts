import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { AppError } from './errors';

const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;

const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 3],
] as const)
  blocked.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const)
  blocked.addSubnet(net, prefix, 'ipv6');

/** Private, loopback, link-local and metadata addresses (incl. IPv4-mapped IPv6). */
export function isPrivateAddress(address: string): boolean {
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
  if (mapped) return isPrivateAddress(mapped);
  const family = isIP(address);
  if (family === 0) return true;
  return blocked.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

export type FetchedDocument = { url: string; contentType: string; body: Buffer };

/**
 * Fetches a user-supplied URL for knowledge ingestion. Only http(s); every hop's host must
 * resolve to public addresses unless AGENTOS_ALLOW_PRIVATE_URLS=1 (local development).
 * Known gap: the check and the connection resolve DNS separately (rebinding window).
 */
export async function fetchDocument(
  rawUrl: string,
  options: { allowPrivate?: boolean; fetchImpl?: typeof fetch } = {},
): Promise<FetchedDocument> {
  const allowPrivate = options.allowPrivate ?? process.env.AGENTOS_ALLOW_PRIVATE_URLS === '1';
  const doFetch = options.fetchImpl ?? fetch;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new AppError('VALIDATION', 'Invalid URL', { url: ['invalid_url'] });
  }
  for (let hop = 0; ; hop += 1) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:')
      throw new AppError('VALIDATION', 'Only http and https', { url: ['invalid_url'] });
    if (url.username || url.password)
      throw new AppError('VALIDATION', 'Credentials in URL', { url: ['invalid_url'] });
    if (!allowPrivate) {
      const host = url.hostname.replace(/^\[|\]$/g, '');
      const addresses = isIP(host)
        ? [host]
        : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
      if (addresses.length === 0)
        throw new AppError('VALIDATION', 'Host not found', { url: ['url_unreachable'] });
      if (addresses.some(isPrivateAddress))
        throw new AppError('VALIDATION', 'Private address', { url: ['url_private'] });
    }
    let response: Response;
    try {
      response = await doFetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          'user-agent': 'AgentOS/0.3 (knowledge ingestion)',
          accept: 'text/html,text/plain,text/markdown,application/pdf;q=0.9,*/*;q=0.1',
        },
      });
    } catch {
      throw new AppError('VALIDATION', 'Fetch failed', { url: ['url_unreachable'] });
    }
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      if (hop >= MAX_REDIRECTS)
        throw new AppError('VALIDATION', 'Too many redirects', { url: ['url_unreachable'] });
      url = new URL(response.headers.get('location')!, url);
      continue;
    }
    if (!response.ok)
      throw new AppError('VALIDATION', `HTTP ${response.status}`, { url: ['url_unreachable'] });
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > MAX_BYTES)
      throw new AppError('VALIDATION', 'Too large', { url: ['source_too_large'] });
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of response.body ?? []) {
      size += (chunk as Uint8Array).byteLength;
      if (size > MAX_BYTES)
        throw new AppError('VALIDATION', 'Too large', { url: ['source_too_large'] });
      chunks.push(Buffer.from(chunk as Uint8Array));
    }
    return {
      url: url.toString(),
      contentType: (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase(),
      body: Buffer.concat(chunks),
    };
  }
}
