import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { createApp } from './app.ts';
import { config } from './config.ts';
import { Store } from './db.ts';
import { FileBackend } from './storage.ts';

const store = new Store(new FileBackend(config.dataDir));
await store.refresh();
const app = createApp({ store });

// In production the built web app is served from the same server.
const dist = path.resolve('dist');
if (fs.existsSync(path.join(dist, 'index.html'))) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
} else if (config.production) {
  console.warn('No dist/ folder found. Run `npm run build` first.');
}

app.listen(config.port, () => {
  console.log(`HQ server listening on http://localhost:${config.port}`);
  console.log(`  data: ${path.join(config.dataDir, 'db.json')}`);
  console.log(`  calendar: ${store.data.calendar.sources.length} link(s)${config.caldav.enabled ? ' + iCloud' : ''}`);
  console.log(`  coach: ${config.coach.configured ? `on (${config.coach.model})` : 'off — set ANTHROPIC_API_KEY'}`);
  if (!config.appPassword) console.log('  password: none (set APP_PASSWORD before putting this on the internet)');
});
