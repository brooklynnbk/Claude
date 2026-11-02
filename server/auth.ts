// Optional password protection. When APP_PASSWORD is set, every /api route
// except /api/auth/* needs a signed session cookie.

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response, Router } from 'express';
import { config } from './config.ts';

const COOKIE = 'hq_session';
const MAX_AGE_MS = 90 * 86400_000;

const secret = () => config.sessionSecret || createHash('sha256').update(`hq:${config.appPassword}`).digest('hex');
const sign = (v: string) => createHmac('sha256', secret()).update(v).digest('base64url');

function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

/** Hosted on the internet without a password: refuse to show anything until one is set. */
const needsSetup = () => config.hosted && !config.appPassword;

export function isAuthed(req: Request): boolean {
  if (needsSetup()) return false;
  if (!config.appPassword) return true;
  const raw = readCookie(req, COOKIE);
  if (!raw) return false;
  const [issued, sig] = raw.split('.');
  if (!issued || !sig || !safeEqual(sig, sign(issued))) return false;
  const age = Date.now() - Number(issued);
  return age >= 0 && age < MAX_AGE_MS;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (needsSetup()) {
    res.status(503).json({ error: 'Set APP_PASSWORD in your Netlify environment variables, then redeploy.' });
    return;
  }
  if (isAuthed(req)) return next();
  res.status(401).json({ error: 'Sign in required' });
}

const attempts = new Map<string, { count: number; until: number }>();

export function mountAuthRoutes(api: Router) {
  api.get('/auth/status', (req, res) => {
    res.json({ required: Boolean(config.appPassword) || needsSetup(), authed: isAuthed(req), setup: needsSetup(), hosted: config.hosted });
  });

  api.post('/auth/login', (req, res) => {
    if (needsSetup()) {
      res.status(503).json({ error: 'Set APP_PASSWORD in your Netlify environment variables, then redeploy.' });
      return;
    }
    const ip = req.ip ?? 'unknown';
    const a = attempts.get(ip);
    if (a && a.count >= 5 && Date.now() < a.until) {
      res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
      return;
    }
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!config.appPassword || !safeEqual(password, config.appPassword)) {
      const next = { count: (a && Date.now() < a.until ? a.count : 0) + 1, until: Date.now() + 10 * 60_000 };
      attempts.set(ip, next);
      res.status(401).json({ error: 'Wrong password' });
      return;
    }
    attempts.delete(ip);
    const issued = String(Date.now());
    res.cookie(COOKIE, `${issued}.${sign(issued)}`, {
      httpOnly: true,
      sameSite: 'lax',
      secure: req.secure,
      maxAge: MAX_AGE_MS,
      path: '/',
    });
    res.json({ ok: true });
  });

  api.post('/auth/logout', (_req, res) => {
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true });
  });
}
