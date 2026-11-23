import type { Artist, Store, Track } from './library';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('genre-playlists', 2);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('tracks')) db.createObjectStore('tracks', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('artists')) db.createObjectStore('artists', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('tags')) db.createObjectStore('tags', { keyPath: 'key' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

const done = (tx: IDBTransaction) =>
  new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
const result = <T>(r: IDBRequest<T>) =>
  new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export class IdbStore implements Store {
  private db = open();
  private async all<T>(name: string): Promise<T[]> {
    return result((await this.db).transaction(name).objectStore(name).getAll() as IDBRequest<T[]>);
  }
  private async keys(name: string): Promise<Set<string>> {
    return new Set(await result((await this.db).transaction(name).objectStore(name).getAllKeys() as IDBRequest<string[]>));
  }
  private async put(name: string, rows: unknown[]): Promise<void> {
    const tx = (await this.db).transaction(name, 'readwrite');
    rows.forEach((r) => tx.objectStore(name).put(r));
    await done(tx);
  }
  trackIds() { return this.keys('tracks'); }
  allTracks() { return this.all<Track>('tracks'); }
  putTracks(t: Track[]) { return this.put('tracks', t); }
  async deleteTracks(ids: string[]) {
    const tx = (await this.db).transaction('tracks', 'readwrite');
    ids.forEach((i) => tx.objectStore('tracks').delete(i));
    await done(tx);
  }
  artistIds() { return this.keys('artists'); }
  allArtists() { return this.all<Artist>('artists'); }
  putArtist(a: Artist) { return this.put('artists', [a]); }
  tagKeys() { return this.keys('tags'); }
  async allTags() {
    const rows = await this.all<{ key: string; tags: string[] }>('tags');
    return new Map(rows.map((r) => [r.key, r.tags]));
  }
  putTags(key: string, tags: string[]) { return this.put('tags', [{ key, tags }]); }
}
