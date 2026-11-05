import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  decodeHtml,
  formatCategory,
  formatDuration,
  formatViews,
  toCategory,
  toTitle,
  toTitleDetail,
} from '../src/mappers/videoMapper.js';
import { fixture } from './helpers.js';

const [first, second] = fixture('search').videos;
const now = new Date('2026-11-05T12:00:00Z');

test('formatDuration', () => {
  assert.equal(formatDuration('12:34'), '12min');
  assert.equal(formatDuration('1:05:20'), '1h 05min');
  assert.equal(formatDuration('0:20'), '1min');
  assert.equal(formatDuration(''), '');
});

test('formatCategory e formatViews', () => {
  assert.equal(formatCategory('big-tits'), 'Big Tits');
  // O "-1" é desempate de slug repetido e sai do nome.
  assert.equal(formatCategory('60fps-1'), '60fps');
  assert.equal(formatCategory('virtual-reality-1'), 'Virtual Reality');
  // Faixas só de números mantêm o hífen; "college-18" e "college-18-1" dão o mesmo nome.
  assert.equal(formatCategory('18-25'), '18-25');
  assert.equal(formatCategory('180-1'), '180');
  assert.equal(formatCategory('college-18'), 'College 18');
  assert.equal(formatCategory('college-18-1'), 'College 18');
  assert.equal(formatViews(1234567), '1,2 mi');
  assert.equal(formatViews(5400), '5,4 mil');
  assert.equal(formatViews(70775), '70,8 mil');
});

test('decodeHtml', () => {
  assert.equal(
    decodeHtml('Exemplo &amp; t&#237;tulo &#39;teste&#39;'),
    "Exemplo & título 'teste'"
  );
  assert.equal(decodeHtml(undefined), '');
});

test('toTitle segue o contrato Title do front', () => {
  const t = toTitle(first, { now });
  assert.deepEqual(Object.keys(t).sort(), [
    'backdrop',
    'description',
    'duration',
    'genres',
    'id',
    'isNew',
    'match',
    'maturity',
    'poster',
    'title',
    'type',
    'year',
  ]);
  assert.equal(t.id, '6ae9db5a2d16a');
  assert.equal(t.title, 'Rough anal ends with a huge cumshot');
  assert.equal(t.type, 'movie');
  assert.equal(t.backdrop, first.thumbs[0].src);
  assert.equal(t.poster, t.backdrop);
  assert.equal(t.year, 2026);
  assert.equal(t.maturity, '18');
  assert.equal(t.duration, '16min');
  assert.deepEqual(t.genres, ['Babe', 'Blowjob', 'Cumshot']);
  assert.equal(t.match, 86);
  assert.equal(
    t.description,
    '70,8 mil de visualizações · doggystyle, cowgirl, shaved pussy'
  );
  assert.equal(t.isNew, true);
});

test('toTitle do segundo vídeo da fixture', () => {
  const t = toTitle(second, { now });
  assert.equal(t.id, '6ae9cf555af0f');
  assert.equal(t.duration, '33min');
  assert.equal(t.match, 94);
  assert.deepEqual(t.genres, ['Babe', 'Blonde', 'Blowjob']);
});

test('toTitle com campos ausentes usa os fallbacks', () => {
  // A API real sempre mandou thumbs, tags e categorias; este caso garante que
  // um vídeo incompleto não quebra a conversão.
  const t = toTitle(
    {
      video_id: 'abc123',
      title: 'Sem nada',
      views: '0',
      duration: '',
      publish_date: '2024-01-02 08:00:00',
      default_thumb: 'https://exemplo.test/default.jpg',
    },
    { now }
  );
  assert.equal(t.backdrop, 'https://exemplo.test/default.jpg');
  assert.deepEqual(t.genres, []);
  assert.equal(t.duration, '');
  assert.equal(t.match, 0);
  assert.equal(t.year, 2024);
  assert.equal(t.description, '0 de visualizações');
  assert.equal(t.isNew, false);
});

test('toTitle sem data de publicação', () => {
  const t = toTitle({ video_id: 'x', title: 'y' }, { now });
  assert.equal(t.year, null);
  assert.equal(t.isNew, false);
  assert.equal(t.backdrop, '');
});

test('toTitleDetail inclui embedUrl, tags e publishedAt', () => {
  const d = toTitleDetail(fixture('video_by_id').video, { now });
  assert.equal(d.embedUrl, 'https://www.pornhub.com/embed/6ae9db5a2d16a');
  assert.equal(d.tags.length, 13);
  assert.equal(d.views, 70775);
  // A data vem do campo da API lido como UTC: não muda com o fuso do servidor.
  assert.equal(d.publishedAt, '2026-11-03');
});

test('toCategory', () => {
  const categories = fixture('categories').categories;
  assert.deepEqual(toCategory({ id: 8, category: 'big-tits' }), {
    id: 8,
    slug: 'big-tits',
    name: 'Big Tits',
  });
  assert.deepEqual(toCategory(categories[0]), { id: 37, slug: '18-25', name: '18-25' });
});
