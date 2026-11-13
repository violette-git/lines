# LineMap Pro backend (Supabase): setup and operating guide

This guide is written for the business owner, not a database specialist. It explains what the
backend does, how to set it up step by step, and how the pieces fit together. Technical words are
explained the first time they appear.

## 1. What the backend is, in plain terms

- **Supabase** is a hosted service that gives you a Postgres database (where all company data
  lives), user sign-in, file storage for photos, and small server programs. You rent it; you do not
  run a server yourself.
- **Multi-tenant** means many customer companies share one database, and each company can only ever
  see its own data. In this system a customer company is called an **organization** (or "org").
- **RLS (Row Level Security)** is a Postgres feature that attaches a rule to every table, such as
  "you may only see rows whose org_id is one of your organizations". The database itself enforces
  this on every query, so even a bug in the app cannot show Company A's poles to Company B.
- **JWT (JSON Web Token)** is the signed "login ticket" the app receives when a user signs in. The
  app sends it with every request as `Authorization: Bearer <token>`. Supabase checks the
  signature, so nobody can fake being another user.
- **Edge Function** is a small server program hosted by Supabase (written in TypeScript and run by
  Deno, a JavaScript runtime). We have two: `analyze-photo` (the AI proxy) and `stripe-webhook`.
- **Service role key** is a master key that bypasses RLS. Only the Edge Functions use it, on the
  server. It must never be put in the app.
- **Webhook** is a web address that another company's system calls to tell you something happened.
  Stripe calls our `stripe-webhook` function when someone subscribes, upgrades, or cancels.
- **Stripe** is the payment processor that runs subscriptions and charges cards.

## 2. Files in this repo

| Path | What it is |
| --- | --- |
| `supabase/migrations/0001_init.sql` | Creates every table, security rule, trigger and helper function. |
| `supabase/seed.sql` | Demo data for a local test database only (one demo org, no real people). |
| `supabase/config.toml` | Supabase CLI settings: JWT check ON for analyze-photo, OFF for stripe-webhook. |
| `supabase/functions/analyze-photo/index.ts` | AI proxy: checks login, subscription and quota, calls Claude, records usage. |
| `supabase/functions/stripe-webhook/index.ts` | Keeps each org's plan, status, seats and AI quota in sync with Stripe. |
| `supabase/functions/_shared/cors.ts` | Shared web headers (CORS lets a browser page call the function). |
| `supabase/functions/_shared/prompt.ts` and `_shared/domain/*` | GENERATED exact copies of the app's `src/ai/prompt.ts` and `src/domain/*`. |
| `supabase/scripts/sync-prompt.mjs` | Regenerates those copies. Run it whenever the app's prompt or field lists change. |
| `supabase/tests/local/` | A test harness that runs the migration on a throwaway local Postgres and checks the security rules. |

## 3. One-time setup

You need Node.js installed (you already have it for Expo). The Supabase CLI runs through `npx`, so
nothing extra is installed into the project.

1. **Create the project.** Go to supabase.com, create an account and a new project. Pick a region
   near your customers and save the database password somewhere safe.
2. **Require email confirmation.** In the dashboard: Authentication, then Sign In / Providers,
   then Email: make sure "Confirm email" is ON. Invites are matched to the email in the user's login
   ticket, so unconfirmed emails would let someone claim an invite meant for another person.
3. **Link this folder to the project.** In a terminal at the repo root:
   ```
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   ```
   The project ref is the short id in your project URL (`https://<ref>.supabase.co`).
4. **Create the database tables (run the migration).** A migration is a SQL file that changes the
   database structure in a repeatable way.
   ```
   npx supabase db push
   ```
   This runs `supabase/migrations/0001_init.sql`. It enables PostGIS (map geometry support) in the
   `extensions` schema, which is the Supabase default for new projects. If you had already enabled
   PostGIS in another schema by hand, disable it first or ask for the migration to be adjusted.
   Do not run `seed.sql` on the live project; it is for local testing.
5. **Set secrets.** Secrets are private settings the functions read at run time. Supabase already
   provides `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` automatically.
   ```
   npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
   npx supabase secrets set STRIPE_SECRET_KEY=sk_live_...
   npx supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
   npx supabase secrets set STRIPE_PRICE_STARTER=price_... STRIPE_PRICE_PRO=price_... STRIPE_PRICE_ENTERPRISE=price_...
   ```
   Each price variable can hold several ids separated by commas (for example a monthly and a yearly
   price for the same plan). Optional secrets:
   - `AI_PRICING_JSON` to correct the per-model token prices used for cost estimates, for example
     `{"claude-sonnet-5-5":{"input":2,"output":10}}` (US dollars per million tokens).
   - `CORS_ALLOWED_ORIGIN` to restrict which website may call analyze-photo from a browser
     (default `*`, which is fine for a mobile app).
