import { Router } from 'express';
import { notImplemented } from '../notImplemented.js';

export function placesRoutes(): Router {
  const router = Router();
  router.get('/nearby', notImplemented('Google Nearby Search proxy for Start visit (?lat&lng)'));
  router.get('/search', notImplemented('Google text search proxy for "Somewhere else…" (?q&lat&lng)'));
  router.post('/:id/refresh', notImplemented('Re-fetch the Google snapshot for a place'));
  return router;
}
