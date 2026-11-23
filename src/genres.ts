import type { Artist, Track } from './library';

export type Mode = 'broad' | 'specific' | 'both';

export interface Options { mode: Mode; minSongs: number; multi: boolean; useLastfm?: boolean }

export interface Candidate {
  key: string;            // stable id, e.g. "broad:Rock" or "specific:shoegaze"
  kind: 'broad' | 'specific';
  name: string;
  trackIds: string[];
  genres: [string, number][]; // underlying Spotify genres and how many songs each contributes
  special?: 'unsorted' | 'other'; // not selected by default
}

export const UNSORTED = 'Unsorted';
export const OTHER = 'Other';

/** Ordered: the first matching rule wins ("bedroom pop" -> Bedroom & Lo-fi, not Pop). */
const BROAD_RULES: [string, RegExp][] = [
  ['Bedroom & Lo-fi', /bedroom|lo-fi|chillhop|sadcore|slowcore|hypnagogic/],
  ['Trap & Drill', /\b(trap|drill|crunk|phonk|cloud rap)\b/],
  ['Hip-Hop & Rap', /\b(hip hop|rap|grime|boom bap)\b/],
  ['Metal', /metal|grindcore|deathcore|metalcore/],
  ['Punk & Emo', /punk|\bemo\b|screamo|hardcore/],
  ['Dream Pop & Shoegaze', /shoegaze|dream pop|noise pop|ethereal|darkwave|coldwave/],
  ['Indie Pop', /indie pop|jangle|twee|chamber pop|art pop|baroque pop/],
  ['Indie Rock', /indie rock|garage rock|math rock|post-rock|alternative rock|post-grunge/],
  ['Indie & Alternative', /indie|alternative|new wave|britpop|post-punk/],
  ['Classic & Hard Rock', /classic rock|hard rock|album rock|glam|southern rock|blues rock|psychedelic|\bprog|art rock|soft rock|yacht rock|heartland|krautrock/],
  ['Rock', /rock|grunge/],
  ['House & Techno', /house|techno|trance|rave|minimal/],
  ['Ambient & Chill', /ambient|downtempo|chillwave|vaporwave|chillout|\bidm\b|new age|lounge|trip-hop/],
  ['Bass & Breaks', /dubstep|drum and bass|dnb|breakbeat|garage|bass music|jungle|\bbass\b/],
  ['Electronic', /electro|edm|synth|hyperpop|glitch|witch house/],
  ['Latin', /latin|reggaeton|salsa|bachata|cumbia|merengue|regional mexican|corrido|banda|norte|urbano|mariachi|tango|bossa|mpb|sertanejo|flamenco|trova/],
  ['R&B & Soul', /r&b|\bsoul\b|funk|motown|quiet storm|disco/],
  ['Jazz & Blues', /jazz|blues|swing|bebop/],
  ['Classical & Soundtrack', /classical|orchestra|opera|baroque|piano|soundtrack|\bscore\b|cinematic|neoclassical|choral/],
  ['Country', /country|bluegrass|western|nashville|honky/],
  ['Folk & Singer-Songwriter', /folk|americana|singer-songwriter/],
  ['Reggae & Dancehall', /reggae|dancehall|\bska\b|\bdub\b/],
  ['K-Pop & J-Pop', /\bk-|\bj-|city pop|anime/],
  ['Pop', /pop\b|\bidol\b|boy band|girl group|\bdance\b/],
  ['World', /afro|\bworld\b|celtic|arab|bollywood|\bindian\b|turkish|persian/],
];

export function broadBucket(genre: string): string {
  const g = genre.toLowerCase();
  for (const [name, re] of BROAD_RULES) if (re.test(g)) return name;
  return OTHER;
}

