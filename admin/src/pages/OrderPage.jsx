import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApi } from '../lib/useApi';
import { api } from '../lib/api';
import { dateTime, money, STATUS_LABELS } from '../lib/format';
import ProductArt from '../components/ProductArt';
import { ErrorBox, Spinner, StatusBadge, StatusTracker } from '../components/Common';

function Actions({ order, onUpdated }) {
  const stores = useApi('/api/admin/stores');
  const [storeId, setStoreId] = useState('');
  const [tracking, setTracking] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const allowed = order.allowedTransitions || [];

  const move = async (status) => {
    if (status === 'Cancelled' && !window.confirm(`Cancel order ${order.OrderNumber}? Stock will be returned to inventory.`)) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api(`/api/admin/orders/${order.OrderId}/status`, {
        method: 'PATCH',
        body: { status, storeId: storeId ? Number(storeId) : undefined, trackingNumber: tracking || undefined, note: note || undefined },
      });
      setNote('');
      setTracking('');
      onUpdated(updated);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  // Suggest the store in the same city (or country) as the delivery address
  const activeStores = (stores.data || []).filter((s) => s.IsActive);
  const canDispatch = allowed.includes('SentToStore');
  useEffect(() => {
    if (storeId || !canDispatch || activeStores.length === 0) return;
    const match = activeStores.find((s) => s.City.toLowerCase() === order.ShipToCity.toLowerCase())
      || activeStores.find((s) => s.Country.toLowerCase() === order.ShipToCountry.toLowerCase());
    if (match) setStoreId(String(match.StoreId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stores.data, canDispatch]);

  if (allowed.length === 0) return <p className="muted">This order is {STATUS_LABELS[order.Status].toLowerCase()} – no further actions.</p>;

  return (
    <div className="actions">
      {allowed.includes('SentToStore') && (
        <div className="action-panel">
          <strong>Dispatch to a store for delivery</strong>
          <label className="field"><span>Store</span>
            <select value={storeId} onChange={(e) => setStoreId(e.target.value)}>
              <option value="">Select a store…</option>
              {activeStores.map((s) => <option key={s.StoreId} value={s.StoreId}>{s.Name} – {s.City}, {s.Country}</option>)}
            </select>
          </label>
          <label className="field"><span>Tracking / delivery reference (optional)</span><input value={tracking} maxLength={100} onChange={(e) => setTracking(e.target.value)} /></label>
        </div>
      )}
      {allowed.includes('Delivered') && (
        <label className="field"><span>Tracking / delivery reference (optional)</span><input value={tracking} maxLength={100} onChange={(e) => setTracking(e.target.value)} /></label>
      )}
      <label className="field"><span>Note (shown to the requester)</span><textarea rows="2" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      <ErrorBox error={error} />
      {allowed.includes('Processing') && (
        <button className="btn btn-primary" disabled={busy} onClick={() => move('Processing')}>
          {order.Status === 'Submitted' ? 'Accept & start processing' : 'Return to processing'}
        </button>
      )}
      {allowed.includes('SentToStore') && (
        <button className="btn btn-primary" disabled={busy || !storeId} onClick={() => move('SentToStore')}>Send to store</button>
      )}
      {allowed.includes('Delivered') && (
        <button className="btn btn-primary" disabled={busy} onClick={() => move('Delivered')}>Mark as delivered</button>
      )}
      {allowed.includes('Cancelled') && (
        <button className="btn btn-danger" disabled={busy} onClick={() => move('Cancelled')}>Cancel order</button>
      )}
    </div>
  );
}

export default function OrderPage() {
  const { id } = useParams();
  const { data: o, error, loading, setData, reload } = useApi(`/api/admin/orders/${id}`);
  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;

  return (
    <>
      <Link to="/orders" className="back">← All orders</Link>
      <div className="page-head">
        <h1>Order {o.OrderNumber}</h1>
        <StatusBadge status={o.Status} />
        <span className="spacer" />
        {o.StoreName && <button className="btn" onClick={() => window.print()}>Print dispatch slip</button>}
      </div>
      <StatusTracker status={o.Status} />

      <div className="two-col">
        <div>
          <div className="card">
            <h3>Items</h3>
            {o.items.map((i) => (
              <div key={i.OrderItemId} className="cart-line">
                <ProductArt product={{ Name: i.ProductName, Category: i.Category, ImageUrl: i.ImageUrl }} size="sm" />
                <div className="cart-line-info"><strong>{i.ProductName}</strong><div className="muted small">SKU {i.Sku} · {i.Quantity} × {money(i.UnitPrice)}</div></div>
                <div className="line-total">{money(i.LineTotal)}</div>
              </div>
            ))}
            <div className="row total"><span>Total</span><span>{money(o.Total)}</span></div>
          </div>
          <div className="card" style={{ marginTop: '1.5rem' }}>
            <h3>History</h3>
            <ul className="timeline">
              {o.history.map((h) => (
                <li key={h.HistoryId}>
                  <strong>{STATUS_LABELS[h.Status] || h.Status}</strong> <span className="muted small">· {dateTime(h.ChangedAt)} · {h.ChangedBy}</span>
                  {h.Note && <div className="small">{h.Note}</div>}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <aside>
          <div className="card">
            <h3>Requester</h3>
            <p>{o.UserName}<br /><span className="muted small">{o.UserEmail}</span></p>
            <p><span className="muted small">Cost center</span><br /><strong>{o.CostCenter}</strong></p>
            {o.Justification && <p><span className="muted small">Business justification</span><br />{o.Justification}</p>}
            <h3>Deliver to</h3>
            <p>{o.ShipToName}<br />{o.ShipToAddress}<br />{o.ShipToCity}, {o.ShipToCountry}{o.Phone && <><br />{o.Phone}</>}</p>
            {o.StoreName && <p><span className="muted small">Assigned store</span><br /><strong>{o.StoreName}</strong><br /><span className="small">{o.StoreEmail}</span></p>}
            {o.TrackingNumber && <p><span className="muted small">Tracking</span><br /><strong>{o.TrackingNumber}</strong></p>}
          </div>
          <div className="card" style={{ marginTop: '1.5rem' }}>
            <h3>Process order</h3>
            <Actions order={o} onUpdated={setData} />
          </div>
        </aside>
      </div>

      {o.StoreName && (
        <section className="dispatch-slip">
          <h1>Dispatch slip – {o.OrderNumber}</h1>
          <p><strong>Store:</strong> {o.StoreName}, {o.StoreCity}, {o.StoreCountry} ({o.StoreEmail})</p>
          <p><strong>Deliver to:</strong> {o.ShipToName}, {o.ShipToAddress}, {o.ShipToCity}, {o.ShipToCountry} {o.Phone}</p>
          <p><strong>Requester:</strong> {o.UserName} ({o.UserEmail}) · Cost center {o.CostCenter}</p>
          {o.TrackingNumber && <p><strong>Tracking:</strong> {o.TrackingNumber}</p>}
          <table className="table">
            <thead><tr><th>SKU</th><th>Product</th><th>Qty</th></tr></thead>
            <tbody>{o.items.map((i) => <tr key={i.OrderItemId}><td>{i.Sku}</td><td>{i.ProductName}</td><td>{i.Quantity}</td></tr>)}</tbody>
          </table>
          <p style={{ marginTop: '3rem' }}>Received by: ____________________ Date: ____________</p>
        </section>
      )}
    </>
  );
}
