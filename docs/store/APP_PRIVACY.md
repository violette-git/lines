# App Privacy (Apple) and Data safety (Google Play) answers

These answers match the privacy policy (src/legal/privacy.ts, served at /legal/privacy) and the
iOS privacy manifest (`ios.privacyManifests` in app.json). If the app changes what it collects
(for example adding analytics, crash reporting or background location), update all three.

Facts these answers rely on:

- The app has accounts (name, email, password) and stores field data (photos, precise GPS,
  labels, notes, measurements) for the user's company on Supabase.
- AI photo analysis sends the chosen photo to Anthropic through our server. Anthropic is our
  service provider.
- Voice input uses the phone's own speech recognition (Apple or Google). The app receives text
  only; it never uploads or stores audio.
- No ads, no advertising ID, no analytics or crash-reporting SDK, no tracking, no data sold.
- Billing happens on the website with Stripe, not in the app.

## Apple: App Store Connect, App Privacy

"Do you or your third-party partners collect data from this app?" **Yes.**

For every data type below: **Linked to the user: Yes. Used for tracking: No.
Purpose: App Functionality** (and nothing else).

| Apple category | Data type | Why |
| --- | --- | --- |
| Contact Info | Name | Account profile, shown to the user's company |
| Contact Info | Email Address | Sign-in, invitations, password reset |
| Location | Precise Location | Each node and photo stores where it was captured |
| User Content | Photos or Videos | Field photos stored for the company and sent for AI analysis |
| User Content | Other User Content | Labels, notes, measurements, templates |
| Identifiers | User ID | Account ID that links records to the user |
| Usage Data | Product Interaction | AI analysis counts per user for plan limits; activity log of edits |

Do **not** select: Coarse Location (precise covers it), Audio Data (audio never leaves the device
through us; Apple's speech service is Apple's own), Purchases (no purchases in the app), Financial
Info, Health, Contacts, Browsing or Search History, Sensitive Info, Diagnostics (no crash or
performance SDK), Advertising Data, Device ID.

"Tracking": **No.** The app does not use the App Tracking Transparency prompt and must not.

## Google Play: Data safety form

### Overview questions

| Question | Answer |
| --- | --- |
| Does your app collect or share any of the required user data types? | Yes |
| Is all of the user data collected by your app encrypted in transit? | Yes |
| Which of the following methods of account creation does your app support? | Username and password (and any other method the auth screens add, such as sign-in links) |
| Delete account URL | `https://[WEB DOMAIN]/legal/delete-account` |
| Do you provide a way for users to request that some or all of their data is deleted, without requiring them to delete their account? | Yes (by email to [SUPPORT EMAIL]; field data can also be deleted by the company in the app) |
| Has your app undergone an independent security review (MASA)? | No (unless you commission one) |

"Shared" in Google's form means sent to a third party that is not acting as your service
provider. Supabase, Anthropic and Stripe process data on our behalf, so nothing is "shared".

### Data types

For every row: **Collected: Yes. Shared: No. Processed ephemerally: No.**

| Google category | Data type | Required or optional | Purposes |
| --- | --- | --- | --- |
| Location | Precise location | Required (core feature) | App functionality |
| Personal info | Name | Required | App functionality, Account management |
| Personal info | Email address | Required | App functionality, Account management |
| Personal info | User IDs | Required | App functionality, Account management |
| Photos and videos | Photos | Required (core feature) | App functionality |
| App activity | Other user-generated content | Required | App functionality |
| App activity | App interactions | Required | App functionality (AI quota and activity log) |

Not collected: Approximate location (precise covers it), Financial info, Health and fitness,
Messages, Audio (see note), Files and docs, Calendar, Contacts, Web browsing, App info and
performance (no crash logs or diagnostics), Device or other IDs.

Note on audio: on Android the app hands voice input to the system speech recognizer (Google). The
app never receives or uploads audio, only the text result, so it is not declared. If your
attorney or Google's review prefers to be conservative, declare "Audio: Voice or sound
recordings, collected, optional, processed ephemerally, App functionality" and add one line to
the privacy policy; no code change is needed either way.

## iOS privacy manifest (already in app.json)

`ios.privacyManifests` declares:

- `NSPrivacyTracking: false`, no tracking domains.
- Required reason APIs used by the app and its libraries: UserDefaults (CA92.1), file timestamps
  (C617.1, 0A2A.1, 3B52.1), system boot time (35F9.1), disk space (E174.1, 85F4.1). These match
  the privacy manifests shipped inside React Native, expo-constants, expo-file-system,
  expo-application, expo-system-ui and AsyncStorage in node_modules. Expo merges them into
  `ios/LineMapPro/PrivacyInfo.xcprivacy` at build time.
- Collected data types: the same seven as the App Privacy table above.

After the first TestFlight upload, App Store Connect emails you if any library uses a required
reason API that is not declared. If that happens, add the missing type and reason to app.json and
rebuild.
