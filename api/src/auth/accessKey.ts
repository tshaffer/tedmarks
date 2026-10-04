import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';

export const ACCESS_KEY_HEADER = 'x-tedmarks-key';

/**
 * Interim protection until Sign in with Apple: every request except /health must
 * carry the shared access key. Disabled when no key is configured (local dev).
 */
export function requireAccessKey(accessKey: string | undefined): RequestHandler {
  const expected = accessKey ? Buffer.from(accessKey) : undefined;
  return (req, res, next) => {
    if (!expected || req.path === '/health') return next();
    const provided = Buffer.from(req.get(ACCESS_KEY_HEADER) ?? '');
    if (provided.length === expected.length && timingSafeEqual(provided, expected)) return next();
    res.status(401).json({ error: 'unauthorized', message: 'Missing or invalid access key.' });
  };
}
