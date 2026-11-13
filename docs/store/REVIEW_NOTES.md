# Notes for app reviewers

## Apple: App Review Information (App Store Connect, version page)

Sign-in required: **Yes**

| Field | Value |
| --- | --- |
| User name | `[DEMO ACCOUNT EMAIL]` |
| Password | `[DEMO ACCOUNT PASSWORD]` |
| Contact first and last name | `[REVIEW CONTACT NAME]` |
| Contact phone | `[REVIEW CONTACT PHONE]` |
| Contact email | `[SUPPORT EMAIL]` |

Before submitting, make sure the demo account belongs to a demo company that has an active
subscription, AI quota left, and a sample project with photos, so the reviewer sees every feature
without doing setup. Do not let the demo subscription lapse during review.

### Notes (paste into the "Notes" box)

```
LineMap Pro is a business tool for telecom field crews who map cable and fiber plant (utility poles, handholes, vaults, pedestals). A crew member takes a photo, the app records the GPS position, places a node on the map, and calculates cable footage between nodes.

ACCOUNTS AND PURCHASES
- LineMap Pro is sold only to companies (contractors and network operators) for use by their employees. A company owner or admin subscribes on our website and invites their crew by email.
- The app contains no in-app purchases, no prices, and no purchase buttons. Users sign in with the account their company created. We believe this is covered by App Store Review Guideline 3.1.3(c), Enterprise Services.
- Please sign in with the demo account provided. It belongs to a demo company with an active subscription and a sample project.

ACCOUNT DELETION
- Account > Delete account deletes the user's account from inside the app (Guideline 5.1.1(v)). Public instructions: https://[WEB DOMAIN]/legal/delete-account

AI FEATURE (THIRD-PARTY AI DISCLOSURE)
- "AI auto-fill" sends a photo the user chooses to analyze to Anthropic's Claude model, through our server, to read pole tags and equipment labels and suggest field values. Suggestions show a confidence level and must be reviewed by the user.
- The app explains this and asks for the user's permission before the first photo is sent. Companies can turn AI off. The privacy policy (https://[WEB DOMAIN]/legal/privacy, section 5) describes it.

PERMISSIONS
- Camera: photograph equipment. Location (when in use only, never background): place each photo and node on the map and measure footage. Microphone and speech recognition: optional voice labels, started by tapping a microphone button. Photo library: import existing field photos (system picker). Local network: connect to a GPS/GNSS receiver on the crew's Wi-Fi.

HOW TO TRY IT
1. Sign in, open the demo project "Demo: Morris Ave fiber route".
2. The map shows the mapped route. Tap a node to see its photo and AI-filled fields.
3. Tap the camera button to capture a new node (allow camera and location).
4. Use the share button on the project to export a KMZ, Excel or PDF file.
```

Before pasting, confirm the "AI FEATURE" paragraph is true: Apple's guideline 5.1.2(i) requires
apps to clearly disclose and get the user's explicit permission before sharing personal data with
third-party AI. See "Store review risks" in docs/RELEASE_CHECKLIST.md.

## Google Play: App access

See "App access instructions" in docs/store/GOOGLE_PLAY_LISTING.md (same demo account).

## Common rejection reasons for this kind of app, and our answer

| Reason | Where it is handled |
| --- | --- |
| 2.1 App completeness: reviewer cannot sign in | Working demo account with live subscription (above) |
| 3.1.1 In-app purchase: digital subscription sold outside the app | No purchase UI or prices in the iOS app; enterprise sales on the web (3.1.3(c)). Consider hiding any "manage plan on the web" link on iOS (see checklist) |
| 4.8 Sign in with Apple | Only needed if the app offers third-party or social sign-in (Google, Facebook and so on). Email and password only: not needed |
| 5.1.1(i) Privacy policy link missing in the app | Settings or Account should link to /legal/privacy; sign-up screen already links to terms and privacy |
| 5.1.1(v) Account deletion | Account > Delete account |
| 5.1.1 Permission strings too vague | Every string in app.json names the feature and the reason |
| 5.1.2(i) Third-party AI without consent | AI consent prompt before first analysis (must exist before submission) |
| 2.5.4 Background location | Not requested; when-in-use only |
