#!/usr/bin/env node
// Captures store screenshots from the web preview build and adds a caption band.
//
// 1. Build the preview:
//      LINEMAP_PREVIEW=1 EXPO_PUBLIC_PREVIEW=1 EXPO_OFFLINE=1 npx expo export --platform web --output-dir /tmp/shots-build
// 2. Run:  node scripts/store-screenshots.mjs [buildDir]
//    Needs Playwright with Chromium (not an app dependency). Set PLAYWRIGHT_DIR to the folder that
//    contains node_modules/playwright if it is not installed in this project.
//
// Output: docs/store/screenshots/<device>/<nn>-<screen>.jpg
// The preview has no satellite imagery (it shows a survey grid), so retake the map shots on a
// real device before launch. See docs/store/SCREENSHOTS.md.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = path.resolve(process.argv[2] ?? '/tmp/shots-build');
const OUT = path.join(ROOT, 'docs', 'store', 'screenshots');
const RAW = '/tmp/shots-raw';
const PORT = 8765;

function loadPlaywright() {
  for (const base of [ROOT, process.env.PLAYWRIGHT_DIR, '/opt/npm-tools'].filter(Boolean)) {
    for (const sub of ['noop.js', 'node_modules/noop.js']) {
      try {
        return createRequire(path.join(base, sub))('playwright');
      } catch {
        /* next */
      }
    }
  }
  console.error('Playwright not found. Install it outside the app (npm i -g playwright) and set PLAYWRIGHT_DIR.');
  process.exit(1);
}
const { chromium } = loadPlaywright();

const DEMO = 'de30a000-0000-4000-8000-000000000001';
const NODE = (n) => `de30a000-0000-4000-8000-1000000000${String(n).padStart(2, '0')}`;

const SHOTS = [
  { id: '01-map', path: `/project/${DEMO}`, wait: 5000, title: 'Photo. GPS. Node. Done.', sub: 'Every photo drops a node on the map with averaged GPS and live span footage.' },
  { id: '02-node', path: `/project/${DEMO}/node/${NODE(3)}`, wait: 2500, scrollText: /^pole details$/i, title: 'AI fills in the fields', sub: 'Claude reads pole tags, lid castings and labels. You review and confirm.' },
  { id: '03-projects', path: '/', wait: 2500, title: 'Every job in one place', sub: 'Aerial and underground footage, node counts and earnings at a glance.' },
  { id: '04-export', path: `/project/${DEMO}/export`, wait: 2500, title: 'Export for any client', sub: 'KMZ, Excel, CSV, PDF, GeoJSON and Shapefile, with a QC check first.' },
  { id: '05-templates', path: '/templates/de30a000-0000-4000-8000-0000000000f1', wait: 2500, title: 'Built for your clients', sub: 'Label patterns, required fields, defaults and rates per client.' },
];

// Final pixel sizes required by the stores, and the CSS viewport the app is rendered at.
const DEVICES = [
  { id: 'iphone-6.9', w: 1320, h: 2868, vw: 440, vh: 956, dpr: 3, band: 560, shotW: 1150, radius: 70, font: 84, subFont: 40 },
  { id: 'android-phone', w: 1080, h: 1920, vw: 412, vh: 732, dpr: 2.625, band: 420, shotW: 900, radius: 52, font: 64, subFont: 31 },
  { id: 'ipad-13', w: 2064, h: 2752, vw: 1032, vh: 1376, dpr: 2, band: 470, shotW: 1820, radius: 48, font: 96, subFont: 44 },
];

