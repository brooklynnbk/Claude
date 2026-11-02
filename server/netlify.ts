// Runs the same Express app inside a Netlify Function.
//
// The function starts the app on a private localhost port the first time it
// runs, then passes each request through to it. Going through a real HTTP
// server keeps streaming (the coach's live replies) working unchanged.

import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from './app.ts';
import { config } from './config.ts';
import { Store } from './db.ts';
import type { Backend } from './storage.ts';

// Response headers that describe the hop to localhost, not the reply itself.
const HOP_HEADERS = new Set(['connection', 'keep-alive', 'transfer-encoding', 'content-length']);

export function createNetlifyHandler(makeBackend: () => Backend) {
  let server: Promise<{ server: Server; port: number }> | null = null;

  const start = () => {
    config.hosted = true;
    config.trustProxy = true;
    const app = createApp({ store: new Store(makeBackend()) });
    app.set('trust proxy', true); // only this function can reach the local port
    return new Promise<{ server: Server; port: number }>((resolve, reject) => {
      const s = app.listen(0, '127.0.0.1', () => resolve({ server: s, port: (s.address() as AddressInfo).port }));
      s.once('error', reject);
    });
  };

  return async (req: Request, context?: { ip?: string }): Promise<Response> => {
    server ??= start();
    const { port } = await server;
    const url = new URL(req.url);
    const headers = new Headers(req.headers);
    headers.set('x-forwarded-proto', url.protocol.replace(':', ''));
    headers.set('x-forwarded-host', url.host);
    if (context?.ip) headers.set('x-forwarded-for', context.ip);
    headers.delete('host');

    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    const upstream = await fetch(`http://127.0.0.1:${port}${url.pathname}${url.search}`, {
      method: req.method,
      headers,
      body: hasBody ? await req.arrayBuffer() : undefined,
      redirect: 'manual',
    });

    const out = new Headers();
    upstream.headers.forEach((value, key) => {
      if (!HOP_HEADERS.has(key) && key !== 'set-cookie') out.set(key, value);
    });
    for (const cookie of upstream.headers.getSetCookie()) out.append('set-cookie', cookie);
    return new Response(upstream.body, { status: upstream.status, headers: out });
  };
}
