#!/usr/bin/env node
// Generates every LineMap Pro brand image from one vector definition.
//
//   node scripts/generate-assets.mjs            writes assets/* and docs/store/graphics/*
//   node scripts/generate-assets.mjs --preview  also writes previews and a contact sheet to /tmp/brand
//
// Needs the "sharp" image library. It is not a dependency of the app (to keep installs small), so
// the script looks for it in this project, then in SHARP_DIR, then in a global npm folder.
// If it is missing, run:  npm install --no-save sharp   (then run this script again).
//
// The mark: a cable route. Three survey nodes joined by two sagging spans (aerial strand sag),
// ending in a GPS target node. Hi-vis amber on field navy, matching src/theme.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(ROOT, 'assets');
const BRAND = path.join(ASSETS, 'brand');
const STORE = path.join(ROOT, 'docs', 'store', 'graphics');
const PREVIEW = '/tmp/brand';
const wantPreview = process.argv.includes('--preview');

const NAVY = '#0B0F14';
const NAVY_HI = '#16212E';
const AMBER = '#FFB020';
const TEXT = '#F2F5F8';
const MUTED = '#A7B3C2';

function loadSharp() {
  const candidates = [ROOT, process.env.SHARP_DIR, '/opt/npm-tools', '/usr/local/lib', '/usr/lib'].filter(Boolean);
  for (const base of candidates) {
    try {
      const req = createRequire(path.join(base, 'noop.js'));
      return req('sharp');
    } catch {
      /* try the next place */
    }
    try {
      const req = createRequire(path.join(base, 'node_modules', 'noop.js'));
      return req('sharp');
    } catch {
      /* try the next place */
    }
  }
  console.error('sharp not found. Run: npm install --no-save sharp   then run this script again.');
  process.exit(1);
}
const sharp = loadSharp();

// ---------------------------------------------------------------------------------------------
// Geometry (1024 x 1024 design space, mark centred on 512,512)
// ---------------------------------------------------------------------------------------------
const A = [222, 640];
const B = [512, 520];
const C = [802, 380];
const SAG = 150; // quadratic control offset; visible sag is about half of this
const SPAN_W = 62;
const NODE_R = 64;
const TARGET_R = 90;
const GAP = 18; // navy gap between a node and the cable, so nodes read as separate dots

const ctrl = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2 + SAG];

/** Mark only, as an SVG fragment drawn in `color`. Cut-outs are real transparency (a mask). */
function markFragment(id, color) {
  const [c1, c2] = [ctrl(A, B), ctrl(B, C)];
  const spans = `M${A[0]} ${A[1]} Q${c1[0]} ${c1[1]} ${B[0]} ${B[1]} Q${c2[0]} ${c2[1]} ${C[0]} ${C[1]}`;
  const ring = (p, r) => `<circle cx="${p[0]}" cy="${p[1]}" r="${r + GAP / 2}" fill="none" stroke="#000" stroke-width="${GAP}"/>`;
  return `
  <defs>
    <mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024">
      <rect width="1024" height="1024" fill="#fff"/>
      ${ring(A, NODE_R)}${ring(B, NODE_R)}${ring(C, TARGET_R)}
      <circle cx="${A[0]}" cy="${A[1]}" r="24" fill="#000"/>
      <circle cx="${B[0]}" cy="${B[1]}" r="24" fill="#000"/>
      <circle cx="${C[0]}" cy="${C[1]}" r="62" fill="#000"/>
      <circle cx="${C[0]}" cy="${C[1]}" r="36" fill="#fff"/>
    </mask>
  </defs>
  <g mask="url(#${id})">
    <path d="${spans}" fill="none" stroke="${color}" stroke-width="${SPAN_W}" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${A[0]}" cy="${A[1]}" r="${NODE_R}" fill="${color}"/>
    <circle cx="${B[0]}" cy="${B[1]}" r="${NODE_R}" fill="${color}"/>
    <circle cx="${C[0]}" cy="${C[1]}" r="${TARGET_R}" fill="${color}"/>
  </g>`;
}

// Farthest point of the mark from the centre (used to fit safe zones).
const MARK_EXTENT = Math.max(
  Math.hypot(A[0] - 512, A[1] - 512) + NODE_R,
  Math.hypot(C[0] - 512, C[1] - 512) + TARGET_R,
);

