# LineMap Pro billing (Stripe): setup and how it works

Written for the business owner. Technical words are explained the first time they appear.
Read `docs/BACKEND.md` first: billing builds on the Supabase backend described there.

## 1. The pieces

- **Stripe** is the payment company. It stores the cards, charges them every month or year,
  emails receipts, and retries failed payments. Card numbers never reach LineMap Pro.
- **Product** (in Stripe) is a thing you sell: one per plan (Starter, Pro, Enterprise).
- **Price** (in Stripe) is how much a product costs and how often: for each plan you create a
  monthly price and a yearly price. Each price has an id that starts with `price_`.
- **Per seat** (Stripe calls it "per unit") means the price is multiplied by the number of seats.
  A **seat** is one person in the company, whatever their role.
- **Checkout** is Stripe's hosted payment page. The dashboard's Billing page sends the owner or
  admin there to pay. Function: `supabase/functions/create-checkout`.
- **Customer Portal** is Stripe's hosted "manage my subscription" page: change plan or seats,
  update the card, download invoices, cancel. Function: `supabase/functions/billing-portal`.
- **Webhook** is how Stripe tells us something changed (paid, upgraded, canceled). Our
  `stripe-webhook` function updates the company's plan, status, seat limit and AI allowance.
  Nothing in the app or dashboard can change those columns; only the webhook can.

Flow: Billing page, then `create-checkout` (checks the person is owner or admin, creates or reuses
the company's Stripe customer, starts Checkout), then Stripe Checkout, then Stripe calls
`stripe-webhook`, then the company's plan updates, then the browser returns to `/admin/billing`.

## 2. Prices and plans in the code

`src/admin/plans.ts` is the single place for what customers see: names, per-seat prices
(monthly and yearly), seat ranges, AI photo allowance and feature lists. The prices there are
**placeholders** (`PRICES_ARE_PLACEHOLDERS = true` shows a "placeholder prices" notice on the
pricing and billing pages). When real prices are decided:

1. Create the Stripe prices (section 3) with the same amounts.
2. Change the numbers in `src/admin/plans.ts` and set `PRICES_ARE_PLACEHOLDERS = false`.
3. If you change seat ranges, change `SEAT_RULES` in `supabase/functions/create-checkout/logic.ts`
   to match (a unit test fails if they differ).
4. If you change AI allowances, change `PLAN_LIMITS` in `supabase/functions/stripe-webhook/index.ts`
   to match (a unit test fails if they differ). The webhook is what actually sets the allowance.

The page only displays prices; Stripe charges whatever the Stripe price says. Keep them equal.

## 3. One-time Stripe setup

Do everything first in **test mode** (the "Test mode" switch in the Stripe dashboard). Test mode
has its own keys, products and webhooks, and moves no real money.

1. **Products and prices.** Stripe dashboard, Product catalog, Add product, three times:
   - Name: `LineMap Pro Starter` (then Pro, then Enterprise).
   - Add a price: Recurring, **Per unit**, Monthly, amount = the monthly per-seat price.
   - Add a second price on the same product: Recurring, Per unit, **Yearly**, amount = 12 times
     the yearly per-seat monthly price (for example 12 x $57 = $684 per seat per year).
   - Copy each price id (`price_...`).
   - Enterprise: create prices only if you want to sell it through Checkout. Otherwise leave its
     secret empty; the pricing page sends Enterprise buyers to email instead.
2. **Secrets.** Each plan secret holds that plan's price ids, comma separated (monthly and yearly
   in any order; checkout tells them apart by billing interval). These are the same secrets the
   webhook already uses to recognize plans.
   ```
   npx supabase secrets set STRIPE_SECRET_KEY=sk_test_...
   npx supabase secrets set STRIPE_PRICE_STARTER=price_monthA,price_yearA
   npx supabase secrets set STRIPE_PRICE_PRO=price_monthB,price_yearB
   npx supabase secrets set STRIPE_PRICE_ENTERPRISE=price_monthC,price_yearC
   npx supabase secrets set WEB_APP_URL=https://your-dashboard-domain
   ```
   `WEB_APP_URL` is the website address where the dashboard runs (must be `https://`;
   `http://localhost` is accepted for local testing). Stripe sends people back to
   `WEB_APP_URL/admin/billing` after paying or canceling. The website build needs the same value
   in `EXPO_PUBLIC_WEB_APP_URL` (it is also used for invite links).
   Optional:
   - `STRIPE_AUTOMATIC_TAX=1` turns on Stripe Tax in Checkout (see section 6).
   - `STRIPE_PORTAL_CONFIGURATION_ID=bpc_...` to use a specific portal setup.
   - `CORS_ALLOWED_ORIGIN=https://your-dashboard-domain` so only your website can call the
     functions from a browser (CORS is the browser rule that decides which sites may call an API).
3. **Deploy the functions.** Both check the user's login, so JWT checking stays ON (the default).
   ```
   npx supabase functions deploy create-checkout
   npx supabase functions deploy billing-portal
   ```
4. **Webhook endpoint.** Stripe dashboard, Developers, Webhooks, Add endpoint:
   - URL: `https://<project-ref>.supabase.co/functions/v1/stripe-webhook`
   - Events: `checkout.session.completed`, `customer.subscription.created`,
     `customer.subscription.updated`, `customer.subscription.deleted`
   - Copy the signing secret: `npx supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...`
