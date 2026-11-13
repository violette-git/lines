import JSZip from 'jszip';
import * as XLSX from 'xlsx';

import { runQc } from '@/domain/qc';
import { makeBundle, TINY_JPEG_B64 } from '../__fixtures__/bundle';
import { exportFileName } from '../build';
import {
  buildCsv,
  buildGeoJSON,
  buildKmz,
  buildReportHtml,
  buildRouteSvg,
  buildShapefileZip,
  buildXlsx,
  csvField,
  kmlColor,
  loadReportPhotos,
  shortFieldNames,
  slugify,
} from '../builders';

/** Minimal RFC 4180 parser used to round-trip the CSV output. */
function parseCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\r' && s[i + 1] === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const EM_DASH = String.fromCharCode(0x2014);

describe('GeoJSON', () => {
  it('builds point and line features with flattened properties and project metadata', () => {
    const fc = buildGeoJSON(makeBundle());
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.linemap.project.name).toBe('Main St Fiber, Phase "2"');
    expect(fc.linemap.totals.node_count).toBe(3);
    expect(fc.linemap.totals.total_ft).toBe(416);
    const points = fc.features.filter((f) => f.geometry.type === 'Point');
    const lines = fc.features.filter((f) => f.geometry.type === 'LineString');
    expect(points).toHaveLength(3);
    expect(lines).toHaveLength(2);

    const p1 = points[0];
    expect(p1.geometry.coordinates).toEqual([-86.8025123, 33.5207123]);
    expect(p1.properties).toMatchObject({
      id: 'n-1',
      seq: 1,
      label: 'P-1',
      type: 'pole',
      type_label: 'Pole',
      pole_tag: 'A "12", 3',
      pole_height_ft: 40,
      transformer: true,
      accuracy_m: 3.2,
      gps_source: 'gps_avg',
      status: 'ai_done',
      photo_count: 1,
      ai_estimates: 'pole_height_ft',
      ai_confidence_min: 0.6,
      possible_duplicate_of: null,
    });

    const l1 = lines[0];
    expect(l1.geometry.coordinates).toHaveLength(2);
    expect(l1.properties).toMatchObject({
      from_label: 'P-1',
      to_label: 'P-2',
      kind: 'aerial',
      straight_ft: 280.4,
      total_ft: 286,
      slack_ft: 0,
      sag_pct: 2,
      override: false,
      cable_type: 'Fiber',
      fiber_count: 144,
    });
    const json = JSON.stringify(fc);
    expect(json).not.toMatch(/NaN|undefined/);
  });
});

