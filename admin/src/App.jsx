import { useState } from 'react';
import { Link, NavLink, Route, Routes } from 'react-router-dom';
import { login, logout } from './lib/auth';
import { useApi } from './lib/useApi';
import { ErrorBox, Spinner } from './components/Common';
import Dashboard from './pages/Dashboard';
import OrdersPage from './pages/OrdersPage';
import OrderPage from './pages/OrderPage';
import ProductsPage from './pages/ProductsPage';
import ProductForm from './pages/ProductForm';
import StoresPage from './pages/StoresPage';

function Logo() {
  return (
    <svg className="logo" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="1" y="1" width="10.5" height="10.5" fill="#f25022" /><rect x="12.5" y="1" width="10.5" height="10.5" fill="#7fba00" />
      <rect x="1" y="12.5" width="10.5" height="10.5" fill="#00a4ef" /><rect x="12.5" y="12.5" width="10.5" height="10.5" fill="#ffb900" />
    </svg>
  );
}

const I = {
  dash: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="7" height="9" /><rect x="14" y="3" width="7" height="5" /><rect x="14" y="12" width="7" height="9" /><rect x="3" y="16" width="7" height="5" /></svg>,
  orders: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 2h9l5 5v15H6z" /><path d="M14 2v6h6M9 13h8M9 17h8" /></svg>,
  products: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 7l9-4 9 4-9 4z" /><path d="M3 7v10l9 4 9-4V7M12 11v10" /></svg>,
  stores: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 9l2-5h14l2 5M4 9v11h16V9M3 9h18M9 20v-6h6v6" /></svg>,
};

function SignIn({ config }) {
  const [devName, setDevName] = useState('Admin User');
  return (
    <div className="signin" style={{ background: 'linear-gradient(135deg, #1b1f2a, #3a2a5c 60%, #5c2d91)' }}>
      <div className="signin-card">
        <Logo />
        <h1>{config.appTitle}</h1>
        <p>Receive orders, process them and dispatch them to stores for delivery. Restricted to fulfilment administrators.</p>
        {config.authMode === 'dev' && (
          <label className="field"><span>Local dev mode – pretend to be</span><input value={devName} onChange={(e) => setDevName(e.target.value)} /></label>
        )}
        <button className="btn btn-primary btn-lg" onClick={() => login(devName)}>Sign in with Microsoft Entra ID</button>
      </div>
    </div>
  );
}

function AccessDenied({ me }) {
  return (
    <div className="signin" style={{ background: '#1b1f2a' }}>
      <div className="signin-card">
        <h1>Access denied</h1>
        <p>You are signed in as <strong>{me.email || me.name}</strong>, but your account is not assigned the <code>Store.Admin</code> app role.</p>
        <p className="muted small">Ask an administrator to assign you the role in Microsoft Entra ID → Enterprise applications → (API app) → Users and groups. Sign out and in again afterwards.</p>
        <button className="btn btn-primary" onClick={logout}>Sign out</button>
      </div>
    </div>
  );
}

function Shell({ user, config }) {
  const { data: me, error, loading, reload } = useApi('/api/me');
  if (loading) return <Spinner label="Checking your permissions…" />;
  if (error) return <div className="admin-main"><ErrorBox error={error} onRetry={reload} /><button className="btn" onClick={logout}>Sign out</button></div>;
  if (!me.isAdmin) return <AccessDenied me={me} />;

  return (
    <div className="admin-layout">
      <aside className="sidebar">
        <Link to="/" className="brand"><Logo /><span>{config.appTitle}</span></Link>
        <nav>
          <NavLink to="/" end>{I.dash}Dashboard</NavLink>
          <NavLink to="/orders">{I.orders}Orders</NavLink>
          <NavLink to="/products">{I.products}Products</NavLink>
          <NavLink to="/stores">{I.stores}Stores</NavLink>
        </nav>
        <div className="side-user">
          <strong style={{ color: '#fff' }}>{user.name}</strong>
          <span>{me.email}</span>
          <button className="btn btn-ghost" onClick={logout}>Sign out</button>
        </div>
      </aside>
      <main className="admin-main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="/orders/:id" element={<OrderPage />} />
          <Route path="/products" element={<ProductsPage />} />
          <Route path="/products/new" element={<ProductForm />} />
          <Route path="/products/:id/edit" element={<ProductForm />} />
          <Route path="/stores" element={<StoresPage />} />
          <Route path="*" element={<div className="empty"><h3>Page not found</h3><Link to="/">Back to dashboard</Link></div>} />
        </Routes>
      </main>
    </div>
  );
}

export default function App({ user, config }) {
  if (!user) return <SignIn config={config} />;
  return <Shell user={user} config={config} />;
}
