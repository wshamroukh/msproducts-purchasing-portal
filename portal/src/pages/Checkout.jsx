import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useCart } from '../lib/cart';
import { api } from '../lib/api';
import { money } from '../lib/format';
import { ErrorBox } from '../components/Common';

const COUNTRIES = ['Oman', 'United Arab Emirates', 'Saudi Arabia', 'Qatar', 'Kuwait', 'Bahrain', 'Egypt', 'United States', 'United Kingdom', 'Ireland', 'Germany', 'India'];

export default function Checkout({ user }) {
  const cart = useCart();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: user.name || '', address: '', city: '', country: 'Oman', phone: '', costCenter: '', justification: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  if (cart.items.length === 0 && !submitting) return <Navigate to="/cart" replace />;

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await api('/api/orders', {
        method: 'POST',
        body: {
          items: cart.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
          shipping: { name: form.name, address: form.address, city: form.city, country: form.country, phone: form.phone },
          costCenter: form.costCenter,
          justification: form.justification,
        },
      });
      cart.clear();
      navigate(`/orders/${result.orderId}?placed=1`, { replace: true });
    } catch (err) {
      setError(err);
      setSubmitting(false);
    }
  };

  return (
    <>
      <Link to="/cart" className="back">← Back to cart</Link>
      <h1>Checkout</h1>
      <form className="two-col" onSubmit={submit}>
        <div className="card form">
          <h3>Delivery details</h3>
          <div className="form-grid">
            <label className="field span-2"><span>Recipient name *</span><input required maxLength={200} value={form.name} onChange={set('name')} /></label>
            <label className="field span-2"><span>Office / street address *</span><input required maxLength={500} placeholder="Building, floor, street" value={form.address} onChange={set('address')} /></label>
            <label className="field"><span>City *</span><input required maxLength={100} value={form.city} onChange={set('city')} /></label>
            <label className="field"><span>Country *</span>
              <select value={form.country} onChange={set('country')}>{COUNTRIES.map((c) => <option key={c}>{c}</option>)}</select>
            </label>
            <label className="field"><span>Phone</span><input maxLength={50} type="tel" value={form.phone} onChange={set('phone')} /></label>
          </div>
          <h3>Approval information</h3>
          <div className="form-grid">
            <label className="field"><span>Cost center *</span><input required maxLength={50} placeholder="e.g. 10045678" value={form.costCenter} onChange={set('costCenter')} /></label>
            <label className="field span-2"><span>Business justification</span><textarea rows="3" maxLength={1000} value={form.justification} onChange={set('justification')} /></label>
          </div>
          <ErrorBox error={error} />
        </div>
        <aside className="card summary">
          <h3>Your order</h3>
          {cart.items.map((i) => (
            <div key={i.productId} className="row small"><span>{i.quantity} × {i.name}</span><span>{money(i.price * i.quantity)}</span></div>
          ))}
          <div className="row total"><span>Total</span><span>{money(cart.subtotal)}</span></div>
          <p className="muted small">Final prices are confirmed by the server when you place the order.</p>
          <button className="btn btn-primary btn-block btn-lg" disabled={submitting}>{submitting ? 'Placing order…' : 'Place order'}</button>
        </aside>
      </form>
    </>
  );
}
