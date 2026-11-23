import { AUTH_URL, SCOPES, SPOTIFY_CLIENT_ID, TOKEN_URL, redirectUri } from './config';
import { challengeFor, randomString } from './pkce';

interface Tokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch ms
}

const TOKENS_KEY = 'sp_tokens';
const VERIFIER_KEY = 'sp_verifier';
const STATE_KEY = 'sp_state';

function load(): Tokens | null {
  try {
    const raw = localStorage.getItem(TOKENS_KEY);
    return raw ? (JSON.parse(raw) as Tokens) : null;
  } catch {
    return null;
  }
}

function save(t: Tokens): void {
  localStorage.setItem(TOKENS_KEY, JSON.stringify(t));
}

export function isLoggedIn(): boolean {
  return load() !== null;
}

export function logout(): void {
  localStorage.removeItem(TOKENS_KEY);
}

export async function startLogin(): Promise<void> {
  const verifier = randomString(96);
  const state = randomString(24);
  localStorage.setItem(VERIFIER_KEY, verifier);
  localStorage.setItem(STATE_KEY, state);
  const params = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri(),
    scope: SCOPES,
    state,
    code_challenge_method: 'S256',
    code_challenge: await challengeFor(verifier),
  });
  location.assign(`${AUTH_URL}?${params}`);
}

async function tokenRequest(body: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: SPOTIFY_CLIENT_ID, ...body }),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new Error(`Token request failed: ${JSON.stringify(json)}`);
  return json;
}

/** Call on page load. Returns true if it just completed a login redirect. */
export async function handleRedirect(): Promise<boolean> {
  const q = new URLSearchParams(location.search);
  const error = q.get('error');
  const code = q.get('code');
  if (!error && !code) return false;
  history.replaceState({}, '', redirectUri());
  if (error) throw new Error(`Spotify login error: ${error}`);
  if (q.get('state') !== localStorage.getItem(STATE_KEY)) throw new Error('Login state mismatch');
  const verifier = localStorage.getItem(VERIFIER_KEY);
  if (!verifier) throw new Error('Missing PKCE verifier');
  const j = await tokenRequest({
    grant_type: 'authorization_code',
    code: code!,
    redirect_uri: redirectUri(),
    code_verifier: verifier,
  });
  save({
    access_token: j.access_token as string,
    refresh_token: j.refresh_token as string,
    expires_at: Date.now() + (j.expires_in as number) * 1000,
  });
  localStorage.removeItem(VERIFIER_KEY);
  localStorage.removeItem(STATE_KEY);
  return true;
}

export async function getAccessToken(forceRefresh = false): Promise<string> {
  const t = load();
  if (!t) throw new Error('Not logged in');
  if (!forceRefresh && Date.now() < t.expires_at - 60_000) return t.access_token;
  const j = await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh_token });
  const next: Tokens = {
    access_token: j.access_token as string,
    refresh_token: (j.refresh_token as string | undefined) ?? t.refresh_token,
    expires_at: Date.now() + (j.expires_in as number) * 1000,
  };
  save(next);
  return next.access_token;
}
