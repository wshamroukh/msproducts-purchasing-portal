let config = null;

export async function loadConfig() {
  const res = await fetch('/config.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Could not load /config.json (${res.status})`);
  config = await res.json();
  if (config.authMode !== 'dev' && (!config.clientId || !config.tenantId || !config.apiScope)) {
    throw new Error('The app is not configured: tenantId, clientId and apiScope are required in /config.json (App Settings TENANT_ID, CLIENT_ID, API_SCOPE).');
  }
  if (!config.apiBaseUrl) throw new Error('apiBaseUrl (App Setting API_BASE_URL) is not configured.');
  return config;
}

export const getConfig = () => config;
