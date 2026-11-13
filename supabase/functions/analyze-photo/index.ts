// analyze-photo: AI proxy for LineMap Pro (Supabase Edge Function, Deno).
//
// The app POSTs { nodeType, imageBase64, mediaType, fieldDefs, context, model, orgId?, projectId?,
// nodeId? } with "Authorization: Bearer <user JWT>". This function checks who the caller is, that
// their company has an active subscription and AI quota left, calls Claude with the company's
// shared Anthropic key, records usage, and returns AiAnalysisResult JSON.
//
// Error responses are non-2xx with { error: string } plus a machine-readable "code":
//   400 bad_request      malformed body
//   401 unauthorized     missing or invalid login
//   402 payment_required subscription not active or trial ended
//   403 forbidden        not a member of the org, or viewer role
//   405 method           not POST
//   413 too_large        image over 5 MB (base64)
//   429 quota            monthly AI photo quota used up
//   500 server_config    missing secrets
//   502 upstream         Anthropic error, timeout, or unusable response

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { errorJson, handleCors, json } from '../_shared/cors.ts';
// prompt.ts and domain/* are generated copies of the app's src/ai/prompt.ts and src/domain/*
// (supabase/scripts/sync-prompt.mjs), so proxy mode sends Claude exactly what direct mode sends.
import {
  aiFillableDefs,
  buildRecordNodeTool,
  buildUserPrompt,
  DEFAULT_MAX_TOKENS,
  normalizeAiResult,
  RECORD_NODE_TOOL,
  SYSTEM_PROMPT,
} from '../_shared/prompt.ts';
import type { AiAnalysisRequest, AiAnalysisResult } from '../_shared/domain/contracts.ts';
import type { FieldDef } from '../_shared/domain/nodeSchemas.ts';
import { NODE_TYPES } from '../_shared/domain/types.ts';

// ---------- Config ----------
const ALLOWED_MODELS = ['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5'] as const;
type AllowedModel = (typeof ALLOWED_MODELS)[number];
const DEFAULT_MODEL: AllowedModel = 'claude-sonnet-5-5';

/** Base64 length limit for the image (5 MiB of base64 characters). */
const MAX_IMAGE_B64 = 5 * 1024 * 1024;
/** Whole request body limit: image plus field definitions and context. */
const MAX_BODY_BYTES = MAX_IMAGE_B64 + 512 * 1024;
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
/** Below the app's 60 s client timeout, so the app never gives up on a call we are still paying for. */
const UPSTREAM_TIMEOUT_MS = 55_000;
const TECH_ROLES = ['owner', 'admin', 'manager', 'tech'];

/**
 * USD per million tokens, used only for the cost estimate stored in ai_usage. VERIFY against
 * Anthropic's pricing page before setting customer prices; override without redeploying code via
 * the AI_PRICING_JSON secret, e.g. {"claude-sonnet-5-5":{"input":2,"output":10}}.
 */
const DEFAULT_PRICING: Record<string, { input: number; output: number }> = {
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
  'claude-opus-5-5': { input: 4, output: 20 },
};

function pricing(): Record<string, { input: number; output: number }> {
  const raw = Deno.env.get('AI_PRICING_JSON');
  if (!raw) return DEFAULT_PRICING;
  try {
    return { ...DEFAULT_PRICING, ...JSON.parse(raw) };
  } catch {
    console.warn('AI_PRICING_JSON is not valid JSON; using defaults');
    return DEFAULT_PRICING;
  }
}

function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = pricing()[model];
  if (!p) return 0;
  return Number(((inputTokens * p.input + outputTokens * p.output) / 1_000_000).toFixed(6));
}

// ---------- Validation ----------
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELD_KEY_RE = /^[A-Za-z0-9_]{1,64}$/;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const WORK_TYPES = ['aerial', 'underground', 'mixed', 'qc'];
const FIELD_KINDS = ['text', 'number', 'select', 'boolean'];
const UNITS = ['ft', 'in', 'count', 'pct'];

class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public extra: Record<string, unknown> = {}) {
    super(message);
  }
}

function shortStr(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.replace(/[\u0000-\u001f]/g, ' ').trim();
  return t ? t.slice(0, max) : undefined;
}

function optUuid(v: unknown, name: string): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || !UUID_RE.test(v)) throw new HttpError(400, 'bad_request', `${name} must be a UUID`);
  return v;
}

