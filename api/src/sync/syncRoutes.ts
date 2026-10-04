import { Router } from 'express';
import { notImplemented } from '../notImplemented.js';

export function syncRoutes(): Router {
  const router = Router();
  router.get('/pull', notImplemented('All records changed since ?since=<serverSeq>, grouped by collection'));
  router.post('/push', notImplemented('Apply a batch of outbox records (latest modifiedAt wins per record); returns assigned serverSeqs'));
  return router;
}
