#!/usr/bin/env node
// Builds the offline WebView map document for native (Android/iOS).
//
//   node scripts/build-map-bundle.mjs [--html-out <file>]
//
// Inputs:
//   src/map/core/mapCore.ts                      shared engine (transpiled with typescript.transpileModule)
//   node_modules/maplibre-gl/dist/maplibre-gl.mjs main thread library (ESM, converted to a classic script)
//   node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs  worker (inlined, started from a Blob URL)
//   node_modules/maplibre-gl/dist/maplibre-gl.css
// Outputs (commit these):
//   src/map/generated/maplibreCss.ts     MAPLIBRE_CSS (also used by the web build)
//   src/map/generated/maplibreWorker.ts  MAPLIBRE_WORKER_JS (also used by the web build)
//   src/map/generated/mapHtml.ts         MAP_HTML (native only; everything inlined, no CDN)
// --html-out writes the same document as a standalone .html file for browser testing.
//
// Hermes strips function source, so the engine cannot be stringified at runtime; it is compiled here.
// Run again after changing mapCore.ts or upgrading maplibre-gl.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const p = (...parts) => resolve(root, ...parts);
const outDir = p('src/map/generated');

function fail(msg) {
  console.error(`build-map-bundle: ${msg}`);
  process.exit(1);
}

function stripSourceMap(code) {
  return code.replace(/\n?\/\/# sourceMappingURL=\S+\s*$/, '\n').replace(/\/\*# sourceMappingURL=[^*]*\*\/\s*$/, '\n');
}

/** Inline <script>/<style> content must not contain sequences that end or confuse the HTML raw text element. */
function assertInlineSafe(name, code, tag) {
  if (new RegExp(`</${tag}`, 'i').test(code)) fail(`${name} contains "</${tag}" and cannot be inlined raw`);
  if (code.includes('<!--')) fail(`${name} contains "<!--" and cannot be inlined raw`);
}

/** JSON string literal, pure ASCII (non-ASCII escaped as \uXXXX, which also keeps em-dashes out of the repo). */
function literal(str) {
  return JSON.stringify(str).replace(/[\u007f-\uffff]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

// ---------------------------------------------------------------- mapCore

const coreSrc = readFileSync(p('src/map/core/mapCore.ts'), 'utf8');
// Hash of the engine source; a unit test compares it to catch a stale generated bundle.
const coreHash = createHash('sha256').update(coreSrc.replace(/\r\n/g, '\n')).digest('hex');
if (/^\s*import\s/m.test(coreSrc)) fail('mapCore.ts must not import anything');
const transpiled = ts.transpileModule(coreSrc, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2019,
    module: ts.ModuleKind.ESNext,
    removeComments: true,
    sourceMap: false,
    isolatedModules: true,
  },
  fileName: 'mapCore.ts',
  reportDiagnostics: true,
});
if (transpiled.diagnostics && transpiled.diagnostics.length) {
  fail('transpile diagnostics:\n' + ts.formatDiagnostics(transpiled.diagnostics, {
    getCanonicalFileName: (f) => f,
    getCurrentDirectory: () => root,
    getNewLine: () => '\n',
  }));
}
let coreJs = stripSourceMap(transpiled.outputText)
  .replace(/^export\s+(?=(async\s+)?(function|const|let|var|class)\b)/gm, '')
  .replace(/^export\s*\{\s*\};?\s*$/gm, '');
if (/^\s*(export|import)\b/m.test(coreJs)) fail('mapCore output still has module syntax; see header rules in mapCore.ts');
coreJs =
  '(function(){\n"use strict";\n' +
  coreJs +
  '\nwindow.LineMapCore={createLineMap:createLineMap,installInlineWorker:installInlineWorker};' +
  '\nwindow.createLineMap=createLineMap;\n})();\n';
assertInlineSafe('mapCore', coreJs, 'script');

// ---------------------------------------------------------------- maplibre

const mlDir = p('node_modules/maplibre-gl/dist');
const mlPkg = JSON.parse(readFileSync(p('node_modules/maplibre-gl/package.json'), 'utf8'));
let mlJs = stripSourceMap(readFileSync(resolve(mlDir, 'maplibre-gl.mjs'), 'utf8'));
const exportRe = /export\s*\{([^}]*)\}\s*;?\s*$/;
const exportMatch = mlJs.match(exportRe);
if (!exportMatch) fail('could not find the export list at the end of maplibre-gl.mjs');
const members = exportMatch[1]
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((spec) => {
    const m = spec.match(/^([\w$]+)(?:\s+as\s+([\w$]+))?$/);
    if (!m) fail(`unexpected export spec "${spec}"`);
    return `${literal(m[2] || m[1])}:${m[1]}`;
  });
