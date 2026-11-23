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

/** Ordered: the first matching rule wins ("indie rock" -> Indie, not Rock). */
const BROAD_RULES: [string, RegExp][] = [
  ['Hip-Hop & Rap', /\b(hip hop|rap|trap|drill|grime|boom bap|crunk)\b/],
  ['Metal', /metal|grindcore|deathcore|metalcore/],
  ['Punk & Emo', /punk|\bemo\b|screamo|hardcore/],
  ['Indie & Alternative', /indie|alternative|lo-fi|bedroom|dream pop|slowcore|shoegaze|new wave|britpop/],
  ['Rock', /rock|grunge|psychedelic|blues rock/],
  ['Electronic', /electro|house|techno|edm|trance|dubstep|drum and bass|dnb|ambient|synth|idm|downtempo|breakbeat|garage|chillwave|vaporwave|rave|bass music/],
  ['Latin', /latin|reggaeton|salsa|bachata|cumbia|merengue|regional mexican|corrido|banda|norte|urbano|mariachi|tango|bossa|mpb|sertanejo|flamenco|trova/],
  ['R&B & Soul', /r&b|\bsoul\b|funk|motown|quiet storm|disco/],
  ['Jazz & Blues', /jazz|blues|swing|bebop/],
  ['Classical & Soundtrack', /classical|orchestra|opera|baroque|piano|soundtrack|\bscore\b|cinematic|neoclassical|choral/],
  ['Folk & Country', /country|folk|bluegrass|americana|singer-songwriter|western/],
  ['Reggae & Dancehall', /reggae|dancehall|\bska\b|\bdub\b/],
  ['Pop', /pop\b|\bidol\b|boy band|girl group|\bdance\b/],
  ['World', /afro|\bworld\b|celtic|arab|bollywood|\bindian\b|\bk-|\bj-|turkish|persian/],
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
]);

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

  const groups = new Map<string, { ids: string[]; genres: Map<string, number> }>();
  const add = (l: string, id: string, raws: string[]) => {
    const g = groups.get(l) ?? { ids: [] as string[], genres: new Map<string, number>() };
    g.ids.push(id);
    for (const r of raws) if (label(r) === l || l === OTHER) g.genres.set(r, (g.genres.get(r) ?? 0) + 1);
    groups.set(l, g);
  };

  for (const t of perTrack) {
    if (t.labels.length === 0) { add(UNSORTED, t.id, []); continue; }
    const good = t.labels.filter((l) => eligible(l) && (kind === 'specific' || l !== OTHER));
    if (good.length === 0) { add(OTHER, t.id, t.raw); continue; }
    const picks = multi ? good : [good.sort((a, b) => (size.get(b)! - size.get(a)!) || a.localeCompare(b))[0]!];
    for (const l of picks) add(l, t.id, t.raw);
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
  const genresOf = (t: Track): string[] => {
    const base = spotify.get(t.artistIds[0] ?? '') ?? [];
    const extra = opts.useLastfm ? trackTags.get(t.id) ?? [] : [];
    return [...new Set([...base, ...extra])];
  };
  const out: Candidate[] = [];
  if (opts.mode !== 'specific') out.push(...build('broad', tracks, genresOf, opts));
  if (opts.mode !== 'broad') out.push(...build('specific', tracks, genresOf, opts));
  return out;
}
