import { afterAll, describe, expect, it } from 'vitest';
import { config } from '../server/config.ts';
import { createNetlifyHandler } from '../server/netlify.ts';
import { MemoryBackend } from '../server/storage.ts';

const backend = new MemoryBackend();
const handler = createNetlifyHandler(() => backend);
const call = (path: string, init: RequestInit = {}) =>
  handler(new Request(`https://hq.example.netlify.app/api${path}`, { headers: { 'content-type': 'application/json' }, ...init }), { ip: '1.2.3.4' });

afterAll(() => {
  config.hosted = false;
  config.trustProxy = false;
  config.appPassword = '';
});

describe('Netlify function', () => {
  it('refuses to show anything until APP_PASSWORD is set', async () => {
    config.appPassword = '';
    const status = await (await call('/auth/status')).json();
    expect(status).toEqual({ required: true, authed: false, setup: true, hosted: true });
    expect((await call('/habits')).status).toBe(503);
  });

  it('signs in with a secure cookie and serves data from shared storage', async () => {
    config.appPassword = 'stickers';
    const login = await call('/auth/login', { method: 'POST', body: JSON.stringify({ password: 'stickers' }) });
    expect(login.status).toBe(200);
    const cookie = login.headers.get('set-cookie')!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);

    const auth = { cookie: cookie.split(';')[0] };
    const created = await call('/habits', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Walk' }) });
    expect(created.status).toBe(200);
    expect(backend.entries.has('main')).toBe(true);

    // Another server instance (cold start) sees the same data.
    const other = createNetlifyHandler(() => backend);
    const res = await other(new Request('https://hq.example.netlify.app/api/habits', { headers: auth }));
    expect((await res.json()).habits.map((h: { name: string }) => h.name)).toEqual(['Walk']);
  });
});
