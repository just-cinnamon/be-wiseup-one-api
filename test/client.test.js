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

// ---- Sincronismo com a origem (ADR-0017) ----

test('deletedVideos aceita os dois formatos e ignora lixo', async () => {
  let url;
  const client = createPornhubClient({
    baseUrl: 'https://exemplo.test/webmasters/',
    timeoutMs: 1000,
    fetchFn: async (u) => (
      (url = u),
      okResponse({ videos: [{ video_id: 'a1' }, 'b2', { outro: 1 }, null, ''] })
    ),
  });

  const ids = await client.deletedVideos(3);

  assert.deepEqual(ids, ['a1', 'b2']);
  assert.equal(new URL(url).pathname, '/webmasters/deleted');
  assert.equal(new URL(url).searchParams.get('page'), '3');
});

test('resposta sem lista de vídeos não derruba o sincronismo', async () => {
  const client = createPornhubClient({
    baseUrl: 'https://exemplo.test/webmasters/',
    timeoutMs: 1000,
    fetchFn: async () => okResponse({ mensagem: 'formato mudou' }),
  });
  // Formato inesperado vira lista vazia, não exceção: este sincronismo roda
  // sozinho em segundo plano, e quebrar o boot por causa dele seria pior.
  assert.deepEqual(await client.deletedVideos(), []);
});

test('isVideoActive distingue "não existe" de "não consegui perguntar"', async () => {
  const comResposta = (body, ok = true) =>
    createPornhubClient({
      baseUrl: 'https://exemplo.test/webmasters/',
      timeoutMs: 1000,
      fetchFn: async () => ({ ok, json: async () => body }),
    });

  assert.equal(
    await comResposta({ video: { video_id: 'a1' } }).isVideoActive('a1'),
    true
  );
  assert.equal(await comResposta({ video: null }).isVideoActive('a1'), false);
  assert.equal(
    await comResposta({}, false).isVideoActive('a1'),
    null,
    'falha na origem é null, e não false: não saber é diferente de não existir'
  );
});
