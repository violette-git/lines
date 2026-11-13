# LineMap Pro

AI-powered field mapping for cable and fiber crews (Android, iOS, web preview).
Snap a photo, the GPS is already averaged, a node drops on the map, it gets a label, span footage calculates itself, and Claude vision fills in the fields.

Built by Spott Ventures.

## What's in Phase 1

- **Capture loop:** camera with rolling GPS averaging (position is ready before you press the shutter), node type chips, "Next" keeps you in the camera, walk mode auto-connects each node to the last one.
- **Node types:** pole, handhole, vault, pedestal, splice case, riser, anchor/guy, building entry, custom. Each has its own fields (`src/domain/nodeSchemas.ts`).
- **Map:** satellite / hybrid / streets, typed icons, per-node and global icon size, Select / Move / Connect modes, live footage while dragging, accuracy circles, recalibrate GPS, align all nodes to imagery.
- **Footage:** geodesic distance plus sag % and slack loops, or a measured override, per span. Live tally of aerial, underground, total footage and estimated earnings.
- **AI auto-fill:** reads pole tags, lid castings, equipment labels, counts attachments; heights and sizes are marked as estimates with confidence. Direct mode (your own key, testing only) or company server mode.
- **Extras:** GPS/time photo watermark, voice labeling, duplicate detection (distance and matching pole tags), client templates (label patterns, required fields, defaults, rates), onboarding and help.
- **Exports:** KMZ (Google Earth, photos embedded), Excel, CSV, PDF report, GeoJSON, Shapefile, with a QC checklist before export.
- **Offline-first:** everything saves to the phone (SQLite) first.
- **Backend (ready to deploy):** Supabase multi-company schema with row-level security, roles, invites, AI usage metering, AI proxy function, Stripe webhook. See `docs/BACKEND.md`.

## Commands

```bash
npm ci
npx expo start            # dev server (needs a development build for camera/voice/WebView map)
npm run typecheck
npm test
npm run build:map         # rebuild the inlined offline map bundle after editing src/map/core/mapCore.ts
npm run sync:prompt       # copy the AI prompt into the Supabase function after editing src/ai/prompt.ts
```

## Getting it on a phone

- **Android APK:** push to `main` on GitHub. The "Android APK" workflow builds an installable APK; download it from the run's Artifacts.
- **iPhone:** needs an Apple Developer account ($99/yr) and an Expo account. Add an `EXPO_TOKEN` repo secret, then run the "EAS Build" workflow (platform `ios`, profile `preview`) and install from the link Expo gives you.
- **Stores:** `eas build --profile production` then `eas submit`.

## Before selling to companies

1. Swap the public dev map tiles for a commercial provider (MapTiler or Mapbox) in `src/map/basemaps.ts`.
2. Deploy the Supabase backend and switch AI to company server mode (never ship your own API key in the app).
3. Phase 2: sign-in screen, live sync, web admin dashboard, Stripe checkout on the website.

## Layout

```
src/app         screens (expo-router)
src/domain      data model, field schemas, labels, QC
src/state       app state (zustand store)
src/data        SQLite (phone) and in-memory demo (web) storage, photo files
src/geo         distance math, GPS averaging, span lengths
src/ai          Claude vision clients, prompt, result merging
src/map         map engine (MapLibre) for WebView and web
src/export      KMZ, XLSX, CSV, PDF, GeoJSON, Shapefile
src/features    capture, watermark, voice, sheets, node editor
supabase        database migrations, Edge Functions, tests
docs            BACKEND.md, USER_GUIDE.md
```
