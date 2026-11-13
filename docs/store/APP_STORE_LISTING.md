# Apple App Store listing (App Store Connect)

Copy these into App Store Connect, under your app, "App Information" and the version page.
Character limits are Apple's; counts below were checked with a script. Anything in [BRACKETS] is a
placeholder you must fill in (all placeholders are listed in docs/RELEASE_CHECKLIST.md).

## App Information

| Field | Value |
| --- | --- |
| Name (30 max) | `LineMap Pro` (11) |
| Subtitle (30 max) | `Field mapping for cable crews` (29) |
| Bundle ID | `com.spottventures.linemappro` |
| SKU (your own internal code) | `LINEMAPPRO-IOS-001` |
| Primary category | Business |
| Secondary category | Productivity |
| Content rights | Does not contain, show or access third-party content (map imagery is licensed by the map provider; see the checklist) |
| Age rating | 4+ (answers below) |
| Copyright | `2026 [LEGAL ENTITY NAME AND TYPE]` |
| Privacy Policy URL | `https://[WEB DOMAIN]/legal/privacy` |
| Support URL | `https://[WEB DOMAIN]/support` |
| Marketing URL (optional) | `https://[WEB DOMAIN]` |
| Price | Free (subscriptions are sold to companies on the website, not in the app) |
| In-App Purchases | None |

Alternate subtitle if you want to name fiber: `Pole and fiber route mapping` (28).

## Promotional text (170 max, can be changed any time without a new build)

```
Snap a photo and the node lands on the map with averaged GPS. Span footage adds itself up and AI reads pole tags for you. Built for aerial and underground crews.
```

(161 characters)

## Keywords (100 max, commas, no spaces, do not repeat words from the name)

```
fiber,cable,pole,telecom,utility,OSP,fielding,survey,GPS,KMZ,handhole,splice,lineman,aerial,mapping
```

(99 characters)

## Description (4000 max)

```
LineMap Pro turns a day of fielding into a few taps. Take a photo, and the pole, handhole or pedestal lands on the map with an averaged GPS position, a label and a span to the last node, with footage already calculated.

Built for telecom field crews mapping cable and fiber plant: aerial pole fielding, underground route walkouts and QC audits.

CAPTURE FAST
- GPS is averaged while you frame the shot, so the position is ready before you press the shutter
- Pick the node type with one tap: pole, handhole, vault, pedestal, splice case, riser, anchor or guy, building entry, or your own
- Walk mode connects each new node to the last one, so a route maps itself as you walk it
- Say a label or note out loud instead of typing it
- Optional photo stamp with GPS position and time

AI THAT FILLS IN THE FIELDS
- Reads pole tag numbers, lid castings and equipment labels from the photo
- Counts attachments and suggests owner, material, class and condition
- Every suggestion shows a confidence level; heights and sizes are clearly marked as estimates
- You review and accept, nothing is final until you say so

FOOTAGE AND EARNINGS, LIVE
- Span length from GPS plus sag percentage and slack loops, or enter a measured length
- Running totals for aerial, underground and total footage
- Estimated earnings from your client's rates

A MAP MADE FOR THE FIELD
- Satellite, hybrid and street maps with clear, typed icons
- Move nodes, connect spans and see footage update as you drag
- Accuracy circles, recalibrate and align tools to line nodes up with imagery
- Duplicate detection by distance and matching pole tags

CLIENT TEMPLATES
- Label patterns, required fields, default values and pay rates for each client
- A quality check flags missing photos, missing required fields and unreviewed AI values before you export

EXPORT ANYWHERE
- Google Earth KMZ with photos inside, Excel, CSV, PDF report, GeoJSON and Shapefile

WORKS WITHOUT A SIGNAL
- Everything saves to the phone first and syncs to your company when you are back online

FOR COMPANIES
LineMap Pro is made for companies. An owner or admin sets up the company and invites the crew, and each member signs in with the account their company invited. There are no purchases in the app.

Your company owns its field data. No ads, no selling data, no tracking.

Privacy policy: https://[WEB DOMAIN]/legal/privacy
Terms of use: https://[WEB DOMAIN]/legal/terms
```

## What's New (first version)

```
First release of LineMap Pro: photo to GPS to node, live span footage, AI auto-fill, client templates and KMZ, Excel, CSV, PDF, GeoJSON and Shapefile exports.
```

## Age rating questionnaire

Answer "None" or "No" to every content question:

| Question group | Answer |
| --- | --- |
| Cartoon or fantasy violence, realistic violence, prolonged graphic violence | None |
| Sexual content or nudity, graphic sexual content | None |
| Profanity or crude humor | None |
| Alcohol, tobacco or drug use or references | None |
| Mature or suggestive themes, horror or fear themes | None |
| Medical or treatment information | None |
| Simulated gambling, real gambling, contests | None / No |
| Unrestricted web access | No (the app only opens our own website pages) |
| User-generated content shared publicly, messaging or chat with other users | No (field data is shared only inside the user's own company workspace, not publicly) |
| Advertising | No |
| Parental controls, age assurance | Not applicable |

Expected result: 4+. (Apple's questionnaire wording changes from time to time; answer the current
questions with the facts above.)

## Encryption (export compliance)

`ios.config.usesNonExemptEncryption` is `false` in app.json, which writes
`ITSAppUsesNonExemptEncryption = NO` into the app. LineMap Pro only uses standard HTTPS provided by
the operating system, which is exempt. App Store Connect will not ask the encryption question for
each build.
