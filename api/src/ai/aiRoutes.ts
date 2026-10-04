import { Router } from 'express';
import { notImplemented } from '../notImplemented.js';

export function aiRoutes(): Router {
  const router = Router();
  router.post('/menu', notImplemented('Menu page images → extracted items (images are not kept)'));
  router.post('/receipt', notImplemented('Receipt image → items, date, place hint (image is not kept)'));
  router.post('/voice', notImplemented('Transcript + visit context → proposed changes (a Draft)'));
  return router;
}