/** Scale the 1024 design around the centre so the mark's farthest point sits at `radius` px. */
function fitTransform(radius) {
  const s = radius / MARK_EXTENT;
  return `translate(512 512) scale(${s.toFixed(4)}) translate(-512 -512)`;
}

function background({ grid = true } = {}) {
  let lines = '';
  if (grid) {
    for (let v = 64; v < 1024; v += 128) {
      lines += `<line x1="${v}" y1="0" x2="${v}" y2="1024"/><line x1="0" y1="${v}" x2="1024" y2="${v}"/>`;
    }
  }
  return `
  <defs>
    <radialGradient id="bg" cx="30%" cy="22%" r="95%">
      <stop offset="0" stop-color="${NAVY_HI}"/>
      <stop offset="1" stop-color="${NAVY}"/>
    </radialGradient>
  </defs>
  <rect width="1024" height="1024" fill="url(#bg)"/>
  ${grid ? `<g stroke="${AMBER}" stroke-opacity="0.07" stroke-width="3">${lines}</g>` : ''}`;
}

const svg = (body, w = 1024, h = 1024, vb = '0 0 1024 1024') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${vb}">${body}</svg>`;

// Full-bleed square icon (iOS, Play Store). Apple and Google apply their own corner masks.
const iconSvg = svg(`${background()}<g transform="${fitTransform(410)}">${markFragment('m', AMBER)}</g>`);
// Android adaptive icon layers. Safe zone = 66 dp circle of a 108 dp canvas (61 percent of width):
// radius 313 px at 1024. We stay inside 290 px so launcher masks never clip the mark.
const fgSvg = svg(`<g transform="${fitTransform(290)}">${markFragment('m', AMBER)}</g>`);
const bgSvg = svg(background());
const monoSvg = svg(`<g transform="${fitTransform(290)}">${markFragment('m', '#FFFFFF')}</g>`);
// Splash: Android 12+ shows the splash icon inside a circle too, so use the same safe fit.
const splashSvg = svg(`<g transform="${fitTransform(330)}">${markFragment('m', AMBER)}</g>`);

function featureGraphicSvg() {
  // Google Play feature graphic, 1024 x 500.
  let lines = '';
  for (let v = 32; v < 1024; v += 64) lines += `<line x1="${v}" y1="0" x2="${v}" y2="500"/>`;
  for (let v = 26; v < 500; v += 64) lines += `<line x1="0" y1="${v}" x2="1024" y2="${v}"/>`;
  return svg(
    `<defs><radialGradient id="g" cx="20%" cy="30%" r="90%"><stop offset="0" stop-color="${NAVY_HI}"/><stop offset="1" stop-color="${NAVY}"/></radialGradient></defs>
    <rect width="1024" height="500" fill="url(#g)"/>
    <g stroke="${AMBER}" stroke-opacity="0.06" stroke-width="2">${lines}</g>
    <g transform="translate(56 74) scale(0.34)"><g transform="${fitTransform(470)}">${markFragment('m', AMBER)}</g></g>
    <g font-family="Inter, 'Helvetica Neue', Arial, sans-serif">
      <text x="452" y="228" font-size="72" font-weight="800" fill="${TEXT}" letter-spacing="-1.5">LineMap <tspan fill="${AMBER}">Pro</tspan></text>
      <text x="454" y="284" font-size="27" font-weight="500" fill="${MUTED}">Field mapping for cable and fiber crews</text>
      <text x="454" y="340" font-size="24" font-weight="600" fill="${AMBER}">Photo. GPS. Node. Footage. Done.</text>
    </g>`,
    1024,
    500,
    '0 0 1024 500',
  );
}

// ---------------------------------------------------------------------------------------------
async function render(svgText, out, size, { opaque = false, width, height } = {}) {
  let img = sharp(Buffer.from(svgText), { density: 300 }).resize(width ?? size, height ?? size);
  if (opaque) img = img.flatten({ background: NAVY }).removeAlpha();
  await img.png({ compressionLevel: 9 }).toFile(out);
  return out;
}

