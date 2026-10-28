import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../lib/useApi';
import { api } from '../lib/api';
import { money } from '../lib/format';
import ProductArt from '../components/ProductArt';
import { ErrorBox, Spinner } from '../components/Common';

export default function ProductsPage() {
  const { data, error, loading, reload, setData } = useApi('/api/admin/products');
  const [category, setCategory] = useState('All');
  const [search, setSearch] = useState('');
  const [actionError, setActionError] = useState(null);

  const rows = useMemo(() => (data || []).filter((p) =>
    (category === 'All' || p.Category === category)
    && (!search || `${p.Name} ${p.Sku}`.toLowerCase().includes(search.toLowerCase()))), [data, category, search]);

  const toggle = async (p) => {
    setActionError(null);
    try {
      const updated = await api(`/api/admin/products/${p.ProductId}`, {
        method: 'PUT',
        body: { sku: p.Sku, name: p.Name, category: p.Category, description: p.Description, price: p.Price, imageUrl: p.ImageUrl, stock: p.Stock, isActive: !p.IsActive },
      });
      setData(data.map((x) => (x.ProductId === p.ProductId ? { ...x, ...updated } : x)));
    } catch (err) {
      setActionError(err);
    }
  };

  if (loading) return <Spinner label="Loading products…" />;

  return (
    <>
      <div className="page-head">
        <h1>Products</h1>
        <span className="spacer" />
        <Link className="btn btn-primary" to="/products/new">+ Add product</Link>
      </div>
      <div className="filters">
        {['All', 'Hardware', 'Software', 'Accessories'].map((c) => (
          <button key={c} className={`tab ${category === c ? 'active' : ''}`} onClick={() => setCategory(c)}>{c}</button>
        ))}
        <input className="search" type="search" placeholder="Search name or SKU…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <ErrorBox error={error || actionError} onRetry={reload} />
      <div className="card table-wrap">
        <table className="table">
          <thead><tr><th /><th>Product</th><th>SKU</th><th>Category</th><th>Price</th><th>Stock</th><th>Sold</th><th>Status</th><th /></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.ProductId} className={p.IsActive ? '' : 'inactive'}>
                <td style={{ width: 72 }}><ProductArt product={p} size="sm" /></td>
                <td><strong>{p.Name}</strong></td>
                <td className="small">{p.Sku}</td>
                <td><span className={`chip chip-${p.Category}`}>{p.Category}</span></td>
                <td>{money(p.Price)}</td>
                <td style={{ color: p.Stock < 10 ? 'var(--danger)' : undefined, fontWeight: p.Stock < 10 ? 600 : undefined }}>{p.Stock}</td>
                <td>{p.UnitsSold}</td>
                <td>{p.IsActive ? 'Active' : 'Hidden'}</td>
                <td>
                  <div className="inline-actions">
                    <Link className="btn" to={`/products/${p.ProductId}/edit`}>Edit</Link>
                    <button className="btn btn-ghost" onClick={() => toggle(p)}>{p.IsActive ? 'Hide' : 'Show'}</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
