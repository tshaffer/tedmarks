import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server.js';
import { MemoryMenuPageStore } from './pageStore.js';

test('menu pages are stored, served with a long cache, and deleted', async () => {
  const store = new MemoryMenuPageStore();
  const server = createApp({ menuPages: store }).listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/menu-pages`;
  const id = '0b5c2a4e-6a1f-4c55-9d8e-2f3a4b5c6d7e';
  try {
    assert.equal((await fetch(`${base}/not-an-id`)).status, 400);
    assert.equal((await fetch(`${base}/${id}`, { method: 'PUT', headers: { 'content-type': 'text/plain' }, body: 'hi' })).status, 415);
    const put = await fetch(`${base}/${id}`, { method: 'PUT', headers: { 'content-type': 'image/png' }, body: new Uint8Array([1, 2, 3]) });
    assert.equal(put.status, 201);
    const got = await fetch(`${base}/${id}`);
    assert.equal(got.status, 200);
    assert.equal(got.headers.get('content-type'), 'image/png');
    assert.match(got.headers.get('cache-control') ?? '', /immutable/);
    assert.deepEqual([...new Uint8Array(await got.arrayBuffer())], [1, 2, 3]);
    assert.equal((await fetch(`${base}/${id}`, { method: 'DELETE' })).status, 200);
    assert.equal((await fetch(`${base}/${id}`)).status, 404);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('menu pages report when storage is not set up', async () => {
  const server = createApp({}).listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  try {
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/menu-pages/0b5c2a4e-6a1f-4c55-9d8e-2f3a4b5c6d7e`);
    assert.equal(res.status, 503);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
