import { useEffect, useState, type FormEvent } from 'react';
import { Icon, type IconName } from './components/Icon.tsx';
import { onUnauthorized, post } from './lib/api.ts';
import { getStatus } from './lib/appInfo.ts';
import type { Route } from './lib/router.ts';
import { CalendarPage } from './pages/Calendar.tsx';
import { CoachPage } from './pages/Coach.tsx';
import { HabitsPage } from './pages/Habits.tsx';
import { OrdersPage } from './pages/Orders.tsx';
import { SettingsPage } from './pages/Settings.tsx';
import { TodayPage } from './pages/Today.tsx';
import { TodosPage } from './pages/Todos.tsx';

const NAV: { route: Route; label: string; icon: IconName }[] = [
  { route: 'today', label: 'Today', icon: 'today' },
  { route: 'todos', label: 'To-do', icon: 'todo' },
  { route: 'calendar', label: 'Calendar', icon: 'calendar' },
  { route: 'habits', label: 'Habits', icon: 'habits' },
  { route: 'orders', label: 'Orders', icon: 'orders' },
  { route: 'coach', label: 'Coach', icon: 'coach' },
];

function readRoute(): { route: Route; arg?: string } {
  const [route, arg] = location.hash.replace(/^#\/?/, '').split('/');
  const known: Route[] = ['today', 'todos', 'calendar', 'habits', 'orders', 'coach', 'settings'];
  return { route: known.includes(route as Route) ? (route as Route) : 'today', arg: arg ? decodeURIComponent(arg) : undefined };
}

export function App() {
  const [auth, setAuth] = useState<'checking' | 'login' | 'setup' | 'ok'>('checking');
  const [{ route, arg }, setRoute] = useState(readRoute);

  useEffect(() => {
    getStatus()
      .then((s) => setAuth(s.setup ? 'setup' : s.authed ? 'ok' : 'login'))
      .catch(() => setAuth('ok'));
    const off = onUnauthorized(() => setAuth('login'));
    const onHash = () => {
      setRoute(readRoute());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onHash);
    return () => {
      off();
      window.removeEventListener('hashchange', onHash);
    };
  }, []);

  if (auth === 'checking') return null;
  if (auth === 'setup') return <SetupNeeded />;
  if (auth === 'login')
    return (
      <Login
        onDone={() => {
          void getStatus(true);
          setAuth('ok');
        }}
      />
    );

  return (
    <div className="shell">
      <nav className="nav" aria-label="Main">
        <div className="brand">HQ</div>
        {NAV.map((n) => (
          <a key={n.route} href={`#/${n.route}`} className={route === n.route ? 'active' : ''} aria-current={route === n.route ? 'page' : undefined}>
            <Icon name={n.icon} />
            <span>{n.label}</span>
          </a>
        ))}
      </nav>
      <main className="main">
        {route === 'today' && <TodayPage />}
        {route === 'todos' && <TodosPage />}
        {route === 'calendar' && <CalendarPage />}
        {route === 'habits' && <HabitsPage />}
        {route === 'orders' && <OrdersPage />}
        {route === 'coach' && <CoachPage tab={arg} />}
        {route === 'settings' && <SettingsPage />}
      </main>
    </div>
  );
}

function SetupNeeded() {
  return (
    <div className="login">
      <div className="card stack">
        <h1>Almost there</h1>
        <p className="text-2">HQ is online, so it needs a password before it will show your data.</p>
        <ol className="steps">
          <li>In Netlify, open this site → Site configuration → Environment variables.</li>
          <li>
            Add <code>APP_PASSWORD</code> with a password only you know (and <code>ANTHROPIC_API_KEY</code> for the coach).
          </li>
          <li>Go to Deploys → Trigger deploy, then reload this page.</li>
        </ol>
      </div>
    </div>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await post('/auth/login', { password });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="card stack" onSubmit={submit}>
        <h1>HQ</h1>
        <p className="text-2">Enter your app password.</p>
        <input type="password" autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-label="Password" />
        {error && <div className="banner bad">{error}</div>}
        <button className="btn primary" disabled={busy || !password}>
          Sign in
        </button>
      </form>
    </div>
  );
}
