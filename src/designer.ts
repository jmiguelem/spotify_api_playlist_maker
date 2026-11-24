import { LASTFM_KEY_STORAGE } from './config';
import { IdbStore } from './idb';
import { buildCandidates, type Candidate, type Mode, type Options } from './genres';
import { exportBackup, importBackup } from './backup';
import { createLastfm, refineWithLastfm } from './lastfm';
import { importLibrary, type Progress, type Store } from './library';
import type { SpotifyClient } from './spotify';

const PREFS_KEY = 'designer_prefs';
interface Prefs extends Options { chosen: Record<string, boolean> } // key -> explicit user choice

function loadPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '');
    return { mode: 'broad', minSongs: 20, multi: false, useLastfm: true, chosen: {}, ...p };
  } catch {
    return { mode: 'broad', minSongs: 20, multi: false, useLastfm: true, chosen: {} };
  }
}
const savePrefs = (p: Prefs) => localStorage.setItem(PREFS_KEY, JSON.stringify(p));

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function renderDesigner(root: HTMLElement, api: SpotifyClient, store: Store = new IdbStore()): void {
  const prefs = loadPrefs();
  root.innerHTML = `
    <h2>Library</h2>
    <div id="status"><small>Loading…</small></div>
    <button id="import">Import / update</button>
    <button id="full" class="secondary">Full resync</button>
    <div id="progress"><small></small></div>
    <h2>Saved data</h2>
    <div id="saved"><small></small></div>
    <button id="export" class="secondary">Export backup</button>
    <button id="importbtn" class="secondary">Import backup</button>
    <input id="importfile" type="file" accept=".json,application/json" hidden>
    <div id="backupmsg"><small></small></div>
    <h2>Finer genres (Last.fm)</h2>
    <div id="lfmstatus"><small></small></div>
    <button id="refine" class="secondary">Refine with Last.fm</button>
    <label class="inline"><input id="uselfm" type="checkbox"> Use Last.fm tags when designing playlists</label>
    <div id="lfmprogress"><small></small></div>
    <h2>Design your playlists</h2>
    <div id="modes"></div>
    <label>Minimum songs per playlist: <b id="minv"></b></label>
    <input id="min" type="range" min="5" max="100" step="5">
    <label class="inline"><input id="multi" type="checkbox"> A song may appear in several playlists</label>
    <div id="summary" class="summary"></div>
    <div id="list"></div>`;
  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>('#' + id)!;

  let tracks: Awaited<ReturnType<Store['allTracks']>> = [];
  let artists: Awaited<ReturnType<Store['allArtists']>> = [];
  let trackTags = new Map<string, string[]>();

  const isOn = (c: Candidate) => prefs.chosen[c.key] ?? !c.special;

  function renderList(): void {
    $('minv').textContent = String(prefs.minSongs);
    ($('min') as HTMLInputElement).value = String(prefs.minSongs);
    ($('multi') as HTMLInputElement).checked = prefs.multi;
    ($('uselfm') as HTMLInputElement).checked = !!prefs.useLastfm;
    $('modes').innerHTML = (['broad', 'specific', 'both'] as Mode[])
      .map((m) => `<button data-mode="${m}" class="${prefs.mode === m ? '' : 'secondary'}">${{ broad: 'Broad', specific: 'Specific', both: 'Both' }[m]}</button>`)
      .join('');
    root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => {
      b.onclick = () => { prefs.mode = b.dataset.mode as Mode; savePrefs(prefs); renderList(); };
    });
    if (tracks.length === 0) { $('list').innerHTML = '<p><small>Import your library to see playlist options.</small></p>'; $('summary').textContent = ''; return; }

    const cands = buildCandidates(tracks, artists, prefs, trackTags);
    const on = cands.filter(isOn);
    const covered = new Set(on.flatMap((c) => c.trackIds)).size;
    $('summary').textContent = `${on.length} of ${cands.length} playlists selected · covers ${covered} of ${tracks.length} songs`;
    $('list').innerHTML = cands.map((c) => `
      <details class="cand">
        <summary>
          <input type="checkbox" data-key="${esc(c.key)}" ${isOn(c) ? 'checked' : ''}>
          <span class="name">${esc(c.name)}</span>
          <span class="tag">${c.kind}</span>
          <span class="count">${c.trackIds.length}</span>
        </summary>
        <small>${c.special === 'unsorted' ? 'Songs whose artist has no genre data.' : c.special === 'other' ? 'Songs only in genres too small to get their own playlist.' : c.genres.map(([g, n]) => `${esc(g)} (${n})`).join(', ')}</small>
      </details>`).join('');
    root.querySelectorAll<HTMLInputElement>('[data-key]').forEach((cb) => {
      cb.onclick = (e) => e.stopPropagation();
      cb.onchange = () => { prefs.chosen[cb.dataset.key!] = cb.checked; savePrefs(prefs); renderList(); };
    });
  }

  async function reload(): Promise<void> {
    const [t, a, tags] = await Promise.all([store.allTracks(), store.allArtists(), store.allTags()]);
    tracks = t; artists = a;
    trackTags = new Map([...tags].filter(([k]) => k.startsWith('t:')).map(([k, v]) => [k.slice(2), v]));
    const tagged = [...trackTags.values()].filter((v) => v.length).length;
    $('lfmstatus').innerHTML = `<small>${trackTags.size} of ${tracks.length} songs checked · ${tagged} got genre tags${localStorage.getItem(LASTFM_KEY_STORAGE) ? '' : ' · <span class="bad">no API key saved (API check tab)</span>'}</small>`;
    let protectedStore = false;
    try { protectedStore = (await navigator.storage?.persist?.()) ?? false; } catch { /* unsupported */ }
    $('saved').innerHTML = `<small>${tracks.length} songs · ${artists.length} artists with genres · ${tags.size} Last.fm lookups, kept on this device ${protectedStore ? '(protected from automatic clean-up)' : '(the browser may clear it if unused for a while: export a backup)'}</small>`;
    const withGenre = artists.filter((a) => a.genres.length).length;
    $('status').innerHTML = `<small>${tracks.length} songs · ${artists.length} artists looked up (${withGenre} with genres)</small>`;
    renderList();
  }

  const show = (p: Progress) => {
    $('progress').innerHTML = `<small>${p.phase === 'songs' ? 'Reading liked songs' : 'Looking up artist genres'}: ${p.done} / ${p.total}</small>`;
  };
  const runImport = (full: boolean) => async () => {
    const btns = root.querySelectorAll<HTMLButtonElement>('#import,#full');
    btns.forEach((b) => (b.disabled = true));
    try {
      await importLibrary(api, store, show, { full });
      $('progress').innerHTML = '<small class="ok">Import complete.</small>';
    } catch (e) {
      $('progress').innerHTML = `<small class="bad">Stopped: ${esc(String(e))}. Progress is saved; tap Import to resume.</small>`;
    }
    btns.forEach((b) => (b.disabled = false));
    await reload();
  };
  $('refine').onclick = async () => {
    const key = localStorage.getItem(LASTFM_KEY_STORAGE);
    if (!key) { $('lfmprogress').innerHTML = '<small class="bad">Save your Last.fm API key in the API check tab first.</small>'; return; }
    const btn = $('refine') as HTMLButtonElement;
    btn.disabled = true;
    try {
      await refineWithLastfm(store, createLastfm({ apiKey: key }), (p) => {
        $('lfmprogress').innerHTML = `<small>Fetching Last.fm tags: ${p.done} / ${p.total}</small>`;
      });
      $('lfmprogress').innerHTML = '<small class="ok">Last.fm refinement complete.</small>';
    } catch (e) {
      $('lfmprogress').innerHTML = `<small class="bad">Stopped: ${esc(String(e))}. Progress is saved; tap again to resume.</small>`;
    }
    btn.disabled = false;
    await reload();
  };
  $('export').onclick = async () => {
    const blob = new Blob([JSON.stringify(await exportBackup(store))], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `genre-playlists-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    $('backupmsg').innerHTML = '<small class="ok">Backup downloaded.</small>';
  };
  $('importbtn').onclick = () => ($('importfile') as HTMLInputElement).click();
  ($('importfile') as HTMLInputElement).onchange = async (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const n = await importBackup(store, JSON.parse(await file.text()));
      $('backupmsg').innerHTML = `<small class="ok">Restored ${n.tracks} songs, ${n.artists} artists, ${n.tags} tag lookups.</small>`;
      await reload();
    } catch (err) {
      $('backupmsg').innerHTML = `<small class="bad">Could not import: ${esc(String(err))}</small>`;
    }
    input.value = '';
  };
  ($('uselfm') as HTMLInputElement).onchange = (e) => {
    prefs.useLastfm = (e.target as HTMLInputElement).checked; savePrefs(prefs); renderList();
  };
  $('import').onclick = runImport(false);
  $('full').onclick = runImport(true);
  ($('min') as HTMLInputElement).oninput = (e) => {
    prefs.minSongs = Number((e.target as HTMLInputElement).value); savePrefs(prefs); renderList();
  };
  ($('multi') as HTMLInputElement).onchange = (e) => {
    prefs.multi = (e.target as HTMLInputElement).checked; savePrefs(prefs); renderList();
  };
  void reload();
}
