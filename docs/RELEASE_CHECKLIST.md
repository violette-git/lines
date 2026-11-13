# LineMap Pro release checklist: from zero to live in the App Store and Google Play

Written for the business owner. Work top to bottom. Each step says what it is, why it matters, and
how to do it. Words in `code style` are things you type or copy exactly.

Plain-language terms used below:

- **EAS** (Expo Application Services): Expo's cloud service that builds the iPhone and Android app
  files for you, so you do not need a Mac or Android Studio.
- **Build**: the installable app file. iPhone builds are `.ipa`, Android store builds are `.aab`
  (app bundle), Android test builds are `.apk`.
- **TestFlight**: Apple's app for installing test builds before release.
- **Internal testing track**: Google Play's equivalent for up to 100 testers.
- **Bundle ID / package name**: the app's permanent ID in the stores,
  `com.spottventures.linemappro`. It can never change after the first upload.
- **Version vs build number**: the version (`1.0.0` in app.json) is what customers see. The build
  number counts every upload; EAS stores it and adds one on every production build automatically.
- **D-U-N-S number**: a free company ID from Dun and Bradstreet that Apple and Google use to verify
  a business. Getting one can take up to a few weeks, so start early.

---

## Part 1. Accounts to create (do these first; some take days)

| # | Account | Cost | Notes |
| --- | --- | --- | --- |
| 1 | D-U-N-S number for Spott Ventures | Free | Request at dnb.com (search "D-U-N-S request Apple"). Needed for organization accounts below |
| 2 | Apple Developer Program, as an **organization** | 99 US dollars per year | developer.apple.com/programs. Enroll as the company so the store shows "Spott Ventures" as seller, not your personal name. Needs the D-U-N-S number and a company website on your domain |
| 3 | Google Play Console, as an **organization** | 25 US dollars one time | play.google.com/console. Organization accounts skip the "12 testers for 14 days" rule that applies to new personal accounts. Needs the D-U-N-S number |
| 4 | Expo account | Free tier works; paid plans give faster, more builds | expo.dev. Create an organization (for example `spott-ventures`) and invite yourself |
| 5 | Supabase project (backend) | Free tier for testing; a paid plan for production (free projects pause when idle) | Already documented in docs/BACKEND.md |
| 6 | Stripe account | Per-transaction fees | For subscriptions on the website (docs/BACKEND.md) |
| 7 | Anthropic API account | Pay per use | Key goes into Supabase secrets only, never into the app |
| 8 | Your domain and website hosting | Domain about 10 to 20 US dollars per year | Hosts the legal pages, support page, invite links and the web dashboard. See Part 5 |
| 9 | Commercial map tiles (MapTiler, Mapbox or Esri) | Depends on usage | The dev tile sources in src/map/basemaps.ts are not licensed for a commercial app. Must be swapped before launch |
| 10 | Business email for support | Varies | This becomes `[SUPPORT EMAIL]` |

## Part 2. Fill in every placeholder

Search the repo for `[` to find them all (`grep -rn "\[[A-Z]" src/legal docs/store eas.json`).

