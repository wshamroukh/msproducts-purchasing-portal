import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { money } from '../lib/format';
import ProductArt from '../components/ProductArt';
import { ErrorBox, Spinner } from '../components/Common';

const EMPTY = { sku: '', name: '', category: 'Hardware', description: '', price: '', imageUrl: '', stock: '0', isActive: true };

export default function ProductForm() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (isNew) return;
    api(`/api/admin/products/${id}`)
      .then((p) => setForm({
        sku: p.Sku, name: p.Name, category: p.Category, description: p.Description || '', price: String(p.Price),
        imageUrl: p.ImageUrl || '', stock: String(p.Stock), isActive: !!p.IsActive,
      }))
      .catch(setError)
      .finally(() => setLoading(false));
  }, [id, isNew]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body = { ...form, price: Number(form.price), stock: parseInt(form.stock, 10), imageUrl: form.imageUrl || null };
      await api(isNew ? '/api/admin/products' : `/api/admin/products/${id}`, { method: isNew ? 'POST' : 'PUT', body });
      navigate('/products');
    } catch (err) {
      setError(err);
      setSaving(false);
    }
  };

  if (loading) return <Spinner />;

  const preview = { Name: form.name || 'New product', Category: form.category, ImageUrl: /^https:\/\//.test(form.imageUrl) ? form.imageUrl : null };

  return (
    <>
      <Link to="/products" className="back">← All products</Link>
      <h1>{isNew ? 'Add a product' : `Edit ${form.name}`}</h1>
      <form className="two-col" onSubmit={submit}>
        <div className="card form">
          <div className="form-grid">
            <label className="field span-2"><span>Product name *</span><input required maxLength={200} value={form.name} onChange={set('name')} placeholder="e.g. Surface Laptop 7th Edition 13.8&quot;" /></label>
            <label className="field"><span>SKU *</span><input required maxLength={50} value={form.sku} onChange={set('sku')} placeholder="e.g. HW-SL7-13" /></label>
            <label className="field"><span>Category *</span>
              <select value={form.category} onChange={set('category')}>
                <option>Hardware</option><option>Software</option><option>Accessories</option>
              </select>
            </label>
            <label className="field"><span>Price (USD) *</span><input required type="number" min="0" step="0.01" value={form.price} onChange={set('price')} /></label>
            <label className="field"><span>Stock *</span><input required type="number" min="0" step="1" value={form.stock} onChange={set('stock')} /></label>
            <label className="field span-2"><span>Description</span><textarea rows="4" maxLength={2000} value={form.description} onChange={set('description')} /></label>
            <label className="field span-2"><span>Image URL (https, optional – an illustration is generated if empty)</span><input type="url" maxLength={500} value={form.imageUrl} onChange={set('imageUrl')} placeholder="https://…" /></label>
            <label className="field checkbox span-2"><input type="checkbox" checked={form.isActive} onChange={set('isActive')} /><span>Visible in the purchasing portal</span></label>
          </div>
          <ErrorBox error={error} />
          <div className="inline-actions">
            <button className="btn btn-primary btn-lg" disabled={saving}>{saving ? 'Saving…' : isNew ? 'Add product' : 'Save changes'}</button>
            <Link className="btn btn-lg" to="/products">Cancel</Link>
          </div>
        </div>
        <aside className="card summary">
          <h3>Preview</h3>
          <ProductArt product={preview} />
          <p><span className={`chip chip-${form.category}`}>{form.category}</span></p>
          <strong>{preview.Name}</strong>
          <p className="muted small">{form.description}</p>
          <div className="price">{form.price ? money(form.price) : '—'}</div>
        </aside>
      </form>
    </>
  );
}
