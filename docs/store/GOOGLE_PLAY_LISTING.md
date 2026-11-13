# Google Play listing (Play Console)

Copy these into Play Console, "Grow users", "Store presence", "Main store listing", and the
"App content" pages. Anything in [BRACKETS] is a placeholder (see docs/RELEASE_CHECKLIST.md).

## Store listing

| Field | Value |
| --- | --- |
| App name (30 max) | `LineMap Pro: Cable Mapping` (26) |
| Package name | `com.spottventures.linemappro` |
| App or game | App |
| Free or paid | Free |
| Category | Business |
| Tags (pick up to 5 in Play Console) | Business, Productivity, Maps, Tools |
| Email (public) | `[SUPPORT EMAIL]` |
| Website | `https://[WEB DOMAIN]` |
| Privacy policy | `https://[WEB DOMAIN]/legal/privacy` |
| App icon | `docs/store/graphics/play-icon-512.png` (512 x 512) |
| Feature graphic | `docs/store/graphics/play-feature-graphic-1024x500.png` (1024 x 500) |
| Phone screenshots | `docs/store/screenshots/android-phone/*.jpg` (1080 x 1920) |
| Tablet screenshots (optional) | `docs/store/screenshots/ipad-13/*.jpg` work for the 10-inch slot |

### Short description (80 max)

```
Photo, GPS and AI auto-fill for mapping poles, fiber and cable routes fast.
```

(75 characters)

### Full description (4000 max)

Use the same description as the App Store (docs/store/APP_STORE_LISTING.md, "Description"). Google
Play does not allow calls to action like "best" or "#1", and the text above has none.

## App content (policy declarations)

| Section | Answer |
| --- | --- |
| Privacy policy | `https://[WEB DOMAIN]/legal/privacy` |
| Ads | No, the app does not contain ads |
| App access | All or some functionality is restricted. Give the demo account (below) |
| Content rating (IARC questionnaire) | Category: "All other app types" (utility, productivity). Answer No to violence, sexuality, language, controlled substances, gambling, user interaction/sharing with the public, location sharing with other users (location is shared only inside the user's company), digital purchases. Expected rating: Everyone / PEGI 3 |
| Target audience and content | 18 and over only. Not designed for children |
| News app | No |
| COVID-19 contact tracing or status | No |
| Data safety | See docs/store/APP_PRIVACY.md |
| Government app | No |
| Financial features | None |
| Health | None |
| Account deletion | Yes, accounts can be created. Delete account URL: `https://[WEB DOMAIN]/legal/delete-account` |

### App access instructions (paste into "App access")

```
Sign in with the demo account below. It belongs to a demo company with an active subscription and a sample project.
Email: [DEMO ACCOUNT EMAIL]
Password: [DEMO ACCOUNT PASSWORD]
Camera, location and microphone permissions are requested when you first capture a node or use voice input.
```

## Permissions Google may ask about

The app does not request any of the restricted permissions that need a Play Console declaration:

- No background location (ACCESS_BACKGROUND_LOCATION is blocked in app.json).
- No photo and video access permissions (READ_MEDIA_IMAGES and READ_MEDIA_VIDEO are blocked; photo
  import uses the system photo picker, which needs no permission).
- No foreground services, no SMS or call log, no "all files access", no exact alarms, no
  accessibility services, no draw-over-other-apps (SYSTEM_ALERT_WINDOW is blocked).

Permissions the app does request: camera, precise and approximate location (while in use),
record audio (voice labels), internet and network state, vibrate (haptics). Storage
permissions are capped at Android 12 and below (used only by the system camera fallback).

## Release tracks

1. First upload: Play Console requires the first app bundle to be uploaded by hand (Testing,
   Internal testing, Create new release, upload the .aab from the EAS build page). After that,
   `eas submit` can upload automatically.
2. Internal testing (up to 100 testers, no review wait) is where `eas.json` sends builds
   (`track: internal`, `releaseStatus: draft`; change to `completed` once the app has been
   published once).
3. New personal developer accounts must run a closed test with at least 12 testers for 14 days
   before they can apply for production. Organization accounts (registered with a D-U-N-S number)
   are not subject to this rule. Check the current rule in Play Console when you create the account.