| Placeholder | Where | What to put |
| --- | --- | --- |
| `[SUPPORT EMAIL]` | src/legal/config.ts, docs/store/* | Public support address, for example support@yourdomain |
| `[LEGAL ENTITY NAME AND TYPE]` | src/legal/config.ts, docs/store/APP_STORE_LISTING.md (copyright) | Exact registered name, for example "Spott Ventures LLC" |
| `[COMPANY MAILING ADDRESS]` | src/legal/config.ts | A mailing address for legal notices (a PO box or registered agent address is fine) |
| `[SUPPORT RESPONSE TIME]` | src/legal/config.ts | For example "2 business days" |
| `[EFFECTIVE DATE]` (two) | src/legal/config.ts | The date the privacy policy and terms take effect |
| `[DAYS AFTER CANCELLATION]` | src/legal/config.ts | How long a cancelled company's data is kept before deletion |
| `[PURGE PERIOD]` | src/legal/config.ts | How long deleted items stay recoverable |
| `[BACKUP RETENTION]` | src/legal/config.ts | Your Supabase plan's backup retention |
| `[HOSTING REGION]` | src/legal/config.ts | The Supabase region you picked (for example United States East) |
| `[WEB DOMAIN]` | docs/store/* | Your website domain. Also see the next row |
| `linemap.pro` | app.json (`ios.associatedDomains`, `android.intentFilters`), src/backend/config.ts default | The code currently assumes `linemap.pro`. If you do not own it, replace every occurrence with your domain and set `EXPO_PUBLIC_WEB_APP_URL` |
| `[ASC APP ID]` | eas.json `submit.production.ios.ascAppId` | App Store Connect, your app, App Information, "Apple ID" (a number) |
| `[APPLE TEAM ID]` | eas.json `submit.production.ios.appleTeamId`, apple-app-site-association file | developer.apple.com, Membership details, Team ID (10 characters) |
| `./secrets/google-play-service-account.json` | eas.json `submit.production.android` | The Google service account key file (Part 7). Never commit it; add `secrets/` to .gitignore, or upload the key to EAS instead and delete this line |
| `[DEMO ACCOUNT EMAIL]`, `[DEMO ACCOUNT PASSWORD]` | docs/store/REVIEW_NOTES.md, GOOGLE_PLAY_LISTING.md | A real working login for reviewers (Part 8) |
| `[REVIEW CONTACT NAME]`, `[REVIEW CONTACT PHONE]` | docs/store/REVIEW_NOTES.md | Who Apple can call during review |
| `[ANDROID SHA256 FINGERPRINT]` | assetlinks.json (Part 5) | From `npx eas-cli@latest credentials`, Android, production keystore; or Play Console, App integrity, App signing key certificate |
| `LEGAL_REVIEWED = false` | src/legal/config.ts | Set to `true` only after the attorney review. While false, legal pages show a "template" banner |

## Part 3. Attorney review (required)

The privacy policy (`src/legal/privacy.ts`), terms of use (`src/legal/terms.ts`) and account
deletion page (`src/legal/support.ts`) are templates written to match what the app actually does.
They are not legal advice. Before launch, have an attorney review them, especially: the
processor/controller wording, state privacy laws (California and others), the Alabama governing
law and venue clause, the liability cap, the AI and Anthropic section (confirm Anthropic's current
API data terms), and retention periods. Then set `LEGAL_REVIEWED = true`.

## Part 4. One-time project setup

Run these in a terminal at the repo folder (`npx` downloads the tools; nothing is added to the app).

1. Sign in to Expo: `npx eas-cli@latest login`
2. Link the project: `npx eas-cli@latest init`. Because this project has `app.config.js`, the tool
   may print a project ID and ask you to add it yourself. If so, add to app.json inside `"expo"`:
   `"owner": "<your expo org>", "extra": { "eas": { "projectId": "<id it printed>" } }`.
3. Install the splash screen package (if it is not already in package.json):
   `npx expo install expo-splash-screen`, then add this entry to the `plugins` list in app.json:
   ```json
   ["expo-splash-screen", { "backgroundColor": "#0B0F14", "image": "./assets/splash-icon.png", "imageWidth": 200, "resizeMode": "contain" }]
   ```
   Without it, the app opens on a white Android launch screen with Expo's default logo.
4. Set the app's backend settings as EAS environment variables (these are baked into each build;
   the anon key is public by design, so `plaintext` is fine):
   ```
   npx eas-cli@latest env:create --environment production --name EXPO_PUBLIC_SUPABASE_URL --value https://<ref>.supabase.co --visibility plaintext
   npx eas-cli@latest env:create --environment production --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <anon key> --visibility plaintext
   npx eas-cli@latest env:create --environment production --name EXPO_PUBLIC_WEB_APP_URL --value https://<your domain> --visibility plaintext
   ```
   Repeat with `--environment preview` (and `development`) for test builds, pointing at a test
   Supabase project if you have one. Never put `ANTHROPIC_API_KEY`, `STRIPE_SECRET_KEY` or the
   Supabase service role key here; those live only in Supabase secrets.
5. GitHub repository secrets (repo Settings, Secrets and variables, Actions):
   - `EXPO_TOKEN`: create at expo.dev, Account settings, Access tokens. Used by the "EAS Build" and
     "Store release" workflows.
   - If you want the "Android APK" workflow's test APK to talk to the backend, also add
     `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` and pass them in that workflow.
6. Regenerate brand images after any design change: `node scripts/generate-assets.mjs --preview`.

## Part 5. Website pages and link files

The same app code serves the website (`npx expo export --platform web`). Make sure these URLs load
**without signing in**:

- `https://<domain>/legal/privacy` (App Store and Play: Privacy Policy URL)
- `https://<domain>/legal/terms`
- `https://<domain>/support` (App Store: Support URL)
- `https://<domain>/legal/delete-account` (Play: Delete account URL)

Because the web build is a single page app, your web host must send `index.html` for unknown paths
(a "rewrite" or "SPA fallback" setting on Netlify, Vercel, Cloudflare Pages and similar).

Invite links (`https://<domain>/org/join?token=...`) open the app directly only if the website
hosts two small files. Create them in the website's `/.well-known/` folder:

`/.well-known/apple-app-site-association` (no file extension, served as JSON):
```json
{ "applinks": { "details": [ { "appIDs": ["[APPLE TEAM ID].com.spottventures.linemappro"], "components": [ { "/": "/org/join*" }, { "/": "/invite/*" } ] } ] } }
```

`/.well-known/assetlinks.json`:
```json
[{ "relation": ["delegate_permission/common.handle_all_urls"], "target": { "namespace": "android_app", "package_name": "com.spottventures.linemappro", "sha256_cert_fingerprints": ["[ANDROID SHA256 FINGERPRINT]"] } }]
```

Use the Play App Signing key fingerprint (Play Console, App integrity) once Google manages signing.

## Part 6. Build and test on iPhone (TestFlight)

1. In App Store Connect (appstoreconnect.apple.com), My Apps, "+", New App: platform iOS, name
   `LineMap Pro`, language English (U.S.), bundle ID `com.spottventures.linemappro` (EAS registers
   it on the first build if it is not in the list yet; you can create the app record after), SKU
   `LINEMAPPRO-IOS-001`, full access.
2. Copy the app's Apple ID number into eas.json (`ascAppId`) and your Team ID (`appleTeamId`).
3. Build and upload: GitHub, Actions, "Store release", Run workflow, platform `ios`, submit `true`.
   Or from a terminal: `npx eas-cli@latest build --platform ios --profile production --auto-submit`.
   The first time, answer "yes" to let EAS create the signing certificate and provisioning profile.
4. About 15 to 30 minutes after upload, the build appears in App Store Connect, TestFlight. Add
   yourself and your testers (Internal Testing needs no review).
5. Install TestFlight on an iPhone, accept the invite, and run the test pass in Part 9.

## Part 7. Build and test on Android (internal testing)

1. In Play Console, Create app: name `LineMap Pro: Cable Mapping`, App, Free, accept the
   declarations.
2. Build: `npx eas-cli@latest build --platform android --profile production` (or the "Store
   release" workflow with platform `android` and submit `false` for this first one).
3. **First upload must be by hand**: Play Console, Testing, Internal testing, Create new release,
   accept Play App Signing, upload the `.aab` downloaded from the EAS build page, add release notes,
   save and roll out to internal testers. Add testers by email list.
4. For automatic uploads afterwards, create a Google service account: Google Cloud console,
   IAM, Service accounts, create one, create a JSON key; in Play Console, Users and permissions,
   invite the service account email with "Release apps to testing tracks" and "Release to
   production" permissions. Save the key as `secrets/google-play-service-account.json` (never
   commit it) or upload it with `npx eas-cli@latest credentials` (Android, Google Service Account).
5. After the app has been published once, change `releaseStatus` in eas.json from `draft` to
   `completed` so submissions roll out to the internal track without a manual click.

## Part 8. Demo account for reviewers (both stores)

Create, on the production backend:

- A company named for example "LineMap Demo Co" with an **active** subscription (or a long trial)
  and AI quota left.
- A user with email `[DEMO ACCOUNT EMAIL]` and password `[DEMO ACCOUNT PASSWORD]`, role owner or
  admin, email confirmed.
- One sample project with 10 or more nodes, real photos of equipment (no people, no plates), a few
  AI-filled values, and spans, so the reviewer sees the full workflow immediately.

Do not change the password or let the subscription lapse while a review is open.

## Part 9. Test pass before every store submission

On a real iPhone and a real Android phone, from a fresh install:

- [ ] Sign up, confirm email, sign in, accept an invite link (tap it in an email on the phone)
- [ ] Permission prompts show the LineMap Pro wording; deny each once and confirm the app explains
      how to turn it back on instead of crashing
- [ ] Capture 5 nodes in walk mode outdoors; GPS accuracy turns green; spans and footage appear
- [ ] Voice label works (tap microphone, speak, text appears)
- [ ] AI auto-fill on a real pole photo; the consent prompt appears the first time
- [ ] Airplane mode: capture still works; turn it off and confirm sync
- [ ] Export KMZ, Excel and PDF and open each one
- [ ] Settings and Account link to Privacy policy, Terms and Support; each page opens
- [ ] Account, Delete account works on a throwaway account
- [ ] No prices, "buy", "upgrade" or "subscribe" buttons anywhere in the iOS app
- [ ] iPad: every screen usable in portrait and landscape (the app supports iPad, so Apple tests it)
- [ ] App icon and launch screen look right (dark, amber mark)

## Part 10. Store listings and submission

1. Fill in the listing text from `docs/store/APP_STORE_LISTING.md` and
   `docs/store/GOOGLE_PLAY_LISTING.md`.
2. Upload screenshots from `docs/store/screenshots/` (retake the map shots on a device with
   satellite imagery first; see `docs/store/SCREENSHOTS.md`) and the Play graphics from
   `docs/store/graphics/`.
3. Apple App Privacy and Google Data safety: answer exactly as in `docs/store/APP_PRIVACY.md`.
4. Apple: paste the review notes and demo login from `docs/store/REVIEW_NOTES.md`; choose the
   TestFlight build; "Manually release this version" is safest for the first launch; Submit for
   Review. Typical review time is one to three days.
5. Google: promote the tested internal release to Closed testing or Production (Testing, select
   the release, Promote), complete every "App content" item, then Send for review. First reviews
   can take up to a week.

## Part 11. Store review gotchas (read before submitting)

- **Account deletion**: both stores require in-app deletion if users can create accounts. Ours is
  Account, Delete account, plus the public page `/legal/delete-account` for Google.
- **Demo sign-in**: the most common rejection for business apps is "we could not sign in". Test the
  demo login on a fresh install the day you submit.
- **Purchases**: the iOS app must not show prices or buy buttons, and outside the United States
  it must not link to the website to buy. We sell to companies for their employees (App Store
  guideline 3.1.3(c), Enterprise Services). If a reviewer objects to a "manage your plan on the
  web" link, set `SHOW_WEB_BILLING_LINK = false` in src/backend/authUi.tsx (or hide it on iOS).
- **Third-party AI**: Apple guideline 5.1.2(i) requires telling users that personal data (photos)
  is sent to a third-party AI and getting explicit permission before the first send. The app must
  show this consent prompt before the first AI analysis.
- **Permission strings**: Apple rejects vague text like "needs your location". Ours name the
  feature and reason (app.json `ios.infoPlist` and plugin settings). Only when-in-use location is
  requested; background location and motion strings are removed on purpose.
- **Privacy manifest**: declared in app.json `ios.privacyManifests`. If Apple emails "ITMS-91053:
  Missing API declaration" after an upload, add the API type and reason it names, then rebuild.
- **Export compliance**: answered in app.json (`usesNonExemptEncryption: false`). Only standard HTTPS is
  used. Revisit if you ever add custom encryption.
- **Location justification**: Google may ask why the app needs precise location. Answer: "Field
  crews photograph utility poles and cable equipment; precise location places each item on the map
  and measures cable footage between items. Location is used only while the app is in use."
- **Data safety must match the privacy policy**: Google compares them. Use APP_PRIVACY.md.
- **Map content rights**: ship with a commercial map provider and keep its attribution visible.
- **Legal pages without sign-in**: reviewers open the privacy URL in a browser; it must load for a
  signed-out visitor.

## Part 12. Later releases

1. Raise `version` in app.json for customer-visible releases (`1.0.1` fixes, `1.1.0` features).
   Build numbers go up automatically.
2. Run the "Store release" workflow (platform `all`, submit `true`).
3. Test in TestFlight and internal testing (Part 9), then submit the new version for review.

## Known open items (from the store-readiness work)

- No AI consent prompt exists yet (required by Apple 5.1.2(i)).
- `expo-splash-screen` is not installed (Part 4, step 3).
- `expo-dev-client` is not installed, so the `development` EAS profile produces a plain debug build
  without the Expo developer menu. Install it only if you want development builds.
- On Android, the system photo picker removes location data from imported photos, so "place an
  imported photo at its EXIF location" may not work on Android.
- Commercial map tiles still need to be configured (src/map/basemaps.ts).
- Store screenshots come from the web preview (no imagery, no photos); retake on a device.
