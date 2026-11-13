/// <reference types="jest" />
import type { GeoFix } from '@/domain/types';
import { TcpNmeaReceiver, backoffDelay, type ReceiverStatus } from '@/gps/tcpReceiver';

import { fakeFactory } from '../__fixtures__/fakeSocket';
import { NMEA } from '../__fixtures__/nmeaSamples';

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-11-13T17:42:03Z'));
});

afterEach(() => {
  jest.useRealTimers();
});

function make(extra: Partial<ConstructorParameters<typeof TcpNmeaReceiver>[0]> = {}) {
  const { factory, sockets } = fakeFactory();
  const rx = new TcpNmeaReceiver({ host: '192.168.42.1', port: 9001, socketFactory: factory, backoffJitter: 0, ...extra });
  const fixes: GeoFix[] = [];
  const states: ReceiverStatus['state'][] = [];
  rx.onFix((f) => fixes.push(f));
  rx.onStatus((s) => {
    if (states[states.length - 1] !== s.state) states.push(s.state);
  });
  return { rx, sockets, fixes, states };
}

test('backoff doubles up to the cap, with bounded jitter', () => {
  expect([1, 2, 3, 4, 5, 6].map((a) => backoffDelay(a, 1000, 15000))).toEqual([1000, 2000, 4000, 8000, 15000, 15000]);
  expect(backoffDelay(1, 1000, 15000, 0.2, 0)).toBe(800);
  expect(backoffDelay(1, 1000, 15000, 0.2, 1)).toBe(1200);
});

test('connects, parses split chunks and emits external fixes with receiver metadata', () => {
  const { rx, sockets, fixes, states } = make({ antennaHeightM: 2 });
  rx.start();
  expect(sockets).toHaveLength(1);
  expect(sockets[0].opts).toMatchObject({ host: '192.168.42.1', port: 9001, bindToWifi: true });
  sockets[0].connect();
  const stream = `${NMEA.gst}\r\n${NMEA.ggaRtkFixed}\r\n${NMEA.gsv}\r\n`;
  sockets[0].send(stream.slice(0, 30));
  expect(fixes).toHaveLength(0);
  sockets[0].send(stream.slice(30, 95));
  sockets[0].send(stream.slice(95));
  expect(fixes).toHaveLength(1);
  expect(fixes[0]).toMatchObject({ source: 'external', fixQuality: 'rtk_fixed', satellites: 24, hdop: 0.6, receiver: 'Receiver 192.168.42.1:9001' });
  expect(fixes[0].altitudeM).toBeCloseTo(180.345, 6);
  const st = rx.getStatus();
  expect(st).toMatchObject({ state: 'streaming', sentences: 3, checksumErrors: 0, lastSentence: NMEA.gsv });
  expect(rx.getLastFix()).toBe(fixes[0]);
  expect(states).toEqual(['connecting', 'connected', 'streaming']);
});

test('counts checksum failures and does not treat them as live data', () => {
  const { rx, sockets, fixes } = make();
  rx.start();
  sockets[0].connect();
  sockets[0].send(`${NMEA.ggaRtkFixed.replace('*61', '*62')}\r\n`);
  expect(fixes).toHaveLength(0);
  expect(rx.getStatus()).toMatchObject({ state: 'connected', checksumErrors: 1, sentences: 0 });
});

test('goes stale after 3 s of silence, then drops and reconnects after 10 s', () => {
  const { rx, sockets } = make();
  rx.start();
  sockets[0].connect();
  sockets[0].send(`${NMEA.ggaRtkFixed}\r\n`);
  jest.advanceTimersByTime(2900);
  expect(rx.getStatus().state).toBe('streaming');
  jest.advanceTimersByTime(200);
  expect(rx.getStatus().state).toBe('stale');
  // data resumes -> streaming again
  sockets[0].send(`${NMEA.ggaRtkFixed}\r\n`);
  expect(rx.getStatus().state).toBe('streaming');
  jest.advanceTimersByTime(10_000);
  expect(sockets[0].destroyed).toBe(true);
  expect(rx.getStatus()).toMatchObject({ state: 'retrying', lastError: 'No data from the receiver for 10 s' });
  jest.advanceTimersByTime(1000);
  expect(sockets).toHaveLength(2);
  expect(rx.getStatus().state).toBe('connecting');
});

test('reconnects with exponential backoff and resets after valid data', () => {
  const { rx, sockets } = make();
  rx.start();
  sockets[0].error(new Error('ECONNREFUSED'));
  expect(rx.getStatus()).toMatchObject({ state: 'retrying', lastError: 'ECONNREFUSED', attempt: 1 });
  jest.advanceTimersByTime(999);
  expect(sockets).toHaveLength(1);
  jest.advanceTimersByTime(1);
  expect(sockets).toHaveLength(2);
  sockets[1].close();
  jest.advanceTimersByTime(1999);
  expect(sockets).toHaveLength(2);
  jest.advanceTimersByTime(1);
  expect(sockets).toHaveLength(3);
  sockets[2].error('timeout');
  jest.advanceTimersByTime(4000);
  expect(sockets).toHaveLength(4);

  // A valid sentence resets the backoff: the next drop retries after 1 s again.
  sockets[3].connect();
  sockets[3].send(`${NMEA.ggaClassic}\r\n`);
  expect(rx.getStatus().attempt).toBe(0);
  sockets[3].close();
  jest.advanceTimersByTime(1000);
  expect(sockets).toHaveLength(5);
});

test('late events from an old socket are ignored', () => {
  const { rx, sockets, fixes } = make();
  rx.start();
  sockets[0].error(new Error('boom'));
  jest.advanceTimersByTime(1000);
  sockets[0].send(`${NMEA.ggaClassic}\r\n`);
  sockets[0].close();
  expect(fixes).toHaveLength(0);
  expect(sockets).toHaveLength(2);
  expect(rx.getStatus().state).toBe('connecting');
});

test('connect timeout guard fails a socket that never connects', () => {
  const { rx, sockets } = make({ connectTimeoutMs: 2000 });
  rx.start();
  jest.advanceTimersByTime(3000);
  expect(rx.getStatus().lastError).toMatch(/Timed out connecting/);
  expect(sockets[0].destroyed).toBe(true);
});

test('stop cancels retries and goes idle', () => {
  const { rx, sockets } = make();
  rx.start();
  sockets[0].error('x');
  rx.stop();
  jest.advanceTimersByTime(60_000);
  expect(sockets).toHaveLength(1);
  expect(rx.getStatus().state).toBe('idle');
});

test('Android Wi-Fi binding falls back to unbound when Wi-Fi is unreachable', () => {
  const { rx, sockets } = make();
  rx.start();
  expect(sockets[0].opts.bindToWifi).toBe(true);
  sockets[0].error('Interface wifi unreachable');
  jest.advanceTimersByTime(1000);
  expect(sockets[1].opts.bindToWifi).toBe(false);
});

test('host change reconnects to the new address', () => {
  const { rx, sockets } = make();
  rx.start();
  rx.updateConfig({ host: '10.0.0.5', port: 5000 });
  expect(sockets).toHaveLength(2);
  expect(sockets[0].destroyed).toBe(true);
  expect(sockets[1].opts).toMatchObject({ host: '10.0.0.5', port: 5000 });
});

test('without a socket factory the receiver reports unsupported', () => {
  const rx = new TcpNmeaReceiver({ host: 'h', port: 1, socketFactory: null });
  rx.start();
  expect(rx.supported).toBe(false);
  expect(rx.getStatus().state).toBe('unsupported');
  expect(rx.getStatus().lastError).toMatch(/installed LineMap Pro app/);
});
