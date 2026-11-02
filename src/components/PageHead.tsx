import type { ReactNode } from 'react';
import { Icon } from './Icon.tsx';

/** Page title row with an optional settings shortcut. */
export function PageHead({ title, sub, children, settings = true }: { title: string; sub?: string; children?: ReactNode; settings?: boolean }) {
  return (
    <header className="page-head">
      <div className="grow">
        <h1>{title}</h1>
        {sub && <p className="sub">{sub}</p>}
      </div>
      <div className="row">
        {children}
        {settings && (
          <a className="icon-btn" href="#/settings" aria-label="Settings" title="Settings">
            <Icon name="settings" />
          </a>
        )}
      </div>
    </header>
  );
}
