// Proxy client: sends the photo to our backend (Supabase Edge Function), which holds the API key.
//
// Wire contract (keep in sync with supabase/functions):
//   POST <settings.proxyUrl>
//   Authorization: Bearer <token>        (omitted when no token)
//   Body: { nodeType, imageBase64, mediaType, fieldDefs, context, model, orgId? }
//         orgId is added only when an org provider returns one (signed-in company mode).
//   2xx:  AiAnalysisResult JSON
//   else: { error: string }
import type { AiAnalysisRequest, AiClient } from '@/domain/contracts';

import { AiError, DEFAULT_TIMEOUT_MS, fetchWithTimeout, readJson, type FetchLike } from './http';
import { DEFAULT_AI_MODEL, aiFillableDefs, normalizeAiResult } from './prompt';

export type AuthTokenProvider = () => Promise<string | null> | string | null;

let defaultAuthTokenProvider: AuthTokenProvider = () => null;

/** Lets the app inject the signed-in user's token (e.g. Supabase session access_token). */
export function setProxyAuthTokenProvider(fn: AuthTokenProvider | null): void {
  defaultAuthTokenProvider = fn ?? (() => null);
}

/** Returns the company (organization) id to bill and check the AI request against, or null. */
export type OrgIdProvider = (req: AiAnalysisRequest) => Promise<string | null> | string | null;

let defaultOrgIdProvider: OrgIdProvider = () => null;

/** Lets the app inject the active company id; the backend needs it when a user is in several companies. */
export function setProxyOrgIdProvider(fn: OrgIdProvider | null): void {
  defaultOrgIdProvider = fn ?? (() => null);
}

export interface ProxyClientOptions {
  url: string;
  model?: string;
  getAuthToken?: AuthTokenProvider;
  getOrgId?: OrgIdProvider;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}

export interface ProxyRequestBody {
  nodeType: AiAnalysisRequest['nodeType'];
  imageBase64: string;
  mediaType: AiAnalysisRequest['mediaType'];
  fieldDefs: AiAnalysisRequest['fieldDefs'];
  context: NonNullable<AiAnalysisRequest['context']>;
  model: string;
  orgId?: string;
}

export function buildProxyBody(req: AiAnalysisRequest, model: string, orgId?: string | null): ProxyRequestBody {
  const body: ProxyRequestBody = {
    nodeType: req.nodeType,
    imageBase64: req.imageBase64,
    mediaType: req.mediaType,
    fieldDefs: req.fieldDefs,
    context: req.context ?? {},
    model,
  };
  if (orgId) body.orgId = orgId;
  return body;
}

function proxyError(status: number, body: unknown): AiError {
  const b = body as { error?: unknown; _text?: string } | null;
  const msg = typeof b?.error === 'string' ? b.error : typeof b?._text === 'string' ? b._text : '';
  const detail = msg ? `: ${msg}` : '';
  if (status === 401) return new AiError(`Sign in again to use AI (401)${detail}`, 'auth', status);
  if (status === 403) return new AiError(`AI is not enabled for this account (403)${detail}`, 'permission', status);
  if (status === 402) return new AiError(`Your company's subscription is not active. Ask your admin to check billing (402)${detail}`, 'permission', status);
  if (status === 429) return new AiError(`Your company's monthly AI photo limit is used up (429)${detail}`, 'rate_limit', status, false);
  if (status === 529 || status === 503) return new AiError(`AI service is overloaded (${status})${detail}`, 'overloaded', status, true);
  if (status === 413) return new AiError('Photo is too large to send.', 'too_large', status);
  if (status >= 500) return new AiError(`AI proxy error (${status})${detail}`, 'server', status, true);
  return new AiError(`AI request failed (${status})${detail}`, 'bad_request', status);
}

export function createProxyClient(opts: ProxyClientOptions): AiClient {
  const fetchImpl: FetchLike = opts.fetchImpl ?? ((u, i) => fetch(u, i));
  const model = opts.model?.trim() || DEFAULT_AI_MODEL;
  return {
    async analyze(req) {
      const token = await (opts.getAuthToken ?? defaultAuthTokenProvider)();
      let orgId: string | null = null;
      try {
        orgId = await (opts.getOrgId ?? defaultOrgIdProvider)(req);
      } catch {
        orgId = null; // the server picks the org when the user has only one
      }
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetchWithTimeout(
        fetchImpl,
        opts.url,
        { method: 'POST', headers, body: JSON.stringify(buildProxyBody(req, model, orgId)) },
        opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        'the AI proxy',
      );
      const body = await readJson(res);
      if (!res.ok) throw proxyError(res.status, body);
      const b = body as { error?: unknown } | null;
      if (b && typeof b.error === 'string') throw new AiError(b.error, 'bad_response', res.status);
      try {
        return normalizeAiResult(body, { fieldDefs: aiFillableDefs(req.fieldDefs), fallbackType: req.nodeType });
      } catch (e) {
        throw new AiError(e instanceof Error ? e.message : 'Invalid AI proxy response', 'bad_response', res.status);
      }
    },
  };
}
