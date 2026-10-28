import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useApi } from '../lib/useApi';
import { api } from '../lib/api';
import { dateTime, money, STATUS_LABELS } from '../lib/format';
import ProductArt from '../components/ProductArt';
import { ErrorBox, Spinner, StatusBadge, StatusTracker } from '../components/Common';

export default function OrderDetail() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { data: o, error, loading, setData } = useApi(`/api/orders/${id}`);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} />;

  const cancel = async () => {
    if (!window.confirm(`Cancel order ${o.OrderNumber}?`)) return;
    setBusy(true);
    setActionError(null);
    try {
      setData(await api(`/api/orders/${o.OrderId}/cancel`, { method: 'POST' }));
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Link to="/orders" className="back">← All my orders</Link>
      {params.get('placed') && (
        <div className="alert alert-success">
          <strong>Thank you!</strong> Order {o.OrderNumber} was placed. The fulfilment team will process it and send it to a store for delivery.
        </div>
      )}
      <div className="page-head">
        <h1>Order {o.OrderNumber}</h1>
        <StatusBadge status={o.Status} />
      </div>
      <StatusTracker status={o.Status} />
      <div className="two-col">
        <div className="card">
          <h3>Items</h3>
          {o.items.map((i) => (
            <div key={i.OrderItemId} className="cart-line">
              <ProductArt product={{ Name: i.ProductName, Category: i.Category, ImageUrl: i.ImageUrl }} size="sm" />
              <div className="cart-line-info">
                <strong>{i.ProductName}</strong>
                <div className="muted small">SKU {i.Sku} · {i.Quantity} × {money(i.UnitPrice)}</div>
              </div>
              <div className="line-total">{money(i.LineTotal)}</div>
            </div>
          ))}
          <div className="row total"><span>Total</span><span>{money(o.Total)}</span></div>

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
        <aside className="card summary">
          <h3>Delivery</h3>
          <p>{o.ShipToName}<br />{o.ShipToAddress}<br />{o.ShipToCity}, {o.ShipToCountry}{o.Phone && <><br />{o.Phone}</>}</p>
          {o.StoreName && <p><span className="muted small">Delivering store</span><br /><strong>{o.StoreName}</strong> ({o.StoreCity})</p>}
          {o.TrackingNumber && <p><span className="muted small">Tracking number</span><br /><strong>{o.TrackingNumber}</strong></p>}
          <p><span className="muted small">Cost center</span><br />{o.CostCenter}</p>
          {o.Justification && <p><span className="muted small">Justification</span><br />{o.Justification}</p>}
          <p className="muted small">Placed {dateTime(o.CreatedAt)}</p>
          <ErrorBox error={actionError} />
          {o.Status === 'Submitted' && (
            <button className="btn btn-danger btn-block" disabled={busy} onClick={cancel}>{busy ? 'Cancelling…' : 'Cancel order'}</button>
          )}
        </aside>
      </div>
    </>
  );
}
