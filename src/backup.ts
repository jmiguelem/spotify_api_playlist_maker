import type { Artist, Store, Track } from './library';

export interface Backup {
  version: 1;
  exportedAt: string;
  tracks: Track[];
  artists: Artist[];
  tags: [string, string[]][];
}

export async function exportBackup(store: Store): Promise<Backup> {
  const [tracks, artists, tags] = await Promise.all([store.allTracks(), store.allArtists(), store.allTags()]);
  return { version: 1, exportedAt: new Date().toISOString(), tracks, artists, tags: [...tags] };
}

const isStrings = (x: unknown): x is string[] => Array.isArray(x) && x.every((s) => typeof s === 'string');

/** Validates and merges a backup into the store (backup rows overwrite existing ones). Returns counts. */
export async function importBackup(store: Store, data: unknown): Promise<{ tracks: number; artists: number; tags: number }> {
  const b = data as Partial<Backup> | null;
  if (!b || b.version !== 1 || !Array.isArray(b.tracks) || !Array.isArray(b.artists) || !Array.isArray(b.tags)) {
    throw new Error('Not a backup file from this app');
  }
  const tracks = b.tracks.filter((t): t is Track =>
    !!t && typeof t.id === 'string' && typeof t.name === 'string' && isStrings(t.artistIds) && isStrings(t.artistNames));
  const artists = b.artists.filter((a): a is Artist =>
    !!a && typeof a.id === 'string' && typeof a.name === 'string' && isStrings(a.genres));
  const tags = b.tags.filter((t): t is [string, string[]] =>
    Array.isArray(t) && typeof t[0] === 'string' && isStrings(t[1]));
  await store.putTracks(tracks.map((t) => ({ ...t, addedAt: typeof t.addedAt === 'string' ? t.addedAt : '' })));
  for (const a of artists) await store.putArtist(a);
  for (const [k, v] of tags) await store.putTags(k, v);
  return { tracks: tracks.length, artists: artists.length, tags: tags.length };
}
