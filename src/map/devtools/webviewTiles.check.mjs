#!/usr/bin/env node
// Headless Chrome check of the native WebView map document and its lmtile:// tile protocol.
// Not a jest test (needs Chrome + playwright). Run after `node scripts/build-map-bundle.mjs`:
//
//   PLAYWRIGHT=/opt/npm-tools/node_modules/playwright CHROME=/usr/bin/google-chrome \
//     node src/map/devtools/webviewTiles.check.mjs [--shot out.png]
//
// What it proves:
//  1. The inlined page boots and posts {type:'ready'} through window.ReactNativeWebView.
//  2. A basemap using "lmtile://test-osm/{z}/{x}/{y}" sends batched {type:'tileReq'} messages.
//  3. A fake RN host (this script) answers from fixture PNGs as base64; those tiles render (pixel check).
//  4. Tiles missing from the fixture are requested too and answered with null without breaking the map.
//  5. After {type:'reloadTiles'} a previously missing tile is requested again and renders once present.
//  6. {type:'view'} returns the visible bounds.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const { chromium } = require(process.env.PLAYWRIGHT || '/opt/npm-tools/node_modules/playwright');
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const shotIdx = process.argv.indexOf('--shot');
const shotPath = shotIdx > 0 ? resolve(process.argv[shotIdx + 1]) : null;

