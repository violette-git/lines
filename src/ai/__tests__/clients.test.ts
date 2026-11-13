/// <reference types="jest" />
import { buildMessagesRequest, createDirectClient, parseMessagesResponse } from '@/ai/claudeDirect';
import { createProxyClient, setProxyAuthTokenProvider } from '@/ai/claudeProxy';
import type { FetchLike } from '@/ai/http';
import { createAiClient } from '@/ai';
import * as keyStore from '@/ai/keyStore';
import type { AiAnalysisRequest } from '@/domain/contracts';
import { NODE_SCHEMAS } from '@/domain/nodeSchemas';
import { DEFAULT_SETTINGS } from '@/domain/types';

jest.mock('@/ai/keyStore', () => ({
  getApiKey: jest.fn(),
  setApiKey: jest.fn(),
  maskApiKey: jest.fn(),
}));

const req: AiAnalysisRequest = {
  nodeType: 'pole',
  imageBase64: 'QUJD',
  mediaType: 'image/jpeg',
  fieldDefs: NODE_SCHEMAS.pole.filter((d) => d.aiFillable),
  context: { workType: 'aerial', client: 'Demo', previousLabel: 'P-2' },
};

function fakeResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    text: async () => text,
  } as unknown as Response;
}

const toolResponse = {
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  stop_reason: 'tool_use',
  content: [
    {
      type: 'tool_use',
      id: 'tu_1',
      name: 'record_node',
      input: {
        detected_type: 'pole',
        type_confidence: 0.94,
        fields: { pole_tag: { value: 'AP 40217', confidence: 0.93, is_estimate: false } },
        suggested_label: null,
        summary: 'Wood distribution pole with two comm attachments.',
        warnings: ['Possible low clearance between comm and power'],
      },
    },
  ],
  usage: { input_tokens: 1800, output_tokens: 420 },
};

describe('direct client', () => {
  test('request body forces the record_node tool and sends the image first', () => {
    const body = buildMessagesRequest(req, 'claude-sonnet-5-5');
    expect(body.model).toBe('claude-sonnet-5-5');
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'record_node' });
    expect(body.tools).toHaveLength(1);
    const content = body.messages[0].content;
    expect(content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' } });
    expect(content[1].type).toBe('text');
    expect(typeof body.system).toBe('string');
  });

  test('sends the right headers and parses tool_use with usage', async () => {
    const fetchImpl = jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>(async () => fakeResponse(200, toolResponse));
    const client = createDirectClient({ apiKey: 'sk-test', model: 'claude-sonnet-5-5', fetchImpl });
    const r = await client.analyze(req);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const h = init!.headers as Record<string, string>;
    expect(h['x-api-key']).toBe('sk-test');
    expect(h['anthropic-version']).toBe('2023-06-01');
    expect(h['content-type']).toBe('application/json');
    expect(h['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(init!.signal).toBeDefined();
    expect(r.fields.pole_tag.value).toBe('AP 40217');
    expect(r.warnings).toHaveLength(1);
    expect(r.usage).toEqual({ inputTokens: 1800, outputTokens: 420 });
  });

  test.each([
    [401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, /API key/],
    [429, { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }, /rate limit.*Retry in about 30s/],
    [529, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }, /overloaded/],
    [400, { type: 'error', error: { type: 'invalid_request_error', message: 'image too big' } }, /image too big/],
  ])('HTTP %i gives a clear error', async (status, body, re) => {
    const fetchImpl: FetchLike = async () => fakeResponse(status, body, { 'retry-after': '30' });
    const client = createDirectClient({ apiKey: 'k', fetchImpl });
    await expect(client.analyze(req)).rejects.toThrow(re);
  });

  test('times out via AbortController', async () => {
    const fetchImpl: FetchLike = (_u, init) =>
      new Promise((_res, rej) => {
        init?.signal?.addEventListener('abort', () => {
          const e = new Error('aborted');
          e.name = 'AbortError';
          rej(e);
        });
      });
    const client = createDirectClient({ apiKey: 'k', fetchImpl, timeoutMs: 20 });
    await expect(client.analyze(req)).rejects.toMatchObject({ code: 'timeout' });
  });

  test('missing tool_use is an error', () => {
    expect(() => parseMessagesResponse({ content: [{ type: 'text', text: 'hi' }], stop_reason: 'end_turn' }, req)).toThrow(/structured/);
    expect(() => parseMessagesResponse({ content: [], stop_reason: 'max_tokens' }, req)).toThrow(/cut off/);
  });
});

describe('proxy client', () => {
  afterEach(() => setProxyAuthTokenProvider(null));

  test('posts the agreed body shape with bearer token and validates the result', async () => {
    const fetchImpl = jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>(async () =>
      fakeResponse(200, { detectedType: 'pole', typeConfidence: 0.8, fields: { owner: { value: 'Telco', confidence: 0.7, isEstimate: false } }, suggestedLabel: null, summary: 's', warnings: [] }),
    );
    setProxyAuthTokenProvider(async () => 'jwt-123');
    const client = createProxyClient({ url: 'https://x.supabase.co/functions/v1/analyze-photo', model: 'claude-sonnet-5-5', fetchImpl });
    const r = await client.analyze(req);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://x.supabase.co/functions/v1/analyze-photo');
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer jwt-123');
    const body = JSON.parse(init!.body as string);
    expect(Object.keys(body).sort()).toEqual(['context', 'fieldDefs', 'imageBase64', 'mediaType', 'model', 'nodeType']);
    expect(body.model).toBe('claude-sonnet-5-5');
    expect(body.fieldDefs).toHaveLength(req.fieldDefs.length);
    expect(r.fields.owner.value).toBe('Telco');
  });

  test('no Authorization header without a token', async () => {
    const fetchImpl = jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>(async () => fakeResponse(200, { detectedType: 'pole', fields: {} }));
    await createProxyClient({ url: 'https://p', fetchImpl }).analyze(req);
    expect((fetchImpl.mock.calls[0][1]!.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  test('surfaces {error} bodies from non-2xx responses', async () => {
    const fetchImpl: FetchLike = async () => fakeResponse(500, { error: 'upstream exploded' });
    await expect(createProxyClient({ url: 'https://p', fetchImpl }).analyze(req)).rejects.toThrow(/upstream exploded/);
  });
});

describe('createAiClient', () => {
  const getApiKey = keyStore.getApiKey as jest.Mock;

  test('off returns null', async () => {
    await expect(createAiClient({ ...DEFAULT_SETTINGS, aiMode: 'off' })).resolves.toBeNull();
  });

  test('direct requires a stored key', async () => {
    getApiKey.mockResolvedValueOnce(null);
    await expect(createAiClient({ ...DEFAULT_SETTINGS, aiMode: 'direct' })).resolves.toBeNull();
    getApiKey.mockResolvedValueOnce('sk-x');
    await expect(createAiClient({ ...DEFAULT_SETTINGS, aiMode: 'direct' })).resolves.not.toBeNull();
  });

  test('proxy requires a URL', async () => {
    await expect(createAiClient({ ...DEFAULT_SETTINGS, aiMode: 'proxy', proxyUrl: null })).resolves.toBeNull();
    await expect(createAiClient({ ...DEFAULT_SETTINGS, aiMode: 'proxy', proxyUrl: ' ' })).resolves.toBeNull();
    await expect(createAiClient({ ...DEFAULT_SETTINGS, aiMode: 'proxy', proxyUrl: 'https://p' })).resolves.not.toBeNull();
  });
});