async function main() {
  for (const d of [ASSETS, BRAND, STORE]) fs.mkdirSync(d, { recursive: true });

  // Vector sources, kept so a designer can refine them later.
  fs.writeFileSync(path.join(BRAND, 'icon.svg'), iconSvg);
  fs.writeFileSync(path.join(BRAND, 'android-foreground.svg'), fgSvg);
  fs.writeFileSync(path.join(BRAND, 'android-monochrome.svg'), monoSvg);
  fs.writeFileSync(path.join(BRAND, 'splash-icon.svg'), splashSvg);
  fs.writeFileSync(path.join(BRAND, 'feature-graphic.svg'), featureGraphicSvg());

  await render(iconSvg, path.join(ASSETS, 'icon.png'), 1024, { opaque: true });
  await render(fgSvg, path.join(ASSETS, 'android-icon-foreground.png'), 1024);
  await render(bgSvg, path.join(ASSETS, 'android-icon-background.png'), 1024, { opaque: true });
  await render(monoSvg, path.join(ASSETS, 'android-icon-monochrome.png'), 1024);
  await render(splashSvg, path.join(ASSETS, 'splash-icon.png'), 1024);
  // Favicon: rounded tile so it reads on light and dark browser tabs.
  const fav = svg(
    `<defs><clipPath id="r"><rect width="1024" height="1024" rx="200"/></clipPath></defs><g clip-path="url(#r)">${background({ grid: false })}<g transform="${fitTransform(420)}">${markFragment('m', AMBER)}</g></g>`,
  );
  await render(fav, path.join(ASSETS, 'favicon.png'), 64);
  // In-app logo (home header, loading screen): the same rounded tile, large enough for 64 pt at 3x.
  await render(fav, path.join(ASSETS, 'logo-tile.png'), 192);

  // Store-only graphics.
  await render(iconSvg, path.join(STORE, 'play-icon-512.png'), 512, { opaque: true });
  await render(featureGraphicSvg(), path.join(STORE, 'play-feature-graphic-1024x500.png'), 0, { opaque: true, width: 1024, height: 500 });

  console.log('Wrote assets/*.png, assets/brand/*.svg, docs/store/graphics/*.png');
  if (wantPreview) await previews(fav);
}

