import * as SecureStore from 'expo-secure-store';
import { getBackendUrl } from '../constants';

const TOKEN_KEY = 'auth_token';

export const getToken   = () => SecureStore.getItemAsync(TOKEN_KEY);
export const clearToken = async () => {
  await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
};

const saveToken = async (token: string) => {
  if (typeof token !== 'string' || !token) {
    throw new Error('Server returned an invalid token. Please try again.');
  }
  await SecureStore.setItemAsync(TOKEN_KEY, token);
};

const friendlyError = (status: number, detail: string, fallback: string): string => {
  if (detail && detail !== fallback) return detail;
  switch (status) {
    case 401: return 'Invalid email or password.';
    case 403: return 'Access denied.';
    case 422: return detail || 'Validation failed — check the form fields.';
    case 502: return 'Server unreachable (502). Your backend tunnel has expired.\n\nRestart the Cloudflare tunnel and update the server URL in Settings.';
    case 503: return 'Server unavailable (503). Check that your backend is running.';
    case 504: return 'Gateway timeout (504). Server is taking too long to respond.';
    default:  return fallback;
  }
};

const fetchT = async (url: string, opts: RequestInit = {}, ms = 15000): Promise<Response> => {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      throw new Error(`Request timed out after ${ms / 1000}s.\nCheck your network and server URL in Settings.`);
    }
    if (e?.message?.includes('Network request failed') || e?.message?.includes('Failed to fetch')) {
      throw new Error('Cannot reach the server.\nCheck that your backend is running and update the URL in Settings.');
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
};

export const parseDetail = (detail: any, fallback: string): string => {
  if (!detail) return fallback;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail.map((e: any) => {
      if (typeof e === 'string') return e;
      if (e?.msg) return `${e.loc?.slice(-1)?.[0] ?? 'field'}: ${e.msg}`;
      return JSON.stringify(e);
    }).join('; ');
  }
  if (typeof detail === 'object' && detail.message) return detail.message;
  try { return JSON.stringify(detail); } catch { return fallback; }
};

export const authFetch = async (url: string, opts: RequestInit = {}): Promise<Response> => {
  const token  = await getToken();
  const isForm = opts.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(isForm ? {} : { 'Content-Type': 'application/json' }),
    ...(opts.headers as Record<string, string> || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  return fetchT(url, { ...opts, headers });
};

export const login = async (email: string, password: string): Promise<string> => {
  const url  = getBackendUrl();
  const res  = await fetchT(`${url}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(friendlyError(res.status, parseDetail(data.detail, ''), `Login failed (${res.status})`));
  await saveToken(data.token);
  return data.token;
};

export const register = async (email: string, password: string, name: string): Promise<string> => {
  const url  = getBackendUrl();
  const res  = await fetchT(`${url}/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(friendlyError(res.status, parseDetail(data.detail, ''), `Registration failed (${res.status})`));
  await saveToken(data.token);
  return data.token;
};

export const logout = async () => {
  const token = await getToken();
  const url   = getBackendUrl();
  if (token) {
    fetchT(`${url}/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }, 4000).catch(() => {});
  }
  await clearToken();
};
