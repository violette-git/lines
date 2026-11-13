/// <reference types="jest" />
import {
  NmeaFixAssembler,
  NmeaLineBuffer,
  accuracyFromGst,
  estimateAccuracyFromHdop,
  ggaQualityToFixQuality,
  modeStringToFixQuality,
  nmeaChecksum,
  parseNmea,
  parseNmeaCoord,
  withChecksum,
  type GgaSentence,
  type NmeaSentence,
} from '@/gps/nmea';

import { BHM_RTK, NMEA } from '../__fixtures__/nmeaSamples';

function ok(line: string): NmeaSentence {
  const r = parseNmea(line);
  if (!r.ok) throw new Error(`expected ok, got ${r.reason}`);
  return r.sentence;
}

describe('checksum', () => {
  test('matches published reference sentences', () => {
    expect(nmeaChecksum('GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,')).toBe('47');
    expect(withChecksum('$GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W')).toBe(NMEA.rmcClassic);
  });

  test('rejects a corrupted sentence and a wrong checksum', () => {
    const corrupted = NMEA.ggaRtkFixed.replace('3330.816', '3330.817');
    expect(parseNmea(corrupted)).toMatchObject({ ok: false, reason: 'checksum' });
    expect(parseNmea(NMEA.ggaClassic.replace('*47', '*48'))).toMatchObject({ ok: false, reason: 'checksum' });
    expect(parseNmea(NMEA.ggaClassic.replace('*47', '*ZZ'))).toMatchObject({ ok: false, reason: 'checksum' });
  });

  test('missing checksum is rejected unless allowed', () => {
    const bare = NMEA.ggaClassic.slice(0, NMEA.ggaClassic.indexOf('*'));
    expect(parseNmea(bare)).toMatchObject({ ok: false, reason: 'missing_checksum' });
    expect(parseNmea(bare, { requireChecksum: false }).ok).toBe(true);
  });

  test('lower-case checksum hex is accepted', () => {
    expect(parseNmea(NMEA.rmcClassic.replace('*6A', '*6a')).ok).toBe(true);
  });
});

describe('coordinates', () => {
  test('ddmm.mmmm and dddmm.mmmm with hemispheres', () => {
    expect(parseNmeaCoord('4807.038', 'N', true)).toBeCloseTo(48.1173, 6);
    expect(parseNmeaCoord('01131.000', 'E', false)).toBeCloseTo(11.516667, 6);
    expect(parseNmeaCoord('3330.81612345', 'S', true)).toBeCloseTo(-BHM_RTK.lat, 9);
    expect(parseNmeaCoord('08648.38412345', 'W', false)).toBeCloseTo(BHM_RTK.lng, 9);
  });

  test('rejects invalid values', () => {
    expect(parseNmeaCoord('', 'N', true)).toBeNull();
    expect(parseNmeaCoord('4860.000', 'N', true)).toBeNull(); // 60 minutes
    expect(parseNmeaCoord('9100.000', 'N', true)).toBeNull();
    expect(parseNmeaCoord('4807.038', 'E', true)).toBeNull(); // wrong hemisphere letter for lat
  });
});

