import { featuredParams, homeRows, top10Params } from '../config/homeSections.js';
import { invalidParams, notFound } from '../http/errors.js';
import { toCategory, toTitle, toTitleDetail } from '../mappers/videoMapper.js';

const ORDERINGS = ['featured', 'newest', 'mostviewed', 'rating'];
const PERIODS = ['weekly', 'monthly', 'alltime'];
const ID_PATTERN = /^[A-Za-z0-9_]{1,40}$/;
const CATEGORY_PATTERN = /^[a-z0-9-]{1,60}$/;

const videosOf = (data) => (Array.isArray(data?.videos) ? data.videos : []);

/**
 * Regras de cada endpoint, sem nada de Express.
 * Recebe o cliente da API por parâmetro (nos testes, um cliente falso).
 */
export function createVideosService({ client }) {
  async function list(params) {
    return videosOf(await client.search(params)).map((v) => toTitle(v));
  }

  /** Valida a query string de GET /api/videos. Lança 400 se algo for inválido. */
  function parseListQuery(query = {}) {
    const q = typeof query.q === 'string' ? query.q.trim() : '';
    const category = typeof query.category === 'string' ? query.category.trim() : '';
    const ordering = query.ordering ?? 'mostviewed';
    const period = query.period ?? 'weekly';
    const page = query.page === undefined ? 1 : Number(query.page);

    if (q.length > 80) throw invalidParams('A busca pode ter no máximo 80 caracteres.');
    if (category && !CATEGORY_PATTERN.test(category))
      throw invalidParams('Categoria inválida.');
    if (!ORDERINGS.includes(ordering))
      throw invalidParams(`ordering deve ser: ${ORDERINGS.join(', ')}.`);
    if (!PERIODS.includes(period))
      throw invalidParams(`period deve ser: ${PERIODS.join(', ')}.`);
    if (!Number.isInteger(page) || page < 1 || page > 50)
      throw invalidParams('page deve ser de 1 a 50.');

    return {
      search: q || undefined,
      category: category || undefined,
      ordering,
      period,
      page,
    };
  }

  return {
    async getHome() {
      const [featured, top10, ...rows] = await Promise.allSettled([
        list(featuredParams),
        list(top10Params),
        ...homeRows.map((row) => list(row.params)),
      ]);
      const value = (result) => (result.status === 'fulfilled' ? result.value : []);

      const top = value(featured)[0];
      return {
        featured: top ? { ...top, rank: 1 } : null,
        top10: value(top10).slice(0, 10),
        rows: homeRows.map((row, i) => ({
          id: row.id,
          title: row.title,
          items: value(rows[i]),
        })),
      };
    },

    async listVideos(query) {
      const params = parseListQuery(query);
      const items = await list(params);
      return { page: params.page, items, hasMore: items.length > 0 && params.page < 50 };
    },

    async getVideo(id) {
      if (!ID_PATTERN.test(String(id))) throw notFound();
      const data = await client.videoById(id);
      if (!data?.video?.video_id) throw notFound();
      return toTitleDetail(data.video);
    },

    async getCategories() {
      const data = await client.categories();
      return (Array.isArray(data?.categories) ? data.categories : []).map(toCategory);
    },
  };
}
