import type { SpotifyClient } from './spotify';
import { ApiError } from './spotify';

export interface Track { id: string; name: string; artistIds: string[]; artistNames: string[]; addedAt: string }
export interface Artist { id: string; name: string; genres: string[] }

/** Storage abstraction so the import logic is testable without IndexedDB. */
export interface Store {
  trackIds(): Promise<Set<string>>;
  allTracks(): Promise<Track[]>;
  putTracks(t: Track[]): Promise<void>;
  deleteTracks(ids: string[]): Promise<void>;
  artistIds(): Promise<Set<string>>;
  allArtists(): Promise<Artist[]>;
  putArtist(a: Artist): Promise<void>;
  /** Last.fm tag cache. Keys: `t:<trackId>` (final tags for a song) and `a:<artistId>` (artist-level cache). */
  tagKeys(): Promise<Set<string>>;
  allTags(): Promise<Map<string, string[]>>;
  putTags(key: string, tags: string[]): Promise<void>;
}

export class MemoryStore implements Store {
  tracks = new Map<string, Track>();
  artists = new Map<string, Artist>();
  async trackIds() { return new Set(this.tracks.keys()); }
  async allTracks() { return [...this.tracks.values()]; }
  async putTracks(t: Track[]) { t.forEach((x) => this.tracks.set(x.id, x)); }
  async deleteTracks(ids: string[]) { ids.forEach((i) => this.tracks.delete(i)); }
  async artistIds() { return new Set(this.artists.keys()); }
  async allArtists() { return [...this.artists.values()]; }
  async putArtist(a: Artist) { this.artists.set(a.id, a); }
  tags = new Map<string, string[]>();
  async tagKeys() { return new Set(this.tags.keys()); }
  async allTags() { return new Map(this.tags); }
  async putTags(key: string, tags: string[]) { this.tags.set(key, tags); }
}

export interface Progress { phase: 'songs' | 'artists'; done: number; total: number }

interface SavedPage {
  total: number;
  items: { added_at: string; track: { id: string | null; name: string; artists: { id: string | null; name: string }[] } | null }[];
}

const PAGE = 50;
const ARTIST_CONCURRENCY = 4;

/**
 * Incremental by default: liked songs come newest-first, so we stop at the first
 * page containing nothing new. `full` rescans everything and drops unliked songs.
 * Genre lookups are saved one by one, so an interrupted import resumes where it stopped.
 * Only each song's primary artist is looked up (one request per artist; batch lookup was removed by Spotify).
 */
export async function importLibrary(
  api: SpotifyClient,
  store: Store,
  onProgress: (p: Progress) => void,
  opts: { full?: boolean } = {},
): Promise<void> {
  const known = await store.trackIds();
  const seen = new Set<string>();
  let offset = 0;
  for (;;) {
    const page = await api.get<SavedPage>(`/me/tracks?limit=${PAGE}&offset=${offset}`);
    const fresh: Track[] = [];
    for (const it of page.items) {
      const t = it.track;
      if (!t?.id) continue; // local files / unavailable
      seen.add(t.id);
      if (known.has(t.id)) continue;
      const artists = t.artists.filter((a) => a.id);
      fresh.push({
        id: t.id,
        name: t.name,
        artistIds: artists.map((a) => a.id!),
        artistNames: artists.map((a) => a.name),
        addedAt: it.added_at,
      });
    }
    await store.putTracks(fresh);
    offset += PAGE;
    onProgress({ phase: 'songs', done: Math.min(offset, page.total), total: page.total });
    if (page.items.length < PAGE || offset >= page.total) break;
    if (!opts.full && fresh.length === 0) break;
  }
  if (opts.full) await store.deleteTracks([...known].filter((id) => !seen.has(id)));

  const have = await store.artistIds();
  const todo = [...new Set((await store.allTracks()).map((t) => t.artistIds[0]).filter((x): x is string => !!x))]
    .filter((id) => !have.has(id));
  let done = 0;
  onProgress({ phase: 'artists', done, total: todo.length });
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const id = todo[next++]!;
      try {
        const a = await api.get<{ id: string; name: string; genres?: string[] }>(`/artists/${id}`);
        await store.putArtist({ id, name: a.name, genres: a.genres ?? [] });
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) await store.putArtist({ id, name: '', genres: [] });
        else throw e;
      }
      onProgress({ phase: 'artists', done: ++done, total: todo.length });
    }
  };
  await Promise.all(Array.from({ length: ARTIST_CONCURRENCY }, worker));
}
