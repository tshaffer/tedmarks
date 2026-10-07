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
