/// <reference types="jest" />
// End to end over a real local TCP socket (Node `net`): a fake receiver serves NMEA in odd-sized
// chunks, the receiver class parses it, then the server drops and the client reconnects.
import type { GeoFix } from '@/domain/types';
import { TcpNmeaReceiver } from '@/gps/tcpReceiver';

import { nodeNetFactory } from '../__fixtures__/fakeSocket';
import { NMEA } from '../__fixtures__/nmeaSamples';

interface NodeSocket {
  write(s: string): void;
  destroy(): void;
  on(ev: string, fn: () => void): void;
}
interface NodeServer {
  listen(port: number, host: string, cb: () => void): void;
  address(): { port: number };
  close(cb?: () => void): void;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const net = require('net') as { createServer(fn: (s: NodeSocket) => void): NodeServer };

function waitFor(cond: () => boolean, ms = 4000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const t = setInterval(() => {
      if (cond()) {
        clearInterval(t);
        resolve();
      } else if (Date.now() - start > ms) {
        clearInterval(t);
        reject(new Error('timed out'));
      }
    }, 10);
  });
}

test('streams NMEA from a local TCP server, survives a drop and reconnects', async () => {
  const clients: NodeSocket[] = [];
  let connections = 0;
  const server = net.createServer((sock) => {
    connections++;
    clients.push(sock);
    sock.on('error', () => undefined);
    const stream = `${NMEA.gsa}\r\n${NMEA.gst}\r\n${NMEA.ggaRtkFixed}\r\n${NMEA.ggaRtkFloat}\r\n`;
    // odd chunk sizes to exercise line buffering
    let i = 0;
    const sizes = [5, 13, 1, 40, 7, 64, 3];
    let k = 0;
    const send = () => {
      if (i >= stream.length) return;
      const n = sizes[k++ % sizes.length];
      try {
        sock.write(stream.slice(i, i + n));
      } catch {
        return;
      }
      i += n;
      setTimeout(send, 2);
    };
    send();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const rx = new TcpNmeaReceiver({
    host: '127.0.0.1',
    port,
    socketFactory: nodeNetFactory(),
    backoffInitialMs: 50,
    backoffJitter: 0,
    connectTimeoutMs: 2000,
  });
  const fixes: GeoFix[] = [];
  rx.onFix((f) => fixes.push(f));
  try {
    rx.start();
    await waitFor(() => fixes.length >= 2);
    expect(fixes[0]).toMatchObject({ source: 'external', fixQuality: 'rtk_fixed', satellites: 24 });
    expect(fixes[0].accuracyM).toBeLessThan(0.02); // from GST
    expect(fixes[1].fixQuality).toBe('rtk_float');
    expect(rx.getStatus().state).toBe('streaming');

    // Server drops the client: the receiver reconnects and streams again.
    clients[0].destroy();
    await waitFor(() => connections >= 2 && fixes.length >= 4);
    expect(fixes[2].fixQuality).toBe('rtk_fixed');
  } finally {
    rx.stop();
    clients.forEach((c) => c.destroy());
    await new Promise<void>((r) => server.close(() => r()));
  }
});
