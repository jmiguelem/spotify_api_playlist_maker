import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/library';
import { ApiError, type SpotifyClient } from '../src/spotify';
import { applyPlan, buildPlan, removeOrphans, type Desired } from '../src/sync';

const MARK = '[auto:genre-sync]';
interface FP { id: string; name: string; description: string | null; owner: { id: string }; items: string[] }

/** In-memory Spotify implementing just the endpoints the sync uses. */
function fakeSpotify() {
  const playlists = new Map<string, FP>();
  const log: string[] = [];
  let n = 0;
  const seed = (p: Partial<FP> & { id: string }) => { playlists.set(p.id, { name: p.id, description: null, owner: { id: 'me' }, items: [], ...p }); };
  const find = (id: string) => { const p = playlists.get(id); if (!p) throw new ApiError(404, 'not found', id); return p; };

  const api = {
    get: async (path: string) => {
      log.push(`GET ${path}`);
      if (path.startsWith('/me/playlists')) return { items: [...playlists.values()], next: null };
      let m = path.match(/^\/playlists\/(\w+)\/items\?limit=50(?:&offset=(\d+))?/);
      if (m) {
        const p = find(m[1]!); const off = Number(m[2] ?? 0);
        const next = off + 50 < p.items.length ? `/playlists/${p.id}/items?limit=50&offset=${off + 50}` : null;
        return { items: p.items.slice(off, off + 50).map((uri) => ({ item: { uri } })), next };
      }
      m = path.match(/^\/playlists\/(\w+)$/);
      if (m) return find(m[1]!);
      throw new Error('unexpected GET ' + path);
    },
    post: async (path: string, body: any) => {
      log.push(`POST ${path}`);
      if (path === '/me/playlists') { const id = `new${++n}`; seed({ id, name: body.name, description: body.description, public: body.public } as never); return { id }; }
      const m = path.match(/^\/playlists\/(\w+)\/items$/)!;
      expect(body.uris.length).toBeLessThanOrEqual(100);
      find(m[1]!).items.push(...body.uris);
      return { snapshot_id: 's' };
    },
    del: async (path: string, body?: any) => {
      log.push(`DELETE ${path}`);
      const lib = path.match(/^\/me\/library\?uris=(.+)$/);
      if (lib) { playlists.delete(decodeURIComponent(lib[1]!).replace('spotify:playlist:', '')); return; }
      const m = path.match(/^\/playlists\/(\w+)\/items$/)!;
      expect(body.items.length).toBeLessThanOrEqual(100);
      const rm = new Set(body.items.map((x: { uri: string }) => x.uri));
      const p = find(m[1]!); p.items = p.items.filter((u) => !rm.has(u));
    },
  } as unknown as SpotifyClient;
  return { api, playlists, seed, log };
}

const uris = (n: number, prefix = 't') => Array.from({ length: n }, (_, i) => `spotify:track:${prefix}${i}`);
const d = (key: string, name: string, u: string[]): Desired => ({ key, name, uris: u });