// ---------------------------------------------------------------------------------------------
// Previews: how the icon looks at real sizes, under launcher masks, and on the splash screen.
async function previews(favSvg) {
  fs.mkdirSync(PREVIEW, { recursive: true });
  const icon = fs.readFileSync(path.join(ASSETS, 'icon.png'));
  const fg = fs.readFileSync(path.join(ASSETS, 'android-icon-foreground.png'));
  const bg = fs.readFileSync(path.join(ASSETS, 'android-icon-background.png'));
  const mono = fs.readFileSync(path.join(ASSETS, 'android-icon-monochrome.png'));
  const splash = fs.readFileSync(path.join(ASSETS, 'splash-icon.png'));

  const b64 = (buf) => `data:image/png;base64,${buf.toString('base64')}`;
  const adaptive = await sharp(bg).composite([{ input: fg }]).png().toBuffer();
  // Android 13 themed icon: monochrome tinted on a pale surface.
  const monoTint = await sharp({ create: { width: 1024, height: 1024, channels: 4, background: '#D9E4F2' } })
    .composite([{ input: await sharp(mono).tint('#1E3A5F').toBuffer() }])
    .png()
    .toBuffer();

  const S = 1600;
  const H = 1180;
  const label = (x, y, t) => `<text x="${x}" y="${y}" font-size="22" fill="${MUTED}" font-family="Inter, Arial, sans-serif">${t}</text>`;
  const iosMask = (x, y, s, href) =>
    `<defs><clipPath id="c${x}${y}"><rect x="${x}" y="${y}" width="${s}" height="${s}" rx="${s * 0.225}"/></clipPath></defs><image href="${href}" x="${x}" y="${y}" width="${s}" height="${s}" clip-path="url(#c${x}${y})"/>`;
  // Android masks: the 108 dp layer is shown at 72 dp, i.e. cropped to the centre 66.7 percent.
  const droid = (x, y, s, href, shape) => {
    const big = s * 1.5;
    const off = (big - s) / 2;
    const clip =
      shape === 'circle'
        ? `<circle cx="${x + s / 2}" cy="${y + s / 2}" r="${s / 2}"/>`
        : shape === 'squircle'
          ? `<rect x="${x}" y="${y}" width="${s}" height="${s}" rx="${s * 0.32}"/>`
          : `<path d="M${x + s / 2} ${y} L${x + s} ${y + s * 0.28} L${x + s} ${y + s * 0.72} L${x + s / 2} ${y + s} L${x} ${y + s * 0.72} L${x} ${y + s * 0.28} Z"/>`;
    const id = `d${shape}${x}${y}`;
    return `<defs><clipPath id="${id}">${clip}</clipPath></defs><image href="${href}" x="${x - off}" y="${y - off}" width="${big}" height="${big}" clip-path="url(#${id})"/>`;
  };
  // Safe-zone overlay on the raw foreground.
  const safe = `<circle cx="1390" cy="200" r="${(160 * 66) / 108}" fill="none" stroke="#3CC8F0" stroke-dasharray="6 6" stroke-width="2"/>`;

  const sheet = svg(
    `<rect width="${S}" height="${H}" fill="#05080C"/>
    <text x="40" y="60" font-size="34" font-weight="800" fill="${TEXT}" font-family="Inter, Arial, sans-serif">LineMap Pro: icon and splash contact sheet</text>
    ${iosMask(40, 100, 360, b64(icon))}${label(40, 490, 'iOS 1024 (Apple mask)')}
    ${iosMask(440, 100, 180, b64(icon))}${label(440, 310, '180 px')}
    ${iosMask(440, 340, 96, b64(icon))}${label(440, 460, '96 px')}
    ${iosMask(560, 340, 48, b64(icon))}${label(560, 410, '48 px')}
    ${iosMask(640, 340, 29, b64(icon))}${label(630, 390, '29')}
    ${droid(720, 120, 180, b64(adaptive), 'circle')}${label(720, 330, 'Android circle')}
    ${droid(940, 120, 180, b64(adaptive), 'squircle')}${label(940, 330, 'Android squircle')}
    ${droid(720, 360, 96, b64(adaptive), 'circle')}${droid(840, 360, 48, b64(adaptive), 'circle')}${label(720, 490, 'Android 96 / 48')}
    ${droid(940, 360, 120, b64(monoTint), 'circle')}${label(940, 510, 'Themed (monochrome)')}
    <rect x="1230" y="40" width="320" height="320" fill="#26313D"/>
    <image href="${b64(fg)}" x="1230" y="40" width="320" height="320"/>${safe.replace('1390', '1390').replace('cy="200"', 'cy="200"').replace(`r="${(160 * 66) / 108}"`, `r="${(320 * 66) / 108 / 2}"`)}
    ${label(1230, 390, 'Foreground + 66 dp safe zone')}
    <rect x="40" y="560" width="300" height="600" rx="40" fill="${NAVY}" stroke="#2A3644" stroke-width="3"/>
    <image href="${b64(splash)}" x="115" y="785" width="150" height="150"/>
    ${label(40, 1180 - 4, 'Splash (200 dp icon)')}
    <rect x="380" y="560" width="300" height="600" rx="40" fill="#141414" stroke="#2A3644" stroke-width="3"/>
    <circle cx="530" cy="860" r="96" fill="${NAVY}"/>
    <image href="${b64(splash)}" x="466" y="796" width="128" height="128"/>
    ${label(380, 1176, 'Android 12+ splash (circle)')}
    <image href="${b64(fs.readFileSync(path.join(STORE, 'play-feature-graphic-1024x500.png')))}" x="720" y="580" width="840" height="410"/>
    ${label(720, 1020, 'Google Play feature graphic 1024 x 500')}
    <image href="${b64(await sharp(Buffer.from(favSvg)).resize(64, 64).png().toBuffer())}" x="720" y="1050" width="64" height="64"/>
    <rect x="800" y="1050" width="64" height="64" fill="#FFFFFF"/>
    <image href="${b64(await sharp(Buffer.from(favSvg)).resize(32, 32).png().toBuffer())}" x="816" y="1066" width="32" height="32"/>
    ${label(880, 1090, 'Favicon 64 and 32 (on dark and white)')}`,
    S,
    H,
    `0 0 ${S} ${H}`,
  );
  await sharp(Buffer.from(sheet)).png().toFile(path.join(PREVIEW, 'contact-sheet.png'));
  await sharp(icon).resize(48, 48).png().toFile(path.join(PREVIEW, 'icon-48.png'));
  await sharp(adaptive).png().toFile(path.join(PREVIEW, 'android-adaptive-composite.png'));
  await sharp(monoTint).png().toFile(path.join(PREVIEW, 'android-themed.png'));
  console.log(`Previews in ${PREVIEW}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
