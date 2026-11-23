import { describe, expect, it, vi } from 'vitest';
import { importLibrary, MemoryStore } from '../src/library';
import { ApiError, type SpotifyClient } from '../src/spotify';

const mkTrack = (i: number) => ({ added_at: `2024-01-${String(i % 28 + 1).padStart(2, '0')}`, track: { id: `t${i}`, name: `T${i}`, artists: [{ id: `ar${i % 3}`, name: `Artist${i % 3}` }] } });
function fakeApi(total: number, order: number[]) {
  const calls: string[] = [];
  const api = {
    get: vi.fn(async (path: string) => {
      calls.push(path);
      const m = path.match(/me\/tracks\?limit=50&offset=(\d+)/);
      if (m) return { total, items: order.slice(Number(m[1]), Number(m[1]) + 50).map(mkTrack) };
      const a = path.match(/artists\/(\w+)/)!;
      if (a[1] === 'ar2') throw new ApiError(404, 'nope', path);
      return { id: a[1], name: a[1], genres: ['rock'] };
    }),
  } as unknown as SpotifyClient;
  return { api, calls };
}

describe('importLibrary', () => {
  it('imports all songs and one genre lookup per unique primary artist', async () => {
    const store = new MemoryStore();
    const { api, calls } = fakeApi(120, [...Array(120).keys()]);
    await importLibrary(api, store, () => {});
    expect(store.tracks.size).toBe(120);
    expect(calls.filter((c) => c.startsWith('/artists/'))).toHaveLength(3);
    expect(store.artists.get('ar2')!.genres).toEqual([]); // 404 tolerated
  });

  it('incremental run stops at the first page with nothing new and skips known artists', async () => {
    const store = new MemoryStore();
    await importLibrary(fakeApi(120, [...Array(120).keys()]).api, store, () => {});
    const { api, calls } = fakeApi(125, [...Array(125).keys()].map((i) => (i < 5 ? 1000 + i : i - 5)));
    await importLibrary(api, store, () => {});
    expect(store.tracks.size).toBe(125);
    expect(calls.filter((c) => c.includes('me/tracks'))).toHaveLength(2); // new page + one fully-known page
    expect(calls.filter((c) => c.startsWith('/artists/'))).toHaveLength(0);
  });

  it('full resync removes songs that are no longer liked', async () => {
    const store = new MemoryStore();
    await importLibrary(fakeApi(60, [...Array(60).keys()]).api, store, () => {});
    await importLibrary(fakeApi(55, [...Array(60).keys()].slice(5)).api, store, () => {}, { full: true });
    expect(store.tracks.size).toBe(55);
    expect(store.tracks.has('t0')).toBe(false);
  });
});
