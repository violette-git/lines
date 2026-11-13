# LineMap Pro User Guide

LineMap Pro is a field app for crews mapping cable and fiber plant. You walk the route, snap a photo at each pole, handhole or vault, and the app builds the map, adds up the footage and produces the files your client wants.

This guide matches the Help screen inside the app (Home, then the question mark button).

## Contents

- [The capture loop](#capture-loop)
- [Walk mode](#walk-mode)
- [Fixing a bad GPS position](#fix-gps)
- [Aligning all nodes to the imagery](#align-all)
- [Spans: slack, sag and overrides](#spans)
- [AI auto-fill, confidence and estimates](#ai)
- [Possible duplicates](#duplicates)
- [Client templates](#templates)
- [Exports and what each format is for](#exports)
- [Working offline](#offline)
- [Tips for better accuracy](#accuracy)
- [Footage and earnings tally](#earnings)

## Getting around

- **Home (Projects):** this week's footage, nodes and estimated earnings at the top, then your projects. Search by name, client or job number, and filter Active, Complete or Archived. Tap a card to open the map; long-press it or tap the three dots to mark it complete, archive it or delete it.
- **New project:** the big button at the bottom right. Name it, add the client and job number, pick the work type and a client template, and set pay rates if you want earnings shown.
- **Templates:** per-client rules for labels, required fields, span defaults and rates.
- **Settings:** units, basemap, map icon size, GPS averaging time, duplicate distance, photo watermark and AI auto-fill.

<a id="capture-loop"></a>

## The capture loop

Mapping a route is one repeated motion: stand at the asset, snap, walk to the next one. Each photo becomes a node (a pole, handhole, vault or other point) on the map.

1. Open your project and tap the big camera button.
2. Pick the node type (Pole, Handhole, and so on). The app remembers your last choice.
3. Stand next to the asset and hold the phone still while the GPS ring fills. This averages several readings for a steadier position.
4. Tap the shutter. The node drops on the map with a label like P-12.
5. Walk to the next asset and repeat. Footage updates as you go.

> **Tip:** You can keep capturing while AI fills in fields in the background. Review the details later from the map.

<a id="walk-mode"></a>

## Walk mode

With walk mode on, each new photo connects to the last one with a span automatically. A span is the cable run between two nodes. This is the fastest way to map a line pole to pole.

Pole to pole spans are aerial. Other combinations use the client template default, or the usual type for that node (for example handhole to handhole is underground).

- Turn it off when you jump around, for example on a QC audit or when you skip ahead and come back.
- If walk mode connected the wrong nodes, delete that span and use the Connect tool on the map to draw the right one.
- You can change walk mode any time in the project details.

<a id="fix-gps"></a>

## Fixing a bad GPS position

Phone GPS is usually good to a few feet in the open, but trees, tall buildings and bucket trucks can push a reading off. There are two ways to fix a node.

1. Recalibrate: open the node, stand right at the asset and tap Recalibrate GPS. The app takes a fresh averaged reading and moves the node.
2. Drag: switch the map to Move mode, then drag the node onto the pole or lid you can see in the satellite image. Dragged positions are marked as manual.

> **Tip:** The colored ring around a node shows its accuracy. Green is tight, amber is fair, red means check it.

<a id="align-all"></a>

## Aligning all nodes to the imagery

Sometimes every node is off by the same amount, often because the satellite imagery itself is shifted a little. Instead of dragging nodes one at a time, shift them all together.

1. Switch to satellite or hybrid basemap and zoom in on a node you can clearly match to a pole.
2. Use Align all nodes from the map menu.
3. Drag that one node to the right spot. Every node in the project moves by the same offset, so the spacing between them stays exact.

> **Tip:** Span footage does not change when you align all nodes, because the distances between nodes stay the same.

<a id="spans"></a>

## Spans: slack, sag and overrides

Every span shows its footage. The app starts with the straight-line distance between the two nodes, then adds allowances so the number matches the cable you actually need.

- Sag: extra cable for the droop between poles, as a percent of the straight distance. Aerial spans usually use 1 to 3 %. Underground spans normally use 0.
- Slack: spare cable coiled at a pole, handhole or vault (slack loops, storage coils), in feet. It is added on top.
- Override: if you measured the run with a wheel or the print gives a number, type it in. The override replaces the calculated total.

Total footage = override, or straight distance x (1 + sag %) + slack.

> **Tip:** Client templates set default sag and slack, so new spans start with the right numbers for that client.

<a id="ai"></a>

## AI auto-fill, confidence and estimates

When AI is turned on in Settings, the app sends each photo to Claude, which reads things like the pole tag, owner, material, attachment count and equipment, then fills in the node fields.

- Every AI value carries a confidence badge. Green (80 % and up) is usually right, amber deserves a glance, red needs checking.
- Heights and sizes are marked "est." because they are visual estimates. A height stick in the photo makes them much better.
- Anything you type or change by hand becomes 100 % and is never overwritten by AI.
- If AI fails (no signal, for example), the node shows as failed. Run it again later from the node or with Run pending AI on the map.

AI modes: Off; My API key (the owner testing with their own Anthropic key, never on shared devices); Company server (your company keeps the key on its own server, the right choice for crews).

<a id="duplicates"></a>

## Possible duplicates

If you capture a node of the same type very close to an existing one, or AI reads the same pole tag twice, the new node is flagged as a possible duplicate.

- Open the flagged node and compare the photos.
- If it really is the same asset, delete one of them.
- If they are different (two poles side by side, for example), tap Not a duplicate to clear the flag.
- Change how close counts as "too close" in Settings under Duplicate check.

<a id="templates"></a>

## Client templates

A template holds one client's rules so every project for them starts set up correctly. Create them from the Templates button on the home screen.

- Label patterns: how nodes are named. Tokens: {seq} capture number (7), {seq3} padded number (007), {TYPE} short code (P, HH), {type} full name (Pole), {job} the project job number. Example: {job}-{TYPE}{seq3} gives J1042-P007.
- Required fields: what must be filled in for each node type. Export QC (quality check) lists anything missing before you send files.
- Span defaults: aerial or underground, sag % and slack feet for new spans.
- Pay rates: per foot and per node, used for the earnings estimate.
- Watermark: stamp GPS, time, project and label onto photo copies.

<a id="exports"></a>

## Exports and what each format is for

Open a project and tap Export. The app runs a quick QC check first, then builds the files and opens the share sheet so you can email, text or save them.

- KMZ: opens in Google Earth. Nodes, spans and photos in one file. Best for a quick review by a supervisor or client.
- Excel (XLSX): node and span tables with every field and footage totals. Best for the office, billing and make-ready sheets.
- CSV: plain table that any program can read.
- PDF: printable report with the map, totals and photos. Best for handing in a job package.
- GeoJSON and Shapefile: GIS formats for engineering software such as ArcGIS or QGIS.

> **Tip:** Photos are included with watermarks when watermarking is on. The originals always stay on the device.

<a id="offline"></a>

## Working offline

LineMap Pro is built for places with no signal. Projects, nodes, spans and photos are saved on the device as you go.

- GPS works without cell service. Capture as normal.
- Satellite imagery needs data to load. Open the project area once on Wi-Fi so the map tiles are cached, or rely on GPS and fix positions later.
- AI waits for a connection. Nodes stay pending, and you can run them all later with Run pending AI.
- Exports are built on the device, so you can create files offline and send them when you have signal.

<a id="accuracy"></a>

## Tips for better accuracy

- Stand right at the base of the pole or next to the lid when you capture, not across the street.
- Hold still until the GPS ring finishes. Raise the averaging time in Settings under heavy trees or downtown.
- Put a height stick (a measuring pole) against the pole in the photo. AI uses it to estimate attachment heights much more accurately.
- Frame the whole pole, top to bottom, plus a close-up of the tag if it is small or faded.
- Shoot with the sun behind you. Glare and backlight hide tags and lid labels.
- Check the map every few spans. Fixing a drifted node right away is faster than coming back.

<a id="earnings"></a>

## Footage and earnings tally

Add a pay rate per foot and per node to a project (or its template) to see estimated earnings. The home screen sums this week's footage, nodes and earnings across your active projects.

> **Tip:** Leave rates blank if you do not want money shown on screen, for example on a shared tablet.

## Settings reference

| Setting | What it does |
| --- | --- |
| Units | Feet (imperial) or meters (metric) for all footage. |
| Default basemap | Satellite, hybrid (satellite with road names) or streets. |
| Map icon size | S to XXL. Bigger is easier to tap with gloves. |
| GPS averaging | 2, 4, 8 or 15 seconds per capture. Longer is more accurate, shorter is faster. 4 seconds suits most work; use 8 or 15 under trees or downtown. |
| Duplicate check | How close a new node of the same type can be before it is flagged. |
| Watermark photos | Stamps GPS, time, project and label onto a copy of each photo. Originals are kept. |
| AI mode | Off, My API key (owner testing only, never on shared devices) or Company server (recommended for crews). |
| AI model | Claude Sonnet 5.5 (recommended balance, about 1 cent per photo), Claude Haiku 5.5 (cheapest and fastest, under a tenth of a cent), Claude Opus 5.5 (most accurate, about 2 cents). Rough estimates at late-2026 list prices. |
| Run AI on every capture | Fill fields automatically in the background, or only when you ask. |

