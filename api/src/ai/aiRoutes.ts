import Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'node:crypto';
import { Router, type Response } from 'express';
import { MenuReadRequest, VoiceStructureRequest, type MenuReadJob, type MenuReadResponse, type VoiceStructureResponse } from '@tedmarks/shared';
import { MenuDeclinedError, type MenuReader } from './menuReader.js';
import { notImplemented } from '../notImplemented.js';
import { VoiceDeclinedError, type VoiceStructurer } from './voiceStructurer.js';

/** How long a finished menu read waits to be collected. */
const JOB_TTL_MS = 15 * 60_000;

export function aiRoutes(voice: VoiceStructurer | undefined, menu: MenuReader | undefined): Router {
  const router = Router();
  // Menu reads in progress or waiting to be collected (one dyno, so memory is enough).
  const jobs = new Map<string, MenuReadJob>();

  /** POST /ai/menu — menu page photos → dishes with sections and prices (images are not kept). */
  router.post('/menu', async (req, res) => {
    if (!menu) {
      res.status(503).json({ error: 'ai_not_configured', message: 'ANTHROPIC_API_KEY is not set on the server.' });
      return;
    }
    const parsed = MenuReadRequest.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'bad_request', message: parsed.error.issues[0]?.message ?? 'Invalid request' });
      return;
    }
    try {
      const body: MenuReadResponse = { items: await menu.read(parsed.data) };
      res.json(body);
    } catch (error) {
      sendAiError(res, error, error instanceof MenuDeclinedError ? 'Claude couldn’t read this menu.' : undefined);
    }
  });

  /**
   * POST /ai/menu/jobs — starts reading a menu and answers at once with { jobId }; GET
   * /ai/menu/jobs/:id until it's done. For long menus (a PDF), which can take longer than
   * Heroku lets one request run (30 s).
   */
  router.post('/menu/jobs', (req, res) => {
    if (!menu) {
      res.status(503).json({ error: 'ai_not_configured', message: 'ANTHROPIC_API_KEY is not set on the server.' });
      return;
    }
    const parsed = MenuReadRequest.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'bad_request', message: parsed.error.issues[0]?.message ?? 'Invalid request' });
      return;
    }
    const jobId = randomUUID();
    jobs.set(jobId, { status: 'reading' });
    menu.read(parsed.data)
      .then((items) => jobs.set(jobId, { status: 'done', items }))
      .catch((error: unknown) => {
        const { body } = aiError(error, error instanceof MenuDeclinedError ? 'Claude couldn’t read this menu.' : undefined);
        jobs.set(jobId, { status: 'failed', ...body });
      })
      .finally(() => setTimeout(() => jobs.delete(jobId), JOB_TTL_MS).unref());
    res.status(202).json({ jobId });
  });

  router.get('/menu/jobs/:id', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) {
      res.status(404).json({ error: 'not_found', message: 'That menu reading has expired. Try again.' });
      return;
    }
    res.json(job);
  });

  router.post('/receipt', notImplemented('Receipt image → items, date, place hint (image is not kept)'));

  /** POST /ai/voice — transcript + visit context → proposed changes (the phone makes the Draft). */
  router.post('/voice', async (req, res) => {
    if (!voice) {
      res.status(503).json({ error: 'ai_not_configured', message: 'ANTHROPIC_API_KEY is not set on the server.' });
      return;
    }
    const parsed = VoiceStructureRequest.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'bad_request', message: parsed.error.issues[0]?.message ?? 'Invalid request' });
      return;
    }
    try {
      const body: VoiceStructureResponse = { changes: await voice.structure(parsed.data) };
      res.json(body);
    } catch (error) {
      sendAiError(res, error, error instanceof VoiceDeclinedError ? 'Claude couldn’t turn this note into changes.' : undefined);
    }
  });
  return router;
}

/** Maps a Claude failure to a status and body; `declined` is the message when Claude declined. */
function aiError(error: unknown, declined: string | undefined): { status: number; body: { error: string; message: string } } {
  if (declined) return { status: 422, body: { error: 'declined', message: declined } };
  if (error instanceof Anthropic.RateLimitError) return { status: 503, body: { error: 'busy', message: 'Claude is busy. Try again in a minute.' } };
  if (error instanceof Anthropic.AuthenticationError) {
    console.error('[ai] Anthropic rejected the API key');
    return { status: 503, body: { error: 'ai_not_configured', message: 'The server’s Claude key isn’t working.' } };
  }
  console.error('[ai]', error instanceof Error ? error.message : error);
  return { status: 502, body: { error: 'ai_unavailable', message: 'Couldn’t reach Claude. Try again later.' } };
}

function sendAiError(res: Response, error: unknown, declined: string | undefined): void {
  const { status, body } = aiError(error, declined);
  res.status(status).json(body);
}
