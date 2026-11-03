// Storage backends for the Store (db.ts).

import fs from 'node:fs';
import path from 'node:path';

export type Part = 'main' | 'coach';

/** What we last saw stored for a part: whether it existed, and its version tag if the backend gave one. */
export interface Seen {
  exists: boolean;
  version?: string;
}

export interface Backend {
  /** True when other processes can write the same data (serverless), so reads must be fresh. */
  readonly shared: boolean;
  read(part: Part): Promise<{ value: unknown; version?: string }>;
  /**
   * Compare-and-swap write against what we last saw: same version, or still
   * absent if it didn't exist. If it existed but no version tag was available,
   * the write is unconditional.
   */
  write(part: Part, value: unknown, seen: Seen): Promise<{ ok: boolean; version?: string }>;
}

/**
 * Your own computer or server: one `db.json` file in the same shape as a
 * backup download. A single process owns it, so there's nothing to compare.
 */
export class FileBackend implements Backend {
  readonly shared = false;
  private file: string;
  private cache: Record<string, unknown> | null = null;

  constructor(dir: string) {
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'db.json');
  }

  private all(): Record<string, unknown> {
    if (!this.cache) this.cache = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : {};
    return this.cache!;
  }

  async read(part: Part) {
    const all = this.all();
    if (part === 'coach') return { value: all.coach ?? null };
    const { coach: _coach, ...main } = all;
    return { value: Object.keys(main).length ? main : null };
  }

  async write(part: Part, value: unknown) {
    const all = this.all();
    if (part === 'coach') all.coach = value;
    else this.cache = { ...(value as object), coach: all.coach };
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.cache, null, 2));
    fs.renameSync(tmp, this.file);
    return { ok: true };
  }
}

/** Minimal slice of the @netlify/blobs Store API we use. */
export interface BlobStoreLike {
  getWithMetadata(key: string, opts: { type: 'json' }): Promise<{ data: unknown; etag?: string } | null>;
  setJSON(key: string, value: unknown, opts: { onlyIfMatch: string } | { onlyIfNew: boolean } | Record<string, never>): Promise<{ modified: boolean; etag?: string }>;
}

/**
 * Netlify Blobs: each part is one JSON blob, written with ETag compare-and-swap.
 *
 * Takes a factory rather than a store: Netlify hands each function invocation
 * a short-lived access token, so the store must be opened fresh for every
 * operation. A store opened at cold start fails later with "Token expired".
 */
export class BlobsBackend implements Backend {
  readonly shared = true;
  constructor(private openStore: () => BlobStoreLike) {}

  private get store(): BlobStoreLike {
    return this.openStore();
  }

  async read(part: Part) {
    const entry = await this.store.getWithMetadata(part, { type: 'json' });
    return entry ? { value: entry.data, version: entry.etag } : { value: null };
  }

  async write(part: Part, value: unknown, seen: Seen) {
    if (seen.exists && !seen.version) {
      // Version tag unavailable (e.g. the local emulator doesn't send one): plain overwrite.
      const res = await this.store.setJSON(part, value, {});
      return { ok: true, version: res.etag || undefined };
    }
    const res = await this.store.setJSON(part, value, seen.version ? { onlyIfMatch: seen.version } : { onlyIfNew: true });
    return { ok: res.modified, version: res.etag || undefined };
  }
}

/** In-memory backend with real compare-and-swap semantics, for tests. */
export class MemoryBackend implements Backend {
  readonly shared = true;
  entries = new Map<Part, { json: string; version: string }>();
  private n = 0;

  /** Set `hideVersionsOnRead` to mimic a backend that doesn't return version tags on reads. */
  constructor(private hideVersionsOnRead = false) {}

  async read(part: Part) {
    const e = this.entries.get(part);
    return e ? { value: JSON.parse(e.json), version: this.hideVersionsOnRead ? undefined : e.version } : { value: null };
  }

  async write(part: Part, value: unknown, seen: Seen) {
    const current = this.entries.get(part);
    const conflict = seen.version ? current?.version !== seen.version : !seen.exists && current !== undefined;
    if (conflict) return { ok: false };
    const version = `"v${++this.n}"`;
    this.entries.set(part, { json: JSON.stringify(value), version });
    return { ok: true, version };
  }
}
