import { Router } from 'express';
import { notImplemented } from '../notImplemented.js';

export function authRoutes(): Router {
  const router = Router();
  router.post('/apple', notImplemented('Exchange a Sign in with Apple identity token for a session token (allowlisted users only)'));
  return router;
}
