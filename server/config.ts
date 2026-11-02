import 'dotenv/config';
import path from 'node:path';

const env = process.env;

const list = (v: string | undefined) =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

export const config = {
  port: Number(env.PORT || 3000),
  dataDir: path.resolve(env.DATA_DIR || 'data'),
  production: env.NODE_ENV === 'production',
  /** True when running as a Netlify Function (set by netlify/functions/api.mts). A password is then required. */
  hosted: false,
  /** If set, the app asks for this password before showing anything. */
  appPassword: env.APP_PASSWORD || '',
  sessionSecret: env.SESSION_SECRET || '',
  trustProxy: env.TRUST_PROXY === '1' || env.TRUST_PROXY === 'true',
  caldav: {
    serverUrl: env.CALDAV_SERVER_URL || 'https://caldav.icloud.com',
    username: env.ICLOUD_USERNAME || '',
    password: env.ICLOUD_APP_PASSWORD || '',
    /** Optional comma-separated list of calendar names to include. */
    calendars: list(env.ICLOUD_CALENDARS),
    get enabled() {
      return Boolean(this.username && this.password);
    },
  },
  coach: {
    model: env.COACH_MODEL || 'claude-opus-5-5',
    effort: (env.COACH_EFFORT || 'medium') as 'low' | 'medium' | 'high' | 'xhigh' | 'max',
    get configured() {
      return Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_PROFILE);
    },
  },
};
