# Screenshot plan

## What is here now

`docs/store/screenshots/` has 15 captioned screenshots made from the web preview build by
`scripts/store-screenshots.mjs`:

| Folder | Size (pixels) | Store slot |
| --- | --- | --- |
| `iphone-6.9/` | 1320 x 2868 | App Store, iPhone 6.9 inch display (required; Apple scales it down for smaller iPhones) |
| `ipad-13/` | 2064 x 2752 | App Store, iPad 13 inch display (required because the app supports iPad) |
| `android-phone/` | 1080 x 1920 | Google Play, phone screenshots (2 to 8 allowed) |

Order and captions (the first two matter most; most people never scroll further):

| # | Screen | Caption | Supporting line |
| --- | --- | --- | --- |
| 1 | Map with the demo route | Photo. GPS. Node. Done. | Every photo drops a node on the map with averaged GPS and live span footage. |
| 2 | Node editor with AI-filled fields | AI fills in the fields | Claude reads pole tags, lid castings and labels. You review and confirm. |
| 3 | Projects home | Every job in one place | Aerial and underground footage, node counts and earnings at a glance. |
| 4 | Export screen | Export for any client | KMZ, Excel, CSV, PDF, GeoJSON and Shapefile, with a QC check first. |
| 5 | Client template editor | Built for your clients | Label patterns, required fields, defaults and rates per client. |

## Before launch: retake on a real device

The web preview has no camera, no GPS and no satellite imagery (the map shows a survey grid), and
the demo nodes have no photos. These shots are good enough for TestFlight and internal testing, but
the final store screenshots should be retaken on a phone with:

1. Satellite or hybrid imagery visible under the route (shot 1), using the commercial map provider
   you will ship with, and its attribution visible.
2. A real pole photo in the node editor with AI suggestions and confidence badges (shot 2).
3. The capture screen with a live camera view, the GPS accuracy chip and node type chips
   (worth adding as a sixth shot: caption "GPS is ready before you shoot").
4. Only demo data. No real customer names, job numbers, addresses, license plates or faces.

How: run a production or preview build on an iPhone with a 6.9 inch display (or the iOS simulator
for that size) and on a 1080 x 1920 or larger Android phone, take raw screenshots, put them in
`/tmp/shots-raw/` with the same names the script uses, and rerun only the caption step (or place
them in any design tool using the same caption text).

## Regenerate the current set

```
LINEMAP_PREVIEW=1 EXPO_PUBLIC_PREVIEW=1 EXPO_OFFLINE=1 npx expo export --platform web --output-dir /tmp/shots-build
node scripts/store-screenshots.mjs /tmp/shots-build
```

Needs Playwright with Chromium, which is not an app dependency (set `PLAYWRIGHT_DIR` to the folder
that contains it).

## Other store graphics

| File | Use |
| --- | --- |
| `docs/store/graphics/play-icon-512.png` | Google Play app icon (512 x 512) |
| `docs/store/graphics/play-feature-graphic-1024x500.png` | Google Play feature graphic |
| `assets/icon.png` | App icon (1024 x 1024, no transparency). App Store Connect takes it from the build |

All brand images are generated from one vector design by `node scripts/generate-assets.mjs`
(sources in `assets/brand/*.svg`).
