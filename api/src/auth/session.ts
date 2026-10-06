import { createHmac, timingSafeEqual } from 'node:crypto';

// Signed cookies: base64url(JSON payload) + "." + HMAC-SHA256. The server's own session after
// Sign in with Apple, and the short-lived state/nonce for the Apple round trip.

export const SESSION_COOKIE = 'tm_session';
export const APPLE_STATE_COOKIE = 'tm_apple';
export const SESSION_DAYS = 90;

export interface Session {
  /** Apple's stable user id ("sub"). */
  appleUserId: string;
  /** Expires (ms since epoch). */
  exp: number;
}

export function sign(payload: object, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

/** The payload if the signature is good and it hasn't expired (`exp`, when present). */
export function verify<T extends { exp?: number }>(token: string | undefined, secret: string, now = Date.now()): T | undefined {
  if (!token) return undefined;
  const [body, mac] = token.split('.');
  if (!body || !mac) return undefined;
  const expected = Buffer.from(createHmac('sha256', secret).update(body).digest('base64url'));
  const given = Buffer.from(mac);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as T;
    if (payload.exp !== undefined && payload.exp < now) return undefined;
    return payload;
  } catch {
    return undefined;
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0) cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

export function sessionFrom(cookieHeader: string | undefined, secret: string | undefined): Session | undefined {
  if (!secret) return undefined;
  return verify<Session>(parseCookies(cookieHeader)[SESSION_COOKIE], secret);
}
