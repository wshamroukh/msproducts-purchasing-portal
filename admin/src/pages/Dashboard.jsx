import { Link } from 'react-router-dom';
import { useApi } from '../lib/useApi';
import { dateTime, money, STATUS_LABELS } from '../lib/format';
import { ErrorBox, Spinner, StatusBadge } from '../components/Common';

export default function Dashboard() {
  const stats = useApi('/api/admin/stats');
  const queue = useApi('/api/admin/orders?status=Submitted');

  if (stats.loading) return <Spinner label="Loading dashboard…" />;
  if (stats.error) return <ErrorBox error={stats.error} onRetry={stats.reload} />;
  const s = stats.data;

  return (
    <>
      <div className="page-head"><h1>Dashboard</h1></div>
      <div className="kpis">
        <div className="card kpi accent"><div className="kpi-label">Total orders</div><div className="kpi-value">{s.totals.Orders}</div></div>
        <div className="card kpi accent"><div className="kpi-label">Order value</div><div className="kpi-value">{money(s.totals.Revenue)}</div></div>
        <div className="card kpi accent"><div className="kpi-label">Requesters</div><div className="kpi-value">{s.totals.Customers}</div></div>
      </div>
      <div className="kpis">
        {Object.entries(s.byStatus).map(([status, v]) => (
          <Link key={status} to={`/orders?status=${status}`} className="card kpi" style={{ color: 'inherit', textDecoration: 'none' }}>
            <div className="kpi-label">{STATUS_LABELS[status]}</div>
            <div className="kpi-value">{v.count}</div>
          </Link>
        ))}
      </div>

      <div className="card table-wrap">
        <div style={{ padding: '1rem 1rem 0', display: 'flex', justifyContent: 'space-between' }}>
          <h3>New orders waiting for processing</h3>
          <Link to="/orders?status=Submitted">View all</Link>
        </div>
        {queue.error && <ErrorBox error={queue.error} />}
        {queue.data && queue.data.length === 0 && <p className="muted" style={{ padding: '0 1rem 1rem' }}>Nothing waiting – all caught up. 🎉</p>}
        {queue.data && queue.data.length > 0 && (
          <table className="table">
            <thead><tr><th>Order</th><th>Requester</th><th>Ship to</th><th>Items</th><th>Total</th><th>Placed</th><th /></tr></thead>
            <tbody>
              {queue.data.slice(0, 10).map((o) => (
                <tr key={o.OrderId}>
                  <td><Link to={`/orders/${o.OrderId}`}><strong>{o.OrderNumber}</strong></Link></td>
                  <td>{o.UserName}<div className="muted small">{o.UserEmail}</div></td>
                  <td>{o.ShipToCity}, {o.ShipToCountry}</td>
                  <td>{o.ItemCount}</td>
                  <td>{money(o.Total)}</td>
                  <td>{dateTime(o.CreatedAt)}</td>
                  <td><Link className="btn btn-primary" to={`/orders/${o.OrderId}`}>Process</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="split">
        <div className="card">
          <h3>Top products</h3>
          {s.topProducts.length === 0 ? <p className="muted">No sales yet.</p> : (
            <table className="table">
              <thead><tr><th>Product</th><th>Units</th><th>Value</th></tr></thead>
              <tbody>{s.topProducts.map((p) => <tr key={p.ProductId}><td>{p.ProductName}</td><td>{p.Units}</td><td>{money(p.Amount)}</td></tr>)}</tbody>
            </table>
          )}
        </div>
        <div className="card">
          <h3>Low stock (under 10)</h3>
          {s.lowStock.length === 0 ? <p className="muted">All products are well stocked.</p> : (
            <table className="table">
              <thead><tr><th>Product</th><th>Stock</th><th /></tr></thead>
              <tbody>{s.lowStock.map((p) => (
                <tr key={p.ProductId}><td>{p.Name}</td><td><StatusBadge status={p.Stock === 0 ? 'Cancelled' : 'Processing'} /> {p.Stock}</td>
                  <td><Link to={`/products/${p.ProductId}/edit`}>Restock</Link></td></tr>
              ))}</tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
