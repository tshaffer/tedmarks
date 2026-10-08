import type { AreaSearchRequest, AreaSearchResponse, MenuReadItem, MenuReadJob, NearbyPlace } from '@tedmarks/shared';

/** Calls the Tedmarks API on the same origin; the session cookie comes along. */
export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    throw new ApiError(response.status, body.message ?? `Request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

export interface Me { signedIn: boolean; appleUserId: string | null; configured: boolean }
export const getMe = () => api<Me>('/auth/me');
export const signOut = () => api<Me>('/auth/logout', { method: 'POST' });

interface PushResult { accepted: { id: string }[]; rejected: { collection: string; id: string; reason: string }[] }

/** Saves records through sync (the same path the phone uses), so changes reach the phones too. */
export async function pushChanges(changes: Record<string, unknown[] | undefined>): Promise<void> {
  const result = await api<PushResult>('/sync/push', { method: 'POST', body: JSON.stringify({ changes }) });
  if (result.rejected.length > 0) {
    throw new ApiError(422, `The server refused ${result.rejected.length} change(s): ${result.rejected[0]!.reason}`);
  }
}

/** A Google restaurant's name, address and location (distance measured from `origin`). */
export async function placeDetails(googlePlaceId: string, origin: google.maps.LatLngLiteral): Promise<NearbyPlace> {
  const { place } = await api<{ place: NearbyPlace }>(`/places/details/${encodeURIComponent(googlePlaceId)}?lat=${origin.lat}&lng=${origin.lng}`);
  return place;
}

/** Asks the server to fetch a place's hours and details from Google (fire and forget). */
export function refreshPlace(placeId: string): void {
  void api(`/places/${placeId}/refresh`, { method: 'POST' }).catch(() => {});
}

export interface MenuPage { mediaType: string; data: string }

/**
 * Has Claude read a menu: starts the reading, then checks every few seconds until it's done
 * (a long PDF can take longer than one request may run on Heroku).
 */
export async function readMenu(placeName: string, pages: MenuPage[]): Promise<MenuReadItem[]> {
  const { jobId } = await api<{ jobId: string }>('/ai/menu/jobs', { method: 'POST', body: JSON.stringify({ placeName, pages }) });
  const deadline = Date.now() + 6 * 60_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const job = await api<MenuReadJob>(`/ai/menu/jobs/${jobId}`);
    if (job.status === 'done') return job.items;
    if (job.status === 'failed') throw new ApiError(502, job.message);
  }
  throw new ApiError(504, 'Reading the menu is taking too long. Try fewer pages.');
}

/** Google's restaurants inside a map area, through Google's own filters (cached on the server). */
export function areaSearch(request: AreaSearchRequest): Promise<AreaSearchResponse> {
  return api<AreaSearchResponse>('/places/area-search', { method: 'POST', body: JSON.stringify(request) });
}