function serve() {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.wasm': 'application/wasm' };
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
    let file = path.join(BUILD, url);
    if (!file.startsWith(BUILD) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(BUILD, 'index.html');
    res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

async function captureRaw(browser, dev) {
  const ctx = await browser.newContext({ viewport: { width: dev.vw, height: dev.vh }, deviceScaleFactor: dev.dpr, colorScheme: 'dark' });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('linemap.seenOnboarding', '1');
    } catch {
      /* ignore */
    }
  });
  const page = await ctx.newPage();
  const files = {};
  for (const s of SHOTS) {
    await page.goto(`http://localhost:${PORT}${s.path}`, { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(s.wait);
    // The preview shows a "camera and GPS are off" notice; dismiss it for clean shots.
    const close = page.locator('[aria-label="Dismiss preview notice"]');
    if (await close.count()) await close.first().click().catch(() => {});
    if (s.scrollText) {
      // Bring a section to the top (for example the AI-filled fields under the photo).
      const target = page.getByText(s.scrollText).first();
      if (await target.count()) {
        await target.evaluate((el) => el.scrollIntoView({ block: 'start' }));
        await page.waitForTimeout(300);
        // Leave a little room above the section heading.
        await target.evaluate((el) => {
          let p = el.parentElement;
          while (p && p.scrollHeight <= p.clientHeight) p = p.parentElement;
          if (p) p.scrollTop = Math.max(0, p.scrollTop - 140);
        });
      }
    }
    await page.waitForTimeout(400);
    const f = path.join(RAW, `${dev.id}-${s.id}.png`);
    await page.screenshot({ path: f });
    files[s.id] = f;
  }
  await ctx.close();
  return files;
}

function wrapperHtml(dev, s, rawFile) {
  const img = `data:image/png;base64,${fs.readFileSync(rawFile).toString('base64')}`;
  const shotH = Math.round((dev.shotW * dev.vh) / dev.vw);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:${dev.w}px;height:${dev.h}px;overflow:hidden;background:#0B0F14;font-family:Inter,'Helvetica Neue',Arial,sans-serif}
  .bg{position:absolute;inset:0;background:radial-gradient(120% 70% at 20% 0%,#1A2533 0%,#0B0F14 60%)}
  .grid{position:absolute;inset:0;background-image:linear-gradient(rgba(255,176,32,.06) 2px,transparent 2px),linear-gradient(90deg,rgba(255,176,32,.06) 2px,transparent 2px);background-size:${Math.round(dev.w / 10)}px ${Math.round(dev.w / 10)}px}
  .band{position:absolute;left:0;right:0;top:0;height:${dev.band}px;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;padding:0 ${Math.round(dev.w * 0.07)}px;box-sizing:border-box}
  .rule{width:${Math.round(dev.font * 1.1)}px;height:${Math.max(6, Math.round(dev.font / 11))}px;border-radius:99px;background:#FFB020;margin-bottom:${Math.round(dev.font * 0.45)}px}
  h1{margin:0;color:#F2F5F8;font-size:${dev.font}px;font-weight:800;letter-spacing:-.02em;line-height:1.08}
  p{margin:${Math.round(dev.subFont * 0.6)}px 0 0;color:#A7B3C2;font-size:${dev.subFont}px;font-weight:500;line-height:1.3;max-width:${Math.round(dev.w * 0.84)}px}
  .shot{position:absolute;left:${Math.round((dev.w - dev.shotW) / 2)}px;top:${dev.band}px;width:${dev.shotW}px;height:${shotH}px;border-radius:${dev.radius}px;overflow:hidden;
    box-shadow:0 0 0 ${Math.round(dev.radius / 5)}px #1F2935,0 0 0 ${Math.round(dev.radius / 5) + 3}px #3A4A5C,0 40px 120px rgba(0,0,0,.6)}
  .shot img{width:100%;height:100%;display:block}
  </style></head><body><div class="bg"></div><div class="grid"></div>
  <div class="band"><div class="rule"></div><h1>${s.title}</h1><p>${s.sub}</p></div>
  <div class="shot"><img src="${img}"></div></body></html>`;
}

async function main() {
  if (!fs.existsSync(path.join(BUILD, 'index.html'))) {
    console.error(`No web build at ${BUILD}. Build it first (see the top of this file).`);
    process.exit(1);
  }
  fs.mkdirSync(RAW, { recursive: true });
  const server = await serve();
  const browser = await chromium.launch({ executablePath: fs.existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined });
  try {
    for (const dev of DEVICES) {
      const raw = await captureRaw(browser, dev);
      const dir = path.join(OUT, dev.id);
      fs.mkdirSync(dir, { recursive: true });
      const ctx = await browser.newContext({ viewport: { width: dev.w, height: dev.h }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      for (const s of SHOTS) {
        await page.setContent(wrapperHtml(dev, s, raw[s.id]), { waitUntil: 'load' });
        await page.screenshot({ path: path.join(dir, `${s.id}.jpg`), type: 'jpeg', quality: 86 });
      }
      await ctx.close();
      console.log(`${dev.id}: ${SHOTS.length} screenshots in ${path.relative(ROOT, dir)}`);
    }
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