mlJs = mlJs.replace(exportRe, `window.maplibregl={${members.join(',')}};\n`);
// The page sets the worker URL explicitly; import.meta only feeds the default worker URL lookup.
mlJs = mlJs.replace(/import\.meta\.url/g, '(document.baseURI||location.href)');
if (/\bimport\.meta\b/.test(mlJs)) fail('maplibre-gl.mjs uses import.meta in an unsupported way');
if (/(^|[;}\s])import\s*[{*\w]/.test(mlJs.slice(0, 2000))) fail('maplibre-gl.mjs has static imports; expected a self-contained bundle');
// Classic script, own scope (module top-level names must not leak into window), module strictness kept.
mlJs = '(function(){\n"use strict";\n' + mlJs + '\n})();\n';
assertInlineSafe('maplibre-gl.mjs', mlJs, 'script');

let workerJs = stripSourceMap(readFileSync(resolve(mlDir, 'maplibre-gl-worker.mjs'), 'utf8'));
// The worker bootstraps itself (self.worker = new Worker(self)); its default export is unused.
workerJs = workerJs.replace(/export\s*\{[^}]*\}\s*;?\s*$/, '\n');
if (/\bimport\.meta\b/.test(workerJs) || /^\s*export\b/m.test(workerJs)) fail('worker still has module-only syntax');
assertInlineSafe('maplibre-gl-worker.mjs', workerJs, 'script');

const mlCss = stripSourceMap(readFileSync(resolve(mlDir, 'maplibre-gl.css'), 'utf8'));
assertInlineSafe('maplibre-gl.css', mlCss, 'style');

// ---------------------------------------------------------------- bridge

const bridgeJs = `(function(){
"use strict";
function post(msg){
  try{
    var s=JSON.stringify(msg);
    var rn=window.ReactNativeWebView;
    if(rn&&rn.postMessage){rn.postMessage(s);return;}
    if(window.parent&&window.parent!==window){window.parent.postMessage(s,"*");}
  }catch(e){}
}
window.addEventListener("error",function(ev){post({type:"error",message:String((ev&&ev.message)||"error")+(ev&&ev.lineno?" @"+ev.lineno:"")});});
window.addEventListener("unhandledrejection",function(ev){var r=ev&&ev.reason;post({type:"error",message:"unhandled: "+String((r&&r.message)||r)});});
var ctl=null;
function handle(msg){
  if(!msg||!ctl)return;
  switch(msg.type){
    case "state":ctl.setState(msg.state);break;
    case "fit":ctl.fit(msg.animate!==false);break;
    case "center":ctl.centerOn(msg.lat,msg.lng,msg.zoom);break;
    case "resize":ctl.resize();break;
    case "snapshot":
      ctl.snapshot().then(function(d){post({type:"snapshot",reqId:msg.reqId,data:d});},function(){post({type:"snapshot",reqId:msg.reqId,data:null});});
      break;
  }
}
window.__lmReceive=function(msg){
  try{handle(typeof msg==="string"?JSON.parse(msg):msg);}catch(e){post({type:"error",message:"bridge: "+String(e&&e.message)});}
};
function onMessage(ev){
  var d=ev&&ev.data;
  if(typeof d==="string"){try{d=JSON.parse(d);}catch(e){return;}}
  if(d&&d.__lm===1)window.__lmReceive(d);
}
window.addEventListener("message",onMessage);
document.addEventListener("message",onMessage);
try{
  var w=document.getElementById("lm-worker");
  window.LineMapCore.installInlineWorker(window.maplibregl,w?w.textContent:"");
  if(w&&w.parentNode)w.parentNode.removeChild(w);
  ctl=window.LineMapCore.createLineMap(document.getElementById("map"),window.maplibregl,post,{showZoomButtons:false});
  window.__lmController=ctl;
  post({type:"ready"});
}catch(e){post({type:"error",message:"init: "+String(e&&e.message)});}
})();
`;
assertInlineSafe('bridge', bridgeJs, 'script');

