// Test double for model providers. Speaks the OpenAI-compatible wire format under /openai
// (also what Ollama serves) and the Anthropic Messages format under /anthropic.
// Behaviour is chosen by model name and message content:
//   *-down      → HTTP 503 (outage; triggers fallback)
//   *-limited   → HTTP 429 (rate limit; triggers fallback)
//   with tools offered, a user message containing [[call:<name part>:<json args>]] makes the
//   model call the first tool whose name contains <name part> (several markers → parallel
//   calls); after tool results it answers "Tool results: <content>; …" (errors prefixed ERROR)
//   Anthropic requests that opt into server-side fallbacks and say "refuse" → served by
//   `claude-fallback` with a fallback block, as the real API does after a policy decline
//   anything else echoes the last user message.
//   /openai/v1/embeddings → deterministic bag-of-words vectors (768 dims; *-small-dim → 384).
// Requests are recorded so tests can assert what reached the provider.
import { createServer, type IncomingMessage, type Server } from 'node:http';

export type RecordedRequest = {
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
};

export const FAKE_MODELS = [
  'fake-echo',
  'fake-down',
  'fake-limited',
  'fake-local',
  'fake-embed',
  'fake-embed-small-dim',
];
export const FAKE_CLAUDE_MODELS = ['claude-fake', 'claude-fake-down', 'claude-opus-5-5'];

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : undefined;
}

type Message = { role: string; content: unknown };
type Body = {
  model: string;
  fallbacks?: unknown;
  messages: Message[];
  tools?: { name?: string; function?: { name: string } }[];
};

const textOf = (content: unknown): string =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? (content as { type?: string; text?: string }[])
          .map((b) => (b.type === 'text' ? (b.text ?? '') : ''))
          .join('')
      : '';

const lastUser = (body: Body) =>
  textOf([...body.messages].reverse().find((m) => m.role === 'user' && textOf(m.content))?.content);

const MARKER = /\[\[call:([\w.-]+):(\{.*?\})\]\]/g;

/** Tool calls requested by markers in the last message, if it is a plain user message. */
function plannedCalls(body: Body): { name: string; args: unknown }[] {
  const names = (body.tools ?? []).map((t) => t.function?.name ?? t.name ?? '');
  const last = body.messages.at(-1);
  if (!last || last.role !== 'user' || names.length === 0) return [];
  return [...textOf(last.content).matchAll(MARKER)].flatMap(([, part, json]) => {
    const name = names.find((n) => n.includes(part!));
    return name ? [{ name, args: JSON.parse(json!) as unknown }] : [];
  });
}

/**
 * Deterministic bag-of-words vector: texts that share words point the same way, so cosine
 * similarity behaves like a crude real embedding.
 */
export function fakeEmbedding(text: string, size = 768): number[] {
  const vector = Array.from({ length: size }, () => 0);
  for (const word of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    let hash = 2166136261;
    for (const char of word) hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619);
    vector[Math.abs(hash) % size]! += 1;
  }
  const norm = Math.hypot(...vector) || 1;
  return vector.map((v) => v / norm);
}

let sequence = 0;

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
    if (url === '/openai/v1/embeddings' && body) {
      if (body.model.endsWith('-down')) return send(503, { error: { message: 'down' } });
      const inputs = (body as unknown as { input: string[] | string }).input;
      const list = Array.isArray(inputs) ? inputs : [inputs];
      const size = body.model.includes('small-dim') ? 384 : 768;
      return send(200, {
        object: 'list',
        model: body.model,
        data: list.map((text, index) => ({
          object: 'embedding',
          index,
          embedding: fakeEmbedding(text, size),
        })),
        usage: { prompt_tokens: list.join(' ').split(/\s+/).length, total_tokens: 0 },
      });
    }
    if (url === '/openai/v1/chat/completions' && body) {
      if (body.model.endsWith('-down')) return send(503, { error: { message: 'down' } });
      if (body.model.endsWith('-limited')) return send(429, { error: { message: 'slow down' } });
      const reply = (message: unknown, finish: string) =>
        send(200, {
          id: 'chatcmpl-fake',
          object: 'chat.completion',
          created: 0,
          model: body.model,
          choices: [{ index: 0, message, finish_reason: finish }],
          usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
        });
      const calls = plannedCalls(body);
      if (calls.length > 0) {
        return reply(
          {
            role: 'assistant',
            content: null,
            tool_calls: calls.map((call) => ({
              id: `call_${++sequence}`,
              type: 'function',
              function: { name: call.name, arguments: JSON.stringify(call.args) },
            })),
          },
          'tool_calls',
        );
      }
      const trailing: string[] = [];
      for (const m of [...body.messages].reverse()) {
        if (m.role !== 'tool') break;
        trailing.unshift(textOf(m.content));
      }
      const text =
        trailing.length > 0 ? `Tool results: ${trailing.join('; ')}` : `echo: ${lastUser(body)}`;
      return reply({ role: 'assistant', content: text }, 'stop');
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
      const message = (content: unknown[], stopReason: string, model = body.model) =>
        send(200, {
          id: 'msg_fake',
          type: 'message',
          role: 'assistant',
          model,
          content,
          stop_reason: stopReason,
          stop_sequence: null,
          usage: { input_tokens: 100, output_tokens: 20 },
        });

      const last = body.messages.at(-1);
      const results = Array.isArray(last?.content)
        ? (last.content as { type: string; content?: string; is_error?: boolean }[]).filter(
            (b) => b.type === 'tool_result',
          )
        : [];
      if (results.length > 0) {
        const text = results.map((r) => `${r.is_error ? 'ERROR ' : ''}${r.content}`).join('; ');
        return message([{ type: 'text', text: `Tool results: ${text}` }], 'end_turn');
      }
      const calls = plannedCalls(body);
      if (calls.length > 0) {
        return message(
          [
            // Current models think; the block must come back unchanged in the next turn.
            { type: 'thinking', thinking: '', signature: 'sig-fake' },
            ...calls.map((call) => ({
              type: 'tool_use',
              id: `toolu_${++sequence}`,
              name: call.name,
              input: call.args,
            })),
          ],
          'tool_use',
        );
      }
      const refused = body.fallbacks !== undefined && lastUser(body).includes('refuse');
      return message(
        [
          ...(refused
            ? [{ type: 'fallback', from: { model: body.model }, to: { model: 'claude-fallback' } }]
            : []),
          { type: 'text', text: `echo: ${lastUser(body)}` },
        ],
        'end_turn',
        refused ? 'claude-fallback' : body.model,
      );
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
