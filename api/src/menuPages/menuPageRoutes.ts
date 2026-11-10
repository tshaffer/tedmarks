import express, { Router } from 'express';
import { Id, MenuPageMediaType } from '@tedmarks/shared';
import type { MenuPageStore } from './pageStore.js';

/** A PDF menu or a full-size screenshot, at most. */
export const MAX_MENU_PAGE_BYTES = 40 * 1024 * 1024;

/**
 * Menu pictures, kept privately: PUT /menu-pages/:id (the file as the body, its type as
 * Content-Type), GET /menu-pages/:id, DELETE /menu-pages/:id. Ids are made by the app; the menu
 * record lists them. A page never changes, so it can be cached forever.
 */
export function menuPageRoutes(store: MenuPageStore | undefined): Router {
  const router = Router();
  router.use((_req, res, next) => {
    if (store) return next();
    res.status(503).json({ error: 'not_configured', message: 'Menu pictures aren’t set up on the server (MENU_IMAGES_BUCKET).' });
  });
  router.param('id', (req, res, next, id: string) => {
    if (Id.safeParse(id).success) return next();
    res.status(400).json({ error: 'bad_request', message: 'Not a page id.' });
  });

  router.put('/:id', express.raw({ type: () => true, limit: MAX_MENU_PAGE_BYTES }), async (req, res) => {
    const mediaType = MenuPageMediaType.safeParse(req.headers['content-type']?.split(';')[0]?.trim());
    if (!mediaType.success) {
      res.status(415).json({ error: 'unsupported', message: 'A menu page is a JPEG, PNG or PDF.' });
      return;
    }
    const bytes = req.body as Buffer | undefined;
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
      res.status(400).json({ error: 'bad_request', message: 'The page is empty.' });
      return;
    }
    try {
      await store!.put(req.params.id, mediaType.data, bytes);
      res.status(201).json({ id: req.params.id, bytes: bytes.length });
    } catch (error) {
      console.error('[menu-pages] put failed', error instanceof Error ? error.message : error);
      res.status(502).json({ error: 'storage_unavailable', message: 'Couldn’t save the page. Try again.' });
    }
  });

  router.get('/:id', async (req, res) => {
    try {
      const page = await store!.get(req.params.id);
      if (!page) {
        res.status(404).json({ error: 'not_found', message: 'That page isn’t on the server (yet).' });
        return;
      }
      res.setHeader('Content-Type', page.mediaType);
      res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
      if (Buffer.isBuffer(page.bytes)) {
        res.end(page.bytes);
      } else {
        if (page.size !== undefined) res.setHeader('Content-Length', String(page.size));
        page.bytes.on('error', () => res.destroy()).pipe(res);
      }
    } catch (error) {
      console.error('[menu-pages] get failed', error instanceof Error ? error.message : error);
      res.status(502).json({ error: 'storage_unavailable', message: 'Couldn’t fetch the page.' });
    }
  });

  router.delete('/:id', async (req, res) => {
    try {
      await store!.delete(req.params.id);
      res.json({ deleted: req.params.id });
    } catch (error) {
      console.error('[menu-pages] delete failed', error instanceof Error ? error.message : error);
      res.status(502).json({ error: 'storage_unavailable', message: 'Couldn’t delete the page.' });
    }
  });
  return router;
}
