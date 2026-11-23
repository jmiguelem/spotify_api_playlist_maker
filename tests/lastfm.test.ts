import { describe, expect, it, vi } from 'vitest';
import { acceptTag, buildCandidates, normalizeTag } from '../src/genres';
import { createLastfm, LastfmError, refineWithLastfm } from '../src/lastfm';
import { MemoryStore, type Track } from '../src/library';

const ok = (tags: [string, number][]) =>
  new Response(JSON.stringify({ toptags: { tag: tags.map(([name, count]) => ({ name, count })) } }), { status: 200 });
const err = (error: number, message = '') => new Response(JSON.stringify({ error, message }), { status: 200 });
const track = (id: string, artist = 'A', name = id): Track =>
  ({ id, name, artistIds: [artist], artistNames: [`Name ${artist}`], addedAt: '' });

describe('tag filtering', () => {
  it.each([
    ['shoegaze', true], ['Hip-Hop', true], ['post-rock', true], ['trip-hop', true], ['indie rock', true],
    ['seen live', false], ['favorites', false], ['female vocalists', false], ['popular', false],
    ['albums i own', false], ['00s', false], ['love', false],
  ])('%s -> %s', (tag, expected) => expect(acceptTag(tag)).toBe(expected));

  it('drops low-weight tags and normalizes synonyms', () => {
    expect(acceptTag('shoegaze', 10)).toBe(false);
    expect(normalizeTag('Hip-Hop')).toBe('hip hop');
    expect(normalizeTag('Drum n Bass')).toBe('drum and bass');
  });
});

describe('createLastfm', () => {
  const mk = (f: unknown) => createLastfm({ apiKey: 'k', fetchImpl: f as never, sleep: async () => {}, gapMs: 0 });

  it('keeps accepted tags, normalized, max 5', async () => {
    const f = vi.fn(async () => ok([['shoegaze', 100], ['seen live', 90], ['Hip-Hop', 80], ['dream pop', 5]]));
    expect(await mk(f).trackTags('A', 'T')).toEqual(['shoegaze', 'hip hop']);
  });

  it('treats "not found" as empty and retries rate-limit errors', async () => {
    expect(await mk(vi.fn(async () => err(6))).trackTags('A', 'T')).toEqual([]);
    const f = vi.fn().mockResolvedValueOnce(err(29)).mockResolvedValueOnce(ok([['jazz', 100]]));
    expect(await mk(f).artistTags('A')).toEqual(['jazz']);
  });

  it('throws on an invalid API key', async () => {
    await expect(mk(vi.fn(async () => err(10, 'Invalid API key'))).artistTags('A')).rejects.toBeInstanceOf(LastfmError);
  });

  it('sends the key and autocorrect', async () => {
    const f = vi.fn(async (_u: string) => ok([]));
    await mk(f).trackTags('Some Artist', 'Song');
    const url = f.mock.calls[0]![0];
    expect(url).toContain('api_key=k'); expect(url).toContain('autocorrect=1'); expect(url).toContain('Some+Artist');
  });
});

describe('refineWithLastfm', () => {
  it('falls back to artist tags (cached per artist) and resumes without refetching', async () => {
    const store = new MemoryStore();
    await store.putTracks([track('t1', 'X'), track('t2', 'X'), track('t3', 'Y')]);
    const lf = {
      trackTags: vi.fn(async (_a: string, t: string) => (t === 't3' ? ['jazz', 'swing'] : [])),
      artistTags: vi.fn(async () => ['shoegaze', 'dream pop']),
    };
    await refineWithLastfm(store, lf, () => {});
    expect(store.tags.get('t:t1')).toEqual(['shoegaze', 'dream pop']);
    expect(store.tags.get('t:t3')).toEqual(['jazz', 'swing']);
    expect(lf.artistTags).toHaveBeenCalledTimes(1); // X cached, Y not needed
    await refineWithLastfm(store, lf, () => {});
    expect(lf.trackTags).toHaveBeenCalledTimes(3);  // nothing refetched
  });

  it('keeps progress when interrupted, and resumes', async () => {
    const store = new MemoryStore();
    await store.putTracks([track('t1', 'X'), track('t2', 'Y'), track('t3', 'Z')]);
    let n = 0;
    const lf = {
      trackTags: vi.fn(async () => { if (++n === 2) throw new LastfmError(29, 'boom'); return ['jazz', 'swing']; }),
      artistTags: vi.fn(async () => []),
    };
    await expect(refineWithLastfm(store, lf, () => {})).rejects.toThrow();
    expect(store.tags.size).toBe(1);
    await refineWithLastfm(store, lf, () => {});
    expect(store.tags.size).toBe(3);
  });
});

describe('merging with Spotify genres', () => {
  const tracks = Array.from({ length: 5 }, (_, i) => track(`t${i}`, 'A'));
  const artists = [{ id: 'A', name: 'A', genres: ['indie rock'] }];
  const tags = new Map(tracks.map((t) => [t.id, ['shoegaze', 'indie rock']]));

  it('adds Last.fm genres when enabled', () => {
    const on = buildCandidates(tracks, artists, { mode: 'specific', minSongs: 3, multi: true, useLastfm: true }, tags);
    expect(on.map((c) => c.name)).toEqual(expect.arrayContaining(['Indie Rock', 'Shoegaze']));
    const off = buildCandidates(tracks, artists, { mode: 'specific', minSongs: 3, multi: true, useLastfm: false }, tags);
    expect(off.map((c) => c.name)).not.toContain('Shoegaze');
  });
});
