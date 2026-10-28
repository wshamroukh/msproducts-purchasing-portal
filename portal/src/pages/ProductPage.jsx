import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApi } from '../lib/useApi';
import { useCart } from '../lib/cart';
import { money } from '../lib/format';
import ProductArt from '../components/ProductArt';
import { ErrorBox, Spinner } from '../components/Common';

export default function ProductPage() {
  const { id } = useParams();
  const { data: p, error, loading } = useApi(`/api/products/${id}`);
  const [qty, setQty] = useState(1);
  const cart = useCart();
  const navigate = useNavigate();

  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} />;

  const max = Math.min(100, p.Stock);
  return (
    <>
      <Link to="/" className="back">← Back to all products</Link>
      <div className="product-detail card">
        <ProductArt product={p} size="lg" />
        <div className="product-info">
          <span className={`chip chip-${p.Category}`}>{p.Category}</span>
          <h1>{p.Name}</h1>
          <p className="muted">SKU {p.Sku}</p>
          <p>{p.Description}</p>
          <div className="price big">{money(p.Price)}</div>
          <p className={`stock ${p.Stock > 0 ? '' : 'out'}`}>{p.Stock > 0 ? (p.Stock >= 1000 ? 'Available' : `${p.Stock} in stock`) : 'Out of stock'}</p>
          <div className="buy-row">
            <div className="qty">
              <button className="btn" onClick={() => setQty(Math.max(1, qty - 1))} aria-label="Decrease">−</button>
              <input type="number" min="1" max={max} value={qty} onChange={(e) => setQty(Math.max(1, Math.min(max, parseInt(e.target.value, 10) || 1)))} />
              <button className="btn" onClick={() => setQty(Math.min(max, qty + 1))} aria-label="Increase">+</button>
            </div>
            <button className="btn btn-primary btn-lg" disabled={p.Stock <= 0} onClick={() => { cart.add(p, qty); navigate('/cart'); }}>
              Add to cart
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
