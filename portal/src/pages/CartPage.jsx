import { Link, useNavigate } from 'react-router-dom';
import { useCart } from '../lib/cart';
import { money } from '../lib/format';
import ProductArt from '../components/ProductArt';
import { Empty } from '../components/Common';

export default function CartPage() {
  const cart = useCart();
  const navigate = useNavigate();

  if (cart.items.length === 0) {
    return (
      <Empty title="Your cart is empty">
        <p>Browse the catalog and add the products you need.</p>
        <Link className="btn btn-primary" to="/">Start shopping</Link>
      </Empty>
    );
  }

  return (
    <>
      <h1>Shopping cart</h1>
      <div className="two-col">
        <div className="card">
          {cart.items.map((i) => (
            <div key={i.productId} className="cart-line">
              <ProductArt product={{ Name: i.name, Category: i.category, ImageUrl: i.imageUrl }} size="sm" />
              <div className="cart-line-info">
                <Link to={`/products/${i.productId}`}><strong>{i.name}</strong></Link>
                <div className="muted small">{i.category} · SKU {i.sku} · {money(i.price)} each</div>
              </div>
              <div className="qty">
                <button className="btn" onClick={() => cart.setQuantity(i.productId, i.quantity - 1)} aria-label="Decrease">−</button>
                <input type="number" min="1" value={i.quantity} onChange={(e) => cart.setQuantity(i.productId, parseInt(e.target.value, 10) || 1)} />
                <button className="btn" onClick={() => cart.setQuantity(i.productId, i.quantity + 1)} aria-label="Increase">+</button>
              </div>
              <div className="line-total">{money(i.price * i.quantity)}</div>
              <button className="btn btn-ghost" onClick={() => cart.remove(i.productId)} aria-label={`Remove ${i.name}`}>Remove</button>
            </div>
          ))}
        </div>
        <aside className="card summary">
          <h3>Order summary</h3>
          <div className="row"><span>Items</span><span>{cart.count}</span></div>
          <div className="row"><span>Delivery</span><span>Free (internal)</span></div>
          <div className="row total"><span>Total</span><span>{money(cart.subtotal)}</span></div>
          <button className="btn btn-primary btn-block btn-lg" onClick={() => navigate('/checkout')}>Proceed to checkout</button>
          <button className="btn btn-link btn-block" onClick={cart.clear}>Empty cart</button>
        </aside>
      </div>
    </>
  );
}
