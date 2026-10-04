import type { RequestHandler } from 'express';

/** Placeholder for endpoints that are designed (docs/tedmarks-data-model.md §16) but not built yet. */
export function notImplemented(description: string): RequestHandler {
  return (_req, res) => {
    res.status(501).json({ error: 'not_implemented', description });
  };
}