describe('sentences', () => {
  test('classic GGA, standalone GPS', () => {
    const s = ok(NMEA.ggaClassic) as GgaSentence;
    expect(s).toMatchObject({ type: 'GGA', talker: 'GP', qualityCode: 1, fixQuality: 'gps', satellites: 8, hdop: 0.9 });
    expect(s.altitudeMslM).toBe(545.4);
    expect(s.geoidSeparationM).toBe(46.9);
    expect(s.utcSeconds).toBe(12 * 3600 + 35 * 60 + 19);
  });

  test('GN talker RTK fixed and float', () => {
    const fixed = ok(NMEA.ggaRtkFixed) as GgaSentence;
    expect(fixed).toMatchObject({ talker: 'GN', fixQuality: 'rtk_fixed', satellites: 24, hdop: 0.6, diffAgeS: 1, diffStationId: '0000' });
    expect(fixed.lat).toBeCloseTo(BHM_RTK.lat, 9);
    expect(fixed.lng).toBeCloseTo(BHM_RTK.lng, 9);
    expect(fixed.geoidSeparationM).toBe(-29.512);
    expect((ok(NMEA.ggaRtkFloat) as GgaSentence).fixQuality).toBe('rtk_float');
  });

  test('GGA with no fix', () => {
    const s = ok(NMEA.ggaNoFix) as GgaSentence;
    expect(s.fixQuality).toBe('none');
    expect(s.lat).toBeNull();
  });

  test('GGA quality code mapping', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((c) => ggaQualityToFixQuality(c))).toEqual([
      'none', 'gps', 'dgps', 'gps', 'rtk_fixed', 'rtk_float', 'estimated', 'manual', 'estimated', 'dgps',
    ]);
  });

  test('RMC with NMEA 4.1 mode indicator', () => {
    const s = ok(NMEA.rmcRtk);
    expect(s).toMatchObject({ type: 'RMC', valid: true, modeIndicator: 'R', fixQuality: 'rtk_fixed', date: { y: 2026, m: 11, d: 13 } });
    expect(ok(NMEA.rmcClassic)).toMatchObject({ valid: true, fixQuality: 'gps', speedKnots: 22.4 });
  });

  test('GST, GSA, GNS', () => {
    expect(ok(NMEA.gst)).toMatchObject({ type: 'GST', sigmaLatM: 0.008, sigmaLonM: 0.009, sigmaAltM: 0.017 });
    expect(ok(NMEA.gsa)).toMatchObject({ type: 'GSA', fixType: 3, pdop: 1.2, hdop: 0.6, vdop: 1.0, systemId: 1 });
    expect((ok(NMEA.gsa) as { satelliteIds: number[] }).satelliteIds).toHaveLength(9);
    expect(ok(NMEA.gnsRtk)).toMatchObject({ type: 'GNS', modeIndicator: 'RRRN', fixQuality: 'rtk_fixed', satellites: 24 });
    expect(modeStringToFixQuality('AFNN')).toBe('rtk_float');
    expect(modeStringToFixQuality('NNNN')).toBe('none');
  });

  test('unsupported but valid sentences are reported as unsupported', () => {
    expect(parseNmea(NMEA.gsv)).toMatchObject({ ok: false, reason: 'unsupported', type: 'GSV' });
    expect(parseNmea(withChecksum('$PUBX,00,123519'))).toMatchObject({ ok: false, reason: 'unsupported' });
  });

  test('ignores leading junk and trailing whitespace', () => {
    expect(parseNmea(`\u0000Ójunk${NMEA.ggaClassic}\r\n`).ok).toBe(true);
    expect(parseNmea('')).toMatchObject({ ok: false, reason: 'empty' });
    expect(parseNmea('hello')).toMatchObject({ ok: false, reason: 'no_start' });
  });
});

describe('NmeaLineBuffer', () => {
  test('reassembles sentences split across TCP chunks', () => {
    const b = new NmeaLineBuffer();
    const stream = `${NMEA.ggaRtkFixed}\r\n${NMEA.gst}\r\n${NMEA.rmcRtk}\r\n`;
    const out: string[] = [];
    for (let i = 0; i < stream.length; i += 7) out.push(...b.push(stream.slice(i, i + 7)));
    expect(out).toEqual([NMEA.ggaRtkFixed, NMEA.gst, NMEA.rmcRtk]);
    expect(b.pending).toBe('');
  });

  test('handles LF only, CR only, glued sentences and binary noise', () => {
    const b = new NmeaLineBuffer();
    expect(b.push(`${NMEA.gsa}\n${NMEA.gst}\r`)).toEqual([NMEA.gsa, NMEA.gst]);
    expect(b.push(`Ó\u0000\u0013${NMEA.ggaClassic}${NMEA.rmcClassic}\n`)).toEqual([NMEA.ggaClassic, NMEA.rmcClassic]);
    expect(b.push('no dollar here\n')).toEqual([]);
  });

  test('drops a runaway line without a terminator', () => {
    const b = new NmeaLineBuffer(64);
    b.push('x'.repeat(200));
    expect(b.pending.length).toBeLessThanOrEqual(64);
    expect(b.push(`\n${NMEA.ggaClassic}\n`)).toEqual([NMEA.ggaClassic]);
  });
});

