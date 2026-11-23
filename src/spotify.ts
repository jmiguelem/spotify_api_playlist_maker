import { API_BASE } from './config';

export class ApiError extends Error {
  constructor(public status: number, public body: string, public path: string) {
    super(`${status} ${path}: ${body.slice(0, 200)}`);
  }
}

export interface ClientDeps {
  getToken: (forceRefresh?: boolean) => Promise<string>;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
}

/** Spotify client with 429 (Retry-After) and 401 (token refresh) handling. */
export function createClient(deps: ClientDeps) {
  const f = deps.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxRetries = deps.maxRetries ?? 5;

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      const token = await deps.getToken(refreshed);
      const res = await f(path.startsWith('http') ? path : API_BASE + path, {
        ...init,
        headers: {
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...init.headers,
          Authorization: `Bearer ${token}`,
        },
      });
      if (res.status === 401 && !refreshed) {
        refreshed = true;
        continue;
      }
      if (res.status === 429 && attempt < maxRetries) {
        const wait = Number(res.headers.get('Retry-After') ?? '2');
        await sleep((Number.isFinite(wait) ? wait : 2) * 1000 + 250);
        continue;
      }
      if (res.status >= 500 && attempt < maxRetries) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      const text = await res.text();
      if (!res.ok) throw new ApiError(res.status, text, path);
      return (text ? JSON.parse(text) : undefined) as T;
    }
  }

  return {
    get: <T>(path: string) => request<T>(path),
    post: <T>(path: string, body: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
    del: <T>(path: string, body?: unknown) =>
      request<T>(path, { method: 'DELETE', body: body ? JSON.stringify(body) : undefined }),
  };
}

export type SpotifyClient = ReturnType<typeof createClient>;
