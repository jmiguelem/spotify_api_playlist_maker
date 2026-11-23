import { describe, expect, it } from 'vitest';
import { broadBucket, buildCandidates } from '../src/genres';
import type { Artist, Track } from '../src/library';

const track = (id: string, artist: string): Track => ({ id, name: id, artistIds: [artist], artistNames: [artist], addedAt: '' });
const artist = (id: string, genres: string[]): Artist => ({ id, name: id, genres });

describe('broadBucket', () => {
  it.each([
    ['indie rock', 'Indie & Alternative'], ['classic rock', 'Rock'], ['pop rap', 'Hip-Hop & Rap'],
    ['german techno', 'Electronic'], ['reggaeton', 'Latin'], ['death metal', 'Metal'], ['zzz', 'Other'],
  ])('%s -> %s', (g, b) => expect(broadBucket(g)).toBe(b));
});

describe('buildCandidates', () => {
  const tracks = [
    ...Array.from({ length: 6 }, (_, i) => track(`a${i}`, 'A')), // shoegaze + indie rock
    ...Array.from({ length: 3 }, (_, i) => track(`b${i}`, 'B')), // techno
    track('c0', 'C'),                                            // rare genre
    track('d0', 'D'),                                            // no genres
  ];
  const artists = [artist('A', ['shoegaze', 'indie rock']), artist('B', ['techno']), artist('C', ['polka']), artist('D', [])];

  it('single mode puts a song in exactly one specific playlist and groups small genres', () => {
    const c = buildCandidates(tracks, artists, { mode: 'specific', minSongs: 3, multi: false });
    const names = c.map((x) => x.name);
    expect(names).toContain('Indie Rock'); expect(names).not.toContain('Shoegaze'); expect(names).toContain('Techno'); // tie -> alphabetical, one playlist per song
    expect(c.find((x) => x.name === 'Other')!.trackIds).toEqual(['c0']);
    expect(c.find((x) => x.name === 'Unsorted')!.trackIds).toEqual(['d0']);
    const all = c.flatMap((x) => x.trackIds);
    expect(new Set(all).size).toBe(all.length);
  });

  it('multi mode lets a song appear in several playlists', () => {
    const c = buildCandidates(tracks, artists, { mode: 'specific', minSongs: 3, multi: true });
    expect(c.find((x) => x.name === 'Shoegaze')!.trackIds).toHaveLength(6);
    expect(c.find((x) => x.name === 'Indie Rock')!.trackIds).toHaveLength(6);
  });

  it('broad mode merges related genres; both mode returns both kinds', () => {
    const broad = buildCandidates(tracks, artists, { mode: 'broad', minSongs: 3, multi: false });
    expect(broad.find((x) => x.name === 'Indie & Alternative')!.trackIds).toHaveLength(6);
    const both = buildCandidates(tracks, artists, { mode: 'both', minSongs: 3, multi: false });
    expect(new Set(both.map((x) => x.kind))).toEqual(new Set(['broad', 'specific']));
  });
});
