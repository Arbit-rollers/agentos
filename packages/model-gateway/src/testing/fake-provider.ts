// Test double for model providers. Speaks the OpenAI-compatible wire format under /openai
// (also what Ollama serves) and the Anthropic Messages format under /anthropic.
// Behaviour is chosen by model name:
//   *-down      → HTTP 503 (outage; triggers fallback)
//   *-limited   → HTTP 429 (rate limit; triggers fallback)
//   Anthropic requests that opt into server-side fallbacks and say "refuse" → served by
//   `claude-fallback` with a fallback block, as the real API does after a policy decline
//   anything else echoes the last user message.
// Requests are recorded so tests can assert what reached the provider.
import { createServer, type IncomingMessage, type Server } from 'node:http';

export type RecordedRequest = {
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
};

export const FAKE_MODELS = ['fake-echo', 'fake-down', 'fake-limited', 'fake-local'];
export const FAKE_CLAUDE_MODELS = ['claude-fake', 'claude-fake-down', 'claude-opus-5-5'];

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : undefined;
}

type Body = {
  model: string;
  fallbacks?: unknown;
  system?: string;
  messages: { role: string; content: string }[];
};

const lastUser = (body: Body) =>
  [...body.messages].reverse().find((m) => m.role === 'user')?.content ?? '';

export function startFakeProvider(options: { port?: number; apiKey?: string } = {}) {
  const requests: RecordedRequest[] = [];

  const server: Server = createServer(async (req, res) => {
    const url = req.url ?? '';
    const body = (await readBody(req)) as Body | undefined;
    requests.push({ path: url, headers: req.headers, body });
    const send = (status: number, payload: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    };

    if (options.apiKey) {
      const presented =
        req.headers['x-api-key'] ?? req.headers.authorization?.replace(/^Bearer /, '');
      if (presented !== options.apiKey) return send(401, { error: { message: 'bad key' } });
    }

    // --- OpenAI-compatible / Ollama ---
    if (url === '/openai/v1/models' && req.method === 'GET') {
      return send(200, {
        object: 'list',
        data: FAKE_MODELS.map((id) => ({ id, object: 'model' })),
      });
    }
    if (url === '/openai/v1/chat/completions' && body) {
      if (body.model.endsWith('-down')) return send(503, { error: { message: 'down' } });
      if (body.model.endsWith('-limited')) return send(429, { error: { message: 'slow down' } });
      const text = `echo: ${lastUser(body)}`;
      return send(200, {
        id: 'chatcmpl-fake',
        object: 'chat.completion',
        created: 0,
        model: body.model,
        choices: [
          { index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
      });
    }

    // --- Anthropic Messages ---
    if (url.startsWith('/anthropic/v1/models') && req.method === 'GET') {
      return send(200, {
        data: FAKE_CLAUDE_MODELS.map((id) => ({
          id,
          type: 'model',
          display_name: id,
          created_at: '2026-01-01T00:00:00Z',
          max_input_tokens: 200_000,
          max_tokens: 64_000,
        })),
        has_more: false,
        first_id: FAKE_CLAUDE_MODELS[0],
        last_id: FAKE_CLAUDE_MODELS.at(-1),
      });
    }
    if (url.startsWith('/anthropic/v1/messages') && body) {
      if (body.model.endsWith('-down')) {
        return send(529, { type: 'error', error: { type: 'overloaded_error', message: 'down' } });
      }
      const refused = body.fallbacks !== undefined && lastUser(body).includes('refuse');
      return send(200, {
        id: 'msg_fake',
        type: 'message',
        role: 'assistant',
        model: refused ? 'claude-fallback' : body.model,
        content: [
          ...(refused
            ? [{ type: 'fallback', from: { model: body.model }, to: { model: 'claude-fallback' } }]
            : []),
          { type: 'text', text: `echo: ${lastUser(body)}` },
        ],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 20 },
      });
    }

    send(404, { error: { message: `no route ${req.method} ${url}` } });
  });

  const ready = new Promise<{ url: string }>((resolve) => {
    server.listen(options.port ?? 0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : options.port;
      resolve({ url: `http://127.0.0.1:${port}` });
    });
  });

  return {
    ready,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
