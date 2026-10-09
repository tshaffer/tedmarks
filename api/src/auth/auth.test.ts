import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { createApp } from '../server.js';
import { AppleTokenVerifier } from './appleAuth.js';
import { allowlist } from './authRoutes.js';
import { sign, verify } from './session.js';

const SERVICES_ID = 'com.tedshaffer.tedmarks.web';

async function setup(allowed: string[]) {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test', alg: 'RS256' };
  const verifier = new AppleTokenVerifier(createLocalJWKSet({ keys: [jwk] }));
  const token = (sub: string, nonce: string, audience = SERVICES_ID) =>
    new SignJWT({ nonce }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setIssuer('https://appleid.apple.com')
      .setAudience(audience).setSubject(sub).setIssuedAt().setExpirationTime('5m').sign(privateKey);
  const server = createApp({
    accessKey: 'phone-key',
    auth: { servicesId: SERVICES_ID, publicUrl: 'https://tedmarks.example', allowedAppleUserIds: allowed, sessionSecret: 'test-secret', verifier },
    webDist: '/nonexistent',
  }).listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { server, base, token };
}

/** GET /auth/apple/start → Apple's URL (with state + nonce) and the state cookie. */
async function start(base: string) {
  const res = await fetch(`${base}/auth/apple/start`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  const location = new URL(res.headers.get('location')!);
  assert.equal(location.origin, 'https://appleid.apple.com');
  assert.equal(location.searchParams.get('redirect_uri'), 'https://tedmarks.example/auth/apple/callback');
  const cookie = res.headers.get('set-cookie')!.split(';')[0]!;
  return { state: location.searchParams.get('state')!, nonce: location.searchParams.get('nonce')!, cookie };
}

const callback = (base: string, cookie: string, form: Record<string, string>) =>
  fetch(`${base}/auth/apple/callback`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams(form).toString(),
  });

test('signed sessions verify, expire, and reject tampering', () => {
  const token = sign({ appleUserId: 'ted', exp: Date.now() + 1000 }, 's');
  assert.equal(verify<{ appleUserId: string; exp?: number }>(token, 's')?.appleUserId, 'ted');
  assert.equal(verify(token, 'other'), undefined);
  assert.equal(verify(token.replace(/.$/, 'x'), 's'), undefined);
  assert.equal(verify(sign({ exp: Date.now() - 1 }, 's'), 's'), undefined);
});

test('Sign in with Apple: allowlisted account gets a session that opens the API', async () => {
  const { server, base, token } = await setup(['ted-apple-id = Ted', 'lori-apple-id']);
  try {
    assert.equal((await fetch(`${base}/sync/pull?since=0`)).status, 401);
    const { state, nonce, cookie } = await start(base);
    const res = await callback(base, cookie, { state, id_token: await token('ted-apple-id', nonce) });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/');
    const session = res.headers.getSetCookie().find((c) => c.startsWith('tm_session='))!.split(';')[0]!;
    // Past the access check (503: no database in this test app).
    assert.equal((await fetch(`${base}/sync/pull?since=0`, { headers: { cookie: session } })).status, 503);
    const me = await (await fetch(`${base}/auth/me`, { headers: { cookie: session } })).json();
    assert.deepEqual(me, { signedIn: true, appleUserId: 'ted-apple-id', name: 'Ted', configured: true });
    // The phone's key still works.
    assert.equal((await fetch(`${base}/sync/pull?since=0`, { headers: { 'x-tedmarks-key': 'phone-key' } })).status, 503);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('Sign in with Apple: unknown accounts, wrong nonce, wrong audience and stale state are refused', async () => {
  const { server, base, token } = await setup(['ted-apple-id']);
  try {
    let s = await start(base);
    let res = await callback(base, s.cookie, { state: s.state, id_token: await token('stranger', s.nonce) });
    assert.equal(res.headers.get('location'), '/signin?denied=stranger');
    assert.ok(!res.headers.getSetCookie().some((c) => c.startsWith('tm_session=') && !c.startsWith('tm_session=;')));

    s = await start(base);
    res = await callback(base, s.cookie, { state: s.state, id_token: await token('ted-apple-id', 'other-nonce') });
    assert.equal(res.headers.get('location'), '/signin?error=invalid');

    s = await start(base);
    res = await callback(base, s.cookie, { state: s.state, id_token: await token('ted-apple-id', s.nonce, 'com.someone.else') });
    assert.equal(res.headers.get('location'), '/signin?error=invalid');

    s = await start(base);
    res = await callback(base, s.cookie, { state: 'not-the-state', id_token: await token('ted-apple-id', s.nonce) });
    assert.equal(res.headers.get('location'), '/signin?error=expired');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('allowlist entries may carry the name to show', () => {
  assert.deepEqual([...allowlist(['ted-id=Ted', ' lori-id ', '', 'x = Lori Shaffer']).entries()], [['ted-id', 'Ted'], ['lori-id', ''], ['x', 'Lori Shaffer']]);
});
