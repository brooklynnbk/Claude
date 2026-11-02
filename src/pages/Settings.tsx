import { useState, type FormEvent } from 'react';
import type { CalendarSource } from '../../shared/types.ts';
import { Icon } from '../components/Icon.tsx';
import { PageHead } from '../components/PageHead.tsx';
import { api, del, post } from '../lib/api.ts';
import { useApi } from '../lib/useApi.ts';

const COLORS = ['#1c7ed6', '#e8590c', '#2f9e44', '#ae3ec9', '#f08c00', '#0c8599', '#d6336c'];

export function SettingsPage() {
  const sources = useApi<{ sources: CalendarSource[]; icloud: boolean; icloudUser: string }>('/calendar/sources');
  const auth = useApi<{ required: boolean; authed: boolean }>('/auth/status');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [color, setColor] = useState(COLORS[0]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await post<CalendarSource>('/calendar/sources', { name: name.trim(), url: url.trim(), color });
      setName('');
      setUrl('');
      setColor(COLORS[((sources.data?.sources.length ?? 0) + 1) % COLORS.length]);
      await sources.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <PageHead title="Settings" settings={false} />

      <section className="card stack">
        <h2>Apple Calendar</h2>
        <p className="text-2 small">Connect one or both ways. Events refresh every few minutes; tap refresh on the Calendar page to pull changes right away.</p>

        <div className="stack" style={{ gap: 8 }}>
          <div className="spread">
            <h3>Option A: Your whole iCloud account (private)</h3>
            {sources.data && <span className={`chip ${sources.data.icloud ? 'good' : ''}`}>{sources.data.icloud ? 'Connected' : 'Not set up'}</span>}
          </div>
          {sources.data?.icloud ? (
            <p className="small text-2">
              Reading every calendar on <strong>{sources.data.icloudUser}</strong>. Nothing is made public.
            </p>
          ) : (
            <details>
              <summary className="small">How to set it up</summary>
              <ol className="steps">
                <li>
                  Go to <a href="https://account.apple.com" target="_blank" rel="noreferrer">account.apple.com</a> → Sign-In and Security → App-Specific Passwords, and create one called “HQ”.
                </li>
                <li>
                  In the <code>.env</code> file in the HQ folder, add:
                  <br />
                  <code>ICLOUD_USERNAME=you@icloud.com</code>
                  <br />
                  <code>ICLOUD_APP_PASSWORD=abcd-efgh-ijkl-mnop</code>
                </li>
                <li>Restart HQ. All your iCloud calendars show up automatically.</li>
              </ol>
            </details>
          )}
        </div>

        <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '4px 0' }} />

        <div className="stack" style={{ gap: 8 }}>
          <h3>Option B: Calendar links</h3>
          <details>
            <summary className="small">Where to find the link</summary>
            <ol className="steps">
              <li>On your iPhone, open Calendar → Calendars → tap ⓘ next to the calendar.</li>
              <li>
                Turn on <strong>Public Calendar</strong>, tap <strong>Share Link…</strong> and copy it. (On a Mac: right-click the calendar → Share Calendar → Public Calendar.)
              </li>
              <li>Paste it below. Links from Google Calendar, Outlook or any .ics feed work too.</li>
            </ol>
            <p className="small muted" style={{ marginTop: 6 }}>
              Anyone with a public link can see that calendar. Use Option A if you'd rather keep everything private.
            </p>
          </details>

          {sources.data?.sources.map((s) => (
            <div key={s.id} className="list-row">
              <span className="swatch-dot" style={{ background: s.color, width: 12, height: 12 }} />
              <span className="grow">
                <strong>{s.name}</strong>
                <div className="tiny muted ellipsis">{s.url}</div>
              </span>
              <button
                className="icon-btn"
                style={{ border: 0 }}
                aria-label={`Remove ${s.name}`}
                onClick={async () => {
                  if (!confirm(`Remove ${s.name}?`)) return;
                  await del(`/calendar/sources/${s.id}`);
                  await sources.reload();
                }}
              >
                <Icon name="trash" />
              </button>
            </div>
          ))}

          <form className="stack" style={{ gap: 10 }} onSubmit={add}>
            <div className="form-grid">
              <label className="field">
                Name
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Personal, Work, Markets…" />
              </label>
              <label className="field">
                Color
                <div className="row" style={{ gap: 6, minHeight: 42 }}>
                  {COLORS.map((c) => (
                    <button
                      type="button"
                      key={c}
                      onClick={() => setColor(c)}
                      aria-label={`Color ${c}`}
                      aria-pressed={color === c}
                      style={{ width: 28, height: 28, borderRadius: '50%', border: color === c ? '3px solid var(--text)' : '2px solid var(--surface)', background: c, cursor: 'pointer' }}
                    />
                  ))}
                </div>
              </label>
              <label className="field full">
                Calendar link
                <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="webcal://p01-caldav.icloud.com/published/2/…" inputMode="url" />
              </label>
            </div>
            {error && <div className="banner bad">{error}</div>}
            <div>
              <button className="btn primary" disabled={busy || !name.trim() || !url.trim()}>
                {busy ? 'Checking link…' : 'Add calendar'}
              </button>
            </div>
          </form>
        </div>
      </section>

      <section className="card stack">
        <h2>Your data</h2>
        <p className="small text-2">Everything is stored in one file on the computer running HQ. Download a backup any time.</p>
        <div className="row wrap">
          <a className="btn" href="/api/export" download>
            Download backup
          </a>
          {auth.data?.required && (
            <button
              className="btn ghost"
              onClick={async () => {
                await api('/auth/logout', { method: 'POST', body: {} });
                location.reload();
              }}
            >
              Sign out
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
