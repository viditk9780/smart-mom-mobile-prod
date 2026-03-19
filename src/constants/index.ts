import AsyncStorage from '@react-native-async-storage/async-storage';

export const DEFAULT_BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? 'http://localhost:8000';
export const BACKEND_URL_KEY     = 'momai_backend_url';
export const CHUNK_INTERVAL_MS   = 30_000;
export const CHUNK_QUEUE_KEY     = 'momai_chunk_queue';

// Runtime backend URL — reads saved override from AsyncStorage
// Falls back to .env value if no override saved
let _runtimeUrl: string = DEFAULT_BACKEND_URL;

export const initBackendUrl = async (): Promise<void> => {
  try {
    const saved = await AsyncStorage.getItem(BACKEND_URL_KEY);
    if (saved && saved.startsWith('http')) _runtimeUrl = saved.trim();
  } catch {}
};

export const getBackendUrl = (): string => _runtimeUrl;

export const setBackendUrl = async (url: string): Promise<void> => {
  const clean = url.trim().replace(/\/$/, ''); // remove trailing slash
  _runtimeUrl = clean;
  await AsyncStorage.setItem(BACKEND_URL_KEY, clean);
};

// Re-export BACKEND_URL as a getter function alias for backwards compat
export const BACKEND_URL = DEFAULT_BACKEND_URL; // used only as fallback in services

export const C = {
  bg:       '#fefbf0',
  surface:  '#fffffe',
  surface2: '#fdf9ee',
  border:   '#e8e0c8',
  text:     '#3d3520',
  dim:      '#6b5f3a',
  muted:    '#beb396',
  accent:   '#d4a020',
  white:    '#ffffff',
  error:    '#dc2626',
  errorBg:  'rgba(220,38,38,0.06)',
  success:  '#16a34a',
  successBg:'rgba(22,163,74,0.07)',
  live:     '#ef4444',
  warn:     '#d97706',
  warnBg:   'rgba(217,119,6,0.06)',
};
