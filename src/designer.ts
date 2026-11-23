import { LASTFM_KEY_STORAGE, PLAYLIST_PREFIX } from './config';
import { IdbStore } from './idb';
import { buildCandidates, type Candidate, type Mode, type Options } from './genres';
import { createLastfm, refineWithLastfm } from './lastfm';
import { importLibrary, type Progress, type Store } from './library';
import type { SpotifyClient } from './spotify';
import { applyPlan, buildPlan, removeOrphans, type Desired, type Plan } from './sync';

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
    <div id="list"></div>
    <h2>Create on Spotify</h2>
    <small>Creates private playlists named "${esc(PLAYLIST_PREFIX)}…" for the ticked ones above. Only playlists made by this app are ever changed, never yours. Nothing is written until you tap Apply.</small>
    <div><button id="preview">Preview changes</button></div>
    <div id="plan"></div>`;
  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>('#' + id)!;

  let tracks: Awaited<ReturnType<Store['allTracks']>> = [];
  let artists: Awaited<ReturnType<Store['allArtists']>> = [];
  let trackTags = new Map<string, string[]>();
  let lastCands: Candidate[] = [];
  let plan: Plan | null = null;

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
    lastCands = cands;
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
  ($('uselfm') as HTMLInputElement).onchange = (e) => {
    prefs.useLastfm = (e.target as HTMLInputElement).checked; savePrefs(prefs); renderList();
  };
  function desired(): Desired[] {
    const on = lastCands.filter(isOn);
    const byId = new Map(tracks.map((t) => [t.id, t]));
    const count = new Map<string, number>();
    on.forEach((c) => count.set(c.name, (count.get(c.name) ?? 0) + 1));
    return on.map((c) => ({
      key: c.key,
      name: PLAYLIST_PREFIX + ((count.get(c.name) ?? 0) > 1 ? `${c.name} (${c.kind})` : c.name),
      uris: c.trackIds.map((id) => byId.get(id)!).sort((a, b) => a.addedAt.localeCompare(b.addedAt)).map((t) => `spotify:track:${t.id}`),
    }));
  }

  function showPlan(p: Plan): void {
    const rows = p.items.map((i) => {
      const what = i.action === 'create' ? `create · ${i.add.length} songs`
        : i.action === 'skip' ? `skipped: ${esc(i.reason ?? '')}`
        : `${i.adopted ? 're-link · ' : ''}+${i.add.length} / −${i.remove.length}${i.add.length + i.remove.length === 0 ? ' (up to date)' : ''}`;
      return `<div class="row"><b>${esc(i.name)}</b><br><small>${what}</small></div>`;
    }).join('');
    const orphans = p.orphans.length
      ? `<h2>No longer selected</h2><small>${p.orphans.map((o) => esc(o.name)).join(', ')}</small>
         <label class="inline"><input id="delorphans" type="checkbox"> Also delete these ${p.orphans.length} generated playlists from Spotify</label>` : '';
    const changes = p.items.filter((i) => i.action !== 'skip' && (i.action === 'create' || i.add.length + i.remove.length > 0 || i.adopted)).length;
    $('plan').innerHTML = `${rows}${orphans}
      <p class="summary">${changes} playlist(s) will change.</p>
      <button id="apply" ${changes === 0 && !p.orphans.length ? 'disabled' : ''}>Apply to Spotify</button>
      <div id="applystatus"></div>`;
    $('apply').onclick = async () => {
      const btn = $('apply') as HTMLButtonElement; btn.disabled = true;
      const st = $('applystatus');
      try {
        const meId = (await api.get<{ id: string }>('/me')).id;
        const stats = await applyPlan(api, store, p, (pr) => { st.innerHTML = `<small>Working: ${pr.done} / ${pr.total} ${esc(pr.current)}</small>`; });
        let extra = '';
        if (p.orphans.length && (root.querySelector('#delorphans') as HTMLInputElement | null)?.checked) {
          extra = '<br><small>' + (await removeOrphans(api, store, p.orphans, meId)).map(esc).join('<br>') + '</small>';
        }
        st.innerHTML = `<p class="ok">Done: ${stats.created} created, ${stats.updated} updated, ${stats.skipped} skipped.</p>${extra}`;
        plan = null;
      } catch (e) {
        st.innerHTML = `<p class="bad">Stopped: ${esc(String(e))}. Tap Preview changes, then Apply, to continue; finished playlists will show as up to date.</p>`;
        btn.disabled = false;
      }
    };
  }

  $('preview').onclick = async () => {
    const want = desired();
    if (want.length === 0) { $('plan').innerHTML = '<p class="bad">Tick at least one playlist above.</p>'; return; }
    const btn = $('preview') as HTMLButtonElement; btn.disabled = true;
    $('plan').innerHTML = '<small>Checking your Spotify playlists…</small>';
    try {
      const meId = (await api.get<{ id: string }>('/me')).id;
      plan = await buildPlan(api, store, want, meId);
      showPlan(plan);
    } catch (e) {
      $('plan').innerHTML = `<p class="bad">${esc(String(e))}</p>`;
    }
    btn.disabled = false;
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