describe('accuracy', () => {
  test('GST DRMS', () => {
    expect(accuracyFromGst(0.008, 0.009)).toBeCloseTo(Math.sqrt(0.008 ** 2 + 0.009 ** 2), 9);
    expect(accuracyFromGst(null, 0.01)).toBeNull();
  });

  test('HDOP x UERE by fix quality', () => {
    expect(estimateAccuracyFromHdop(0.6, 'rtk_fixed')).toBeCloseTo(0.009, 6);
    expect(estimateAccuracyFromHdop(0.7, 'rtk_float')).toBeCloseTo(0.21, 6);
    expect(estimateAccuracyFromHdop(1, 'dgps')).toBeCloseTo(1, 6);
    expect(estimateAccuracyFromHdop(0.9, 'gps')).toBeCloseTo(3.6, 6);
    expect(estimateAccuracyFromHdop(null, 'gps')).toBeCloseTo(6, 6); // default HDOP 1.5
    expect(estimateAccuracyFromHdop(1, 'none')).toBeNull();
  });
});

describe('NmeaFixAssembler', () => {
  const feed = (a: NmeaFixAssembler, line: string, at: number) => a.push(ok(line), at);

  test('RTK fixed GGA plus GST: GST accuracy, antenna height subtracted, receiver metadata', () => {
    const a = new NmeaFixAssembler({ antennaHeightM: 1.8, receiverName: 'Reach RS3' });
    expect(feed(a, NMEA.gst, 1000)).toBeNull();
    const f = feed(a, NMEA.ggaRtkFixed, 1100)!;
    expect(f).toMatchObject({ source: 'external', fixQuality: 'rtk_fixed', satellites: 24, hdop: 0.6, receiver: 'Reach RS3', samples: 1 });
    expect(f.accuracyM).toBeCloseTo(0.01204, 4);
    expect(f.altitudeM).toBeCloseTo(182.345 - 1.8, 6);
    expect(f.capturedAt).toBe(new Date(1100).toISOString());
    expect(a.snapshot.accuracySource).toBe('gst');
    expect(a.snapshot.ellipsoidHeightM).toBeCloseTo(182.345 - 29.512, 6);
    expect(a.snapshot.groundAltitudeM).toBeCloseTo(180.545, 6);
  });

  test('falls back to HDOP when GST is missing or old', () => {
    const a = new NmeaFixAssembler();
    feed(a, NMEA.gst, 0);
    const f = feed(a, NMEA.ggaRtkFloat, 10_000)!;
    expect(a.snapshot.accuracySource).toBe('hdop');
    expect(f.accuracyM).toBeCloseTo(0.7 * 0.3, 6);
  });

  test('no-fix GGA emits nothing but updates the snapshot', () => {
    const a = new NmeaFixAssembler();
    expect(feed(a, NMEA.ggaNoFix, 0)).toBeNull();
    expect(a.snapshot.fixQuality).toBe('none');
  });

  test('GNS and RMC are fallbacks only when GGA is absent', () => {
    const a = new NmeaFixAssembler();
    expect(feed(a, NMEA.ggaRtkFixed, 0)).not.toBeNull();
    expect(feed(a, NMEA.gnsRtk, 100)).toBeNull();
    expect(feed(a, NMEA.rmcRtk, 200)).toBeNull();

    const gnsOnly = new NmeaFixAssembler();
    expect(feed(gnsOnly, NMEA.gnsRtk, 0)).toMatchObject({ fixQuality: 'rtk_fixed', satellites: 24 });

    const rmcOnly = new NmeaFixAssembler();
    feed(rmcOnly, NMEA.gsa, 0);
    const f = feed(rmcOnly, NMEA.rmcRtk, 50)!;
    expect(f).toMatchObject({ fixQuality: 'rtk_fixed', hdop: 0.6, satellites: 9, altitudeM: null });
  });

  test('antenna height can change at runtime', () => {
    const a = new NmeaFixAssembler({ antennaHeightM: 2 });
    expect(feed(a, NMEA.ggaClassic, 0)!.altitudeM).toBeCloseTo(543.4, 6);
    a.setOptions({ antennaHeightM: null });
    expect(feed(a, NMEA.ggaClassic, 100)!.altitudeM).toBeCloseTo(545.4, 6);
  });
});