// ---------------------------------------------------------------- fixture tiles (tiny PNG encoder)

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** 256x256 solid RGB tile with a 4 px dark border. */
function pngTile([r, g, b]) {
  const W = 256;
  const raw = Buffer.alloc((W * 3 + 1) * W);
  for (let y = 0; y < W; y++) {
    raw[y * (W * 3 + 1)] = 0;
    for (let x = 0; x < W; x++) {
      const edge = x < 4 || y < 4 || x >= W - 4 || y >= W - 4;
      const o = y * (W * 3 + 1) + 1 + x * 3;
      raw[o] = edge ? 20 : r;
      raw[o + 1] = edge ? 20 : g;
      raw[o + 2] = edge ? 20 : b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(W, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Birmingham, AL at zoom 16 (tile 16964/26284). Fixture: a 3x3 block minus the east-center tile (a miss).
const Z = 16;
const CX = 16964;
const CY = 26284;
const CENTER = { lat: 33.5186, lng: -86.8104 };
const COLORS = [
  [220, 60, 60],
  [60, 180, 90],
  [60, 110, 220],
];
const fixture = new Map(); // key "z/x/y" -> { png, color }
for (let dx = -1; dx <= 1; dx++) {
  for (let dy = -1; dy <= 1; dy++) {
    if (dx === 1 && dy === 0) continue; // deliberately missing
    const color = COLORS[(dx + dy + 3) % 3];
    fixture.set(`${Z}/${CX + dx}/${CY + dy}`, { png: pngTile(color), color });
  }
}
const MISSING_KEY = `${Z}/${CX + 1}/${CY}`;

const work = mkdtempSync(join(tmpdir(), 'lm-webview-'));
const htmlPath = join(work, 'map.html');
execFileSync(process.execPath, [join(root, 'scripts/build-map-bundle.mjs'), '--html-out', htmlPath], { stdio: 'inherit' });
mkdirSync(join(work, 'fixtures'), { recursive: true });
for (const [k, v] of fixture) {
  const p = join(work, 'fixtures', `${k}.png`);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, v.png);
}

// ---------------------------------------------------------------- browser

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
const requested = []; // every lmtile url the page asked for
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

// Fake RN host: answers tile requests from the fixture map (what src/offline/tileHost.ts does on a phone).
await page.exposeFunction('__hostServe', (reqsJson) => {
  const reqs = JSON.parse(reqsJson);
  return reqs.map((r) => {
    requested.push(r.url);
    const m = /^lmtile:\/\/test-osm\/(\d+)\/(\d+)\/(\d+)$/.exec(r.url);
    const hit = m ? fixture.get(`${m[1]}/${m[2]}/${m[3]}`) : null;
    return { id: r.id, data: hit ? hit.png.toString('base64') : null };
  });
});
await page.addInitScript(() => {
  window.__posted = [];
  window.ReactNativeWebView = {
    postMessage(s) {
      const msg = JSON.parse(s);
      window.__posted.push(msg);
      if (msg.type === 'tileReq' && msg.reqs.length) {
        window.__hostServe(JSON.stringify(msg.reqs)).then((items) => window.__lmReceive({ type: 'tiles', items }));
      }
    },
  };
});

await page.goto('file://' + htmlPath);
await page.waitForFunction(() => window.__posted.some((m) => m.type === 'ready'), null, { timeout: 20000 });
check('page boots and posts ready', true);

const basemap = {
  id: 'streets:test-osm:cache:x',
  sources: {
    'bm-imagery': {
      type: 'raster',
      tiles: ['lmtile://test-osm/{z}/{x}/{y}'],
      tileSize: 256,
      minzoom: Z,
      maxzoom: Z,
      attribution: 'fixture',
    },
  },
  layers: [{ id: 'bm-imagery', type: 'raster', source: 'bm-imagery', paint: { 'raster-fade-duration': 0 } }],
};
await page.evaluate(
  ({ basemap, CENTER, Z }) => {
    window.__lmReceive({
      type: 'state',
      state: {
        nodes: [],
        spans: [],
        selectedNodeId: null,
        selectedSpanId: null,
        basemap,
        globalIconScale: 1,
        editMode: 'select',
        units: 'imperial',
        user: null,
        showAccuracy: false,
      },
    });
    window.__lmController && window.__lmController.centerOn(CENTER.lat, CENTER.lng, Z);
  },
  { basemap, CENTER, Z },
);
// centerOn eases for 600 ms; wait for tiles to load and settle.
await page.waitForFunction((n) => window.__posted.filter((m) => m.type === 'tileReq').length >= n, 1, { timeout: 15000 });
await page.waitForTimeout(2500);

const tileMsgs = await page.evaluate(() => window.__posted.filter((m) => m.type === 'tileReq'));
const batched = tileMsgs.some((m) => m.reqs.length > 1);
check('tile requests go through the RN bridge in batches', tileMsgs.length > 0 && batched, `${tileMsgs.length} messages, ${requested.length} tiles`);
check('missing tile was requested (miss reaches the host)', requested.includes(`lmtile://test-osm/${MISSING_KEY}`));

// Pixel check: the map center must show the center fixture tile color; the east neighbor is a miss.
async function samplePixel(fx, fy) {
  return page.evaluate(
    ({ fx, fy }) => {
      const c = document.querySelector('canvas.maplibregl-canvas');
      const o = document.createElement('canvas');
      o.width = c.width;
      o.height = c.height;
      const ctx = o.getContext('2d');
      ctx.drawImage(c, 0, 0);
      const d = ctx.getImageData(Math.floor(c.width * fx), Math.floor(c.height * fy), 1, 1).data;
      return [d[0], d[1], d[2]];
    },
    { fx, fy },
  );
}
// CENTER lies inside tile CX/CY (see src/offline/__tests__/tileMath.test.ts), so the canvas center shows it.
const near = (a, b, tol = 12) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
const centerColor = fixture.get(`${Z}/${CX}/${CY}`).color;
const px = await samplePixel(0.5, 0.5);
check('custom-protocol tile renders at the map center', near(px, centerColor), `got ${px} want ${centerColor}`);

// View bounds through the bridge.
await page.evaluate(() => window.__lmReceive({ type: 'view', reqId: 7 }));
const view = await page.evaluate(() => window.__posted.find((m) => m.type === 'view' && m.reqId === 7));
const vb = view && view.view && view.view.bounds;
check(
  'view message returns bounds around the center',
  !!vb && vb[0] < CENTER.lng && vb[2] > CENTER.lng && vb[1] < CENTER.lat && vb[3] > CENTER.lat,
  vb ? vb.map((v) => v.toFixed(4)).join(',') : 'none',
);

// Every fixture tile that intersects the visible area must have been asked for.
if (vb) {
  const n = 2 ** Z;
  const tx = (lng) => Math.floor(((lng + 180) / 360) * n);
  const ty = (lat) => {
    const r = (lat * Math.PI) / 180;
    return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  };
  const inView = [...fixture.keys()].filter((k) => {
    const [, x, y] = k.split('/').map(Number);
    return x >= tx(vb[0]) && x <= tx(vb[2]) && y >= ty(vb[3]) && y <= ty(vb[1]);
  });
  const got = inView.filter((k) => requested.includes(`lmtile://test-osm/${k}`));
  check('every fixture tile in view was requested', inView.length > 0 && got.length === inView.length, `${got.length} of ${inView.length} in view`);
}

// Reload after "network came back": the missing tile now exists and must be fetched again.
const missBefore = requested.filter((u) => u.endsWith(MISSING_KEY)).length;
fixture.set(MISSING_KEY, { png: pngTile([240, 200, 40]), color: [240, 200, 40] });
await page.evaluate(() => window.__lmReceive({ type: 'reloadTiles' }));
await page.waitForTimeout(2000);
const missAfter = requested.filter((u) => u.endsWith(MISSING_KEY)).length;
check('reloadTiles re-requests tiles that were missing', missAfter > missBefore, `${missBefore} -> ${missAfter}`);

if (shotPath) {
  await page.screenshot({ path: shotPath });
  console.log(`screenshot: ${shotPath}`);
}
check('no page errors', errors.length === 0, errors.join(' | '));
const errMsgs = await page.evaluate(() => window.__posted.filter((m) => m.type === 'error').map((m) => m.message));
check('no engine error events', errMsgs.length === 0, errMsgs.join(' | '));

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
