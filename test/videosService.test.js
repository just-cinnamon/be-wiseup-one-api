import assert from 'node:assert/strict';
import { test } from 'node:test';
import { homeRows } from '../src/config/homeSections.js';
import { createVideosService } from '../src/services/videosService.js';
import { fakeClient, fixture } from './helpers.js';

// A fixture `search` tem três vídeos reais da API.
const FIXTURE_VIDEOS = fixture('search').videos.length;
const FIRST_ID = fixture('search').videos[0].video_id;

test('getHome monta featured, top10 e todas as fileiras', async () => {
  const service = createVideosService({ client: fakeClient() });
  const home = await service.getHome();
  assert.equal(home.featured.rank, 1);
  assert.equal(home.featured.id, FIRST_ID);
  assert.equal(home.top10.length, FIXTURE_VIDEOS);
  assert.equal(home.rows.length, homeRows.length);
  assert.ok(home.rows.every((r) => r.id && r.title && Array.isArray(r.items)));
});

test('getHome continua funcionando se uma seção falhar', async () => {
  let n = 0;
  const client = fakeClient({
    search: async () => {
      n += 1;
      if (n === 3) throw new Error('falhou');
      return { videos: [{ video_id: 'abc', title: 'x' }] };
    },
  });
  const home = await createVideosService({ client }).getHome();
  assert.deepEqual(home.rows[0].items, []);
  assert.equal(home.rows[1].items.length, 1);
});

test('listVideos valida e repassa os parâmetros', async () => {
  const client = fakeClient();
  const service = createVideosService({ client });
  const result = await service.listVideos({
    q: '  termo ',
    page: '2',
    ordering: 'newest',
  });
  assert.equal(result.page, 2);
  assert.equal(result.items.length, FIXTURE_VIDEOS);
  assert.equal(result.hasMore, true);
  assert.deepEqual(client.calls.at(-1), [
    'search',
    {
      search: 'termo',
      category: undefined,
      ordering: 'newest',
      period: 'weekly',
      page: 2,
    },
  ]);
});

test('listVideos rejeita parâmetros inválidos com 400', async () => {
  const service = createVideosService({ client: fakeClient() });
  for (const query of [
    { ordering: 'x' },
    { period: 'daily' },
    { page: '0' },
    { page: '51' },
    { page: 'a' },
    { category: '<script>' },
    { q: 'x'.repeat(81) },
  ]) {
    await assert.rejects(
      service.listVideos(query),
      { status: 400, code: 'INVALID_PARAMS' },
      JSON.stringify(query)
    );
  }
});

test('getVideo devolve detalhe ou 404', async () => {
  const service = createVideosService({ client: fakeClient() });
  const video = await service.getVideo(FIRST_ID);
  assert.ok(video.embedUrl.endsWith(`/${FIRST_ID}`));

  await assert.rejects(service.getVideo('../etc'), { status: 404 });

  const empty = createVideosService({
    client: fakeClient({
      videoById: async () => ({ code: '2001', message: 'No video' }),
    }),
  });
  await assert.rejects(empty.getVideo('ph999'), { status: 404 });
});

test('getCategories', async () => {
  const cats = await createVideosService({ client: fakeClient() }).getCategories();
  assert.equal(cats.length, fixture('categories').categories.length);
  assert.deepEqual(cats[0], { id: 37, slug: '18-25', name: '18-25' });
  assert.deepEqual(cats[1], { id: 622, slug: '180-1', name: '180' });
});

// ---- Vídeo bloqueado (ADR-0017) ----

/** Moderação falsa: só o que o `videosService` consulta. */
const comBloqueio = (...ids) => ({ isBlocked: (id) => ids.includes(String(id)) });

test('vídeo bloqueado não aparece na Home nem na busca', async () => {
  const service = createVideosService({
    client: fakeClient(),
    moderation: comBloqueio(FIRST_ID),
  });

  const home = await service.getHome();
  assert.equal(home.top10.length, FIXTURE_VIDEOS - 1);
  assert.ok(
    home.top10.every((t) => t.id !== FIRST_ID),
    'o bloqueado saiu do Top 10'
  );
  assert.ok(home.rows.every((r) => r.items.every((t) => t.id !== FIRST_ID)));

  // O destaque era justamente o bloqueado: a Home promove o próximo, em vez de
  // mostrar um destaque vazio.
  assert.ok(home.featured);
  assert.notEqual(home.featured.id, FIRST_ID);

  const busca = await service.listVideos({});
  assert.equal(busca.items.length, FIXTURE_VIDEOS - 1);
  assert.ok(busca.items.every((t) => t.id !== FIRST_ID));
});

test('o detalhe de vídeo bloqueado é 404, e nem chega à origem', async () => {
  const client = fakeClient();
  const service = createVideosService({ client, moderation: comBloqueio(FIRST_ID) });

  await assert.rejects(() => service.getVideo(FIRST_ID), { status: 404 });
  // 404 e não 403: dizer "bloqueado" confirmaria que o vídeo existe e contaria
  // o que a denúncia conseguiu.
  assert.equal(
    client.calls.filter(([nome]) => nome === 'videoById').length,
    0,
    'bloqueado não gera chamada à origem'
  );
});

test('sem moderação, o catálogo segue inteiro', async () => {
  const service = createVideosService({ client: fakeClient() });
  const home = await service.getHome();
  assert.equal(home.top10.length, FIXTURE_VIDEOS);
  assert.equal(home.featured.id, FIRST_ID);
});

test('se todos os vídeos estiverem bloqueados, a Home vem vazia sem quebrar', async () => {
  const todos = fixture('search').videos.map((v) => v.video_id);
  const service = createVideosService({
    client: fakeClient(),
    moderation: comBloqueio(...todos),
  });

  const home = await service.getHome();
  assert.equal(home.featured, null);
  assert.equal(home.top10.length, 0);
  assert.ok(home.rows.every((r) => r.items.length === 0));
});