export function titleCase(s: string): string {
  return s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

const SYNONYMS: Record<string, string> = {
  'hip-hop': 'hip hop', hiphop: 'hip hop', rnb: 'r&b', 'r and b': 'r&b', 'rhythm and blues': 'r&b',
  'drum n bass': 'drum and bass', 'drum & bass': 'drum and bass', dnb: 'drum and bass',
  'electronica': 'electronic', 'synth pop': 'synthpop', 'post rock': 'post-rock', 'post punk': 'post-punk',
  'trip hop': 'trip-hop', 'lo fi': 'lo-fi', lofi: 'lo-fi', 'alt rock': 'alternative rock',
};

/** Genres that matter but are not matched by the broad rules; accepted from Last.fm as-is. */
const EXTRA_GENRES = new Set([
  'trip-hop', 'industrial', 'gospel', 'new age', 'lounge', 'chillout', 'easy listening', 'experimental',
  'noise', 'avant-garde', 'anime', 'post-rock', 'math rock', 'krautrock', 'ska punk', 'emo', 'soundtrack',
  'world music', 'afrobeat', 'highlife', 'k-pop', 'j-pop', 'city pop', 'shoegaze', 'grunge', 'dream pop',
  'hyperpop', 'sadcore', 'hypnagogic pop', 'chillhop', 'phonk', 'cloud rap', 'witch house', 'darkwave', 'coldwave',
  'synthwave', 'folk punk', 'jangle pop', 'twee pop', 'art pop', 'chamber pop', 'neo soul', 'emo rap', 'slowcore',
]);

/**
 * Hand-written parent genres for names where the hierarchy is not obvious from the words
 * ("bedroom pop" -> "pop" is derived automatically; "shoegaze" -> "rock" is not).
 */
const PARENTS: Record<string, string[]> = {
  shoegaze: ['rock', 'indie'], 'post-punk': ['punk', 'indie'], 'trip-hop': ['hip hop', 'electronic'],
  hyperpop: ['pop', 'electronic'], emo: ['punk'], grunge: ['rock', 'alternative'], britpop: ['pop', 'rock', 'indie'],
  chillwave: ['electronic'], vaporwave: ['electronic'], synthpop: ['pop', 'electronic'], synthwave: ['electronic'],
  'post-rock': ['rock'], drill: ['rap'], trap: ['rap'], reggaeton: ['latin'], 'k-pop': ['pop'], 'j-pop': ['pop'],
  'singer-songwriter': ['folk'], slowcore: ['indie', 'rock'], sadcore: ['slowcore'], 'lo-fi': ['indie'],
  'bedroom pop': ['lo-fi'], 'hypnagogic pop': ['lo-fi'], chillhop: ['lo-fi', 'hip hop'], 'new wave': ['alternative'],
  'indie pop': ['indie'], darkwave: ['new wave'], coldwave: ['new wave'], 'cloud rap': ['rap'], phonk: ['rap'],
};

/** Words that make a multi-word genre a child of a broader one ("indie rock" -> "rock", "indie"). */
const ROOTS = new Set([
  'pop', 'rock', 'indie', 'alternative', 'electronic', 'hip hop', 'rap', 'metal', 'punk', 'folk', 'country',
  'jazz', 'blues', 'soul', 'r&b', 'latin', 'dance', 'house', 'techno', 'funk', 'classical', 'reggae', 'ska',
]);

const ancestorCache = new Map<string, string[]>();

/** Broader genres of `g`, nearest first: explicit parents, then root words it is built from. */
export function ancestors(g: string): string[] {
  const hit = ancestorCache.get(g);
  if (hit) return hit;
  const out: string[] = [];
  const seen = new Set([g]);
  const queue = [g];
  while (queue.length) {
    const cur = queue.shift()!;
    const words = cur.split(' ');
    const next = [...(PARENTS[cur] ?? [])];
    for (let i = 1; i < words.length; i++) {
      next.push(words.slice(i).join(' '), words.slice(0, words.length - i).join(' '));
    }
    for (const n of next) {
      if (seen.has(n) || !(ROOTS.has(n) || n in PARENTS)) continue;
      seen.add(n); out.push(n); queue.push(n);
    }
  }
  ancestorCache.set(g, out);
  return out;
}

/** Drops labels that are broader than another label in the same set. */
function dropAncestors(labels: string[]): string[] {
  return labels.filter((l) => !labels.some((o) => o !== l && ancestors(o).includes(l)));
}

const NON_GENRE =
  /seen|favou?rite|\bown\b|vocalist|spotify|\blove|awesome|beautiful|\bcool\b|\bgood\b|\bbest\b|amazing|\bmale\b|female|british|american|swedish|canadian|german|french|\busa?\b|\buk\b|under|check|wish|playlist|albums?\b|songs?\b|\bband\b|artist|radio|\bsad\b|happy|\bchill\b|relax|mood|study|sleep|party|workout|summer|winter|night|morning|cover|\d/;

/**
 * A Last.fm tag outside the known genre list. Kept only when it looks like a genre name;
 * the designer further requires it on several songs by different artists.
 */
export function looseTag(name: string, weight = 100, artist = '', minWeight = 50): boolean {
  const t = normalizeTag(name);
  if (weight < minWeight || t.length < 4 || t.length > 30 || t.split(' ').length > 3) return false;
  if (NON_GENRE.test(t) || (artist && t.includes(artist.toLowerCase()))) return false;
  return !acceptTag(t, 100);
}

export const LOOSE = '~';
const LOOSE_MIN_SONGS = 3;
const LOOSE_MIN_ARTISTS = 2;

/** Resolves stored Last.fm tags: known ones as-is, "~" ones only when several artists share them. */
function resolveTags(tracks: Track[], trackTags: Map<string, string[]>): Map<string, string[]> {
  const support = new Map<string, { songs: number; artists: Set<string> }>();
  for (const t of tracks) {
    for (const tag of trackTags.get(t.id) ?? []) {
      if (!tag.startsWith(LOOSE)) continue;
      const s = support.get(tag) ?? { songs: 0, artists: new Set<string>() };
      s.songs++; s.artists.add(t.artistIds[0] ?? t.id);
      support.set(tag, s);
    }
  }
  const out = new Map<string, string[]>();
  for (const t of tracks) {
    const kept = (trackTags.get(t.id) ?? []).flatMap((tag) => {
      if (!tag.startsWith(LOOSE)) return [tag];
      const s = support.get(tag)!;
      return s.songs >= LOOSE_MIN_SONGS && s.artists.size >= LOOSE_MIN_ARTISTS ? [tag.slice(1)] : [];
    });
    out.set(t.id, kept);
  }
  return out;
}

export function normalizeTag(name: string): string {
  const t = name.toLowerCase().trim().replace(/_/g, ' ').replace(/\s+/g, ' ');
  return SYNONYMS[t] ?? t;
}

/** True when a Last.fm tag looks like a music genre (not "seen live", "favorites", an artist name, ...). */
export function acceptTag(name: string, weight = 100, minWeight = 25): boolean {
  const t = normalizeTag(name);
  if (weight < minWeight || t.length < 3 || t.length > 30 || t.split(' ').length > 3) return false;
  return EXTRA_GENRES.has(t) || broadBucket(t) !== OTHER;
}

function build(
  kind: 'broad' | 'specific',
  tracks: Track[],
  genresOf: (t: Track) => string[],
  { minSongs, multi }: Options,
): Candidate[] {
  const label = (g: string) => (kind === 'broad' ? broadBucket(g) : g);
  const perTrack = tracks.map((t) => {
    const raw = genresOf(t);
    return { id: t.id, raw, labels: [...new Set(raw.map(label))] };
  });
  const size = new Map<string, number>();
  for (const t of perTrack) for (const l of t.labels) size.set(l, (size.get(l) ?? 0) + 1);
  const eligible = (l: string) => (size.get(l) ?? 0) >= minSongs;

  // Songs per genre including songs that only have a narrower child genre; lets several
  // small genres (hyperpop, bedroom pop, ...) fold into their shared parent ("pop").
  const rolled = new Map<string, Set<string>>();
  if (kind === 'specific') {
    for (const t of perTrack) {
      for (const l of t.labels) for (const a of ancestors(l)) {
        const set = rolled.get(a) ?? new Set<string>();
        set.add(t.id); rolled.set(a, set);
      }
    }
  }
  const rolledSize = (l: string) => Math.max(size.get(l) ?? 0, rolled.get(l)?.size ?? 0);

  const groups = new Map<string, { ids: string[]; genres: Map<string, number> }>();
  const add = (l: string, id: string, raws: string[]) => {
    const g = groups.get(l) ?? { ids: [] as string[], genres: new Map<string, number>() };
    g.ids.push(id);
    for (const r of raws) g.genres.set(r, (g.genres.get(r) ?? 0) + 1);
    groups.set(l, g);
  };

  for (const t of perTrack) {
    if (t.labels.length === 0) { add(UNSORTED, t.id, []); continue; }
    let good = t.labels.filter((l) => eligible(l) && (kind === 'specific' || l !== OTHER));
    if (kind === 'specific') good = dropAncestors(good);
    if (good.length === 0) {
      const home = kind === 'specific'
        ? t.labels.flatMap(ancestors).filter((a) => rolledSize(a) >= minSongs)
        : [];
      if (home.length === 0) { add(OTHER, t.id, t.raw); continue; }
      const best = dropAncestors([...new Set(home)])
        .sort((a, b) => (rolledSize(a) - rolledSize(b)) || a.localeCompare(b))[0]!;
      add(best, t.id, t.raw);
      continue;
    }
    // Most specific (smallest) genre wins, so niche genres are not swallowed by big ones.
    const picks = multi ? good : [[...good].sort((a, b) => (size.get(a)! - size.get(b)!) || a.localeCompare(b))[0]!];
    for (const l of picks) add(l, t.id, t.raw.filter((r) => label(r) === l));
  }

  return [...groups.entries()]
    .map(([l, g]): Candidate => ({
      key: `${kind}:${l}`,
      kind,
      name: kind === 'specific' && l !== UNSORTED && l !== OTHER ? titleCase(l) : l,
      trackIds: g.ids,
      genres: [...g.genres.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
      special: l === UNSORTED ? 'unsorted' : l === OTHER ? 'other' : undefined,
    }))
    .sort((a, b) => b.trackIds.length - a.trackIds.length);
}

/**
 * `trackTags` maps track id -> accepted Last.fm genre tags (already normalized);
 * they are merged with the primary artist's Spotify genres when `opts.useLastfm` is on.
 */
export function buildCandidates(
  tracks: Track[],
  artists: Artist[],
  opts: Options,
  trackTags: Map<string, string[]> = new Map(),
): Candidate[] {
  const spotify = new Map(artists.map((a) => [a.id, a.genres.map(normalizeTag)]));
  const resolved = opts.useLastfm ? resolveTags(tracks, trackTags) : new Map<string, string[]>();
  const genresOf = (t: Track): string[] => {
    const base = spotify.get(t.artistIds[0] ?? '') ?? [];
    const extra = resolved.get(t.id) ?? [];
    return [...new Set([...base, ...extra])];
  };
  const out: Candidate[] = [];
  if (opts.mode !== 'specific') out.push(...build('broad', tracks, genresOf, opts));
  if (opts.mode !== 'broad') out.push(...build('specific', tracks, genresOf, opts));
  return out;
}
