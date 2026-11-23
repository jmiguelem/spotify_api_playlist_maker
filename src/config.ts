// Public OAuth client id (PKCE flow: no client secret is used or stored anywhere).
export const SPOTIFY_CLIENT_ID = 'f95c898e68da40758056732bce9ef0ed';

// Least privilege: read liked songs, read/modify the user's own playlists.
export const SCOPES = [
  'user-library-read',
  'playlist-read-private',
  'playlist-modify-public',
  'playlist-modify-private',
].join(' ');

export const API_BASE = 'https://api.spotify.com/v1';
export const AUTH_URL = 'https://accounts.spotify.com/authorize';
export const TOKEN_URL = 'https://accounts.spotify.com/api/token';

// Marker written into the description of every playlist this app creates.
export const PLAYLIST_MARKER = '[auto:genre-sync]';

/** Must exactly match a Redirect URI registered in the Spotify dashboard. */
export function redirectUri(): string {
  return location.origin + import.meta.env.BASE_URL;
}
