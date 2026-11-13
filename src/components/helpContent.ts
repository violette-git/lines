// Help and how-to content. Rendered by /help and mirrored in docs/USER_GUIDE.md.
// Keep wording plain and field-friendly; explain jargon the first time it appears.
import type { IconName } from './ui';

export type HelpBlock = { kind: 'p'; text: string } | { kind: 'steps'; items: string[] } | { kind: 'bullets'; items: string[] } | { kind: 'tip'; text: string };

export interface HelpSection {
  id: string;
  title: string;
  icon: IconName;
  blocks: HelpBlock[];
}

export const HELP_SECTIONS: HelpSection[] = [
  {
    id: 'capture-loop',
    title: 'The capture loop',
    icon: 'camera-outline',
    blocks: [
      { kind: 'p', text: 'Mapping a route is one repeated motion: stand at the asset, snap, walk to the next one. Each photo becomes a node (a pole, handhole, vault or other point) on the map.' },
      {
        kind: 'steps',
        items: [
          'Open your project and tap the big camera button.',
          'Pick the node type (Pole, Handhole, and so on). The app remembers your last choice.',
          'Stand next to the asset and hold the phone still while the GPS ring fills. This averages several readings for a steadier position.',
          'Tap the shutter. The node drops on the map with a label like P-12.',
          'Walk to the next asset and repeat. Footage updates as you go.',
        ],
      },
      { kind: 'tip', text: 'You can keep capturing while AI fills in fields in the background. Review the details later from the map.' },
    ],
  },
  {
    id: 'walk-mode',
    title: 'Walk mode',
    icon: 'walk-outline',
    blocks: [
      { kind: 'p', text: 'With walk mode on, each new photo connects to the last one with a span automatically. A span is the cable run between two nodes. This is the fastest way to map a line pole to pole.' },
      { kind: 'p', text: 'Pole to pole spans are aerial. Other combinations use the client template default, or the usual type for that node (for example handhole to handhole is underground).' },
      {
        kind: 'bullets',
        items: [
          'Turn it off when you jump around, for example on a QC audit or when you skip ahead and come back.',
          'If walk mode connected the wrong nodes, delete that span and use the Connect tool on the map to draw the right one.',
          'You can change walk mode any time in the project details.',
        ],
      },
    ],
  },
  {
    id: 'fix-gps',
    title: 'Fixing a bad GPS position',
    icon: 'locate-outline',
    blocks: [
      { kind: 'p', text: 'Phone GPS is usually good to a few feet in the open, but trees, tall buildings and bucket trucks can push a reading off. There are two ways to fix a node.' },
      {
        kind: 'steps',
        items: [
          'Recalibrate: open the node, stand right at the asset and tap Recalibrate GPS. The app takes a fresh averaged reading and moves the node.',
          'Drag: switch the map to Move mode, then drag the node onto the pole or lid you can see in the satellite image. Dragged positions are marked as manual.',
        ],
      },
      { kind: 'tip', text: 'The colored ring around a node shows its accuracy. Green is tight, amber is fair, red means check it.' },
    ],
  },
  {
    id: 'align-all',
    title: 'Aligning all nodes to the imagery',
    icon: 'move-outline',
    blocks: [
      { kind: 'p', text: 'Sometimes every node is off by the same amount, often because the satellite imagery itself is shifted a little. Instead of dragging nodes one at a time, shift them all together.' },
      {
        kind: 'steps',
        items: [
          'Switch to satellite or hybrid basemap and zoom in on a node you can clearly match to a pole.',
          'Use Align all nodes from the map menu.',
          'Drag that one node to the right spot. Every node in the project moves by the same offset, so the spacing between them stays exact.',
        ],
      },
      { kind: 'tip', text: 'Span footage does not change when you align all nodes, because the distances between nodes stay the same.' },
    ],
  },
  {
    id: 'spans',
    title: 'Spans: slack, sag and overrides',
    icon: 'git-commit-outline',
    blocks: [
      { kind: 'p', text: 'Every span shows its footage. The app starts with the straight-line distance between the two nodes, then adds allowances so the number matches the cable you actually need.' },
      {
        kind: 'bullets',
        items: [
          'Sag: extra cable for the droop between poles, as a percent of the straight distance. Aerial spans usually use 1 to 3 %. Underground spans normally use 0.',
          'Slack: spare cable coiled at a pole, handhole or vault (slack loops, storage coils), in feet. It is added on top.',
          'Override: if you measured the run with a wheel or the print gives a number, type it in. The override replaces the calculated total.',
        ],
      },
      { kind: 'p', text: 'Total footage = override, or straight distance x (1 + sag %) + slack.' },
      { kind: 'tip', text: 'Client templates set default sag and slack, so new spans start with the right numbers for that client.' },
    ],
  },
  {
    id: 'ai',
    title: 'AI auto-fill, confidence and estimates',
    icon: 'sparkles-outline',
    blocks: [
      { kind: 'p', text: 'When AI is turned on in Settings, the app sends each photo to Claude, which reads things like the pole tag, owner, material, attachment count and equipment, then fills in the node fields.' },
      {
        kind: 'bullets',
        items: [
          'Every AI value carries a confidence badge. Green (80 % and up) is usually right, amber deserves a glance, red needs checking.',
          'Heights and sizes are marked "est." because they are visual estimates. A height stick in the photo makes them much better.',
          'Anything you type or change by hand becomes 100 % and is never overwritten by AI.',
          'If AI fails (no signal, for example), the node shows as failed. Run it again later from the node or with Run pending AI on the map.',
        ],
      },
      { kind: 'p', text: 'AI modes: Off; My API key (the owner testing with their own Anthropic key, never on shared devices); Company server (your company keeps the key on its own server, the right choice for crews).' },
    ],
  },
  {
    id: 'duplicates',
    title: 'Possible duplicates',
    icon: 'copy-outline',
    blocks: [
      { kind: 'p', text: 'If you capture a node of the same type very close to an existing one, or AI reads the same pole tag twice, the new node is flagged as a possible duplicate.' },
      {
        kind: 'bullets',
        items: [
          'Open the flagged node and compare the photos.',
          'If it really is the same asset, delete one of them.',
          'If they are different (two poles side by side, for example), tap Not a duplicate to clear the flag.',
          'Change how close counts as "too close" in Settings under Duplicate check.',
        ],
      },
    ],
  },
  {
    id: 'templates',
    title: 'Client templates',
    icon: 'albums-outline',
    blocks: [
      { kind: 'p', text: 'A template holds one client\'s rules so every project for them starts set up correctly. Create them from the Templates button on the home screen.' },
      {
        kind: 'bullets',
        items: [
          'Label patterns: how nodes are named. Tokens: {seq} capture number (7), {seq3} padded number (007), {TYPE} short code (P, HH), {type} full name (Pole), {job} the project job number. Example: {job}-{TYPE}{seq3} gives J1042-P007.',
          'Required fields: what must be filled in for each node type. Export QC (quality check) lists anything missing before you send files.',
          'Span defaults: aerial or underground, sag % and slack feet for new spans.',
          'Pay rates: per foot and per node, used for the earnings estimate.',
          'Watermark: stamp GPS, time, project and label onto photo copies.',
        ],
      },
    ],
  },
  {
    id: 'exports',
    title: 'Exports and what each format is for',
    icon: 'share-outline',
    blocks: [
      { kind: 'p', text: 'Open a project and tap Export. The app runs a quick QC check first, then builds the files and opens the share sheet so you can email, text or save them.' },
      {
        kind: 'bullets',
        items: [
          'KMZ: opens in Google Earth. Nodes, spans and photos in one file. Best for a quick review by a supervisor or client.',
          'Excel (XLSX): node and span tables with every field and footage totals. Best for the office, billing and make-ready sheets.',
          'CSV: plain table that any program can read.',
          'PDF: printable report with the map, totals and photos. Best for handing in a job package.',
          'GeoJSON and Shapefile: GIS formats for engineering software such as ArcGIS or QGIS.',
        ],
      },
      { kind: 'tip', text: 'Photos are included with watermarks when watermarking is on. The originals always stay on the device.' },
    ],
  },
  {
    id: 'offline',
    title: 'Working offline',
    icon: 'cloud-offline-outline',
    blocks: [
      { kind: 'p', text: 'LineMap Pro is built for places with no signal. Projects, nodes, spans and photos are saved on the device as you go.' },
      {
        kind: 'bullets',
        items: [
          'GPS works without cell service. Capture as normal.',
          'Satellite imagery needs data to load. Open the project area once on Wi-Fi so the map tiles are cached, or rely on GPS and fix positions later.',
          'AI waits for a connection. Nodes stay pending, and you can run them all later with Run pending AI.',
          'Exports are built on the device, so you can create files offline and send them when you have signal.',
        ],
      },
    ],
  },
  {
    id: 'accuracy',
    title: 'Tips for better accuracy',
    icon: 'ribbon-outline',
    blocks: [
      {
        kind: 'bullets',
        items: [
          'Stand right at the base of the pole or next to the lid when you capture, not across the street.',
          'Hold still until the GPS ring finishes. Raise the averaging time in Settings under heavy trees or downtown.',
          'Put a height stick (a measuring pole) against the pole in the photo. AI uses it to estimate attachment heights much more accurately.',
          'Frame the whole pole, top to bottom, plus a close-up of the tag if it is small or faded.',
          'Shoot with the sun behind you. Glare and backlight hide tags and lid labels.',
          'Check the map every few spans. Fixing a drifted node right away is faster than coming back.',
        ],
      },
    ],
  },
  {
    id: 'earnings',
    title: 'Footage and earnings tally',
    icon: 'cash-outline',
    blocks: [
      { kind: 'p', text: 'Add a pay rate per foot and per node to a project (or its template) to see estimated earnings. The home screen sums this week\'s footage, nodes and earnings across your active projects.' },
      { kind: 'tip', text: 'Leave rates blank if you do not want money shown on screen, for example on a shared tablet.' },
    ],
  },
];

export function sectionText(s: HelpSection): string {
  return [
    s.title,
    ...s.blocks.map((b) => (b.kind === 'steps' || b.kind === 'bullets' ? b.items.join(' ') : b.text)),
  ].join(' ');
}
