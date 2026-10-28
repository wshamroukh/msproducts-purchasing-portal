import { getConfig } from './config';
import { getAuthHeaders } from './auth';

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  const headers = { ...(await getAuthHeaders()) };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(`${getConfig().apiBaseUrl.replace(/\/$/, '')}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Cannot reach the API. Check that the backend is running and CORS allows this site.', 0);
  }

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
  if (!res.ok) throw new ApiError((data && data.error) || `Request failed (${res.status})`, res.status);
  return data;
}
