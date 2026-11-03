import type { Config, Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { createNetlifyHandler } from '../../server/netlify.ts';
import { BlobsBackend } from '../../server/storage.ts';

// All of HQ's data lives in the site-wide "hq" blob store. Strong consistency
// so every request sees the latest save. The store is reopened for every
// operation so it always uses the current invocation's access token.
const handler = createNetlifyHandler(() => new BlobsBackend(() => getStore({ name: 'hq', consistency: 'strong' })));

export default (req: Request, context: Context) => handler(req, context);

export const config: Config = {
  path: '/api/*',
};
