import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi } from '../lib/useApi';
import { dateTime, money, STATUS_LABELS } from '../lib/format';
import { Empty, ErrorBox, Spinner, StatusBadge } from '../components/Common';

const FILTERS = ['', 'Submitted', 'Processing', 'SentToStore', 'Delivered', 'Cancelled'];

export default function OrdersPage() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || '';
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const qs = new URLSearchParams();
  if (status) qs.set('status', status);
  if (q) qs.set('q', q);
  const { data, error, loading, reload } = useApi(`/api/admin/orders?${qs}`);

  return (
    <>
      <div className="page-head"><h1>Orders</h1><span className="spacer" /><button className="btn" onClick={reload}>Refresh</button></div>
      <div className="filters">
        {FILTERS.map((f) => (
          <button key={f || 'all'} className={`tab ${status === f ? 'active' : ''}`} onClick={() => setParams(f ? { status: f } : {})}>
            {f ? STATUS_LABELS[f] : 'All'}
          </button>
        ))}
        <input className="search" type="search" placeholder="Order #, requester, cost center…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data && <Spinner />}
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
    </>
  );
}
