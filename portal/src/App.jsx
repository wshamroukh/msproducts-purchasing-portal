import { useState } from 'react';
import { Link, NavLink, Route, Routes } from 'react-router-dom';
import { login, logout } from './lib/auth';
import { useCart } from './lib/cart';
import Catalog from './pages/Catalog';
import ProductPage from './pages/ProductPage';
import CartPage from './pages/CartPage';
import Checkout from './pages/Checkout';
import Orders from './pages/Orders';
import OrderDetail from './pages/OrderDetail';

function Logo() {
  return (
    <svg className="logo" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="1" y="1" width="10.5" height="10.5" fill="#f25022" /><rect x="12.5" y="1" width="10.5" height="10.5" fill="#7fba00" />
      <rect x="1" y="12.5" width="10.5" height="10.5" fill="#00a4ef" /><rect x="12.5" y="12.5" width="10.5" height="10.5" fill="#ffb900" />
    </svg>
  );
}

function SignIn({ config }) {
  const [devName, setDevName] = useState('Dev User');
  return (
    <div className="signin">
      <div className="signin-card">
        <Logo />
        <h1>{config.appTitle}</h1>
        <p>Order Microsoft software, devices and accessories for your work. Sign in with your organization account to continue.</p>
        {config.authMode === 'dev' && (
          <label className="field">
            <span>Local dev mode – pretend to be</span>
            <input value={devName} onChange={(e) => setDevName(e.target.value)} />
          </label>
        )}
        <button className="btn btn-primary btn-lg" onClick={() => login(devName)}>
          Sign in with Microsoft Entra ID
        </button>
        <p className="muted small">For internal employees only.</p>
      </div>
    </div>
  );
}

export default function App({ user, config }) {
  const cart = useCart();
  if (!user) return <SignIn config={config} />;

  return (
    <div className="layout">
      <header className="topbar">
        <Link to="/" className="brand"><Logo /><span>{config.appTitle}</span></Link>
        <nav className="nav">
          <NavLink to="/" end>Shop</NavLink>
          <NavLink to="/orders">My orders</NavLink>
        </nav>
        <div className="topbar-right">
          <Link to="/cart" className="cart-link" aria-label={`Cart, ${cart.count} items`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6" /><circle cx="10" cy="20" r="1.4" /><circle cx="17" cy="20" r="1.4" /></svg>
            {cart.count > 0 && <span className="cart-count">{cart.count}</span>}
          </Link>
          <div className="user">
            <span className="avatar">{(user.name || '?').split(' ').map((p) => p[0]).slice(0, 2).join('')}</span>
            <span className="user-name">{user.name}</span>
            <button className="btn btn-ghost" onClick={logout}>Sign out</button>
          </div>
        </div>
      </header>
      <main className="content">
        <Routes>
          <Route path="/" element={<Catalog />} />
          <Route path="/products/:id" element={<ProductPage />} />
          <Route path="/cart" element={<CartPage />} />
          <Route path="/checkout" element={<Checkout user={user} />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/orders/:id" element={<OrderDetail />} />
          <Route path="*" element={<div className="empty"><h3>Page not found</h3><Link to="/">Back to the shop</Link></div>} />
        </Routes>
      </main>
      <footer className="footer">Sample n-tier application · React SPA → Node.js API → Azure SQL · Secured with Microsoft Entra ID</footer>
    </div>
  );
}
