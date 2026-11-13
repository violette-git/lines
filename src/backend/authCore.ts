// Pure helpers for accounts, companies and roles. No React Native or Supabase imports here, so
// everything in this file is easy to unit test and safe to reuse from the web admin dashboard.
import { WEB_APP_URL } from './config';
import { ROLE_RANK, type OrgRole, type OrgSummary } from './contracts';

const ROLES: readonly OrgRole[] = ['owner', 'admin', 'manager', 'tech', 'viewer'];
const PLANS: readonly OrgSummary['plan'][] = ['trial', 'starter', 'pro', 'enterprise'];

export const isOrgRole = (v: unknown): v is OrgRole => typeof v === 'string' && (ROLES as readonly string[]).includes(v);

/** Plain-language names for roles, shown in the app. */
export const ROLE_LABEL: Record<OrgRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  manager: 'Manager',
  tech: 'Field tech',
  viewer: 'Viewer',
};

/** One-line explanation of what each role can do. */
export const ROLE_HINT: Record<OrgRole, string> = {
  owner: 'Full control, including billing and other owners.',
  admin: 'Manages members, projects and billing.',
  manager: 'Creates projects and templates, cleans up data.',
  tech: 'Captures and edits nodes, spans and photos.',
  viewer: 'Can look at everything but cannot change anything.',
};

export const PLAN_LABEL: Record<OrgSummary['plan'], string> = {
  trial: 'Free trial',
  starter: 'Starter',
  pro: 'Pro',
  enterprise: 'Enterprise',
};

/**
 * Row shape returned by
 *   from('org_members').select('role, organizations(id, name, slug, plan, subscription_status,
 *     seat_limit, ai_monthly_photo_quota, trial_ends_at)')
 * PostgREST returns the embedded parent as an object; some typings call it an array, so accept both.
 */
export interface OrgMemberRow {
  role: unknown;
  organizations: OrgRowLike | OrgRowLike[] | null;
}
interface OrgRowLike {
  id?: unknown;
  name?: unknown;
  slug?: unknown;
  plan?: unknown;
  subscription_status?: unknown;
  seat_limit?: unknown;
  ai_monthly_photo_quota?: unknown;
  trial_ends_at?: unknown;
}

