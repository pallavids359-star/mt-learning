/**
 * API client.
 * - Access token lives in memory only.
 * - Refresh token lives in sessionStorage (cleared when the tab closes) and is rotated on every refresh.
 * - Concurrent 401s share a single refresh request.
 */
const BASE = (import.meta.env.VITE_API_URL ?? '') + '/api/v1';
const REFRESH_KEY = 'mt.refresh';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

type Tokens = { accessToken: string; refreshToken: string };

let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
let onSessionLost: (() => void) | null = null;

export function setSessionLostHandler(fn: () => void) {
  onSessionLost = fn;
}

function storedRefresh(): string | null {
  try {
    return sessionStorage.getItem(REFRESH_KEY);
  } catch {
    return null;
  }
}

export function setTokens(t: Tokens | null) {
  accessToken = t?.accessToken ?? null;
  try {
    if (t) sessionStorage.setItem(REFRESH_KEY, t.refreshToken);
    else sessionStorage.removeItem(REFRESH_KEY);
  } catch {
    /* storage unavailable: session lasts until reload */
  }
}

export const hasStoredSession = () => !!storedRefresh();

async function refresh(): Promise<boolean> {
  const rt = storedRefresh();
  if (!rt) return false;
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: rt }),
      });
      if (!res.ok) {
        setTokens(null);
        return false;
      }
      setTokens(await res.json());
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export async function ensureSession(): Promise<boolean> {
  if (accessToken) return true;
  return refresh();
}

function errorMessage(body: unknown, status: number): string {
  if (body && typeof body === 'object' && 'message' in body) {
    const m = (body as { message: unknown }).message;
    if (Array.isArray(m)) return m.join('. ');
    if (typeof m === 'string') return m;
  }
  if (status >= 500) return 'The server ran into a problem. Try again in a moment.';
  return `Request failed (${status})`;
}

interface RequestOpts {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  form?: FormData;
  raw?: boolean;
}

export async function api<T>(path: string, opts: RequestOpts = {}, retried = false): Promise<T> {
  const url = new URL(BASE + path, window.location.origin);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const headers: Record<string, string> = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }

  let res: Response;
  try {
    res = await fetch(url, { method: opts.method ?? 'GET', headers, body });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Check the network connection.');
  }

  if (res.status === 401 && !retried && !path.startsWith('/auth/')) {
    if (await refresh()) return api<T>(path, opts, true);
    onSessionLost?.();
    throw new ApiError(401, 'Your session has ended. Sign in again.');
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(res.status, errorMessage(data, res.status), data);
  }
  if (opts.raw) return (await res.blob()) as T;
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export async function logout() {
  const rt = storedRefresh();
  setTokens(null);
  if (rt) {
    await fetch(`${BASE}/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: rt }),
    }).catch(() => undefined);
  }
}

/** Uploads one file with progress reporting (fetch cannot report upload progress). */
export async function uploadFile<T>(path: string, file: File, onProgress?: (fraction: number) => void, retried = false): Promise<T> {
  await ensureSession();
  const result = await new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', BASE + path);
    if (accessToken) xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* non-JSON */
      }
      resolve({ status: xhr.status, body });
    };
    xhr.onerror = () => reject(new ApiError(0, 'The upload failed. Check the network connection and try again.'));
    const form = new FormData();
    form.append('file', file);
    xhr.send(form);
  });
  if (result.status === 401 && !retried) {
    accessToken = null;
    if (await ensureSession()) return uploadFile<T>(path, file, onProgress, true);
  }
  if (result.status === 413) throw new ApiError(413, 'The file is too large.');
  if (result.status >= 400) throw new ApiError(result.status, errorMessage(result.body, result.status), result.body);
  return result.body as T;
}