6. **Deploy the functions.**
   ```
   npx supabase functions deploy analyze-photo
   npx supabase functions deploy stripe-webhook
   ```
   `config.toml` already turns JWT checking off for stripe-webhook (Stripe cannot log in; the
   function checks Stripe's signature instead).
7. **Connect Stripe.** In the Stripe dashboard: Developers, Webhooks, Add endpoint.
   - URL: `https://<ref>.supabase.co/functions/v1/stripe-webhook`
   - Events: `checkout.session.completed`, `customer.subscription.created`,
     `customer.subscription.updated`, `customer.subscription.deleted`
   - Copy the endpoint's signing secret (`whsec_...`) into `STRIPE_WEBHOOK_SECRET` (step 5).
   - Create one Product per plan with a recurring Price, and put the price ids into the
     `STRIPE_PRICE_*` secrets.

## 4. How the app uses the AI proxy

The app has three AI modes in Settings:

- **Off**: no AI.
- **Direct**: the phone calls Anthropic with an API key typed into the phone. Fine for testing by
  you; never for customers, because each phone would hold a key and you could not meter usage.
- **Proxy**: the phone sends the photo to our `analyze-photo` function. The function holds the one
  Anthropic key, checks the user, the company's subscription and its monthly quota, calls Claude,
  logs the token usage, and sends the result back. This is the mode for paying customers.

To use proxy mode, set "Proxy URL" in Settings to:

```
https://<your-project-ref>.supabase.co/functions/v1/analyze-photo
```

The app must also be signed in to Supabase and send the user's login ticket. The app's
`src/ai/claudeProxy.ts` exposes `setProxyAuthTokenProvider(...)` for that; the sign-in screen must
call it with a function returning the current Supabase session's `access_token`. Until sign-in is
built, proxy mode will answer 401 (not signed in).

Request and response (the "wire contract"):

- `POST` with header `Authorization: Bearer <user JWT>` and JSON body
  `{ nodeType, imageBase64, mediaType, fieldDefs, context, model }`.
  Optional extra fields: `orgId` (required only if the user belongs to more than one organization),
  `projectId`, `nodeId` (stored with the usage record for reporting).
- Success: HTTP 200 with the `AiAnalysisResult` JSON the app already understands, plus
  `usage: { inputTokens, outputTokens }`.
- Failure: a non-2xx status with `{ error: "message for the user", code: "..." }`:

| Status | code | Meaning |
| --- | --- | --- |
| 400 | bad_request | Malformed request (unknown node type, bad image data, several orgs and no orgId). |
| 401 | unauthorized | Not signed in, or the session expired. |
| 402 | payment_required | The company's subscription is not active, or the free trial ended. |
| 403 | forbidden | Not a member of that organization, or the user is a Viewer. |
| 413 | too_large | Image over 5 MB (as base64 text). The app's 2048 px JPEGs are well under this. |
| 429 | quota | The company used its monthly AI photo allowance. Resets on the 1st (UTC). |
| 502 | upstream | Claude was unreachable, busy, timed out (55 s), or gave an unusable answer. |

Allowed models: `claude-sonnet-5-5` (default), `claude-haiku-5-5`, `claude-opus-5-5`. Any other
model name is replaced by the default. The prompt and tool schema are generated copies of the
app's own `src/ai/prompt.ts`, so proxy and direct modes ask Claude exactly the same question. When
that file or `src/domain/*` changes, run `node supabase/scripts/sync-prompt.mjs` and redeploy
analyze-photo. `node supabase/scripts/sync-prompt.mjs --check` fails if the copies are stale (good
for a pre-release checklist).

## 5. Who can do what (roles)

Every user belongs to one or more organizations with one role in each.

| Action | Owner | Admin | Manager | Tech | Viewer |
| --- | :-: | :-: | :-: | :-: | :-: |
| See the org's projects, nodes, spans, photos, templates | yes | yes | yes | yes | yes |
| Capture and edit nodes, spans, photos (including soft delete) | yes | yes | yes | yes | no |
| Use AI photo analysis | yes | yes | yes | yes | no |
| Create, edit, delete projects and client templates | yes | yes | yes | no | no |
| Permanently delete nodes, spans, photos | yes | yes | yes | no | no |
| See the whole org's AI usage and the audit log | yes | yes | yes | own usage only | own usage only |
| Invite members, change roles, remove members | yes | yes (not owners) | no | no | no |
| Rename the organization | yes | yes | no | no | no |
| Make someone an owner, or remove/demote an owner | yes | no | no | no | no |
| Change plan, seats or AI quota | Stripe only (via the webhook), never from the app |

Other rules the database enforces:

- Nobody can read or change another organization's data. This is checked on every table, and the
  storage bucket, and was tested (see section 9).
- New members join only by accepting an invite sent to their own (confirmed) email address, or by
  creating a new organization. Invites expire after 7 days and work once.
- Seat limit: joining fails once the org has as many members as `seat_limit`.
- An organization always keeps at least one owner.
- A user can own at most 3 organizations (stops people creating endless free trials).
- Photos live in the private `photos` storage bucket at `<org_id>/<project_id>/<photo_id>.jpg`
  (watermarked copy `<photo_id>_wm.jpg`). Only members of that org can read them; tech and up can
  upload; manager and up can delete.

## 6. Plans, billing and AI quota

Plan limits live in one place in code (`PLAN_LIMITS` in `stripe-webhook/index.ts`):

| Plan | Included seats | AI photos per month |
| --- | --- | --- |
| trial (14 days, automatic on signup) | 3 | 50 |
| starter | 5 | 500 |
| pro | 25 | 3000 |
| enterprise | 100 (or what they buy) | 20000 |

If a customer buys more seats than the plan includes (Stripe "quantity"), the seat limit rises to
match. Lowering seats below the current member count does not remove anyone; it only blocks new
members until someone leaves.

The web checkout page (Phase 2) must create the Stripe Checkout Session with
`client_reference_id = <org id>` and `subscription_data.metadata.org_id = <org id>`, so the webhook
knows which organization paid. The webhook ignores duplicate and out-of-order events.

AI quota is checked and reserved in one database step that locks the org row, so two phones
pressing "Analyze" at the same moment cannot both slip past the limit. If Claude never answers,
the reservation is released. If Claude answers (even with an unusable result) the photo counts,
because Anthropic billed for it.

### Pricing AI usage (cost per photo)

Each analysis is billed by Anthropic in **tokens** (small chunks of text; images are converted to
tokens too). Cost per photo = input tokens x input price + output tokens x output price.

Rough budget for one 2048 px photo (measure your own, see below):

| Part | Approx. tokens |
| --- | --- |
| Instructions (system prompt) | about 1,200 input |
| Field list / tool schema for one node type | about 1,000 to 2,000 input |
| The photo | about 1,600 to 4,500 input (depends on resolution the model uses) |
| Claude's answer | about 500 to 1,000 output |

Using the default per-million-token prices in the code (Sonnet 5.5 $2 in / $10 out, Haiku 5.5
$0.10 / $0.50, Opus 5.5 $4 / $20; these came from third-party summaries, so verify them on
Anthropic's official pricing page before you set customer prices), one photo costs roughly:
Sonnet about 1 to 2.5 cents, Haiku about a tenth of a cent, Opus about 2 to 5 cents.

The reliable method is to measure:

1. Run a pilot of 30 to 50 real photos in proxy mode.
2. In the Supabase SQL editor run:
   ```sql
   select model, count(*) as photos,
          round(avg(input_tokens)) as avg_in, round(avg(output_tokens)) as avg_out,
          round(avg(cost_usd_estimate), 4) as avg_cost_usd
   from ai_usage where status = 'ok' group by model;
   ```
3. Price each plan so its included photos cost at most 15 to 25 percent of the plan price. Example:
   pro includes 3000 photos; at 2 cents each that is $60 of AI cost per month at full use, so a pro
   price of $250 or more per month keeps healthy margin. Most customers will not use their full
   allowance.

`ai_usage_monthly` (a database view) shows photos, tokens and estimated cost per org per month.

## 7. Phase 2: live sync design (already built into the tables)

In Phase 1 the app stores everything on the phone. Phase 2 adds syncing to the server so a crew and
the office see the same data. The tables are ready for it:

- Every synced row (templates, projects, nodes, spans, photos) has `org_id`, `created_by`,
  `created_at`, `updated_at` (server clock), `client_updated_at` (the phone's clock when the edit
  was made), `deleted_at` and `rev`.
- **rev** is a number from one shared counter that goes up on every insert or update. A phone
  remembers the highest rev it has seen and asks "give me everything with rev greater than N".
- **Soft delete**: deleting sets `deleted_at` instead of removing the row, so other phones learn
  about the deletion on their next pull. Old tombstones can be purged later by a scheduled job.
- **Last-write-wins (LWW)**: a database trigger silently ignores an update whose
  `client_updated_at` is older than the stored one. If two techs edit the same node offline, the
  later edit wins no matter which phone syncs first.
- `created_by`, `created_at` and `org_id` cannot be changed after insert; `rev` and `updated_at` are
  always set by the server.

Planned RPCs (an RPC is a database function the app can call by name):

- `sync_push(org_id uuid, changes jsonb)`: upserts batches of rows per table in dependency order
  (templates, projects, nodes, spans, photos). RLS and the LWW trigger apply automatically; returns
  the new rev of each row plus any rows that were rejected.
- `sync_pull(org_id uuid, since_rev bigint, limit int)`: returns rows from all synced tables with
  `rev > since_rev`, ordered by rev, including tombstones, plus the highest rev returned.
- Caveat to handle then: two transactions can take rev numbers and commit in the opposite order,
  so a pull could skip a row whose lower rev committed late. Fix: pull only up to a "safe" rev
  (for example ignore revs newer than a couple of seconds) or re-pull a small overlap window.
- Photos: upload the file to the bucket first, then push the `photos` row with `storage_path`.
- Known offline conflicts to design for: two phones giving different nodes the same `seq` number
  (no uniqueness is enforced on purpose), and two primary photos on one node.

Projects and nodes are not linked to `ai_usage` by foreign key on purpose, because in Phase 1 they
do not exist on the server yet.

## 8. App stores: sell on the web, the app only signs in

Apple and Google take 15 to 30 percent of digital subscriptions sold inside an app and require
their own in-app purchase systems for that. The common approach for business (B2B) software is:

- Customers subscribe on your website through Stripe (owner or admin, from a laptop).
- The mobile app has no prices, no "buy" or "upgrade" buttons, and only lets people sign in. When a
  subscription is inactive, the app shows a neutral message such as "Your company's subscription is
  not active. Contact your administrator."
- Apple's rules have specific allowances for apps used by an organization's employees and for
  "reader"-style sign-in apps, and court rulings in some regions have changed what apps may link
  to. These rules change; read the current App Store Review Guidelines (section 3.1) and Google
  Play's Payments policy, or ask a lawyer, before submitting.

## 9. What was tested, and how to re-run it

`supabase/tests/local/run_local.sh` creates a throwaway Postgres 16 database with PostGIS, adds
small stand-ins for Supabase's `auth` and `storage` schemas and its `anon`, `authenticated` and
`service_role` roles, runs the migration and the seed, then signs in as several fake users and
checks more than 60 rules, including:

- Another org's owner sees zero of your organizations, projects, nodes, spans, templates, invites,
  audit rows, photos and AI usage, and cannot insert, update or delete any of them.
- A node in your own org cannot point at another org's project.
- Techs can add and soft-delete nodes but cannot create projects, hard delete, or promote
  themselves. Viewers cannot write anything. Admins cannot touch owners.
- Owners cannot change plan, seats or quota (only the webhook can).
- Seat limit, last-owner protection, invite email matching and one-time use.
- Span lines follow their nodes when a node is moved; rev increases; last-write-wins holds.
- The AI quota reservation stops at the limit and only the server can call it.
- Every table in `public` has RLS turned on, and signed-out users have no table access at all.

Run it on a machine with PostgreSQL 15+ and PostGIS installed:

```
bash supabase/tests/local/run_local.sh
```

It ends with `ALL RLS TESTS PASSED` or stops at the first failure.

## 10. Day-to-day operations

- **Give a customer more AI or seats by hand** (for example an enterprise deal): in the SQL editor,
  `update organizations set ai_monthly_photo_quota = 50000, seat_limit = 250 where slug = '...';`
  The next Stripe event for that customer will reset these to the plan values, so for custom deals
  either create a custom Stripe price mapped to enterprise or adjust `PLAN_LIMITS`.
- **Who changed this pole?** `select * from audit_log where row_id = '<node id>' order by at desc;`
- **Monthly AI bill per customer:** `select * from ai_usage_monthly order by month desc;`
- **Adding a table later:** new tables must have `org_id`, RLS enabled, policies using
  `is_org_member` / `has_org_role`, and `revoke all ... from anon`. Supabase grants new tables to
  signed-out users by default, so the revoke matters.
