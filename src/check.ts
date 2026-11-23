import { PLAYLIST_MARKER } from './config';
import { ApiError, type SpotifyClient } from './spotify';

export interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

interface Page<T> { items: T[]; total: number }
interface SavedTrack { track: { id: string; name: string; artists: { id: string; name: string }[] } }

async function probe(name: string, fn: () => Promise<string>): Promise<CheckResult> {
  try {
    return { name, ok: true, detail: await fn() };
  } catch (e) {
    const detail = e instanceof ApiError ? `HTTP ${e.status}: ${e.body.slice(0, 120)}` : String(e);
    return { name, ok: false, detail };
  }
}

/** Read-only probes of every endpoint the app depends on. */
export async function runReadChecks(api: SpotifyClient, lastfmKey: string | null): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  let artistId: string | undefined;
  let artistName = 'Radiohead';

  out.push(await probe('GET /me (profile)', async () => {
    const me = await api.get<{ id: string; product?: string }>('/me');
    return `user ${me.id}${me.product ? `, plan: ${me.product}` : ''}`;
  }));

  out.push(await probe('GET /me/tracks (liked songs)', async () => {
    const p = await api.get<Page<SavedTrack>>('/me/tracks?limit=1');
    const t = p.items[0]?.track;
    artistId = t?.artists[0]?.id;
    artistName = t?.artists[0]?.name ?? artistName;
    return `${p.total} liked songs`;
  }));

  out.push(await probe('GET /artists/{id} returns genres', async () => {
    if (!artistId) throw new Error('no liked song to test with');
    const a = await api.get<{ name: string; genres?: string[] }>(`/artists/${artistId}`);
    if (!Array.isArray(a.genres)) throw new Error('genres field missing from response');
    return `${a.name}: ${a.genres.length ? a.genres.join(', ') : '(no genres listed)'}`;
  }));

  out.push(await probe('GET /me/playlists', async () => {
    const p = await api.get<Page<unknown>>('/me/playlists?limit=1');
    return `${p.total} playlists`;
  }));

  out.push(await probe('Last.fm reachable from browser', async () => {
    if (!lastfmKey) throw new Error('no Last.fm API key saved in settings');
    const u = `https://ws.audioscrobbler.com/2.0/?method=artist.gettoptags&artist=${encodeURIComponent(artistName)}&api_key=${encodeURIComponent(lastfmKey)}&format=json`;
    const r = await fetch(u);
    const j = (await r.json()) as { toptags?: { tag: { name: string }[] }; error?: number; message?: string };
    if (j.error) throw new Error(`Last.fm error ${j.error}: ${j.message}`);
    return `${artistName}: ${(j.toptags?.tag ?? []).slice(0, 5).map((t) => t.name).join(', ')}`;
  }));

  out.push(await probe('MusicBrainz reachable from browser', async () => {
    const r = await fetch(`https://musicbrainz.org/ws/2/artist/?query=artist:${encodeURIComponent(artistName)}&fmt=json&limit=1`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = (await r.json()) as { artists?: { name: string }[] };
    return `found ${j.artists?.[0]?.name ?? 'nothing'}`;
  }));

  return out;
}

/**
 * Write probe (opt-in): creates one private playlist carrying the app marker,
 * adds a track, then removes the playlist. Touches nothing else.
 */
export async function runWriteCheck(api: SpotifyClient): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  let playlistId: string | undefined;
  let trackUri: string | undefined;

  try {
    const p = await api.get<Page<SavedTrack>>('/me/tracks?limit=1');
    const id = p.items[0]?.track.id;
    trackUri = id ? `spotify:track:${id}` : undefined;
  } catch { /* reported below */ }

  out.push(await probe('POST /me/playlists (create)', async () => {
    const pl = await api.post<{ id: string }>('/me/playlists', {
      name: 'API check (safe to delete)',
      description: `${PLAYLIST_MARKER} temporary test playlist`,
      public: false,
    });
    playlistId = pl.id;
    return `created ${pl.id}`;
  }));

  out.push(await probe('POST /playlists/{id}/items (add)', async () => {
    if (!playlistId || !trackUri) throw new Error('nothing to add to');
    await api.post(`/playlists/${playlistId}/items`, { uris: [trackUri] });
    return 'added 1 track';
  }));

  out.push(await probe('DELETE /me/library (remove test playlist)', async () => {
    if (!playlistId) throw new Error('no test playlist');
    await api.del('/me/library', { uris: [`spotify:playlist:${playlistId}`] });
    return 'test playlist removed';
  }));

  return out;
}