function validateFieldDefs(v: unknown): FieldDef[] {
  if (!Array.isArray(v)) throw new HttpError(400, 'bad_request', 'fieldDefs must be an array');
  if (v.length > 150) throw new HttpError(400, 'bad_request', 'Too many fieldDefs (max 150)');
  const out: FieldDef[] = [];
  for (const raw of v) {
    if (typeof raw !== 'object' || raw === null) throw new HttpError(400, 'bad_request', 'Invalid field definition');
    const r = raw as Record<string, unknown>;
    if (typeof r.key !== 'string' || !FIELD_KEY_RE.test(r.key)) {
      throw new HttpError(400, 'bad_request', 'Field keys must be 1-64 letters, digits or underscores');
    }
    if (typeof r.kind !== 'string' || !FIELD_KINDS.includes(r.kind)) {
      throw new HttpError(400, 'bad_request', `Field ${r.key} has an invalid kind`);
    }
    const def: FieldDef = {
      key: r.key,
      label: shortStr(r.label, 100) ?? r.key,
      kind: r.kind as FieldDef['kind'],
      aiFillable: r.aiFillable === true,
    };
    if (typeof r.unit === 'string' && UNITS.includes(r.unit)) def.unit = r.unit as FieldDef['unit'];
    if (Array.isArray(r.options)) {
      def.options = r.options.slice(0, 60).map((o) => shortStr(o, 100)).filter((o): o is string => Boolean(o));
    }
    if (def.kind === 'select' && (!def.options || def.options.length === 0)) def.kind = 'text';
    if (r.aiEstimateOnly === true) def.aiEstimateOnly = true;
    const help = shortStr(r.help, 300);
    if (help) def.help = help;
    out.push(def);
  }
  if (!out.some((d) => d.aiFillable)) throw new HttpError(400, 'bad_request', 'No AI-fillable fields requested');
  return out;
}

interface ParsedBody {
  req: AiAnalysisRequest;
  model: AllowedModel;
  orgId: string | null;
  projectId: string | null;
  nodeId: string | null;
  imageBytes: number;
}

function validateBody(body: unknown): ParsedBody {
  if (typeof body !== 'object' || body === null) throw new HttpError(400, 'bad_request', 'Body must be a JSON object');
  const b = body as Record<string, unknown>;

  const nodeType = b.nodeType;
  if (typeof nodeType !== 'string' || (nodeType !== 'auto' && !(NODE_TYPES as string[]).includes(nodeType))) {
    throw new HttpError(400, 'bad_request', 'nodeType must be a known node type or "auto"');
  }
  if (b.mediaType !== 'image/jpeg' && b.mediaType !== 'image/png') {
    throw new HttpError(400, 'bad_request', 'mediaType must be image/jpeg or image/png');
  }
  if (typeof b.imageBase64 !== 'string' || b.imageBase64.length === 0) {
    throw new HttpError(400, 'bad_request', 'imageBase64 is required');
  }
  // Tolerate a data: URL prefix and line breaks even though the contract says plain base64.
  let image = b.imageBase64;
  const comma = image.startsWith('data:') ? image.indexOf(',') : -1;
  if (comma >= 0) image = image.slice(comma + 1);
  image = image.replace(/\s+/g, '');
  if (image.length > MAX_IMAGE_B64) {
    throw new HttpError(413, 'too_large', 'Image is larger than 5 MB. Resize or compress it and try again.');
  }
  if (!BASE64_RE.test(image)) throw new HttpError(400, 'bad_request', 'imageBase64 is not valid base64');

  const fieldDefs = validateFieldDefs(b.fieldDefs);

  let context: AiAnalysisRequest['context'];
  if (typeof b.context === 'object' && b.context !== null) {
    const c = b.context as Record<string, unknown>;
    context = {};
    if (typeof c.workType === 'string' && WORK_TYPES.includes(c.workType)) {
      context.workType = c.workType as NonNullable<AiAnalysisRequest['context']>['workType'];
    }
    const client = shortStr(c.client, 120);
    if (client) context.client = client;
    const prev = shortStr(c.previousLabel, 60);
    if (prev) context.previousLabel = prev;
  }

  const model: AllowedModel = (ALLOWED_MODELS as readonly string[]).includes(b.model as string)
    ? (b.model as AllowedModel)
    : DEFAULT_MODEL;

  return {
    req: {
      nodeType: nodeType as AiAnalysisRequest['nodeType'],
      imageBase64: image,
      mediaType: b.mediaType,
      fieldDefs,
      context,
    },
    model,
    orgId: optUuid(b.orgId, 'orgId'),
    projectId: optUuid(b.projectId, 'projectId'),
    nodeId: optUuid(b.nodeId, 'nodeId'),
    imageBytes: Math.floor((image.length * 3) / 4),
  };
}

// ---------- Org + billing checks ----------
interface OrgRow {
  id: string;
  subscription_status: string;
  trial_ends_at: string | null;
  ai_monthly_photo_quota: number;
}

