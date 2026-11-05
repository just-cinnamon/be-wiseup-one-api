/**
 * Converte um vídeo da Webmasters API para o formato `Title`
 * usado pelo front-end (contrato documentado em src/data/mock.js do be-wiseup-one).
 */
const ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  '#39': "'",
  nbsp: ' ',
};

export function decodeHtml(text = '') {
  return String(text)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&([a-z]+|#39);/gi, (match, name) => ENTITIES[name.toLowerCase()] ?? match);
}

/** "12:34" → "12min" · "1:05:20" → "1h 05min" · "0:45" → "1min" */
export function formatDuration(value) {
  const parts = String(value ?? '')
    .split(':')
    .map((p) => Number.parseInt(p, 10));
  if (!parts.length || parts.some(Number.isNaN)) return '';
  const [h, m, s] = parts.length === 3 ? parts : [0, ...parts.slice(-2)];
  const minutes = Math.max(1, Math.floor(h * 60 + m + s / 60));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours}h ${String(rest).padStart(2, '0')}min` : `${rest}min`;
}

/**
 * "big-tits" → "Big Tits" · "60fps-1" → "60fps" · "18-25" → "18-25"
 * O sufixo "-1" é o desempate que a API usa em slugs repetidos e não faz parte
 * do nome. Faixas só de números ("18-25") mantêm o hífen.
 */
export function formatCategory(slug = '') {
  const base = String(slug).replace(/-1$/, '');
  if (/^\d+(-\d+)*$/.test(base)) return base;
  return base
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** 1234567 → "1,2 mi" · 5400 → "5,4 mil" */
export function formatViews(views) {
  const n = Number(views) || 0;
  const fmt = (v) => v.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  if (n >= 1e6) return `${fmt(n / 1e6)} mi`;
  if (n >= 1e3) return `${fmt(n / 1e3)} mil`;
  return String(n);
}

function parseDate(value) {
  // A API usa "AAAA-MM-DD HH:MM:SS", sem fuso. Lemos como UTC para que `year` e
  // `publishedAt` sejam os mesmos no micro local e no servidor (outra região).
  const date = new Date(`${String(value ?? '').replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function biggestThumb(video) {
  const thumbs = Array.isArray(video.thumbs) ? video.thumbs : [];
  const best = thumbs.reduce(
    (acc, t) => (Number(t.width) > Number(acc?.width ?? 0) ? t : acc),
    null
  );
  return best?.src || video.default_thumb || video.thumb || '';
}

const tagNames = (video) =>
  (video.tags ?? []).map((t) => t.tag_name ?? t).filter(Boolean);

export function toTitle(video, { now = new Date() } = {}) {
  const published = parseDate(video.publish_date);
  const views = Number(video.views) || 0;
  const tags = tagNames(video).slice(0, 3);
  const image = biggestThumb(video);

  return {
    id: String(video.video_id),
    title: decodeHtml(video.title),
    type: 'movie',
    backdrop: image,
    poster: image,
    year: published ? published.getUTCFullYear() : null,
    maturity: '18',
    duration: formatDuration(video.duration),
    genres: (video.categories ?? [])
      .map((c) => formatCategory(c.category ?? c))
      .filter(Boolean)
      .slice(0, 3),
    match: Math.min(100, Math.max(0, Math.round(Number(video.rating) || 0))),
    description: [`${formatViews(views)} de visualizações`, tags.join(', ')]
      .filter(Boolean)
      .join(' · '),
    isNew: published ? now - published < 30 * 24 * 60 * 60 * 1000 : false,
  };
}

/** Versão com os campos extras do modal de detalhes. */
export function toTitleDetail(video, options) {
  const published = parseDate(video.publish_date);
  return {
    ...toTitle(video, options),
    tags: tagNames(video),
    views: Number(video.views) || 0,
    publishedAt: published ? published.toISOString().slice(0, 10) : null,
    embedUrl: `https://www.pornhub.com/embed/${encodeURIComponent(video.video_id)}`,
  };
}

export function toCategory(item) {
  return { id: item.id, slug: item.category, name: formatCategory(item.category) };
}
