import Anthropic from '@anthropic-ai/sdk';
import { Router } from 'express';
import { VoiceStructureRequest, type VoiceStructureResponse } from '@tedmarks/shared';
import { notImplemented } from '../notImplemented.js';
import { VoiceDeclinedError, type VoiceStructurer } from './voiceStructurer.js';

export function aiRoutes(voice: VoiceStructurer | undefined): Router {
  const router = Router();
  router.post('/menu', notImplemented('Menu page images → extracted items (images are not kept)'));
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
      if (error instanceof VoiceDeclinedError) {
        res.status(422).json({ error: 'declined', message: 'Claude couldn’t turn this note into changes.' });
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
  });
  return router;
}