describe('KMZ', () => {
  it('unzips to doc.kml with placemarks, styled folders and the embedded photo', async () => {
    const bytes = await buildKmz(makeBundle());
    expect(bytes).toBeInstanceOf(Uint8Array);
    const zip = await JSZip.loadAsync(bytes);
    expect(Object.keys(zip.files)[0]).toBe('doc.kml');
    const kml = await zip.file('doc.kml')!.async('string');
    expect(kml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect((kml.match(/<Placemark /g) ?? []).length).toBe(5);
    expect(kml).toContain('<name>P-1</name>');
    expect(kml).toContain('<name>HH-3</name>');
    expect(kml).toContain('<name>Pole (2)</name>');
    expect(kml).toContain('<name>Handhole (1)</name>');
    expect(kml).toContain('<name>Spans (2)</name>');
    expect(kml).toContain('<name>286 ft</name>');
    expect(kml).toContain('<styleUrl>#span-underground</styleUrl>');
    expect(kml).toContain(`<color>${kmlColor('#FFB020')}</color>`);
    // Project name with quotes is escaped.
    expect(kml).toContain('<name>Main St Fiber, Phase &quot;2&quot;</name>');
    // Notes with & and < are double-escaped inside the HTML description, never raw.
    expect(kml).not.toMatch(/<tag>/);
    expect(kml).toContain('files/ph-1.jpg');
    const photo = zip.file('files/ph-1.jpg');
    expect(photo).not.toBeNull();
    expect(await photo!.async('base64')).toBe(TINY_JPEG_B64);
    expect(kml).not.toMatch(/NaN|undefined/);
  });

  it('converts colors to KML aabbggrr', () => {
    expect(kmlColor('#FFB020')).toBe('ff20b0ff');
    expect(kmlColor('#3DDC97', '80')).toBe('8097dc3d');
  });

  it('works without a photo loader', async () => {
    const zip = await JSZip.loadAsync(await buildKmz(makeBundle({ loadPhotoBase64: undefined })));
    expect(Object.keys(zip.files)).toEqual(['doc.kml']);
  });
});

describe('CSV', () => {
  it('quotes commas, quotes and newlines per RFC 4180 and round-trips', () => {
    const { nodesCsv, spansCsv } = buildCsv(makeBundle());
    expect(nodesCsv.includes('\r\n')).toBe(true);
    const rows = parseCsv(nodesCsv);
    const header = rows[0];
    expect(rows).toHaveLength(4);
    expect(header.slice(0, 5)).toEqual(['Seq', 'Label', 'Type', 'Latitude', 'Longitude']);
    expect(header).toContain('Pole height (ft)');
    expect(header).toContain('Size'); // handhole field present in union
    expect(header).toContain('Down guys / Guys attached'); // same key, different labels
    expect(header).toContain('GPS accuracy (m)');
    expect(header).toContain('Created at');
    const p1 = rows[1];
    const col = (name: string) => p1[header.indexOf(name)];
    expect(col('Latitude')).toBe('33.5207123');
    expect(col('Longitude')).toBe('-86.8025123');
    expect(col('Pole tag / number')).toBe('A "12", 3');
    expect(col('Notes')).toBe('Line one\nLine two, with comma & <tag>');
    expect(col('Transformer')).toBe('Yes');
    expect(col('Leaning')).toBe('No');
    expect(col('GPS accuracy (m)')).toBe('3.2');
    expect(col('Created at')).toBe('2026-11-10T14:00:00.000Z');
    // Raw text check of the quoting.
    expect(nodesCsv).toContain('"A ""12"", 3"');
    expect(nodesCsv).toContain('"Line one\nLine two, with comma & <tag>"');

    const s = parseCsv(spansCsv);
    expect(s).toHaveLength(3);
    expect(s[1].slice(0, 3)).toEqual(['P-1', 'P-2', 'Aerial']);
    expect(s[1][s[0].indexOf('Total (ft)')]).toBe('286');
  });

  it('neutralises spreadsheet formulas', () => {
    expect(csvField('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvField('-5')).toBe('-5');
    expect(csvField('-cmd')).toBe("'-cmd");
    expect(csvField(null)).toBe('');
    expect(csvField(Number.NaN)).toBe('');
  });
});

describe('XLSX', () => {
  it('parses back with Summary, Nodes, Spans and QC Issues sheets', () => {
    const bundle = makeBundle();
    const bytes = buildXlsx(bundle);
    expect(bytes).toBeInstanceOf(Uint8Array);
    const wb = XLSX.read(bytes, { type: 'array' });
    expect(wb.SheetNames).toEqual(['Summary', 'Nodes', 'Spans', 'QC Issues']);

    const summary = XLSX.utils.sheet_to_json<(string | number)[]>(wb.Sheets.Summary, { header: 1 });
    const get = (k: string) => summary.find((r) => r[0] === k)?.[1];
    expect(get('Project')).toBe('Main St Fiber, Phase "2"');
    expect(get('Client')).toBe('Acme Telecom');
    expect(get('Job #')).toBe('J-1042');
    expect(get('Nodes')).toBe(3);
    expect(get('  Pole')).toBe(2);
    expect(get('  Handhole')).toBe(1);
    expect(get('Aerial (ft)')).toBe(286);
    expect(get('Underground (ft)')).toBe(130);
    expect(get('Total (ft)')).toBe(416);
    // 0.5 $/ft * 416 ft + 10 $/node * 3 = 238
    expect(get('Earnings')).toBe(238);

    const nodes = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets.Nodes);
    expect(nodes).toHaveLength(3);
    expect(nodes[0].Label).toBe('P-1');
    expect(nodes[0].Latitude).toBeCloseTo(33.5207123, 7);
    expect(nodes[2].Type).toBe('Handhole');

    const spans = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets.Spans);
    expect(spans).toHaveLength(2);
    expect(spans[1].Kind).toBe('Underground');

    const qc = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['QC Issues']);
    expect(qc.length).toBe(runQc(bundle).length);
    expect(qc[0].Severity).toBe('Error');
  });

  it('omits earnings when no rates are set', () => {
    const b = makeBundle();
    b.project.ratePerFoot = null;
    b.project.ratePerNode = null;
    b.template = null;
    const wb = XLSX.read(buildXlsx(b), { type: 'array' });
    const summary = XLSX.utils.sheet_to_json<(string | number)[]>(wb.Sheets.Summary, { header: 1 });
    expect(summary.find((r) => r[0] === 'Earnings')).toBeUndefined();
  });
});