async function resolveOrg(userClient: SupabaseClient, admin: SupabaseClient, userId: string, requested: string | null): Promise<OrgRow> {
  // Read through the user's own client so RLS guarantees we only see the caller's memberships.
  const { data: memberships, error } = await userClient
    .from('org_members')
    .select('org_id, role')
    .eq('user_id', userId);
  if (error) throw new HttpError(500, 'server_error', 'Could not load memberships');
  const rows = (memberships ?? []) as { org_id: string; role: string }[];

  let membership: { org_id: string; role: string } | undefined;
  if (requested) {
    membership = rows.find((m) => m.org_id === requested);
    if (!membership) throw new HttpError(403, 'forbidden', 'You are not a member of this organization');
  } else {
    const eligible = rows.filter((m) => TECH_ROLES.includes(m.role));
    if (rows.length === 0) throw new HttpError(403, 'forbidden', 'Your account is not part of any organization yet');
    if (eligible.length === 1) membership = eligible[0];
    else if (eligible.length === 0) membership = rows[0];
    else throw new HttpError(400, 'bad_request', 'You belong to several organizations: send orgId');
  }
  if (!TECH_ROLES.includes(membership.role)) {
    throw new HttpError(403, 'forbidden', 'Your role is view-only. Ask an admin for tech access to use AI.');
  }

  const { data: org, error: orgErr } = await admin
    .from('organizations')
    .select('id, subscription_status, trial_ends_at, ai_monthly_photo_quota')
    .eq('id', membership.org_id)
    .single();
  if (orgErr || !org) throw new HttpError(500, 'server_error', 'Could not load organization');
  return org as OrgRow;
}

function assertSubscription(org: OrgRow): void {
  if (org.subscription_status === 'active') return;
  if (org.subscription_status === 'trialing') {
    if (!org.trial_ends_at || new Date(org.trial_ends_at).getTime() > Date.now()) return;
    throw new HttpError(402, 'payment_required', 'Your free trial has ended. An owner or admin can subscribe on the web.');
  }
  throw new HttpError(402, 'payment_required', `Subscription is ${org.subscription_status}. An owner or admin can update billing on the web.`, {
    subscriptionStatus: org.subscription_status,
  });
}

// ---------- Anthropic call ----------
/** Same body as the app's direct mode (src/ai/claudeDirect.ts buildMessagesRequest). */
function buildMessagesBody(req: AiAnalysisRequest, model: string): Record<string, unknown> {
  return {
    model,
    max_tokens: DEFAULT_MAX_TOKENS,
    system: SYSTEM_PROMPT,
    tools: [buildRecordNodeTool(req.fieldDefs)],
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

/** Caps string sizes so a runaway model answer cannot bloat the app's local database. */
function capResult(r: AiAnalysisResult): AiAnalysisResult {
  for (const f of Object.values(r.fields)) {
    if (typeof f.value === 'string') f.value = f.value.slice(0, 1000);
    if (f.note) f.note = f.note.slice(0, 500);
  }
  r.summary = r.summary.slice(0, 2000);
  r.warnings = r.warnings.slice(0, 30).map((w) => w.slice(0, 500));
  if (r.suggestedLabel) r.suggestedLabel = r.suggestedLabel.slice(0, 80);
  return r;
}

interface AnthropicResponse {
  content?: { type: string; name?: string; input?: unknown; text?: string }[];
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { type?: string; message?: string };
}

async function callClaude(apiKey: string, body: Record<string, unknown>): Promise<AnthropicResponse> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    const timedOut = e instanceof DOMException && e.name === 'AbortError';
    throw new HttpError(502, 'upstream', timedOut ? 'AI service timed out' : 'Could not reach AI service');
  } finally {
    clearTimeout(timer);
  }

  let parsed: AnthropicResponse;
  try {
    parsed = (await res.json()) as AnthropicResponse;
  } catch {
    throw new HttpError(502, 'upstream', `AI service returned an unreadable response (HTTP ${res.status})`);
  }
  if (!res.ok) {
    const msg = parsed.error?.message ?? `HTTP ${res.status}`;
    console.error('anthropic error', res.status, parsed.error?.type, msg);
    const busy = res.status === 429 || res.status === 529;
    throw new HttpError(502, 'upstream', busy ? 'AI service is busy. Try again in a minute.' : `AI service error: ${msg}`, {
      upstreamStatus: res.status,
    });
  }
  return parsed;
}

