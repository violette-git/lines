// Test doubles for the TCP receiver: an in-memory fake socket and a Node `net` adapter.
import type { SocketConnectOptions, SocketFactory, SocketLike } from '@/gps/tcpReceiver';

export class FakeSocket implements SocketLike {
  connectFns: (() => void)[] = [];
  dataFns: ((c: string) => void)[] = [];
  errorFns: ((e: unknown) => void)[] = [];
  closeFns: (() => void)[] = [];
  destroyed = false;

  constructor(public readonly opts: SocketConnectOptions) {}

  onConnect(fn: () => void) {
    this.connectFns.push(fn);
  }
  onData(fn: (c: string) => void) {
    this.dataFns.push(fn as (c: string) => void);
  }
  onError(fn: (e: unknown) => void) {
    this.errorFns.push(fn);
  }
  onClose(fn: () => void) {
    this.closeFns.push(fn);
  }
  destroy() {
    this.destroyed = true;
  }

  // drive from the test
  connect() {
    this.connectFns.forEach((f) => f());
  }
  send(text: string) {
    this.dataFns.forEach((f) => f(text));
  }
  error(e: unknown) {
    this.errorFns.forEach((f) => f(e));
  }
  close() {
    this.closeFns.forEach((f) => f());
  }
}

export function fakeFactory(): { factory: SocketFactory; sockets: FakeSocket[] } {
  const sockets: FakeSocket[] = [];
  return {
    sockets,
    factory: (o) => {
      const s = new FakeSocket(o);
      sockets.push(s);
      return s;
    },
  };
}

/** Adapter from Node's net.Socket to SocketLike, for integration tests against a real TCP server. */
export function nodeNetFactory(): SocketFactory {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const net = require('net') as {
    createConnection(o: { host: string; port: number }): {
      setEncoding(e: string): void;
      on(ev: string, fn: (...a: unknown[]) => void): void;
      setTimeout(ms: number, fn: () => void): void;
      destroy(): void;
      removeAllListeners(): void;
    };
  };
  return (o) => {
    const s = net.createConnection({ host: o.host, port: o.port });
    s.setEncoding('latin1');
    s.setTimeout(o.connectTimeoutMs, () => s.destroy());
    return {
      onConnect: (fn) => s.on('connect', () => {
        s.setTimeout(0, () => undefined);
        fn();
      }),
      onData: (fn) => s.on('data', (d) => fn(d as string)),
      onError: (fn) => s.on('error', (e) => fn(e)),
      onClose: (fn) => s.on('close', () => fn()),
      destroy: () => {
        s.removeAllListeners();
        s.on('error', () => undefined);
        s.destroy();
      },
    };
  };
}