export const ORG_MEMBER_SELECT =
  'role, organizations(id, name, slug, plan, subscription_status, seat_limit, ai_monthly_photo_quota, trial_ends_at)';

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Maps membership rows to OrgSummary, dropping malformed rows, sorted by name. */
export function mapOrgRows(rows: readonly OrgMemberRow[] | null | undefined): OrgSummary[] {
  const out: OrgSummary[] = [];
  const seen = new Set<string>();
  for (const r of rows ?? []) {
    const o = Array.isArray(r.organizations) ? r.organizations[0] : r.organizations;
    const id = str(o?.id);
    if (!o || !id || seen.has(id) || !isOrgRole(r.role)) continue;
    seen.add(id);
    const plan = str(o.plan);
    out.push({
      id,
      name: str(o.name) ?? 'Unnamed company',
      slug: str(o.slug) ?? '',
      role: r.role,
      plan: plan && (PLANS as readonly string[]).includes(plan) ? (plan as OrgSummary['plan']) : 'trial',
      subscriptionStatus: str(o.subscription_status),
      seatLimit: num(o.seat_limit),
      aiMonthlyPhotoQuota: num(o.ai_monthly_photo_quota),
      trialEndsAt: str(o.trial_ends_at),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** Keeps the stored choice if it is still valid, otherwise picks the first company (or none). */
export function pickActiveOrg(orgs: readonly OrgSummary[], stored: string | null | undefined): string | null {
  if (stored && orgs.some((o) => o.id === stored)) return stored;
  return orgs[0]?.id ?? null;
}

export function roleForOrg(orgs: readonly OrgSummary[], orgId: string | null | undefined): OrgRole | null {
  if (!orgId) return null;
  return orgs.find((o) => o.id === orgId)?.role ?? null;
}

export const atLeast = (r: OrgRole | null, min: OrgRole) => r != null && ROLE_RANK[r] >= ROLE_RANK[min];

/** Short status line for a company's subscription, without prices. */
export function subscriptionLabel(o: Pick<OrgSummary, 'plan' | 'subscriptionStatus' | 'trialEndsAt'>, now = Date.now()): string {
  const s = o.subscriptionStatus;
  if (s === 'trialing' || (o.plan === 'trial' && !s)) {
    if (!o.trialEndsAt) return 'Free trial';
    const days = Math.ceil((new Date(o.trialEndsAt).getTime() - now) / 86_400_000);
    if (!Number.isFinite(days)) return 'Free trial';
    if (days <= 0) return 'Trial ended';
    return `Free trial, ${days} day${days === 1 ? '' : 's'} left`;
  }
  if (s === 'active') return `${PLAN_LABEL[o.plan]} plan, active`;
  if (s === 'past_due' || s === 'unpaid') return 'Payment problem';
  if (s === 'canceled' || s === 'incomplete_expired') return 'Subscription ended';
  if (s === 'paused') return 'Subscription paused';
  if (s === 'incomplete') return 'Setup not finished';
  return PLAN_LABEL[o.plan];
}

/** True when AI and other paid features should work for this company right now. */
export function isSubscriptionUsable(o: Pick<OrgSummary, 'subscriptionStatus' | 'trialEndsAt'>, now = Date.now()): boolean {
  if (o.subscriptionStatus === 'active') return true;
  if (o.subscriptionStatus === 'trialing') return !o.trialEndsAt || new Date(o.trialEndsAt).getTime() > now;
  return false;
}

// ------------------------------------------------------------------------------------------------
// Invites
// ------------------------------------------------------------------------------------------------

/** Invite tokens are 48 hex characters from the database; accept any reasonable url-safe token. */
const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s;
  }
}

/** Reads one query parameter from a URL-ish string without relying on the URL class. */
function queryParam(url: string, name: string): string | null {
  const q = url.indexOf('?');
  if (q < 0) return null;
  const hash = url.indexOf('#', q);
  const query = url.slice(q + 1, hash < 0 ? undefined : hash);
  for (const part of query.split('&')) {
    const eq = part.indexOf('=');
    const k = safeDecode(eq < 0 ? part : part.slice(0, eq));
    if (k === name) return safeDecode(eq < 0 ? '' : part.slice(eq + 1)).trim();
  }
  return null;
}

/**
 * Pulls an invite token out of whatever the user pasted or the OS opened:
 *   - a bare token
 *   - linemappro://org/join?token=...      (app link)
 *   - https://linemap.pro/org/join?token=... (web link)
 *   - .../invite/<token> or ?invite=<token> (older or hand-made links)
 * Returns null when nothing usable is found.
 */
export function parseInviteToken(input: string | null | undefined): string | null {
  const raw = (input ?? '').trim();
  if (!raw) return null;
  if (TOKEN_RE.test(raw)) return raw;
  const fromQuery = queryParam(raw, 'token') ?? queryParam(raw, 'invite');
  if (fromQuery != null) return TOKEN_RE.test(fromQuery) ? fromQuery : null;
  const path = raw.split(/[?#]/)[0];
  const m = path.match(/\/(?:invite|join)\/([A-Za-z0-9_-]{16,128})\/?$/);
  return m ? m[1] : null;
}

/** True when a URL (or path) points at the invite screen. */
export function isInviteUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  let rest = url.trim();
  const m = rest.match(/^([a-z][a-z0-9+.-]*):\/\/(.*)$/i);
  if (m) {
    rest = m[2];
    // Web and Expo dev links have a host; custom schemes (linemappro://org/join) put the path first.
    if (/^(https?|exps?)$/i.test(m[1])) rest = rest.replace(/^[^/?#]*/, '').replace(/^\/--(?=\/)/, '');
  }
  return /^\/*(org\/join|invite)(\/|\?|#|$)/i.test(rest);
}

export const APP_SCHEME = 'linemappro';

/** Links to put in invite emails. The web link works everywhere; the app link opens the installed app. */
export function buildInviteLinks(token: string, webBase: string = WEB_APP_URL): { web: string; app: string } {
  const t = encodeURIComponent(token);
  return { web: `${webBase.replace(/\/+$/, '')}/org/join?token=${t}`, app: `${APP_SCHEME}://org/join?token=${t}` };
}

// ------------------------------------------------------------------------------------------------
// Sign-up form helpers
// ------------------------------------------------------------------------------------------------

export const MIN_PASSWORD_LENGTH = 8;

export function isValidEmail(email: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
}

export interface PasswordStrength {
  /** 0 (empty) to 4 (strong). */
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  hint: string;
  ok: boolean;
}

export function passwordStrength(pw: string): PasswordStrength {
  if (!pw) return { score: 0, label: '', hint: `Use at least ${MIN_PASSWORD_LENGTH} characters.`, ok: false };
  if (pw.length < MIN_PASSWORD_LENGTH) {
    return { score: 1, label: 'Too short', hint: `Use at least ${MIN_PASSWORD_LENGTH} characters.`, ok: false };
  }
  let variety = 0;
  if (/[a-z]/.test(pw)) variety++;
  if (/[A-Z]/.test(pw)) variety++;
  if (/[0-9]/.test(pw)) variety++;
  if (/[^A-Za-z0-9]/.test(pw)) variety++;
  const common = /^(password|12345678|qwerty|letmein|linemap)/i.test(pw) || /^(.)\1+$/.test(pw);
  if (common) return { score: 1, label: 'Too easy to guess', hint: 'Avoid common words and repeated characters.', ok: false };
  const lengthBonus = pw.length >= 14 ? 2 : pw.length >= 11 ? 1 : 0;
  const total = variety + lengthBonus;
  if (total >= 5) return { score: 4, label: 'Strong', hint: 'Nice. Hard to guess.', ok: true };
  if (total >= 4) return { score: 3, label: 'Good', hint: 'A longer phrase makes it even stronger.', ok: true };
  return { score: 2, label: 'Fair', hint: 'Mix in numbers, capitals or symbols, or make it longer.', ok: true };
}

// ------------------------------------------------------------------------------------------------
// Friendly errors
// ------------------------------------------------------------------------------------------------

const AUTH_CODE_MESSAGES: Record<string, string> = {
  invalid_credentials: 'That email and password do not match. Check for typos, or reset your password.',
  email_not_confirmed: 'Please confirm your email first. Open the link we sent you, then sign in.',
  user_already_exists: 'An account with this email already exists. Sign in instead.',
  email_exists: 'An account with this email already exists. Sign in instead.',
  weak_password: 'That password is too easy to guess. Try a longer one.',
  over_email_send_rate_limit: 'Too many emails sent. Wait a few minutes and try again.',
  over_request_rate_limit: 'Too many tries. Wait a minute and try again.',
  signup_disabled: 'New sign-ups are turned off right now.',
  email_address_invalid: 'That email address does not look right.',
  same_password: 'The new password must be different from the old one.',
  user_not_found: 'No account found for that email.',
  validation_failed: 'Please check the details and try again.',
};

/** Turns Supabase auth, database and network errors into one plain sentence for the user. */
export function friendlyAuthError(err: unknown): string {
  const e = err as { code?: unknown; message?: unknown; name?: unknown; status?: unknown } | null;
  const code = typeof e?.code === 'string' ? e.code : '';
  if (code && AUTH_CODE_MESSAGES[code]) return AUTH_CODE_MESSAGES[code];
  const msg = typeof e?.message === 'string' ? e.message : typeof err === 'string' ? err : '';
  if (/network request failed|failed to fetch|fetch failed|networkerror|load failed|timed? ?out/i.test(msg) || e?.name === 'AuthRetryableFetchError') {
    return 'Could not reach the server. Check your signal and try again.';
  }
  if (/invalid login credentials/i.test(msg)) return AUTH_CODE_MESSAGES.invalid_credentials;
  if (/email not confirmed/i.test(msg)) return AUTH_CODE_MESSAGES.email_not_confirmed;
  if (code === '28000' || /not signed in|jwt expired|invalid jwt/i.test(msg)) return 'Your session ended. Sign in again.';
  if (msg) return msg.length > 220 ? `${msg.slice(0, 217)}...` : msg;
  return 'Something went wrong. Please try again.';
}

export class AuthUnavailableError extends Error {
  constructor() {
    super('Accounts are not set up in this build. You can keep using the app on this phone without an account.');
    this.name = 'AuthUnavailableError';
  }
}

/**
 * The `next` query parameter of the sign-in and sign-up screens, made safe: only a path inside
 * this app ("/admin", "/project/abc?x=1"). Anything else (other sites, "//host", "/\\host",
 * "javascript:", control characters, the auth screens themselves) gives null, so a crafted link
 * cannot send someone to another website after they sign in.
 */
export function safeNextPath(raw: unknown): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v !== 'string') return null;
  const p = v.trim();
  if (!p.startsWith('/') || p.length > 512) return null;
  if (p.startsWith('//') || p.startsWith('/\\')) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(p)) return null;
  // The path part may be decoded again later (by the router or the browser). Judge the fully
  // decoded form too, so "/%2F%2Fevil.example", "/%5Cevil.example" and "/a/../..//evil.example"
  // cannot turn into a link to another host.
  const pathPart = p.split(/[?#]/)[0];
  let decoded = pathPart;
  for (let i = 0; i < 3; i++) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      return null;
    }
    if (next === decoded) break;
    decoded = next;
  }
  if (!decoded.startsWith('/') || decoded.startsWith('//')) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(decoded)) return null;
  if (decoded.split('/').some((seg) => seg === '.' || seg === '..')) return null;
  if (/^\/auth(\/|$|\?)/.test(decoded)) return null;
  return p;
}
