import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Store } from '../server/db.ts';
import { FileBackend, MemoryBackend } from '../server/storage.ts';

describe('Store', () => {
  it('re-applies a change when another server saved first (no lost updates)', async () => {
    const shared = new MemoryBackend();
    const a = new Store(shared);
    const b = new Store(shared);
    await a.refresh();
    await b.refresh();

    // Both servers loaded the same version; A saves first, then B.
    await a.update((d) => d.orders.push({ id: '1', customer: 'From A', items: [{ design: 'x', quantity: 1 }], dueDate: '2026-11-02', status: 'todo', createdAt: '' }));
    await b.update((d) => d.orders.push({ id: '2', customer: 'From B', items: [{ design: 'y', quantity: 1 }], dueDate: '2026-11-02', status: 'todo', createdAt: '' }));

    const fresh = new Store(shared);
    await fresh.refresh();
    expect(fresh.data.orders.map((o) => o.customer)).toEqual(['From A', 'From B']);
  });

  it('still saves when the backend gives no version tags on reads', async () => {
    const shared = new MemoryBackend(true);
    const first = new Store(shared);
    await first.update((d) => d.habits.habits.push({ id: 'a', name: 'A', emoji: '✅', days: [], archived: false, createdAt: '' }));
    const second = new Store(shared); // a fresh server instance: only knows what it reads
    await second.refresh();
    await second.update((d) => d.habits.habits.push({ id: 'b', name: 'B', emoji: '✅', days: [], archived: false, createdAt: '' }));
    await second.update((d) => d.habits.habits.push({ id: 'c', name: 'C', emoji: '✅', days: [], archived: false, createdAt: '' }));
    const check = new Store(shared);
    await check.refresh();
    expect(check.data.habits.habits.map((h) => h.name)).toEqual(['A', 'B', 'C']);
  });

  it('saves the coach transcript separately from everything else', async () => {
    const backend = new MemoryBackend();
    const s = new Store(backend);
    await s.update((d) => d.coach.messages.push({ role: 'user', content: 'hi' }));
    expect([...backend.entries.keys()]).toEqual(['coach']);
    await s.update((d) => d.habits.habits.push({ id: 'h', name: 'Walk', emoji: '🚶', days: [], archived: false, createdAt: '' }));
    expect([...backend.entries.keys()].sort()).toEqual(['coach', 'main']);
  });

  it('keeps the local file in the same shape as a backup', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-file-'));
    const s = new Store(new FileBackend(dir));
    await s.update((d) => d.habits.habits.push({ id: 'h', name: 'Walk', emoji: '🚶', days: [], archived: false, createdAt: '' }));
    await s.update((d) => d.coach.messages.push({ role: 'user', content: 'hi' }));
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'));
    expect(onDisk.habits.habits[0].name).toBe('Walk');
    expect(onDisk.coach.messages).toHaveLength(1);

    const reopened = new Store(new FileBackend(dir));
    await reopened.refresh();
    expect(reopened.data.habits.habits).toHaveLength(1);
    expect(reopened.data.coach.messages).toHaveLength(1);
  });
});
