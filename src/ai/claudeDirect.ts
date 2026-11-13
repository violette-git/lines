// Direct client: calls the Anthropic Messages API from the device with the user's own API key.
import type { AiAnalysisRequest, AiAnalysisResult, AiClient } from '@/domain/contracts';

import { AiError, DEFAULT_TIMEOUT_MS, fetchWithTimeout, readJson, type FetchLike } from './http';
import {
  DEFAULT_AI_MODEL,
  DEFAULT_MAX_TOKENS,
  RECORD_NODE_TOOL,
  SYSTEM_PROMPT,
  aiFillableDefs,
  buildRecordNodeTool,
  buildUserPrompt,
  normalizeAiResult,
} from './prompt';

export const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_VERSION = '2023-06-01';

export interface DirectClientOptions {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
  endpoint?: string;
}

/** Messages API request body for one photo analysis (pure, exported for tests and the backend). */
export function buildMessagesRequest(req: AiAnalysisRequest, model: string = DEFAULT_AI_MODEL, maxTokens = DEFAULT_MAX_TOKENS) {
  const tool = buildRecordNodeTool(req.fieldDefs);
  return {
    model,
    max_tokens: maxTokens,
    system: SYSTEM_PROMPT,
    tools: [tool],
    tool_choice: { type: 'tool', name: RECORD_NODE_TOOL },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: req.mediaType, data: req.imageBase64 } },
          { type: 'text', text: buildUserPrompt(req) },
        ],
      },
    ],
  };
}

interface MessagesResponse {
  content?: { type: string; name?: string; input?: unknown; text?: string }[];
  stop_reason?: string | null;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/** Extracts the record_node tool input from a Messages API response. */
export function parseMessagesResponse(json: unknown, req: Pick<AiAnalysisRequest, 'fieldDefs' | 'nodeType'>): AiAnalysisResult {
  const body = (json ?? {}) as MessagesResponse;
  const block = body.content?.find((c) => c.type === 'tool_use' && c.name === RECORD_NODE_TOOL);
  if (!block) {
    if (body.stop_reason === 'max_tokens') {
      throw new AiError('AI response was cut off before it finished. Try again.', 'bad_response', null, true);
    }
    if (body.stop_reason === 'refusal') {
      throw new AiError('AI declined to analyze this photo.', 'bad_response');
    }
    throw new AiError('AI response did not include structured node data.', 'bad_response', null, true);
  }
  const result = normalizeAiResult(block.input, { fieldDefs: aiFillableDefs(req.fieldDefs), fallbackType: req.nodeType });
  const u = body.usage;
  if (u && typeof u.input_tokens === 'number' && typeof u.output_tokens === 'number') {
    result.usage = { inputTokens: u.input_tokens, outputTokens: u.output_tokens };
  }
  return result;
}

/** Turns an Anthropic error response into a clear AiError. */
export function anthropicError(status: number, body: unknown, retryAfter: string | null): AiError {
  const err = (body as { error?: { type?: string; message?: string } } | null)?.error;
  const type = err?.type ?? '';
  const detail = err?.message ? `: ${err.message}` : '';
  if (status === 401 || type === 'authentication_error') {
    return new AiError('Anthropic rejected the API key (401). Check the key in Settings.', 'auth', status);
  }
  if (status === 403 || type === 'permission_error') {
    return new AiError(`This API key is not allowed to use the model (403)${detail}`, 'permission', status);
  }
  if (status === 429 || type === 'rate_limit_error') {
    const wait = retryAfter ? ` Retry in about ${retryAfter}s.` : ' Wait a minute and retry.';
    return new AiError(`Anthropic rate limit reached (429).${wait}`, 'rate_limit', status, true);
  }
  if (status === 529 || type === 'overloaded_error') {
    return new AiError('Claude is overloaded right now (529). Photos stay queued; retry shortly.', 'overloaded', status, true);
  }
  if (status === 413 || type === 'request_too_large') {
    return new AiError('Photo is too large to send. Capture at a lower resolution.', 'too_large', status);
  }
  if (status === 404 || type === 'not_found_error') {
    return new AiError(`Model not found (404). Check the AI model in Settings${detail}`, 'bad_request', status);
  }
  if (status >= 500) {
    return new AiError(`Anthropic server error (${status})${detail}`, 'server', status, true);
  }
  return new AiError(`AI request failed (${status})${detail}`, 'bad_request', status);
}

export function createDirectClient(opts: DirectClientOptions): AiClient {
  const fetchImpl: FetchLike = opts.fetchImpl ?? ((u, i) => fetch(u, i));
  const model = opts.model?.trim() || DEFAULT_AI_MODEL;
  return {
    async analyze(req) {
      const res = await fetchWithTimeout(
        fetchImpl,
        opts.endpoint ?? ANTHROPIC_MESSAGES_URL,
        {
          method: 'POST',
          headers: {
            'x-api-key': opts.apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
            'content-type': 'application/json',
            // Required for browser (web build) calls; harmless on native.
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify(buildMessagesRequest(req, model, opts.maxTokens ?? DEFAULT_MAX_TOKENS)),
        },
        opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        'Anthropic',
      );
      const body = await readJson(res);
      if (!res.ok) throw anthropicError(res.status, body, res.headers?.get?.('retry-after') ?? null);
      return parseMessagesResponse(body, req);
    },
  };
}
