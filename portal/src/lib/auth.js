/*
  Thin wrapper around MSAL.js (Entra ID sign-in for single-page apps).
  - Authorization code flow with PKCE, redirect based
  - Access tokens for the backend API are acquired silently and refreshed by MSAL
  - "dev" mode skips Entra ID entirely for local development
*/
import { PublicClientApplication, InteractionRequiredAuthError } from '@azure/msal-browser';

let pca = null;
let cfg = null;

const DEV_USER_KEY = 'msstore.devUser';

export async function initAuth(config) {
  cfg = config;
  if (config.authMode === 'dev') {
    const name = localStorage.getItem(DEV_USER_KEY);
    return name ? { name, username: `${name.replace(/\s+/g, '.').toLowerCase()}@contoso.example` } : null;
  }

  pca = new PublicClientApplication({
    auth: {
      clientId: config.clientId,
      authority: `https://login.microsoftonline.com/${config.tenantId}`,
      redirectUri: `${window.location.origin}/`,
      postLogoutRedirectUri: `${window.location.origin}/`,
    },
    cache: { cacheLocation: 'localStorage' },
  });
  await pca.initialize();

  const result = await pca.handleRedirectPromise();
  if (result && result.account) pca.setActiveAccount(result.account);
  if (!pca.getActiveAccount()) {
    const accounts = pca.getAllAccounts();
    if (accounts.length > 0) pca.setActiveAccount(accounts[0]);
  }
  const account = pca.getActiveAccount();
  return account ? { name: account.name, username: account.username } : null;
}

export async function login(devName) {
  if (cfg.authMode === 'dev') {
    localStorage.setItem(DEV_USER_KEY, devName || 'Dev User');
    window.location.reload();
    return;
  }
  await pca.loginRedirect({ scopes: [cfg.apiScope], prompt: 'select_account' });
}

export async function logout() {
  if (cfg.authMode === 'dev') {
    localStorage.removeItem(DEV_USER_KEY);
    window.location.assign('/');
    return;
  }
  await pca.logoutRedirect({ account: pca.getActiveAccount() });
}

/** Returns the HTTP headers that authenticate a call to the backend API. */
export async function getAuthHeaders() {
  if (cfg.authMode === 'dev') {
    return { 'x-dev-user': localStorage.getItem(DEV_USER_KEY) || 'Dev User', 'x-dev-admin': String(!!cfg.devAdmin) };
  }
  const account = pca.getActiveAccount();
  const request = { scopes: [cfg.apiScope], account };
  try {
    const result = await pca.acquireTokenSilent(request);
    return { Authorization: `Bearer ${result.accessToken}` };
  } catch (err) {
    if (err instanceof InteractionRequiredAuthError) {
      await pca.acquireTokenRedirect(request);
      return new Promise(() => {}); // page is navigating away
    }
    throw err;
  }
}
