import { Link } from 'react-router-dom';
import { useApi } from '../lib/useApi';
import { dateTime, money } from '../lib/format';
import { Empty, ErrorBox, Spinner, StatusBadge } from '../components/Common';

export default function Orders() {
  const { data, error, loading, reload } = useApi('/api/orders');
  if (loading) return <Spinner label="Loading your orders…" />;
  return (
    <>
      <h1>My orders</h1>
      <ErrorBox error={error} onRetry={reload} />
      {data && data.length === 0 && (
        <Empty title="No orders yet"><Link className="btn btn-primary" to="/">Browse products</Link></Empty>
      )}
      {data && data.length > 0 && (
        <div className="card table-wrap">
          <table className="table">
            <thead><tr><th>Order</th><th>Placed</th><th>Items</th><th>Total</th><th>Status</th><th /></tr></thead>
            <tbody>
              {data.map((o) => (
                <tr key={o.OrderId}>
                  <td><Link to={`/orders/${o.OrderId}`}><strong>{o.OrderNumber}</strong></Link></td>
                  <td>{dateTime(o.CreatedAt)}</td>
                  <td>{o.ItemCount}</td>
                  <td>{money(o.Total)}</td>
                  <td><StatusBadge status={o.Status} /></td>
                  <td><Link to={`/orders/${o.OrderId}`}>View</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
