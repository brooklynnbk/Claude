import { useMemo, useState, type FormEvent } from 'react';
import { ORDER_STATUSES, ORDER_STATUS_LABELS, type ISODate, type Order, type OrderItem, type OrderStatus } from '../../shared/types.ts';
import { Icon } from '../components/Icon.tsx';
import { PageHead } from '../components/PageHead.tsx';
import { del, patch, post } from '../lib/api.ts';
import { addDays, formatWeekRange, relativeDay, todayISO, weekStart } from '../lib/dates.ts';
import { useApi, useToday } from '../lib/useApi.ts';

export const stickerCount = (o: Order) => o.items.reduce((n, i) => n + i.quantity, 0);
const money = (n: number) => n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: n % 1 ? 2 : 0 });

export function useOrders() {
  const res = useApi<Order[]>('/orders');
  const setStatus = async (o: Order, status: OrderStatus) => {
    res.setData((list) => list?.map((x) => (x.id === o.id ? { ...x, status } : x)));
    try {
      const updated = await patch<Order>(`/orders/${o.id}`, { status });
      res.setData((list) => list?.map((x) => (x.id === o.id ? updated : x)));
    } catch (err) {
      res.setError(err instanceof Error ? err.message : String(err));
      void res.reload();
    }
  };
  return { ...res, setStatus };
}

