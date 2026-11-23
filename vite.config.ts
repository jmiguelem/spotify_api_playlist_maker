import { defineConfig } from 'vite';

// Served from https://<user>.github.io/spotify_api_playlist_maker/
export default defineConfig({
  base: '/spotify_api_playlist_maker/',
  test: { environment: 'node' },
});
