import { ElMessage } from 'element-plus';

const BASE = import.meta.env.VITE_API_BASE ?? '/api/v1';
const TOKEN_KEY = 'uwb_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

interface RequestOpts {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  auth?: boolean;
}

export async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const url = new URL(BASE + path, window.location.origin);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
    }
  }

  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.auth !== false) {
    const token = getToken();
    if (token) headers.authorization = `Bearer ${token}`;
  }

  const res = await fetch(url.toString(), {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (res.status === 204) return undefined as T;
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const message = payload?.error?.message ?? `请求失败（${res.status}）`;
    if (res.status === 401) setToken(null);
    throw new ApiError(res.status, payload?.error?.code ?? 'error', message);
  }
  return payload as T;
}

/** 统一弹错误提示，页面里少写重复 catch */
export function notifyError(err: unknown, fallback = '操作失败'): void {
  ElMessage.error(err instanceof ApiError ? err.message : fallback);
}
