import { acceptTag, LOOSE, looseTag, normalizeTag } from './genres';
import type { Store } from './library';

const ENDPOINT = 'https://ws.audioscrobbler.com/2.0/';

export class LastfmError extends Error {
  constructor(public code: number, message: string) { super(`Last.fm error ${code}: ${message}`); }
}

export interface LastfmDeps {
  apiKey: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Minimum gap between requests (Last.fm asks for roughly <= 5 requests/second). */
  gapMs?: number;
  maxRetries?: number;
}

interface TagResponse {
  toptags?: { tag?: { name: string; count: number | string }[] | { name: string; count: number | string } };
  error?: number;
  message?: string;
}

/** Returns normalized, de-duplicated genre tags for a track or artist; unknown-but-plausible ones are prefixed "~". */
export function createLastfm(deps: LastfmDeps) {
  const f = deps.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const gap = deps.gapMs ?? 220;
  const maxRetries = deps.maxRetries ?? 4;

  async function call(params: Record<string, string>): Promise<string[]> {
    const url = `${ENDPOINT}?${new URLSearchParams({ ...params, api_key: deps.apiKey, autocorrect: '1', format: 'json' })}`;
    for (let attempt = 0; ; attempt++) {
      await sleep(gap);
      let res: Response;
      try {
        res = await f(url);
      } catch (e) {
        if (attempt < maxRetries) { await sleep(1000 * 2 ** attempt); continue; }
        throw e;
      }
      if (res.status === 429 || res.status >= 500) {
        if (attempt < maxRetries) { await sleep(1000 * 2 ** attempt); continue; }
        throw new LastfmError(res.status, 'service unavailable');
      }
      const j = (await res.json()) as TagResponse;
      if (j.error === 29 && attempt < maxRetries) { await sleep(2000 * 2 ** attempt); continue; } // rate limit
      if (j.error === 6) return []; // not found
      if (j.error) throw new LastfmError(j.error, j.message ?? '');
      const raw = j.toptags?.tag;
      const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
      const out: string[] = [];
      const loose: string[] = [];
      for (const t of list) {
        const n = normalizeTag(t.name);
        if (acceptTag(t.name, Number(t.count))) {
          if (!out.includes(n) && out.length < 5) out.push(n);
        } else if (looseTag(t.name, Number(t.count), params.artist ?? '')) {
          // Unknown tag (e.g. "hypnagogic pop"): marked "~" so it only counts when several artists share it.
          if (!loose.includes(LOOSE + n) && loose.length < 3) loose.push(LOOSE + n);
        }
      }
      return [...out, ...loose];
    }
  }

  return {
    trackTags: (artist: string, track: string) => call({ method: 'track.gettoptags', artist, track }),
    artistTags: (artist: string) => call({ method: 'artist.gettoptags', artist }),
  };
}

export type Lastfm = ReturnType<typeof createLastfm>;

export interface TagProgress { done: number; total: number }

/**
 * Fetches Last.fm tags for every song not yet tagged. Song-level tags first;
 * if a song has fewer than 2 usable tags, the primary artist's tags are used (cached per artist).
 * Each song is saved as it completes, so an interrupted run resumes where it stopped.
 */
export async function refineWithLastfm(
  store: Store,
  lf: Lastfm,
  onProgress: (p: TagProgress) => void,
): Promise<void> {
  const cached = await store.allTags();
  const tracks = (await store.allTracks()).filter((t) => !cached.has(`t:${t.id}`));
  const artistCache = new Map<string, string[]>();
  for (const [k, v] of cached) if (k.startsWith('a:')) artistCache.set(k.slice(2), v);
  let done = 0;
  onProgress({ done, total: tracks.length });
  for (const t of tracks) {
    const artistName = t.artistNames[0];
    const artistId = t.artistIds[0];
    let tags: string[] = [];
    if (artistName) {
      tags = await lf.trackTags(artistName, t.name);
      if (tags.length < 2 && artistId) {
        const key = `a:${artistId}`;
        let at = artistCache.get(artistId);
        if (!at) {
          at = await lf.artistTags(artistName);
          await store.putTags(key, at);
          artistCache.set(artistId, at);
        }
        tags = [...new Set([...tags, ...at])].slice(0, 8);
      }
    }
    await store.putTags(`t:${t.id}`, tags);
    onProgress({ done: ++done, total: tracks.length });
  }
}
