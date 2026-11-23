import { describe, expect, it, vi } from 'vitest';
import { runWriteCheck } from '../src/check';
import { ApiError, createClient } from '../src/spotify';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function setup(deleteResponse: () => Response) {
  const calls: { method: string; url: string; body?: string }[] = [];
  const f = vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    calls.push({ method, url, body: init.body as string | undefined });
    if (url.includes('/me/tracks')) return json({ total: 1, items: [{ track: { id: 'trk', name: 'n', artists: [{ id: 'a', name: 'A' }] } }] });
    if (method === 'POST' && url.endsWith('/me/playlists')) return json({ id: 'pl1' });
    if (method === 'POST' && url.endsWith('/playlists/pl1/items')) return json({ snapshot_id: 's' });
    if (method === 'DELETE') return deleteResponse();
    return json({}, 404);
  });
  return { calls, api: createClient({ getToken: async () => 't', fetchImpl: f as never, sleep: async () => {} }) };
}

describe('write check', () => {
  it('removes the test playlist via the uris query parameter (no body)', async () => {
    const { api, calls } = setup(() => new Response(null, { status: 200 }));
    const results = await runWriteCheck(api);
    expect(results.every((r) => r.ok)).toBe(true);
    const del = calls.find((c) => c.method === 'DELETE')!;
    expect(del.url).toBe('https://api.spotify.com/v1/me/library?uris=spotify%3Aplaylist%3Apl1');
    expect(del.body).toBeUndefined();
  });

  it('tells the user how to clean up if removal fails', async () => {
    const { api } = setup(() => new Response('{"error":{"status":403}}', { status: 403 }));
    const last = (await runWriteCheck(api)).at(-1)!;
    expect(last.ok).toBe(false);
    expect(last.detail).toContain('delete the playlist "API check (safe to delete)" manually');
  });
});