describe('Shapefile', () => {
  it('zips .shp/.shx/.dbf/.prj for both layers plus README', async () => {
    const zip = await JSZip.loadAsync(await buildShapefileZip(makeBundle()));
    for (const layer of ['nodes', 'spans']) {
      for (const ext of ['shp', 'shx', 'dbf', 'prj', 'cpg']) expect(zip.file(`${layer}.${ext}`)).not.toBeNull();
    }
    const prj = await zip.file('nodes.prj')!.async('string');
    expect(prj).toContain('GCS_WGS_1984');
    const readme = await zip.file('README.txt')!.async('string');
    expect(readme).toMatch(/comm_attac\s+comm_attachment_count/);
    expect(readme).toMatch(/comm_atta1\s+comm_attachment_heights/);

    // SHP headers: file code 9994, shape type POINT=1 / POLYLINE=3, record counts match DBF.
    const shp = new DataView((await zip.file('nodes.shp')!.async('uint8array')).buffer);
    expect(shp.getInt32(0)).toBe(9994);
    expect(shp.getInt32(32, true)).toBe(1);
    const lshpBytes = await zip.file('spans.shp')!.async('uint8array');
    const lshp = new DataView(lshpBytes.buffer);
    expect(lshp.getInt32(32, true)).toBe(3);
    // File length in the header (16-bit words) matches the actual size.
    expect(lshp.getInt32(24) * 2).toBe(lshpBytes.byteLength);
    // First polyline record: 1 part, 2 points.
    expect(lshp.getInt32(100 + 8 + 36, true)).toBe(1);
    expect(lshp.getInt32(100 + 8 + 40, true)).toBe(2);

    const shx = await zip.file('spans.shx')!.async('uint8array');
    expect((shx.byteLength - 100) / 8).toBe(2);

    const dbf = new DataView((await zip.file('nodes.dbf')!.async('uint8array')).buffer);
    expect(dbf.getUint32(4, true)).toBe(3);
    const sdbf = new DataView((await zip.file('spans.dbf')!.async('uint8array')).buffer);
    expect(sdbf.getUint32(4, true)).toBe(2);

    // Full parse through SheetJS's DBF reader to confirm columns/values.
    const dbfBytes = await zip.file('nodes.dbf')!.async('uint8array');
    const wb = XLSX.read(dbfBytes, { type: 'array' });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]]);
    expect(rows).toHaveLength(3);
    expect(String(rows[0].label ?? rows[0].LABEL).trim()).toBe('P-1');
  });

  it('truncates DBF field names to 10 unique characters', () => {
    const m = shortFieldNames(['comm_attachment_count', 'comm_attachment_heights', 'label', '9lives', 'a-b']);
    expect(m.get('comm_attachment_count')).toBe('comm_attac');
    expect(m.get('comm_attachment_heights')).toBe('comm_atta1');
    expect(m.get('label')).toBe('label');
    expect(m.get('9lives')).toBe('f_9lives');
    expect(m.get('a-b')).toBe('a_b');
    for (const v of m.values()) expect(v.length).toBeLessThanOrEqual(10);
  });
});

