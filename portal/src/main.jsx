import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { loadConfig } from './lib/config';
import { initAuth } from './lib/auth';
import { CartProvider } from './lib/cart';
import './styles.css';

const root = createRoot(document.getElementById('root'));

(async () => {
  try {
    const config = await loadConfig();
    document.title = config.appTitle || document.title;
    const user = await initAuth(config);
    root.render(
      <StrictMode>
        <BrowserRouter>
          <CartProvider>
            <App user={user} config={config} />
          </CartProvider>
        </BrowserRouter>
      </StrictMode>
    );
  } catch (err) {
    console.error(err);
    root.render(
      <div className="boot-error">
        <h1>The portal could not start</h1>
        <p>{err.message}</p>
      </div>
    );
  }
})();