// ---------- Handler ----------
Deno.serve(async (request: Request): Promise<Response> => {
  const pre = handleCors(request);
  if (pre) return pre;
  if (request.method !== 'POST') return errorJson(405, 'Use POST', { code: 'method' });

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY || !ANTHROPIC_API_KEY) {
    console.error('analyze-photo: missing secrets');
    return errorJson(500, 'Server is not configured', { code: 'server_config' });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  let usageId: string | null = null;
  const started = Date.now();

  try {
    // 1. Who is calling?
    const authHeader = request.headers.get('Authorization') ?? '';
    const token = authHeader.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) throw new HttpError(401, 'unauthorized', 'Sign in required');

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser(token);
    if (userErr || !userData?.user) throw new HttpError(401, 'unauthorized', 'Session expired. Sign in again.');
    const user = userData.user;

    // 2. Size check before reading the body into memory.
    const declared = Number(request.headers.get('content-length') ?? '0');
    if (declared > MAX_BODY_BYTES) {
      throw new HttpError(413, 'too_large', 'Image is larger than 5 MB. Resize or compress it and try again.');
    }
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) {
      throw new HttpError(413, 'too_large', 'Image is larger than 5 MB. Resize or compress it and try again.');
    }
    let rawBody: unknown;
    try {
      rawBody = JSON.parse(text);
    } catch {
      throw new HttpError(400, 'bad_request', 'Body must be valid JSON');
    }
    const parsed = validateBody(rawBody);

    // 3. Which company, and may it use AI right now?
    const org = await resolveOrg(userClient, admin, user.id, parsed.orgId);
    assertSubscription(org);

    // 4. Reserve one photo of quota atomically (row lock on the org in SQL).
    const { data: reservation, error: resErr } = await admin.rpc('ai_reserve_usage', {
      p_org_id: org.id,
      p_user_id: user.id,
      p_model: parsed.model,
      p_project_id: parsed.projectId,
      p_node_id: parsed.nodeId,
      p_image_bytes: parsed.imageBytes,
    });
    if (resErr || !reservation) throw new HttpError(500, 'server_error', 'Could not check AI quota');
    const r = reservation as { ok: boolean; reason?: string; usage_id?: string; used?: number; quota?: number };
    if (!r.ok) {
      if (r.reason === 'quota') {
        throw new HttpError(429, 'quota', `Monthly AI photo limit reached (${r.used} of ${r.quota}). It resets on the 1st (UTC), or upgrade the plan.`, {
          used: r.used,
          quota: r.quota,
        });
      }
      throw new HttpError(403, 'forbidden', 'Organization not found');
    }
    usageId = r.usage_id ?? null;

    // 5. Ask Claude.
    const claude = await callClaude(ANTHROPIC_API_KEY, buildMessagesBody(parsed.req, parsed.model));
    const inputTokens = claude.usage?.input_tokens ?? 0;
    const outputTokens = claude.usage?.output_tokens ?? 0;
    const tool = claude.content?.find((c) => c.type === 'tool_use' && c.name === RECORD_NODE_TOOL);
    const unusable = !tool ? 'no tool_use block' : claude.stop_reason === 'max_tokens' ? 'max_tokens reached' : null;

    // 6. Claude answered, so tokens were billed: record them now (service role; users cannot write
    //    ai_usage). The photo counts against quota even if the answer turns out unusable.
    if (usageId) {
      const { error: updErr } = await admin.from('ai_usage').update({
        status: 'ok',
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost_usd_estimate: estimateCostUsd(parsed.model, inputTokens, outputTokens),
        latency_ms: Date.now() - started,
        error: unusable,
      }).eq('id', usageId);
      if (updErr) console.error('ai_usage update failed', updErr.message);
      usageId = null;
    }

    if (!tool || unusable) throw new HttpError(502, 'upstream', 'AI returned an incomplete answer. Try again.');

    let result: AiAnalysisResult;
    try {
      result = capResult(normalizeAiResult(tool.input, {
        fieldDefs: aiFillableDefs(parsed.req.fieldDefs),
        fallbackType: parsed.req.nodeType,
      }));
    } catch {
      throw new HttpError(502, 'upstream', 'AI returned an unusable answer. Try again.');
    }
    result.usage = { inputTokens, outputTokens };

    return json(200, result);
  } catch (e) {
    const err = e instanceof HttpError ? e : new HttpError(500, 'server_error', 'Unexpected server error');
    if (!(e instanceof HttpError)) console.error('analyze-photo unexpected', e);
    // usageId is still set only if Claude never answered: release the reservation so failed
    // calls do not eat quota.
    if (usageId) {
      await admin.from('ai_usage').update({
        status: 'error',
        error: err.message.slice(0, 500),
        latency_ms: Date.now() - started,
      }).eq('id', usageId);
    }
    return errorJson(err.status, err.message, { code: err.code, ...err.extra });
  }
});
