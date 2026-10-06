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
