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
    const res = await fetch(`${base}/sync/pull?since=0`);
    assert.equal(res.status, 501);
  });
});

test('every collection gets id and serverSeq indexes', () => {
  const keys = indexesFor('ratings').map((i) => JSON.stringify(i.key));
  assert.ok(keys.includes('{"id":1}'));
  assert.ok(keys.includes('{"serverSeq":1}'));
  assert.ok(keys.includes('{"subjectType":1,"subjectId":1,"scope":1,"personId":1}'));
});
