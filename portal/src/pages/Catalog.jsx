import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../lib/useApi';
import { useCart } from '../lib/cart';
import { money } from '../lib/format';
import ProductArt from '../components/ProductArt';
import { Empty, ErrorBox, Spinner } from '../components/Common';

const CATEGORIES = ['All', 'Hardware', 'Software', 'Accessories'];

export default function Catalog() {
  const [category, setCategory] = useState('All');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [toast, setToast] = useState('');
  const cart = useCart();

  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const params = new URLSearchParams();
  if (category !== 'All') params.set('category', category);
  if (query) params.set('q', query);
  const { data, error, loading, reload } = useApi(`/api/products?${params}`);

  const add = (p) => {
    cart.add(p, 1);
    setToast(`Added "${p.Name}" to your cart`);
    setTimeout(() => setToast(''), 2200);
  };

  return (
    <>
      <section className="hero">
        <div>
          <h1>Equip your work with Microsoft</h1>
          <p>Software licenses, Surface devices and accessories – approved for internal purchase and delivered by your nearest store.</p>
        </div>
      </section>

      <div className="toolbar">
        <div className="tabs" role="tablist">
          {CATEGORIES.map((c) => (
            <button key={c} role="tab" aria-selected={category === c} className={`tab ${category === c ? 'active' : ''}`} onClick={() => setCategory(c)}>
              {c}
            </button>
          ))}
        </div>
        <input className="search" type="search" placeholder="Search products…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? (
        <Spinner label="Loading products…" />
      ) : data && data.length === 0 ? (
        <Empty title="No products found">Try another category or search term.</Empty>
      ) : (
        <div className="grid">
          {(data || []).map((p) => (
            <article key={p.ProductId} className="card product-card">
              <Link to={`/products/${p.ProductId}`}><ProductArt product={p} /></Link>
              <div className="card-body">
                <span className={`chip chip-${p.Category}`}>{p.Category}</span>
                <h3><Link to={`/products/${p.ProductId}`}>{p.Name}</Link></h3>
                <p className="muted clamp">{p.Description}</p>
              </div>
              <div className="card-foot">
                <div>
                  <div className="price">{money(p.Price)}</div>
                  <div className={`stock ${p.Stock > 0 ? '' : 'out'}`}>{p.Stock > 0 ? (p.Stock >= 1000 ? 'Available' : `${p.Stock} in stock`) : 'Out of stock'}</div>
                </div>
                <button className="btn btn-primary" disabled={p.Stock <= 0} onClick={() => add(p)}>Add to cart</button>
              </div>
            </article>
          ))}
        </div>
      )}
      {toast && <div className="toast" role="status">{toast} · <Link to="/cart">View cart</Link></div>}
    </>
  );
}
