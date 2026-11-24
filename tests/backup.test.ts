import { describe, expect, it } from 'vitest';
import { exportBackup, importBackup } from '../src/backup';
import { MemoryStore } from '../src/library';

describe('backup', () => {
  it('round-trips songs, artists and tags into an empty store', async () => {
    const a = new MemoryStore();
    await a.putTracks([{ id: 't1', name: 'T', artistIds: ['x'], artistNames: ['X'], addedAt: '2024-01-01' }]);
    await a.putArtist({ id: 'x', name: 'X', genres: ['bedroom pop'] });
    await a.putTags('t:t1', ['bedroom pop', '~hauntology']);
    const json = JSON.parse(JSON.stringify(await exportBackup(a)));
    const b = new MemoryStore();
    expect(await importBackup(b, json)).toEqual({ tracks: 1, artists: 1, tags: 1 });
    expect(b.artists.get('x')!.genres).toEqual(['bedroom pop']);
    expect(b.tags.get('t:t1')).toEqual(['bedroom pop', '~hauntology']);
  });

  it('rejects foreign files and skips malformed rows', async () => {
    const s = new MemoryStore();
    await expect(importBackup(s, { hello: 1 })).rejects.toThrow();
    await expect(importBackup(s, null)).rejects.toThrow();
    const r = await importBackup(s, { version: 1, tracks: [{ id: 1 }], artists: [{ id: 'a', name: 'A', genres: 'x' }], tags: [['k', ['g']], 'bad'] });
    expect(r).toEqual({ tracks: 0, artists: 0, tags: 1 });
  });
});