5. **Customer Portal.** Stripe dashboard, Settings, Billing, Customer portal. Turn on:
   - Payment methods (update card), Invoice history, Customer information (billing address).
   - Subscriptions: **Cancel** (choose "at end of billing period"), **Update quantity** (seats)
     with a sensible maximum, and **Switch plan** with the Starter, Pro (and Enterprise if sold)
     products and both prices each. Proration (charging only for the part of the period used)
     should be on.
   - Business information: your support email, terms and privacy links (`/legal/terms`,
     `/legal/privacy` on your site). Save. The portal will not open until this page is saved.
6. **Branding.** Settings, Branding: logo, accent color `#FFB020`, so Checkout looks like LineMap Pro.
7. Repeat steps 1 to 5 in **live mode** with the live keys (`sk_live_...`) when ready to charge.

## 4. Testing with fake cards (test mode only)

- Card that works: `4242 4242 4242 4242`, any future expiry, any 3-digit CVC, any ZIP.
- Card that is declined: `4000 0000 0000 0002`.
- Card that needs extra bank approval (3-D Secure): `4000 0025 0000 3155`.
- Card that pays first, then fails on renewal: `4000 0000 0000 0341`.

Checklist:

1. Sign in to the dashboard as the owner of a test company (still on the free trial).
2. Billing, choose Pro, yearly, Continue to checkout, pay with 4242.
3. Back on the Billing page, the plan shows Pro and Active within a few seconds (the webhook may
   land a moment after the browser returns; the page refreshes itself after 4 seconds).
4. In Supabase, `select plan, subscription_status, seat_limit, ai_monthly_photo_quota,
   stripe_customer_id from organizations where id = '<org id>';` shows the new values.
5. Manage billing opens the Stripe portal. Change seats to 12: after returning, the seat limit is 12.
6. Cancel in the portal: status becomes `canceled` at the period end (or right away if you chose
   that), and the phone app's AI proxy stops with "subscription not active".
7. Stripe dashboard, Developers, Webhooks, your endpoint: every event shows 200. A 400 means the
   signing secret is wrong; a 500 means look at the function logs in Supabase.

If the free trial still has more than two days left when someone subscribes, the remaining
trial days carry over (Stripe shows "trial until ..." and charges when it ends).

## 5. How seats work

- The company's **seat limit** is what the database enforces: once the company has that many
  members, accepting another invite fails, and the dashboard will not create new invites.
- Buying N seats sets the limit to N. Note: the webhook currently sets the limit to the larger
  of the purchased seats and the plan's included seats in `PLAN_LIMITS` (Starter 5, Pro 25,
  Enterprise 100). With per-seat pricing that gives small teams extra free seats; see the open
  item in the build report. Change `update.seat_limit` in `stripe-webhook/index.ts` to `quantity`
  if you want the limit to equal what was bought.
- Checkout never sells fewer seats than the company already has members, nor fewer than the plan
  minimum, nor more than the plan maximum.
- Removing seats in the portal never removes people. If the limit drops below the member count,
  nobody new can join until someone leaves or seats are added.
- Removing a person on the Team page frees their seat immediately (billing quantity does not
  change by itself; lower it in Manage billing if you want to pay for fewer seats).

## 6. Taxes

Stripe does not collect sales tax unless you turn it on. Options:

- **Stripe Tax** (paid add-on): register where you must collect tax, turn on Stripe Tax, set the
  product tax code to "Software as a service (SaaS), business use", then set
  `STRIPE_AUTOMATIC_TAX=1`. Checkout will ask for the billing address and add tax.
- Or handle tax yourself with your accountant.

SaaS (software as a service) tax rules differ by state and country; ask an accountant which
apply to Spott Ventures before charging real customers.

## 7. App Store and Google Play rule: no buying in the phone app

Apple and Google require their own in-app purchase systems (and take 15 to 30 percent) for
digital subscriptions bought inside an app. LineMap Pro sells on the website instead, so:

- The phone app shows **no prices, no plan names with prices, no buy or upgrade buttons, and no
  links to the pricing or billing pages**. The `/pricing` route shows a neutral "plans are managed
  by your company" message on phones, and the dashboard's "open on a computer" button sends
  billing paths to the dashboard home instead of the billing page.
- When a subscription is inactive, the app says to contact the company administrator.
- Apple's guidelines (section 3.1) and Google Play's Payments policy change, and court rulings in
  some regions allow some outside links. Check the current rules before each store submission.

## 8. Troubleshooting

| What you see | Likely cause |
| --- | --- |
| "Billing is not configured yet" | `STRIPE_SECRET_KEY` or a valid `https` `WEB_APP_URL` secret is missing. |
| "No yearly price is set up for the pro plan yet" | `STRIPE_PRICE_PRO` lacks an active, per-unit, every-1-year price. |
| "This company already has a subscription" | Use Manage billing to change plans; a second subscription is blocked on purpose. |
| Plan does not update after paying | Webhook endpoint URL, events or `STRIPE_WEBHOOK_SECRET` wrong; or the price id is not in `STRIPE_PRICE_*`. Check the webhook log in Stripe. |
| "Could not open the billing portal" | The Customer Portal settings page was never saved (step 5). |
| "There is no billing account yet" | The company has never been through Checkout. |