export function OrdersPage() {
  const today = useToday(todayISO);
  const [start, setStart] = useState(() => weekStart(today));
  const end = addDays(start, 7);
  const { data, setData, error, setStatus } = useOrders();
  const [editing, setEditing] = useState<Order | 'new' | null>(null);
  const [hideShipped, setHideShipped] = useState(false);

  const orders = data ?? [];
  const week = useMemo(() => orders.filter((o) => o.dueDate >= start && o.dueDate < end).sort(byDue), [orders, start, end]);
  const isThisWeek = start === weekStart(today);
  const overdue = isThisWeek ? orders.filter((o) => o.dueDate < start && o.status !== 'shipped').sort(byDue) : [];
  const shipped = week.filter((o) => o.status === 'shipped').length;
  const revenue = week.reduce((n, o) => n + (o.total ?? 0), 0);
  const stickers = week.reduce((n, o) => n + stickerCount(o), 0);
  const channels = [...new Set(orders.map((o) => o.channel).filter(Boolean) as string[])];

  const visible = hideShipped ? week.filter((o) => o.status !== 'shipped') : week;
  const groups = new Map<ISODate, Order[]>();
  for (const o of visible) groups.set(o.dueDate, [...(groups.get(o.dueDate) ?? []), o]);

  async function save(body: OrderDraft, id?: string) {
    if (id) {
      const updated = await patch<Order>(`/orders/${id}`, body);
      setData(orders.map((o) => (o.id === id ? updated : o)));
    } else {
      const created = await post<Order>('/orders', body);
      setData([...orders, created]);
    }
    setEditing(null);
  }

  return (
    <div className="stack">
      <PageHead title="Orders" sub={`Week of ${formatWeekRange(start)}`}>
        <button className="btn primary" onClick={() => setEditing('new')}>
          <Icon name="plus" size={18} /> Order
        </button>
      </PageHead>

      <div className="spread">
        <button className="icon-btn" onClick={() => setStart(addDays(start, -7))} aria-label="Previous week">
          <Icon name="left" />
        </button>
        <button className="btn sm" onClick={() => setStart(weekStart(today))} disabled={isThisWeek}>
          This week
        </button>
        <button className="icon-btn" onClick={() => setStart(addDays(start, 7))} aria-label="Next week">
          <Icon name="right" />
        </button>
      </div>

      {error && <div className="banner bad">{error}</div>}

      <div className="stats">
        <div className="stat">
          <div className="label">Orders</div>
          <div className="value">{week.length}</div>
          {overdue.length > 0 && <div className="delta" style={{ color: 'var(--bad)' }}>+{overdue.length} overdue</div>}
        </div>
        <div className="stat">
          <div className="label">Shipped</div>
          <div className="value">
            {shipped}/{week.length}
          </div>
          <div className="bar" style={{ marginTop: 6 }}>
            <span style={{ width: `${week.length ? (shipped / week.length) * 100 : 0}%` }} />
          </div>
        </div>
        <div className="stat">
          <div className="label">Stickers</div>
          <div className="value">{stickers.toLocaleString()}</div>
        </div>
        <div className="stat">
          <div className="label">Revenue</div>
          <div className="value">{money(revenue)}</div>
        </div>
      </div>

      {editing === 'new' && (
        <OrderForm
          channels={channels}
          defaultDue={isThisWeek ? today : start}
          onCancel={() => setEditing(null)}
          onSave={(b) => save(b)}
        />
      )}

      {overdue.length > 0 && (
        <section className="card">
          <div className="group-title bad">Overdue</div>
          {overdue.map((o) =>
            editing !== 'new' && editing?.id === o.id ? (
              <OrderForm key={o.id} order={o} channels={channels} onCancel={() => setEditing(null)} onSave={(b) => save(b, o.id)} onDelete={() => remove(o)} />
            ) : (
              <OrderCard key={o.id} order={o} today={today} onStatus={setStatus} onEdit={() => setEditing(o)} />
            ),
          )}
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <h2>Due this week</h2>
          {shipped > 0 && (
            <button className="link-btn" onClick={() => setHideShipped(!hideShipped)}>
              {hideShipped ? 'Show shipped' : 'Hide shipped'}
            </button>
          )}
        </div>
        {data && !week.length && (
          <div className="empty">
            No orders due {isThisWeek ? 'this week' : 'in this week'}.{' '}
            <button className="link-btn" onClick={() => setEditing('new')}>
              Add one
            </button>
          </div>
        )}
        {data && week.length > 0 && !visible.length && <div className="empty">Everything this week has shipped. 🎉</div>}
        {[...groups.entries()].map(([date, list]) => (
          <div key={date} style={{ marginBottom: 14 }}>
            <div className={`group-title ${date === today ? 'today' : ''}`}>{relativeDay(date, today)}</div>
            {list.map((o) =>
              editing !== 'new' && editing?.id === o.id ? (
                <OrderForm key={o.id} order={o} channels={channels} onCancel={() => setEditing(null)} onSave={(b) => save(b, o.id)} onDelete={() => remove(o)} />
              ) : (
                <OrderCard key={o.id} order={o} today={today} onStatus={setStatus} onEdit={() => setEditing(o)} />
              ),
            )}
          </div>
        ))}
      </section>
    </div>
  );

  async function remove(o: Order) {
    if (!confirm(`Delete the order for ${o.customer}?`)) return;
    await del(`/orders/${o.id}`);
    setData(orders.filter((x) => x.id !== o.id));
    setEditing(null);
  }
}

const byDue = (a: Order, b: Order) => a.dueDate.localeCompare(b.dueDate) || a.createdAt.localeCompare(b.createdAt);

export function OrderCard({ order: o, today, onStatus, onEdit }: { order: Order; today: ISODate; onStatus: (o: Order, s: OrderStatus) => void; onEdit?: () => void }) {
  const late = o.status !== 'shipped' && o.dueDate < today;
  return (
    <div className={`order ${o.status === 'shipped' ? 'shipped' : ''}`}>
      <div className="spread" style={{ alignItems: 'flex-start' }}>
        <div className="grow">
          <div className="row wrap" style={{ gap: 6 }}>
            <span className="customer">{o.customer}</span>
            {o.channel && <span className="chip">{o.channel}</span>}
            {late && <span className="chip bad">Due {relativeDay(o.dueDate, today)}</span>}
          </div>
          <ul>
            {o.items.map((i, n) => (
              <li key={n}>
                <span className="qty">{i.quantity}×</span> {i.design}
                {i.size && <span className="muted"> · {i.size}</span>}
              </li>
            ))}
          </ul>
          {o.notes && <p className="small muted" style={{ marginTop: 4 }}>{o.notes}</p>}
        </div>
        <div style={{ textAlign: 'right' }}>
          {o.total !== undefined && <div style={{ fontWeight: 700 }}>{money(o.total)}</div>}
          {onEdit && (
            <button className="icon-btn" style={{ border: 0, marginTop: 2 }} onClick={onEdit} aria-label={`Edit order for ${o.customer}`}>
              <Icon name="edit" />
            </button>
          )}
        </div>
      </div>
      <div className="seg full status-seg" role="group" aria-label="Order status">
        {ORDER_STATUSES.map((s) => (
          <button key={s} className={`${o.status === s ? 'on' : ''} st-${s}`} onClick={() => onStatus(o, s)} aria-pressed={o.status === s}>
            {ORDER_STATUS_LABELS[s]}
          </button>
        ))}
      </div>
    </div>
  );
}

type OrderDraft = Omit<Order, 'id' | 'createdAt' | 'completedAt' | 'channel' | 'notes' | 'total'> & {
  channel: string;
  notes: string;
  total: number | null;
};

function OrderForm({
  order,
  channels,
  defaultDue,
  onSave,
  onCancel,
  onDelete,
}: {
  order?: Order;
  channels: string[];
  defaultDue?: ISODate;
  onSave: (o: OrderDraft) => Promise<void>;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [customer, setCustomer] = useState(order?.customer ?? '');
  const [channel, setChannel] = useState(order?.channel ?? '');
  const [dueDate, setDueDate] = useState(order?.dueDate ?? defaultDue ?? todayISO());
  const [items, setItems] = useState<(Omit<OrderItem, 'quantity'> & { quantity: string })[]>(
    order?.items.map((i) => ({ ...i, quantity: String(i.quantity) })) ?? [{ design: '', quantity: '1', size: '' }],
  );
  const [total, setTotal] = useState(order?.total !== undefined ? String(order.total) : '');
  const [notes, setNotes] = useState(order?.notes ?? '');
  const [status, setStatus] = useState<OrderStatus>(order?.status ?? 'todo');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const setItem = (i: number, patchItem: Partial<(typeof items)[number]>) => setItems(items.map((it, n) => (n === i ? { ...it, ...patchItem } : it)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const clean = items.filter((i) => i.design.trim());
    if (!clean.length) return setError('Add at least one sticker design.');
    setBusy(true);
    setError('');
    try {
      await onSave({
        customer: customer.trim(),
        channel: channel.trim(),
        dueDate,
        status,
        items: clean.map((i) => ({ design: i.design.trim(), quantity: Math.max(1, Math.round(Number(i.quantity) || 1)), size: i.size?.trim() || undefined })),
        total: total.trim() ? Number(total) : null,
        notes: notes.trim(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card stack" onSubmit={submit} style={order ? { margin: '8px 0', borderColor: 'var(--accent)' } : undefined}>
      <h2>{order ? 'Edit order' : 'New order'}</h2>
      <div className="form-grid">
        <label className="field">
          Customer
          <input type="text" value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="Name or shop" autoFocus={!order} required />
        </label>
        <label className="field">
          Channel
          <input type="text" list="order-channels" value={channel} onChange={(e) => setChannel(e.target.value)} placeholder="Etsy, Shopify, wholesale…" />
          <datalist id="order-channels">
            {[...new Set([...channels, 'Etsy', 'Shopify', 'Instagram', 'Wholesale', 'Market', 'Custom'])].map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
        <label className="field">
          Due date
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
        </label>
        <label className="field">
          Order total ($)
          <input type="number" inputMode="decimal" min="0" step="0.01" value={total} onChange={(e) => setTotal(e.target.value)} placeholder="Optional" />
        </label>
      </div>

      <div className="stack" style={{ gap: 8 }}>
        <div className="small text-2" style={{ fontWeight: 600 }}>
          Stickers
        </div>
        {items.map((it, i) => (
          <div key={i} className="item-row">
            <input type="text" value={it.design} onChange={(e) => setItem(i, { design: e.target.value })} placeholder="Design" aria-label="Design" />
            <input type="number" inputMode="numeric" min="1" value={it.quantity} onChange={(e) => setItem(i, { quantity: e.target.value })} aria-label="Quantity" />
            <input className="size" type="text" value={it.size ?? ''} onChange={(e) => setItem(i, { size: e.target.value })} placeholder='Size / finish, e.g. 3" matte' aria-label="Size or finish" />
            <button type="button" className="icon-btn" onClick={() => setItems(items.length > 1 ? items.filter((_, n) => n !== i) : items)} aria-label="Remove sticker" disabled={items.length === 1}>
              <Icon name="x" />
            </button>
          </div>
        ))}
        <div>
          <button type="button" className="btn sm" onClick={() => setItems([...items, { design: '', quantity: '1', size: items.at(-1)?.size ?? '' }])}>
            <Icon name="plus" size={16} /> Another design
          </button>
        </div>
      </div>

      <label className="field">
        Notes
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Shipping address, custom requests, packaging…" rows={2} />
      </label>

      <div className="seg full" role="group" aria-label="Status">
        {ORDER_STATUSES.map((s) => (
          <button type="button" key={s} className={status === s ? 'on' : ''} onClick={() => setStatus(s)}>
            {ORDER_STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      {error && <div className="banner bad">{error}</div>}
      <div className="row">
        <button className="btn primary" disabled={busy || !customer.trim()}>
          {order ? 'Save' : 'Add order'}
        </button>
        <button type="button" className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
        {onDelete && (
          <button type="button" className="btn ghost danger" style={{ marginLeft: 'auto' }} onClick={onDelete}>
            <Icon name="trash" size={16} /> Delete
          </button>
        )}
      </div>
    </form>
  );
}
