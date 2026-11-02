import { useEffect, useState } from 'react';
import { api } from './api.ts';

export interface AuthStatus {
  required: boolean;
  authed: boolean;
  /** Hosted without APP_PASSWORD: nothing is shown until it's set. */
  setup: boolean;
  /** Running on Netlify (settings live in Netlify, not a .env file). */
  hosted: boolean;
}

let cached: Promise<AuthStatus> | null = null;
export const getStatus = (fresh = false) => {
  if (fresh || !cached) cached = api<AuthStatus>('/auth/status');
  return cached;
};

export function useAppInfo(): AuthStatus | undefined {
  const [info, setInfo] = useState<AuthStatus>();
  useEffect(() => {
    getStatus().then(setInfo, () => undefined);
  }, []);
  return info;
}

/** Where secrets are configured, in words. */
export const settingsPlace = (hosted: boolean | undefined) =>
  hosted ? 'Netlify (Site configuration → Environment variables), then redeploy' : 'the .env file in the HQ folder, then restart HQ';