describe('PDF report HTML', () => {
  it('contains every label, photo, AI badges and no undefined/NaN', async () => {
    const bundle = makeBundle();
    const qc = runQc(bundle);
    const photoDataUrls = await loadReportPhotos(bundle);
    expect(photoDataUrls['ph-1']).toBe(`data:image/jpeg;base64,${TINY_JPEG_B64}`);
    const html = buildReportHtml(bundle, { photoDataUrls, mapImageDataUrl: null, qc });
    for (const label of ['P-1', 'P-2', 'HH-3']) expect(html).toContain(label);
    expect(html).toContain('Main St Fiber, Phase &quot;2&quot;');
    expect(html).toContain('<svg');
    expect(html).toContain('286 ft');
    expect(html).toContain('class="badge est">est.</span><span class="conf">60%');
    expect(html).toContain('class="badge ai">AI</span><span class="conf">92%');
    expect(html).toContain(`data:image/jpeg;base64,${TINY_JPEG_B64}`);
    expect(html).toContain('Missing (required)');
    expect(html).toContain('@page');
    expect(html).toContain('&#177;3.2 m');
    expect(html).toContain('$238.00');
    expect(html).not.toMatch(/undefined|NaN|Infinity/);
    expect(html).not.toMatch(/(src|href)="https?:/);
    expect(html).not.toContain('<tag>');
  });

  it('uses the map image when provided and ignores non-data URLs', () => {
    const bundle = makeBundle();
    const withMap = buildReportHtml(bundle, { qc: [], mapImageDataUrl: 'data:image/png;base64,iVBORw0KGgo=' });
    expect(withMap).toContain('data:image/png;base64,iVBORw0KGgo=');
    expect(withMap).not.toContain('aria-label="Route diagram"');
    expect(withMap).toContain('No issues found');
    const remote = buildReportHtml(bundle, { qc: [], mapImageDataUrl: 'https://example.com/x.png' });
    expect(remote).not.toContain('example.com');
    expect(remote).toContain('aria-label="Route diagram"');
  });

  it('handles empty projects and coincident nodes without NaN', () => {
    const empty = buildReportHtml(makeBundle({ nodes: [], spans: [], photos: [] }), { qc: [] });
    expect(empty).not.toMatch(/undefined|NaN|Infinity/);
    const b = makeBundle();
    b.nodes = b.nodes.slice(0, 1);
    b.spans = [];
    const svg = buildRouteSvg(b);
    expect(svg).not.toMatch(/NaN|Infinity/);
  });
});

describe('file names', () => {
  it('slugifies the project name and stamps the date', () => {
    const b = makeBundle();
    expect(slugify(b.project.name)).toBe('main-st-fiber-phase-2');
    expect(exportFileName(b, 'kmz')).toMatch(/^main-st-fiber-phase-2_2026111[23]\.kmz$/);
    expect(exportFileName(b, 'shapefile')).toMatch(/_shp\.zip$/);
    expect(slugify('')).toBe('linemap-project');
  });
});

describe('no em-dash in outputs', () => {
  it('generated text contains no em-dash', async () => {
    const b = makeBundle();
    const { nodesCsv, spansCsv } = buildCsv(b);
    const html = buildReportHtml(b, { qc: runQc(b) });
    const zip = await JSZip.loadAsync(await buildKmz(b));
    const kml = await zip.file('doc.kml')!.async('string');
    const shp = await JSZip.loadAsync(await buildShapefileZip(b));
    const readme = await shp.file('README.txt')!.async('string');
    for (const text of [nodesCsv, spansCsv, html, kml, readme, JSON.stringify(buildGeoJSON(b))]) {
      expect(text.includes(EM_DASH)).toBe(false);
    }
  });
});
