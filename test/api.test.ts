import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../server/app.ts';
import { config } from '../server/config.ts';
import { Store } from '../server/db.ts';
import { MemoryBackend } from '../server/storage.ts';

let server: Server;
let base: string;
let cookie = '';

const call = async (method: string, url: string, body?: unknown) => {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json(), headers: res.headers };
};

beforeAll(async () => {
  config.appPassword = 'stickers';
  const store = new Store(new MemoryBackend());
  server = createApp({ store }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(() => {
  config.appPassword = '';
  server.close();
});

describe('API', () => {
  it('requires the app password', async () => {
    expect((await call('GET', '/habits')).status).toBe(401);
    expect((await call('POST', '/auth/login', { password: 'wrong' })).status).toBe(401);
    const ok = await call('POST', '/auth/login', { password: 'stickers' });
    expect(ok.status).toBe(200);
    cookie = ok.headers.get('set-cookie')!.split(';')[0];
    expect((await call('GET', '/auth/status')).body).toEqual({ required: true, authed: true, setup: false, hosted: false });
  });

  it('tracks habits', async () => {
    const created = await call('POST', '/habits', { name: 'Drink water', emoji: '💧' });
    const id = created.body.habits[0].id;
    const toggled = await call('POST', `/habits/${id}/toggle`, { date: '2026-11-02' });
    expect(toggled.body.log).toEqual({ '2026-11-02': [id] });
    const untoggled = await call('POST', `/habits/${id}/toggle`, { date: '2026-11-02' });
    expect(untoggled.body.log).toEqual({});
    expect((await call('POST', `/habits/${id}/toggle`, { date: 'nope' })).status).toBe(400);
  });

  it('manages sticker orders', async () => {
    const order = await call('POST', '/orders', {
      customer: 'Maya (Etsy)',
      channel: 'Etsy',
      items: [{ design: 'Frog on mushroom', quantity: 25, size: '3" matte' }],
      dueDate: '2026-11-05',
      total: 42.5,
    });
    expect(order.body.status).toBe('todo');
    const shipped = await call('PATCH', `/orders/${order.body.id}`, { status: 'shipped', notes: '' });
    expect(shipped.body.status).toBe('shipped');
    expect(shipped.body.completedAt).toBeTruthy();
    expect(shipped.body.items).toHaveLength(1);
    const back = await call('PATCH', `/orders/${order.body.id}`, { status: 'packed' });
    expect(back.body.completedAt).toBeUndefined();
    expect((await call('POST', '/orders', { customer: 'x', items: [], dueDate: '2026-11-05' })).status).toBe(400);
  });

  it('says the coach needs a key when none is configured', async () => {
    const state = await call('GET', '/coach');
    expect(state.body.messages).toEqual([]);
    if (!state.body.configured) {
      const res = await call('POST', '/coach/chat', { message: 'hi', today: '2026-11-02', tz: 'America/New_York' });
      expect(res.status).toBe(503);
    }
  });

  it('restores a backup', async () => {
    const backup = (await call('GET', '/export')).body;
    expect(backup.orders).toHaveLength(1);
    backup.orders.push({ ...backup.orders[0], id: 'copy1', customer: 'Restored Co' });
    const res = await call('POST', '/import', backup);
    expect(res.body.counts.orders).toBe(2);
    expect((await call('GET', '/orders')).body.map((o: any) => o.customer)).toContain('Restored Co');
    expect((await call('POST', '/import', { hello: 'world' })).status).toBe(400);
  });

  it('validates calendar ranges', async () => {
    const res = await call('GET', '/calendar/events?start=2026-11-02&end=2026-11-09&tz=America/New_York');
    expect(res.body).toEqual({ events: [], errors: [], connected: { links: 0, icloud: false } });
    expect((await call('GET', '/calendar/events?start=2026-11-02&end=2026-11-09&tz=Mars/Base')).status).toBe(400);
  });
});