const pageCss =
  'html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#0B0F14;overscroll-behavior:none}' +
  '#map{position:absolute;inset:0}';

const HEAD =
  '<!DOCTYPE html><html><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">' +
  '<title>LineMap</title><style>';
const AFTER_CSS = `</style><style>${pageCss}</style></head><body><div id="map"></div><script type="text/plain" id="lm-worker">`;
const AFTER_WORKER = '</script><script>';
const AFTER_ML = '</script><script>';
const AFTER_CORE = '</script><script>';
const TAIL = '</script></body></html>';

// ---------------------------------------------------------------- write

mkdirSync(outDir, { recursive: true });
const banner = (what) =>
  `// AUTO-GENERATED by scripts/build-map-bundle.mjs from ${what}. Do not edit; re-run the script.\n` +
  `// maplibre-gl ${mlPkg.version} (BSD-3-Clause, https://github.com/maplibre/maplibre-gl-js).\n`;

writeFileSync(
  resolve(outDir, 'maplibreCss.ts'),
  banner('maplibre-gl/dist/maplibre-gl.css') + `export const MAPLIBRE_CSS: string = ${literal(mlCss)};\n`,
);
writeFileSync(
  resolve(outDir, 'maplibreWorker.ts'),
  banner('maplibre-gl/dist/maplibre-gl-worker.mjs') +
    '// Classic-script compatible worker source; start it from a Blob URL via installInlineWorker().\n' +
    `export const MAPLIBRE_WORKER_JS: string = ${literal(workerJs)};\n`,
);
writeFileSync(
  resolve(outDir, 'mapHtml.ts'),
  banner('src/map/core/mapCore.ts + maplibre-gl') +
    "import { MAPLIBRE_CSS } from './maplibreCss';\n" +
    "import { MAPLIBRE_WORKER_JS } from './maplibreWorker';\n\n" +
    `export const MAPLIBRE_VERSION = ${literal(mlPkg.version)};\n` +
    '/** sha256 of src/map/core/mapCore.ts this bundle was built from (checked by src/map/__tests__). */\n' +
    `export const MAP_CORE_SOURCE_SHA256 = ${literal(coreHash)};\n\n` +
    `const MAPLIBRE_JS: string = ${literal(mlJs)};\n\n` +
    `const MAP_CORE_JS: string = ${literal(coreJs)};\n\n` +
    `const BRIDGE_JS: string = ${literal(bridgeJs)};\n\n` +
    '/** Self-contained offline map document for react-native-webview. */\n' +
    'export const MAP_HTML: string = [\n' +
    `  ${literal(HEAD)},\n  MAPLIBRE_CSS,\n  ${literal(AFTER_CSS)},\n  MAPLIBRE_WORKER_JS,\n  ${literal(AFTER_WORKER)},\n` +
    `  MAPLIBRE_JS,\n  ${literal(AFTER_ML)},\n  MAP_CORE_JS,\n  ${literal(AFTER_CORE)},\n  BRIDGE_JS,\n  ${literal(TAIL)},\n` +
    "].join('');\n",
);

const html = HEAD + mlCss + AFTER_CSS + workerJs + AFTER_WORKER + mlJs + AFTER_ML + coreJs + AFTER_CORE + bridgeJs + TAIL;
const htmlOutIdx = process.argv.indexOf('--html-out');
if (htmlOutIdx > 0 && process.argv[htmlOutIdx + 1]) {
  const out = resolve(process.argv[htmlOutIdx + 1]);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
  console.log(`build-map-bundle: wrote ${out}`);
}
console.log(
  `build-map-bundle: maplibre-gl ${mlPkg.version}, MAP_HTML ${(html.length / 1024).toFixed(0)} KB ` +
    `(core ${(coreJs.length / 1024).toFixed(1)} KB, lib ${(mlJs.length / 1024).toFixed(0)} KB, worker ${(workerJs.length / 1024).toFixed(0)} KB)`,
);
