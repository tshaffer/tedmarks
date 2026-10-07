import type { Menu, Note, Person, Place, PlaceItem, PlaceSubtype, Rating, Visit, VisitItem } from '@tedmarks/shared';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '../api.js';

/** Everything the website shows, as live (not deleted) records by id. */
export interface TedmarksRecords {
  places: Map<string, Place>;
  visits: Map<string, Visit>;
  visitItems: Map<string, VisitItem>;
  placeItems: Map<string, PlaceItem>;
  ratings: Map<string, Rating>;
  notes: Map<string, Note>;
  people: Map<string, Person>;
  menus: Map<string, Menu>;
  placeSubtypes: Map<string, PlaceSubtype>;
}

const COLLECTIONS = ['places', 'visits', 'visitItems', 'placeItems', 'ratings', 'notes', 'people', 'menus', 'placeSubtypes'] as const;

interface PullPage { changes: Record<string, { id: string; deletedAt?: string }[]>; serverSeq: number; hasMore: boolean }

/** Reads every record through the same sync endpoint the phone uses (a few thousand small records). */
async function loadAll(): Promise<TedmarksRecords> {
  const byCollection = new Map<string, Map<string, { id: string; deletedAt?: string }>>();
  let since = 0;
  for (;;) {
    const page = await api<PullPage>(`/sync/pull?since=${since}&limit=1000`);
    for (const [collection, records] of Object.entries(page.changes)) {
      const map = byCollection.get(collection) ?? new Map();
      for (const record of records) map.set(record.id, record);   // later pages win
      byCollection.set(collection, map);
    }
    since = page.serverSeq;
    if (!page.hasMore) break;
  }
  const live = (name: string) => new Map([...(byCollection.get(name) ?? new Map()).entries()].filter(([, r]) => !r.deletedAt));
  return Object.fromEntries(COLLECTIONS.map((name) => [name, live(name)])) as unknown as TedmarksRecords;
}

interface DataState { data: TedmarksRecords | null; error: string | null; reload: () => Promise<void> }

const DataContext = createContext<DataState>({ data: null, error: null, reload: async () => {} });

export function TedmarksDataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<TedmarksRecords | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setData(await loadAll());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t load your places.');
    }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  return <DataContext.Provider value={{ data, error, reload }}>{children}</DataContext.Provider>;
}

export const useTedmarksData = () => useContext(DataContext);
