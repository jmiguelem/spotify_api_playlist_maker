import { describe, expect, it } from 'vitest';
import { ancestors, broadBucket, buildCandidates, looseTag } from '../src/genres';
import type { Artist, Track } from '../src/library';

const track = (id: string, artist: string): Track => ({ id, name: id, artistIds: [artist], artistNames: [artist], addedAt: '' });
const artist = (id: string, genres: string[]): Artist => ({ id, name: id, genres });

describe('broadBucket', () => {
  it.each([
    ['indie rock', 'Indie Rock'], ['classic rock', 'Classic & Hard Rock'], ['pop rap', 'Hip-Hop & Rap'],
    ['bedroom pop', 'Bedroom & Lo-fi'], ['dream pop', 'Dream Pop & Shoegaze'], ['indie pop', 'Indie Pop'],
    ['uk drill', 'Trap & Drill'], ['k-pop', 'K-Pop & J-Pop'], ['hyperpop', 'Electronic'], ['dubstep', 'Bass & Breaks'],
    ['ambient', 'Ambient & Chill'], ['outlaw country', 'Country'], ['indie folk', 'Indie & Alternative'], ['pop', 'Pop'],
    ['german techno', 'House & Techno'], ['reggaeton', 'Latin'], ['death metal', 'Metal'], ['zzz', 'Other'],
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
    expect(broad.find((x) => x.name === 'Dream Pop & Shoegaze')!.trackIds).toHaveLength(6); // tie with Indie Rock -> alphabetical
    const both = buildCandidates(tracks, artists, { mode: 'both', minSongs: 3, multi: false });
    expect(new Set(both.map((x) => x.kind))).toEqual(new Set(['broad', 'specific']));
  });
});

describe('refinement', () => {
  const many = (prefix: string, artistId: string, n: number) => Array.from({ length: n }, (_, i) => track(`${prefix}${i}`, artistId));

  it('derives parents from the name and from the explicit map', () => {
    expect(ancestors('bedroom pop')).toEqual(expect.arrayContaining(['pop', 'lo-fi', 'indie']));
    expect(ancestors('indie rock')).toEqual(expect.arrayContaining(['rock', 'indie']));
    expect(ancestors('shoegaze')).toEqual(expect.arrayContaining(['rock', 'indie']));
    expect(ancestors('polka')).toEqual([]);
  });

  it('a niche genre is not swallowed by bigger parent genres', () => {
    const tracks = [...many('b', 'B', 5), ...many('p', 'P', 30), ...many('i', 'I', 20)];
    const artists = [
      artist('B', ['bedroom pop', 'indie pop', 'pop']), artist('P', ['pop']), artist('I', ['indie pop', 'indie']),
    ];
    const c = buildCandidates(tracks, artists, { mode: 'specific', minSongs: 5, multi: false });
    expect(c.find((x) => x.name === 'Bedroom Pop')!.trackIds).toHaveLength(5);
    expect(c.find((x) => x.name === 'Pop')!.trackIds).toHaveLength(30);
    expect(c.find((x) => x.name === 'Indie Pop')!.trackIds).toHaveLength(20);
  });

  it('multi mode drops a parent genre when a narrower one is present', () => {
    const tracks = many('b', 'B', 5);
    const c = buildCandidates(tracks, [artist('B', ['bedroom pop', 'pop', 'indie'])], { mode: 'specific', minSongs: 3, multi: true });
    expect(c.map((x) => x.name)).toEqual(['Bedroom Pop']);
  });

  it('small genres fold into a shared parent instead of "Other"', () => {
    const tracks = [...many('h', 'H', 3), ...many('b', 'B', 3), ...many('z', 'Z', 1)];
    const artists = [artist('H', ['hyperpop']), artist('B', ['bedroom pop']), artist('Z', ['polka'])];
    const c = buildCandidates(tracks, artists, { mode: 'specific', minSongs: 5, multi: false });
    expect(c.find((x) => x.name === 'Pop')!.trackIds).toHaveLength(6);
    expect(c.find((x) => x.name === 'Pop')!.genres.map(([g]) => g).sort()).toEqual(['bedroom pop', 'hyperpop']);
    expect(c.find((x) => x.name === 'Other')!.trackIds).toEqual(['z0']);
  });

  it('keeps unknown Last.fm tags only when several artists share them', () => {
    const tracks = [...many('a', 'A', 3), ...many('b', 'B', 3), ...many('c', 'C', 3)];
    const tags = new Map(tracks.map((t) => [t.id, t.artistIds[0] === 'C' ? ['~hauntology'] : ['~witchy vibes']]));
    tags.forEach((v, k) => { if (k.startsWith('a')) tags.set(k, ['~hauntology']); });
    const artists = [artist('A', []), artist('B', []), artist('C', [])];
    const opts = { mode: 'specific' as const, minSongs: 3, multi: true, useLastfm: true };
    const names = buildCandidates(tracks, artists, opts, tags).map((x) => x.name);
    expect(names).toContain('Hauntology');
    expect(names).not.toContain('Witchy Vibes'); // 3 songs but only artists B -> not enough support
  });

  it('looseTag accepts genre-shaped tags and rejects noise', () => {
    expect(looseTag('hauntology', 80)).toBe(true);
    expect(looseTag('seen live', 90)).toBe(false);
    expect(looseTag('90s', 90)).toBe(false);
    expect(looseTag('taylor swift', 90, 'Taylor Swift')).toBe(false);
    expect(looseTag('hauntology', 20)).toBe(false);
    expect(looseTag('shoegaze', 90)).toBe(false); // known genres use the normal path
  });
});
