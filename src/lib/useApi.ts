import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.ts';

/** Load a GET endpoint, with a setter so mutations can swap in the server's reply. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(Boolean(path));
  const seq = useRef(0);

  const reload = useCallback(async () => {
    if (!path) return;
    const id = ++seq.current;
    setLoading(true);
    try {
      const result = await api<T>(path);
      if (id === seq.current) {
        setData(result);
        setError(undefined);
      }
    } catch (err) {
      if (id === seq.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, setData, error, setError, loading, reload };
}

/** Re-render when the local date changes (e.g. the app is left open past midnight). */
export function useToday(get: () => string): string {
  const [today, setToday] = useState(get);
  useEffect(() => {
    const tick = () => setToday(get());
    const t = setInterval(tick, 60_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [get]);
  return today;
}