describe('sync', () => {
  it('creates private marked playlists, adds in chunks of 100 and registers them', async () => {
    const { api, playlists, log } = fakeSpotify(); const store = new MemoryStore();
    const plan = await buildPlan(api, store, [d('broad:Rock', '🤖 Rock', uris(250))], 'me');
    expect(plan.items[0]!.action).toBe('create');
    expect(log.filter((l) => l.startsWith('POST'))).toHaveLength(0); // dry run wrote nothing
    const stats = await applyPlan(api, store, plan, () => {});
    expect(stats).toEqual({ created: 1, updated: 0, skipped: 0 });
    const pl = [...playlists.values()][0]!;
    expect(pl.items).toHaveLength(250);
    expect(pl.description).toContain(MARK);
    expect(log.filter((l) => l.includes('/items') && l.startsWith('POST'))).toHaveLength(3);
    expect((await store.registry())[0]).toMatchObject({ key: 'broad:Rock', playlistId: pl.id });
  });

  it('updates with a minimal diff on the next run and is idempotent', async () => {
    const { api, playlists } = fakeSpotify(); const store = new MemoryStore();
    await applyPlan(api, store, await buildPlan(api, store, [d('k', '🤖 A', uris(10))], 'me'), () => {});
    const want = [...uris(10).slice(3), ...uris(2, 'n')]; // drop 3, add 2
    const plan = await buildPlan(api, store, [d('k', '🤖 A', want)], 'me');
    expect(plan.items[0]).toMatchObject({ action: 'update', unchanged: 7 });
    expect(plan.items[0]!.add).toHaveLength(2); expect(plan.items[0]!.remove).toHaveLength(3);
    await applyPlan(api, store, plan, () => {});
    expect(new Set([...playlists.values()][0]!.items)).toEqual(new Set(want));
    const again = await buildPlan(api, store, [d('k', '🤖 A', want)], 'me');
    expect(again.items[0]).toMatchObject({ add: [], remove: [] });
  });

  it('reads playlists with more than 50 items across pages', async () => {
    const { api, seed } = fakeSpotify(); const store = new MemoryStore();
    seed({ id: 'big', description: MARK, items: uris(120) });
    await store.putRegistry({ key: 'k', playlistId: 'big', name: 'x' });
    const plan = await buildPlan(api, store, [d('k', 'x', uris(120))], 'me');
    expect(plan.items[0]).toMatchObject({ add: [], remove: [], unchanged: 120 });
  });

  it('never touches your own playlists, even with the same name', async () => {
    const { api, playlists, seed } = fakeSpotify(); const store = new MemoryStore();
    seed({ id: 'mine', name: '🤖 Rock', description: 'my own list', items: ['spotify:track:keep'] });
    const plan = await buildPlan(api, store, [d('broad:Rock', '🤖 Rock', uris(3))], 'me');
    expect(plan.items[0]!.action).toBe('create'); // not adopted: no marker
    await applyPlan(api, store, plan, () => {});
    expect(playlists.get('mine')!.items).toEqual(['spotify:track:keep']);
  });

  it('skips registered playlists that are not yours or lost the marker', async () => {
    const { api, playlists, seed } = fakeSpotify(); const store = new MemoryStore();
    seed({ id: 'other', description: MARK, owner: { id: 'someone' }, items: ['spotify:track:x'] });
    seed({ id: 'edited', description: 'renamed by me', items: ['spotify:track:y'] });
    await store.putRegistry({ key: 'a', playlistId: 'other', name: 'a' });
    await store.putRegistry({ key: 'b', playlistId: 'edited', name: 'b' });
    const plan = await buildPlan(api, store, [d('a', 'a', uris(2)), d('b', 'b', uris(2))], 'me');
    expect(plan.items.map((i) => i.action)).toEqual(['skip', 'skip']);
    const stats = await applyPlan(api, store, plan, () => {});
    expect(stats.skipped).toBe(2);
    expect(playlists.get('other')!.items).toEqual(['spotify:track:x']);
    expect(playlists.get('edited')!.items).toEqual(['spotify:track:y']);
  });

  it('recreates a generated playlist that was deleted in Spotify', async () => {
    const { api } = fakeSpotify(); const store = new MemoryStore();
    await store.putRegistry({ key: 'k', playlistId: 'gone', name: 'x' });
    const plan = await buildPlan(api, store, [d('k', 'x', uris(2))], 'me');
    expect(plan.items[0]!.action).toBe('create');
  });

  it('re-adopts a marked playlist by name when the local registry was lost (no duplicates)', async () => {
    const { api, playlists, seed } = fakeSpotify(); const store = new MemoryStore();
    seed({ id: 'old', name: '🤖 Jazz', description: MARK, items: uris(2) });
    const plan = await buildPlan(api, store, [d('specific:jazz', '🤖 Jazz', uris(3))], 'me');
    expect(plan.items[0]).toMatchObject({ action: 'update', playlistId: 'old', adopted: true });
    await applyPlan(api, store, plan, () => {});
    expect(playlists.size).toBe(1);
    expect((await store.registry())[0]!.playlistId).toBe('old');
  });

  it('lists unselected generated playlists as orphans and only deletes verified ones on request', async () => {
    const { api, playlists, seed } = fakeSpotify(); const store = new MemoryStore();
    seed({ id: 'g1', description: MARK }); seed({ id: 'g2', description: 'edited' }); seed({ id: 'keep', description: MARK });
    await store.putRegistry({ key: 'o1', playlistId: 'g1', name: 'o1' });
    await store.putRegistry({ key: 'o2', playlistId: 'g2', name: 'o2' });
    await store.putRegistry({ key: 'k', playlistId: 'keep', name: 'k' });
    const plan = await buildPlan(api, store, [d('k', 'k', [])], 'me');
    expect(plan.orphans.map((o) => o.key).sort()).toEqual(['o1', 'o2']);
    expect(playlists.size).toBe(3); // building the plan deleted nothing
    const log = await removeOrphans(api, store, plan.orphans, 'me');
    expect(playlists.has('g1')).toBe(false);   // verified -> deleted
    expect(playlists.has('g2')).toBe(true);    // marker removed -> left alone
    expect(playlists.has('keep')).toBe(true);
    expect(log.join(' ')).toContain('left alone');
  });
});
