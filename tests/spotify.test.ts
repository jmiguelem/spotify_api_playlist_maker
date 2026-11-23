import { describe, expect, it, vi } from 'vitest';
import { ApiError, createClient } from '../src/spotify';

const res = (status: number, body = '{}', headers: Record<string, string> = {}) =>
  new Response(body, { status, headers });

describe('spotify client', () => {
  it('retries on 429 honoring Retry-After', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(res(429, '', { 'Retry-After': '3' }))
      .mockResolvedValueOnce(res(200, '{"ok":true}'));
    const sleep = vi.fn(async () => {});
    const api = createClient({ getToken: async () => 't', fetchImpl: f as never, sleep });
    expect(await api.get('/me')).toEqual({ ok: true });
    expect(sleep).toHaveBeenCalledWith(3250);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('refreshes the token once on 401', async () => {
    const f = vi.fn().mockResolvedValueOnce(res(401)).mockResolvedValueOnce(res(200, '{"a":1}'));
    const getToken = vi.fn(async () => 't');
    const api = createClient({ getToken, fetchImpl: f as never });
    await api.get('/me');
    expect(getToken).toHaveBeenNthCalledWith(1, false);
    expect(getToken).toHaveBeenNthCalledWith(2, true);
  });

  it('throws ApiError on 403 without retrying', async () => {
    const f = vi.fn().mockResolvedValue(res(403, 'forbidden'));
    const api = createClient({ getToken: async () => 't', fetchImpl: f as never });
    await expect(api.get('/x')).rejects.toBeInstanceOf(ApiError);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('gives up after maxRetries on repeated 429', async () => {
    const f = vi.fn().mockImplementation(async () => res(429, '', { 'Retry-After': '0' }));
    const api = createClient({ getToken: async () => 't', fetchImpl: f as never, sleep: async () => {}, maxRetries: 2 });
    await expect(api.get('/x')).rejects.toBeInstanceOf(ApiError);
    expect(f).toHaveBeenCalledTimes(3);
  });
});
