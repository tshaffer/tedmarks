import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createApp } from './server.js';
import { indexesFor } from './db/indexes.js';

async function withServer(fn: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('GET /health reports ok without a database', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, service: 'tedmarks-api', db: 'not configured' });
  });
});

test('designed-but-unbuilt endpoints return 501', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/ai/receipt`, { method: 'POST' });
    assert.equal(res.status, 501);
  });
});

test('voice notes: not configured without a key; validated; structured by the injected Claude', async () => {
  const request = {
    transcript: 'The burrata was amazing, Lori thought the pizza was soggy. Definitely coming back.',
    placeName: 'Doppio Zero',
    participants: [{ id: 'ted', name: 'Ted' }, { id: 'lori', name: 'Lori' }],
    dishes: [{ id: 'vi-1', name: 'Burrata' }],
    orderedBefore: [],
  };
  await withServer(async (base) => {
    const res = await fetch(`${base}/ai/voice`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) });
    assert.equal(res.status, 503);
  });
  const voice = {
    structure: async () => [
      { kind: 'itemRating' as const, dishId: 'vi-1', dishName: 'Burrata', personId: null, value: 'loved', text: null, evidence: 'burrata was amazing' },
    ],
  };
  const server = createApp({ voice }).listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const bad = await fetch(`${base}/ai/voice`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...request, transcript: '' }) });
    assert.equal(bad.status, 400);
    const ok = await fetch(`${base}/ai/voice`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) });
    assert.equal(ok.status, 200);
    assert.equal(((await ok.json()) as { changes: unknown[] }).changes.length, 1);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('sync reports not configured without a database', async () => {
  await withServer(async (base) => {
    assert.equal((await fetch(`${base}/sync/pull?since=0`)).status, 503);
    const push = await fetch(`${base}/sync/push`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ changes: {} }),
    });
    assert.equal(push.status, 503);
  });
});

test('places endpoints report not configured without a key', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/places/nearby?lat=37.39&lng=-122.08`);
    assert.equal(res.status, 503);
  });
});

test('nearby rejects an out-of-range radius', async () => {
  const fakePlaces = { nearby: async () => [], search: async () => [] } as unknown as import('./google/placesClient.js').PlacesClient;
  const server = createApp({ places: fakePlaces }).listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const { port } = server.address() as AddressInfo;
  try {
    const bad = await fetch(`http://127.0.0.1:${port}/places/nearby?lat=37.39&lng=-122.08&radius=10`);
    assert.equal(bad.status, 400);
    const ok = await fetch(`http://127.0.0.1:${port}/places/nearby?lat=37.39&lng=-122.08&radius=8047`);
    assert.equal(ok.status, 200);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('access key or a signed-in session protects the API; /health and /auth are public', async () => {
  const server = createApp({ accessKey: 'secret-key' }).listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    assert.equal((await fetch(`${base}/places/nearby?lat=1&lng=1`)).status, 401);
    assert.equal((await fetch(`${base}/places/nearby?lat=1&lng=1`, { headers: { 'X-Tedmarks-Key': 'wrong' } })).status, 401);
    // Right key gets past the check (503: Places isn't configured in this test app).
    assert.equal((await fetch(`${base}/places/nearby?lat=1&lng=1`, { headers: { 'X-Tedmarks-Key': 'secret-key' } })).status, 503);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('every collection gets id and serverSeq indexes', () => {
  const keys = indexesFor('ratings').map((i) => JSON.stringify(i.key));
  assert.ok(keys.includes('{"id":1}'));
  assert.ok(keys.includes('{"serverSeq":1}'));
  assert.ok(keys.includes('{"subjectType":1,"subjectId":1,"scope":1,"personId":1}'));
});

test('website pages named like API prefixes get the app; API paths under them still reach the API', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const webDist = mkdtempSync(join(tmpdir(), 'tedmarks-web-'));
  writeFileSync(join(webDist, 'index.html'), '<!doctype html><title>Tedmarks</title>');
  const server = createApp({ webDist }).listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    for (const page of ['/places', '/visits', '/help', '/place/abc']) {
      const res = await fetch(`${base}${page}`);
      assert.equal(res.status, 200, page);
      assert.match(await res.text(), /Tedmarks/, page);
    }
    const api = await fetch(`${base}/places/nearby?lat=1&lng=2`);
    assert.notEqual(api.headers.get('content-type')?.includes('text/html'), true);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('help questions: not configured without a key; validated; answered by the injected Claude', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/ai/help`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: 'How do I merge dishes?' }) });
    assert.equal(res.status, 503);
  });
  let asked: unknown;
  const help = { answer: async (request: unknown) => { asked = request; return { answer: 'Use **Merge dishes…**.', topics: ['merge-dishes'] }; } };
  const server = createApp({ help }).listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const post = (body: unknown) => fetch(`${base}/ai/help`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await post({ question: '  ' })).status, 400);
    const ok = await post({ question: 'How do I merge dishes?' });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { answer: 'Use **Merge dishes…**.', topics: ['merge-dishes'] });
    assert.deepEqual(asked, { question: 'How do I merge dishes?', history: [] });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
