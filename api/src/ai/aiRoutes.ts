import Anthropic from '@anthropic-ai/sdk';
import { Router, type Response } from 'express';
import { MenuReadRequest, VoiceStructureRequest, type MenuReadResponse, type VoiceStructureResponse } from '@tedmarks/shared';
import { MenuDeclinedError, type MenuReader } from './menuReader.js';
import { notImplemented } from '../notImplemented.js';
import { VoiceDeclinedError, type VoiceStructurer } from './voiceStructurer.js';

export function aiRoutes(voice: VoiceStructurer | undefined, menu: MenuReader | undefined): Router {
  const router = Router();

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

/** Maps a Claude failure to a response; `declined` is the message when Claude declined. */
function sendAiError(res: Response, error: unknown, declined: string | undefined): void {
  if (declined) {
    res.status(422).json({ error: 'declined', message: declined });
  } else if (error instanceof Anthropic.RateLimitError) {
    res.status(503).json({ error: 'busy', message: 'Claude is busy. Try again in a minute.' });
  } else if (error instanceof Anthropic.AuthenticationError) {
    console.error('[ai] Anthropic rejected the API key');
    res.status(503).json({ error: 'ai_not_configured', message: 'The server’s Claude key isn’t working.' });
  } else {
    console.error('[ai]', error instanceof Error ? error.message : error);
    res.status(502).json({ error: 'ai_unavailable', message: 'Couldn’t reach Claude. Try again later.' });
  }
}
