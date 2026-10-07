import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server.js';
import { cleanMenuItems } from './menuReader.js';

test('cleanMenuItems trims, drops blanks and repeats, keeps menu order', () => {
  const items = cleanMenuItems([
    { section: ' Pizza ', name: ' Margherita ', price: ' 18 ' },
    { section: 'Pizza', name: 'margherita', price: '18' },
    { section: 'Dessert', name: 'Margherita', price: null },
    { section: null, name: '   ', price: '4' },
    { section: '', name: 'Tiramisu', price: '' },
  ]);
  assert.deepEqual(items, [
    { section: 'Pizza', name: 'Margherita', price: '18' },
    { section: 'Dessert', name: 'Margherita', price: null },
    { section: null, name: 'Tiramisu', price: null },
  ]);
});

test('POST /ai/menu validates pages and returns what the reader found', async () => {
  const menu = { read: async () => [{ section: 'Pizza', name: 'Margherita', price: '18' }] };
  const server = createApp({ menu }).listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (body: unknown) =>
    fetch(`${base}/ai/menu`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    assert.equal((await post({ placeName: 'Doppio Zero', pages: [] })).status, 400);
    const ok = await post({ placeName: 'Doppio Zero', pages: [{ mediaType: 'image/jpeg', data: 'aGVsbG8=' }] });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { items: [{ section: 'Pizza', name: 'Margherita', price: '18' }] });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('POST /ai/menu/jobs reads in the background; GET returns the result (PDFs accepted)', async () => {
  let finish: (items: { section: string | null; name: string; price: string | null }[]) => void = () => {};
  const menu = { read: () => new Promise<{ section: string | null; name: string; price: string | null }[]>((resolve) => { finish = resolve; }) };
  const server = createApp({ menu }).listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const started = await fetch(`${base}/ai/menu/jobs`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ placeName: 'Doppio Zero', pages: [{ mediaType: 'application/pdf', data: 'JVBERi0=' }] }),
    });
    assert.equal(started.status, 202);
    const { jobId } = (await started.json()) as { jobId: string };
    assert.deepEqual(await (await fetch(`${base}/ai/menu/jobs/${jobId}`)).json(), { status: 'reading' });
    finish([{ section: null, name: 'Tiramisu', price: '9' }]);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(await (await fetch(`${base}/ai/menu/jobs/${jobId}`)).json(), { status: 'done', items: [{ section: null, name: 'Tiramisu', price: '9' }] });
    assert.equal((await fetch(`${base}/ai/menu/jobs/nope`)).status, 404);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
