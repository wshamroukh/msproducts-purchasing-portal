import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useCart } from '../lib/cart';
import { money } from '../lib/format';
import ProductArt from '../components/ProductArt';
import { Empty, ErrorBox, Spinner } from '../components/Common';

const CATEGORIES = ['All', 'Hardware', 'Software', 'Accessories'];
const CACHE_KEY = 'msstore.catalog.v1';

// The whole catalog is loaded once and filtered in the browser, so switching tabs and searching
// is instant. The last catalog is kept for the browser session and shown immediately on the next
// visit while a fresh copy is fetched in the background (stale-while-revalidate).
function useCatalog() {
  const [products, setProducts] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem(CACHE_KEY)); } catch { return null; }
  });
  const [error, setError] = useState(null);
  const load = useCallback(() => {
    setError(null);
    api('/api/products')
      .then((data) => {
        setProducts(data);
        try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch { /* storage full */ }
      })
      .catch(setError);
  }, []);
  useEffect(() => load(), [load]);
  return { products, error, reload: load };
}


export default function Catalog() {
  const [category, setCategory] = useState('All');
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState('');
  const cart = useCart();

  const { products, error, reload } = useCatalog();
  const data = useMemo(() => {
    if (!products) return null;
    const q = search.trim().toLowerCase();
    return products.filter((p) =>
      (category === 'All' || p.Category === category)
      && (!q || `${p.Name} ${p.Description || ''} ${p.Sku}`.toLowerCase().includes(q)));
  }, [products, category, search]);

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
      {!data && !error ? (
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
