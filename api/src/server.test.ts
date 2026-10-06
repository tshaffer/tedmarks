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
    const res = await fetch(`${base}/ai/menu`, { method: 'POST' });
    assert.equal(res.status, 501);
  });
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

test('access key protects everything except /health', async () => {
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
