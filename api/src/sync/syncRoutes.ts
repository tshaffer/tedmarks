import { Router, type Response } from 'express';
import { SyncPushRequest } from '@tedmarks/shared';
import type { SyncStore } from './syncStore.js';

const DEFAULT_PULL_LIMIT = 500;
const MAX_PULL_LIMIT = 1000;

function sendError(res: Response, error: unknown): void {
  console.error('[sync]', error instanceof Error ? error.message : error);
  res.status(500).json({ error: 'sync_failed', message: 'The server could not complete the sync.' });
}

export function syncRoutes(store: SyncStore | undefined): Router {
  const router = Router();

  router.use((_req, res, next) => {
    if (store) return next();
    res.status(503).json({ error: 'db_not_configured', message: 'MONGODB_URI is not set on the server.' });
  });

  /** GET /sync/pull?since=<serverSeq>&limit=<n> — records changed after `since`, oldest first. */
  router.get('/pull', async (req, res) => {
    const since = Number(req.query['since'] ?? 0);
    const limit = Number(req.query['limit'] ?? DEFAULT_PULL_LIMIT);
    if (!Number.isInteger(since) || since < 0 || !Number.isInteger(limit) || limit < 1 || limit > MAX_PULL_LIMIT) {
      res.status(400).json({ error: 'bad_request', message: `since must be ≥ 0; limit 1–${MAX_PULL_LIMIT}` });
      return;
    }
    try {
      res.json(await store!.pull(since, limit));
    } catch (error) {
      sendError(res, error);
    }
  });

  /** POST /sync/push — records from the phone's outbox; latest modifiedAt wins per record. */
  router.post('/push', async (req, res) => {
    const parsed = SyncPushRequest.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'bad_request', message: parsed.error.issues[0]?.message ?? 'Invalid push' });
      return;
    }
    try {
      res.json(await store!.push(parsed.data));
    } catch (error) {
      sendError(res, error);
    }
  });

  return router;
}
