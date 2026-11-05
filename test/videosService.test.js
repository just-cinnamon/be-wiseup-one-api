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
