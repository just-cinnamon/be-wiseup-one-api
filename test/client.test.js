import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCache } from '../src/services/cache.js';
import { createPornhubClient } from '../src/services/pornhubClient.js';

const okResponse = (body) => ({ ok: true, json: async () => body });

test('monta a URL só com parâmetros permitidos', async () => {
  let called;
  const client = createPornhubClient({
    baseUrl: 'https://exemplo.test/webmasters/',
    timeoutMs: 1000,
    fetchFn: async (url) => ((called = url), okResponse({ videos: [] })),
  });
  await client.search({ search: 'a b', page: 2, hack: 'x', category: '' });
  const url = new URL(called);
  assert.equal(url.pathname, '/webmasters/search');
  assert.equal(url.searchParams.get('search'), 'a b');
  assert.equal(url.searchParams.get('page'), '2');
  assert.equal(url.searchParams.get('thumbsize'), 'large_hd');
  assert.equal(url.searchParams.has('hack'), false);
  assert.equal(url.searchParams.has('category'), false);
});

test('usa o cache e, se a API falhar, devolve a resposta expirada', async () => {
  let clock = 0;
  let calls = 0;
  let fail = false;
  const cache = createCache({ ttlSeconds: 10, now: () => clock });
  const client = createPornhubClient({
    baseUrl: 'https://exemplo.test/webmasters',
    timeoutMs: 1000,
    cache,
    fetchFn: async () => {
      calls += 1;
      if (fail) throw new Error('rede caiu');
      return okResponse({ categories: [{ id: 1 }] });
    },
  });

  await client.categories();
  await client.categories();
  assert.equal(calls, 1, 'segunda chamada vem do cache');

  clock = 11_000;
  fail = true;
  const data = await client.categories();
  assert.equal(calls, 2);
  assert.deepEqual(data, { categories: [{ id: 1 }] }, 'usa a resposta expirada');
});

test('erros viram 502 e 504', async () => {
  const make = (fetchFn) =>
    createPornhubClient({ baseUrl: 'https://x.test', timeoutMs: 1000, fetchFn });

  await assert.rejects(make(async () => ({ ok: false })).categories(), { status: 502 });

  const timeout = Object.assign(new Error('t'), { name: 'TimeoutError' });
  await assert.rejects(
    make(async () => {
      throw timeout;
    }).categories(),
    { status: 504, code: 'UPSTREAM_TIMEOUT' }
  );
});

test('cache remove a entrada mais antiga ao passar do limite', () => {
  const cache = createCache({ ttlSeconds: 10, maxEntries: 2 });
  cache.set('a', 1);
  cache.set('b', 2);
  cache.set('c', 3);
  assert.equal(cache.size, 2);
  assert.equal(cache.get('a'), undefined);
});
