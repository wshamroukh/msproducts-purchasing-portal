import { createContext, useContext, useEffect, useMemo, useState } from 'react';

const CartContext = createContext(null);
const KEY = 'msstore.cart.v1';

export function CartProvider({ children }) {
  const [items, setItems] = useState(() => {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
  });

  useEffect(() => localStorage.setItem(KEY, JSON.stringify(items)), [items]);

  const value = useMemo(() => {
    const add = (product, quantity = 1) =>
      setItems((cur) => {
        const existing = cur.find((i) => i.productId === product.ProductId);
        const max = Math.min(100, product.Stock ?? 100);
        if (existing) {
          return cur.map((i) => (i.productId === product.ProductId ? { ...i, quantity: Math.min(max, i.quantity + quantity) } : i));
        }
        return [...cur, {
          productId: product.ProductId, sku: product.Sku, name: product.Name, category: product.Category,
          price: Number(product.Price), imageUrl: product.ImageUrl, stock: product.Stock, quantity: Math.min(max, quantity),
        }];
      });
    const setQuantity = (productId, quantity) =>
      setItems((cur) => cur.map((i) => (i.productId === productId ? { ...i, quantity: Math.max(1, Math.min(100, i.stock ?? 100, quantity)) } : i)));
    const remove = (productId) => setItems((cur) => cur.filter((i) => i.productId !== productId));
    const clear = () => setItems([]);
    const count = items.reduce((n, i) => n + i.quantity, 0);
    const subtotal = items.reduce((n, i) => n + i.quantity * i.price, 0);
    return { items, add, setQuantity, remove, clear, count, subtotal };
  }, [items]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export const useCart = () => useContext(CartContext);
