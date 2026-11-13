// delete-account: in-app account deletion for LineMap Pro (Supabase Edge Function, Deno).
//
// Apple and Google require apps that let people create accounts to also let them delete those
// accounts from inside the app. The app POSTs { deleteSoleOrgs?: boolean } with
// "Authorization: Bearer <user JWT>". The function:
//   1. checks who is calling (the login ticket must be valid; nobody can delete someone else),
//   2. runs public.delete_account_prepare() with the service role. That database function enforces
//      the rules and removes memberships, the profile and personal data in invites, or reports
//      what blocks the deletion without changing anything,
//   3. removes the photo files of companies deleted along with the account,
//   4. deletes the login itself with auth.admin.deleteUser().
//
// Responses (non-2xx bodies are { error: string, code: string, ... } like analyze-photo):
//   200 { ok: true, deletedOrgs: [{ org_id, org_name }], leftOrgs: [...] }
//   401 unauthorized       missing or invalid login
//   405 method             not POST
//   409 blocked            { blocked: [{ org_id, org_name, reason, other_members }] }
//                          reason: sole_owner_with_members | sole_member_needs_consent | active_subscription
//   500 server_config / server_error / auth_delete_failed (data removed, login not; safe to retry)

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { errorJson, handleCors, json } from '../_shared/cors.ts';

const PHOTO_BUCKET = 'photos';

interface PrepareResult {
  ok: boolean;
  blocked?: { org_id: string; org_name: string; reason: string; other_members: number }[];
  deleted_orgs?: { org_id: string; org_name: string }[];
  left_orgs?: { org_id: string; org_name: string }[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function blockedMessage(p: PrepareResult): string {
  const first = p.blocked?.[0];
  if (!first) return 'Your account cannot be deleted yet.';
  if (first.reason === 'sole_owner_with_members') {
    return `You are the only owner of ${first.org_name}. Make someone else an owner first, then try again.`;
  }
  if (first.reason === 'active_subscription') {
    return `${first.org_name} still has a subscription. Cancel it on the website first, then try again.`;
  }
  return `Deleting your account would also delete ${first.org_name}. Confirm that you want the company deleted too.`;
}

/** Removes every file under <orgId>/ in the photos bucket (project folders, then files). Best effort. */
async function removeOrgPhotos(admin: SupabaseClient, orgId: string): Promise<number> {
  if (!UUID_RE.test(orgId)) return 0;
  const bucket = admin.storage.from(PHOTO_BUCKET);
  let removed = 0;
  const pageSize = 1000;
  const folders: string[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await bucket.list(orgId, { limit: pageSize, offset });
    if (error || !data?.length) break;
    for (const e of data) if (e.id == null) folders.push(`${orgId}/${e.name}`);
    if (data.length < pageSize) break;
  }
  for (const folder of folders) {
    // Always list from the start: removed files drop out of the listing.
    for (let guard = 0; guard < 1000; guard++) {
      const { data, error } = await bucket.list(folder, { limit: pageSize });
      if (error || !data?.length) break;
      const paths = data.filter((e) => e.id != null).map((e) => `${folder}/${e.name}`);
      if (!paths.length) break;
      for (let i = 0; i < paths.length; i += 100) {
        const { error: rmErr } = await bucket.remove(paths.slice(i, i + 100));
        if (rmErr) return removed;
        removed += Math.min(100, paths.length - i);
      }
      if (data.length < pageSize) break;
    }
  }
  return removed;
}

Deno.serve(async (request: Request): Promise<Response> => {
  const pre = handleCors(request);
  if (pre) return pre;
  if (request.method !== 'POST') return errorJson(405, 'Use POST', { code: 'method' });

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
    console.error('delete-account: missing secrets');
    return errorJson(500, 'Server is not configured', { code: 'server_config' });
  }

  // 1. Who is calling? Only the verified user id from the login ticket is ever used.
  const token = (request.headers.get('Authorization') ?? '').match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return errorJson(401, 'Sign in required', { code: 'unauthorized' });
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser(token);
  const user = userData?.user;
  if (userErr || !user) return errorJson(401, 'Session expired. Sign in again.', { code: 'unauthorized' });

  let deleteSoleOrgs = false;
  try {
    const text = await request.text();
    if (text.trim()) {
      const body = JSON.parse(text) as { deleteSoleOrgs?: unknown } | null;
      deleteSoleOrgs = body?.deleteSoleOrgs === true;
    }
  } catch {
    return errorJson(400, 'Body must be valid JSON', { code: 'bad_request' });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  // 2. Rules and data removal, in one database transaction.
  const { data: prepRaw, error: prepErr } = await admin.rpc('delete_account_prepare', {
    p_user_id: user.id,
    p_delete_sole_orgs: deleteSoleOrgs,
  });
  if (prepErr || !prepRaw) {
    console.error('delete-account: prepare failed', prepErr?.message);
    return errorJson(500, 'Could not delete your account right now. Please try again.', { code: 'server_error' });
  }
  const prep = prepRaw as PrepareResult;
  if (!prep.ok) {
    return errorJson(409, blockedMessage(prep), { code: 'blocked', blocked: prep.blocked ?? [] });
  }

  // 3. Photo files of companies that were deleted with the account.
  for (const org of prep.deleted_orgs ?? []) {
    try {
      await removeOrgPhotos(admin, org.org_id);
    } catch (e) {
      console.error('delete-account: photo cleanup failed for', org.org_id, e instanceof Error ? e.message : e);
    }
  }

  // 4. The login itself.
  const { error: delErr } = await admin.auth.admin.deleteUser(user.id);
  if (delErr) {
    console.error('delete-account: deleteUser failed', delErr.message);
    return errorJson(500, 'Your data was removed, but the login could not be deleted. Please try again in a minute.', {
      code: 'auth_delete_failed',
    });
  }

  return json(200, { ok: true, deletedOrgs: prep.deleted_orgs ?? [], leftOrgs: prep.left_orgs ?? [] });
});
