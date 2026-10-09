import { randomBytes } from 'node:crypto';
import express, { Router, type Response } from 'express';
import type { AppleTokenVerifier } from './appleAuth.js';
import { APPLE_STATE_COOKIE, SESSION_COOKIE, SESSION_DAYS, parseCookies, sessionFrom, sign, verify } from './session.js';

export interface AuthConfig {
  /** Services ID registered for the website (Apple's "client_id"). */
  servicesId: string | undefined;
  /** Public origin, e.g. https://tedmarks-api-….herokuapp.com (must match Apple's return URL). */
  publicUrl: string | undefined;
  /** Apple user IDs allowed in, each optionally with the name to show: "001234.abcd=Ted". */
  allowedAppleUserIds: string[];
  sessionSecret: string | undefined;
  verifier: AppleTokenVerifier;
  /** Local development with no access key: the API is open, so the website counts as signed in. */
  openForDevelopment?: boolean;
}

interface AppleState { state: string; nonce: string; exp: number }

function setCookie(res: Response, name: string, value: string, maxAgeSec: number, sameSite: 'Lax' | 'None'): void {
  res.append('Set-Cookie', `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSec}; HttpOnly; Secure; SameSite=${sameSite}`);
}

/**
 * Sign in with Apple for the website (decision #4): Apple's page posts back an identity token,
 * which is checked against Apple's keys and the allowlist; the server then sets its own session cookie.
 */
export function authRoutes(config: AuthConfig): Router {
  const router = Router();
  const allowed = allowlist(config.allowedAppleUserIds);
  const configured = Boolean(config.servicesId && config.publicUrl && config.sessionSecret);
  const callbackUrl = `${config.publicUrl}/auth/apple/callback`;

  /** GET /auth/me — who's signed in (for the web app). */
  router.get('/me', (req, res) => {
    const session = sessionFrom(req.get('cookie'), config.sessionSecret);
    if (!session && config.openForDevelopment) {
      res.json({ signedIn: true, appleUserId: 'local-development', name: 'Ted', configured });
      return;
    }
    res.json({ signedIn: Boolean(session), appleUserId: session?.appleUserId ?? null, name: (session && allowed.get(session.appleUserId)) || null, configured });
  });

  /** GET /auth/apple/start — off to Apple's sign-in page. */
  router.get('/apple/start', (_req, res) => {
    if (!configured) {
      res.status(503).send('Sign in with Apple is not set up on the server.');
      return;
    }
    const state = randomBytes(16).toString('base64url');
    const nonce = randomBytes(16).toString('base64url');
    // Apple posts back from its own site, so this cookie must be SameSite=None to come along.
    setCookie(res, APPLE_STATE_COOKIE, sign({ state, nonce, exp: Date.now() + 10 * 60_000 } satisfies AppleState, config.sessionSecret!), 600, 'None');
    const url = new URL('https://appleid.apple.com/auth/authorize');
    url.search = new URLSearchParams({
      client_id: config.servicesId!,
      redirect_uri: callbackUrl,
      response_type: 'code id_token',
      response_mode: 'form_post',
      state,
      nonce,
    }).toString();
    res.redirect(url.toString());
  });

  /** POST /auth/apple/callback — Apple's form post with the identity token. */
  router.post('/apple/callback', express.urlencoded({ extended: false }), async (req, res) => {
    const body = req.body as { state?: string; id_token?: string; error?: string };
    const saved = verify<AppleState>(parseCookies(req.get('cookie'))[APPLE_STATE_COOKIE], config.sessionSecret ?? '');
    res.append('Set-Cookie', `${APPLE_STATE_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=None`);
    if (body.error) {
      res.redirect('/signin?error=cancelled');
      return;
    }
    if (!saved || !body.state || body.state !== saved.state || !body.id_token) {
      res.redirect('/signin?error=expired');
      return;
    }
    let appleUserId: string;
    try {
      appleUserId = await config.verifier.verify(body.id_token, config.servicesId!, saved.nonce);
    } catch (error) {
      console.error('[auth] Apple token rejected:', error instanceof Error ? error.message : error);
      res.redirect('/signin?error=invalid');
      return;
    }
    if (!allowed.has(appleUserId)) {
      console.warn('[auth] Sign-in from an Apple account not on the allowlist');
      res.redirect(`/signin?denied=${encodeURIComponent(appleUserId)}`);
      return;
    }
    const exp = Date.now() + SESSION_DAYS * 86_400_000;
    setCookie(res, SESSION_COOKIE, sign({ appleUserId, exp }, config.sessionSecret!), SESSION_DAYS * 86_400, 'Lax');
    res.redirect('/');
  });

  /** POST /auth/logout */
  router.post('/logout', (_req, res) => {
    res.append('Set-Cookie', `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
    res.json({ signedIn: false });
  });

  return router;
}

/** Apple user ID → name to show ('' when the entry has none). */
export function allowlist(entries: string[]): Map<string, string> {
  return new Map(entries.map((entry) => {
    const [id = '', name = ''] = entry.split('=').map((part) => part.trim());
    return [id, name] as const;
  }).filter(([id]) => id));
}
