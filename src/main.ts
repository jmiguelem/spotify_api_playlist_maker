import { getAccessToken, handleRedirect, isLoggedIn, logout, startLogin } from './auth';
import { runReadChecks, runWriteCheck, type CheckResult } from './check';
import { LASTFM_KEY_STORAGE, redirectUri } from './config';
import { renderDesigner } from './designer';
import { createClient } from './spotify';

const app = document.getElementById('app')!;
const api = createClient({ getToken: getAccessToken });
const LASTFM_KEY = LASTFM_KEY_STORAGE;

const style = document.createElement('style');
style.textContent = `
  :root { color-scheme: dark; }
  body { margin:0; background:#121212; color:#eee; font:16px/1.4 system-ui,sans-serif; }
  main { max-width:560px; margin:0 auto; padding:16px; }
  h1 { font-size:1.3rem; } h2 { font-size:1rem; margin-top:1.5rem; color:#aaa; }
  button { background:#1db954; color:#000; border:0; border-radius:999px; padding:12px 20px; font-size:1rem; font-weight:600; margin:4px 8px 4px 0; }
  button.secondary { background:#333; color:#eee; }
  input { width:100%; box-sizing:border-box; padding:10px; border-radius:8px; border:1px solid #444; background:#1e1e1e; color:#eee; }
  .row { padding:8px 0; border-bottom:1px solid #2a2a2a; } .ok { color:#1db954; } .bad { color:#ff6b6b; }
  small { color:#999; word-break:break-word; }
  .inline { display:block; margin:12px 0; } .inline input { width:auto; margin-right:8px; }
  .summary { margin:12px 0; color:#1db954; font-weight:600; }
  .cand { padding:8px 0; border-bottom:1px solid #2a2a2a; } .cand summary { display:flex; align-items:center; gap:10px; cursor:pointer; list-style:none; }
  .cand input { width:auto; } .cand .name { flex:1; } .cand .count { font-variant-numeric:tabular-nums; color:#aaa; }
  .tag { font-size:.7rem; color:#888; border:1px solid #444; border-radius:999px; padding:1px 8px; }
  .tabs { display:flex; gap:8px; margin-bottom:8px; } nav button { flex:1; }
`;
document.head.append(style);

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function renderResults(el: HTMLElement, results: CheckResult[]): void {
  el.innerHTML = results
    .map((r) => `<div class="row"><span class="${r.ok ? 'ok' : 'bad'}">${r.ok ? '✔' : '✖'}</span> ${esc(r.name)}<br><small>${esc(r.detail)}</small></div>`)
    .join('');
}

function renderLogin(msg = ''): void {
  app.innerHTML = `<main><h1>Genre Playlists</h1>${msg ? `<p class="bad">${esc(msg)}</p>` : ''}
    <button id="login">Log in with Spotify</button>
    <p><small>Redirect URI to register in the Spotify dashboard:<br>${esc(redirectUri())}</small></p></main>`;
  document.getElementById('login')!.onclick = () => void startLogin();
}

function renderHome(tab: 'design' | 'check' = 'design'): void {
  if (tab === 'design') {
    app.innerHTML = `<main><h1>Genre Playlists</h1><nav class="tabs"><button>Playlists</button><button class="secondary" id="totab">API check</button></nav><div id="view"></div></main>`;
    document.getElementById('totab')!.onclick = () => renderHome('check');
    renderDesigner(document.getElementById('view')!, api);
    return;
  }
  app.innerHTML = `<main><h1>Genre Playlists</h1><nav class="tabs"><button class="secondary" id="totab">Playlists</button><button>API check</button></nav>
    <h2>Settings</h2>
    <label>Last.fm API key (stays on this device)</label>
    <input id="lfm" type="password" autocomplete="off" value="${esc(localStorage.getItem(LASTFM_KEY) ?? '')}">
    <h2>API check</h2>
    <button id="read">Run read-only check</button>
    <button id="write" class="secondary">Run write check</button>
    <p><small>The write check creates one private test playlist and deletes it right away.</small></p>
    <div id="results"></div>
    <h2>Account</h2><button id="logout" class="secondary">Log out</button></main>`;
  document.getElementById('totab')!.onclick = () => renderHome('design');
  const results = document.getElementById('results')!;
  const lfm = document.getElementById('lfm') as HTMLInputElement;
  lfm.onchange = () => localStorage.setItem(LASTFM_KEY, lfm.value.trim());
  const run = (fn: () => Promise<CheckResult[]>) => async () => {
    results.textContent = 'Running…';
    try { renderResults(results, await fn()); } catch (e) { results.textContent = String(e); }
  };
  document.getElementById('read')!.onclick = run(() => runReadChecks(api, localStorage.getItem(LASTFM_KEY) || null));
  document.getElementById('write')!.onclick = run(() => runWriteCheck(api));
  document.getElementById('logout')!.onclick = () => { logout(); renderLogin(); };
}

async function boot(): Promise<void> {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
  }
  try {
    await handleRedirect();
  } catch (e) {
    return renderLogin(String(e));
  }
  if (isLoggedIn()) renderHome(); else renderLogin();
}

void boot();
