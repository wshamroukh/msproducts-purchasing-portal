import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { dateTime, money, STATUS_LABELS } from '../lib/format';
import { Empty, ErrorBox, Spinner, StatusBadge } from '../components/Common';

const FILTERS = ['', 'Submitted', 'Processing', 'SentToStore', 'Delivered', 'Cancelled'];
const CACHE_KEY = 'msstore.admin.orders.v1';
const AUTO_REFRESH_MS = 60000;

// Loads the order board once (all open orders + the latest closed ones) and filters it in the
// browser, so switching tabs and searching is instant. The last board is kept for the browser
// session and shown immediately, while a fresh copy loads in the background.
function useOrderBoard() {
  const [orders, setOrders] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem(CACHE_KEY)); } catch { return null; }
  });
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadedAt, setLoadedAt] = useState(null);

  const load = useCallback(() => {
    setRefreshing(true);
    setError(null);
    api('/api/admin/orders')
      .then((data) => {
        setOrders(data);
        setLoadedAt(new Date());
        try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch { /* storage full */ }
      })
      .catch(setError)
      .finally(() => setRefreshing(false));
  }, []);

  useEffect(() => {
    load();
    // keep the queue current while the page is open (only when the tab is visible)
    const t = setInterval(() => { if (document.visibilityState === 'visible') load(); }, AUTO_REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  return { orders, error, refreshing, loadedAt, reload: load };
}

export default function OrdersPage() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || '';
  const [search, setSearch] = useState('');
  const [showLoadTest, setShowLoadTest] = useState(false);
  const { orders, error, refreshing, loadedAt, reload } = useOrderBoard();

  // orders visible before the status tab is applied (load-test toggle + search)
  const base = useMemo(() => {
    if (!orders) return null;
    const q = search.trim().toLowerCase();
    return orders.filter((o) =>
      (showLoadTest || o.CostCenter !== 'LOADTEST')
      && (!q || `${o.OrderNumber} ${o.UserName} ${o.UserEmail || ''} ${o.CostCenter}`.toLowerCase().includes(q)));
  }, [orders, search, showLoadTest]);

  const counts = useMemo(() => {
    const c = { '': base ? base.length : 0 };
    for (const o of base || []) c[o.Status] = (c[o.Status] || 0) + 1;
    return c;
  }, [base]);

  const data = useMemo(() => (base ? base.filter((o) => !status || o.Status === status) : null), [base, status]);
  const loadTestCount = useMemo(() => (orders || []).filter((o) => o.CostCenter === 'LOADTEST').length, [orders]);

  return (
    <>
      <div className="page-head">
        <h1>Orders</h1>
        <span className="spacer" />
        {loadedAt && <span className="muted small">Updated {loadedAt.toLocaleTimeString()}</span>}
        <button className="btn" onClick={reload} disabled={refreshing}>{refreshing ? 'Refreshing…' : 'Refresh'}</button>
      </div>
      <div className="filters">
        {FILTERS.map((f) => (
          <button key={f || 'all'} className={`tab ${status === f ? 'active' : ''}`} onClick={() => setParams(f ? { status: f } : {})}>
            {f ? STATUS_LABELS[f] : 'All'}{base ? ` (${counts[f] || 0})` : ''}
          </button>
        ))}
        <input className="search" type="search" placeholder="Order #, requester, cost center…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {loadTestCount > 0 && (
        <label className="field checkbox small" style={{ marginBottom: '1rem' }}>
          <input type="checkbox" checked={showLoadTest} onChange={(e) => setShowLoadTest(e.target.checked)} />
          <span>Show load-test orders ({loadTestCount})</span>
        </label>
      )}
      <ErrorBox error={error} onRetry={reload} />
      {!data && !error && <Spinner />}
      {data && data.length === 0 && <Empty title="No orders match this filter" />}
      {data && data.length > 0 && (
        <div className="card table-wrap">
          <table className="table">
            <thead><tr><th>Order</th><th>Requester</th><th>Cost center</th><th>Ship to</th><th>Items</th><th>Total</th><th>Store</th><th>Status</th><th>Placed</th></tr></thead>
            <tbody>
              {data.map((o) => (
                <tr key={o.OrderId}>
                  <td><Link to={`/orders/${o.OrderId}`}><strong>{o.OrderNumber}</strong></Link></td>
                  <td>{o.UserName}<div className="muted small">{o.UserEmail}</div></td>
                  <td>{o.CostCenter}</td>
                  <td>{o.ShipToCity}, {o.ShipToCountry}</td>
                  <td>{o.ItemCount}</td>
                  <td>{money(o.Total)}</td>
                  <td>{o.StoreName || <span className="muted">—</span>}</td>
                  <td><StatusBadge status={o.Status} /></td>
                  <td className="small">{dateTime(o.CreatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(status === 'Delivered' || status === 'Cancelled' || status === '') && data && data.length > 0 && (
        <p className="muted small">Showing all open orders and the latest 500 delivered / cancelled orders.</p>
      )}
    </>
  );
}
