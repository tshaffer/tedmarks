import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { sessionFrom } from './session.js';

export const ACCESS_KEY_HEADER = 'x-tedmarks-key';

/**
 * Protects the API: a request needs either the iPhone app's shared access key (X-Tedmarks-Key)
 * or the website's Sign in with Apple session cookie. Disabled when no key is configured (local dev).
 */
export function requireAccess(accessKey: string | undefined, sessionSecret?: string): RequestHandler {
  const expected = accessKey ? Buffer.from(accessKey) : undefined;
  return (req, res, next) => {
    if (!expected) return next();
    const provided = Buffer.from(req.get(ACCESS_KEY_HEADER) ?? '');
    if (provided.length === expected.length && timingSafeEqual(provided, expected)) return next();
    if (sessionFrom(req.get('cookie'), sessionSecret)) return next();
    res.status(401).json({ error: 'unauthorized', message: 'Sign in, or send the access key.' });
  };
}
