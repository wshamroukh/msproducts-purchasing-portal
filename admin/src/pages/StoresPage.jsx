import { useState } from 'react';
import { useApi } from '../lib/useApi';
import { api } from '../lib/api';
import { ErrorBox, Spinner } from '../components/Common';

const EMPTY = { name: '', city: '', country: '', email: '', phone: '', isActive: true };

export default function StoresPage() {
  const { data, error, loading, reload } = useApi('/api/admin/stores');
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const edit = (s) => {
    setEditing(s.StoreId);
    setForm({ name: s.Name, city: s.City, country: s.Country, email: s.Email || '', phone: s.Phone || '', isActive: !!s.IsActive });
  };
  const reset = () => { setEditing(null); setForm(EMPTY); setFormError(null); };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      await api(editing ? `/api/admin/stores/${editing}` : '/api/admin/stores', { method: editing ? 'PUT' : 'POST', body: form });
      reset();
      reload();
    } catch (err) {
      setFormError(err);
    } finally {
      setSaving(false);
    }
  };

  if (loading && !data) return <Spinner />;

  return (
    <>
      <h1>Stores</h1>
      <p className="muted">Orders are dispatched to one of these stores, which delivers them to the requester.</p>
      <ErrorBox error={error} onRetry={reload} />
      <div className="two-col">
        <div className="card table-wrap">
          <table className="table">
            <thead><tr><th>Store</th><th>Location</th><th>Contact</th><th>Open deliveries</th><th>Status</th><th /></tr></thead>
            <tbody>
              {(data || []).map((s) => (
                <tr key={s.StoreId} className={s.IsActive ? '' : 'inactive'}>
                  <td><strong>{s.Name}</strong></td>
                  <td>{s.City}, {s.Country}</td>
                  <td className="small">{s.Email}<br />{s.Phone}</td>
                  <td>{s.OpenDeliveries}</td>
                  <td>{s.IsActive ? 'Active' : 'Inactive'}</td>
                  <td><button className="btn" onClick={() => edit(s)}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form className="card summary form" onSubmit={submit}>
          <h3>{editing ? 'Edit store' : 'Add a store'}</h3>
          <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
            <label className="field"><span>Name *</span><input required maxLength={100} value={form.name} onChange={set('name')} /></label>
            <label className="field"><span>City *</span><input required maxLength={100} value={form.city} onChange={set('city')} /></label>
            <label className="field"><span>Country *</span><input required maxLength={100} value={form.country} onChange={set('country')} /></label>
            <label className="field"><span>Email</span><input type="email" maxLength={256} value={form.email} onChange={set('email')} /></label>
            <label className="field"><span>Phone</span><input maxLength={50} value={form.phone} onChange={set('phone')} /></label>
            <label className="field checkbox"><input type="checkbox" checked={form.isActive} onChange={set('isActive')} /><span>Active</span></label>
          </div>
          <ErrorBox error={formError} />
          <button className="btn btn-primary btn-block" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save store' : 'Add store'}</button>
          {editing && <button type="button" className="btn btn-link btn-block" onClick={reset}>Cancel</button>}
        </form>
      </div>
    </>
  );
}
