import { upstreamTimeout, upstreamUnavailable } from '../http/errors.js';

const ALLOWED_PARAMS = [
  'search',
  'category',
  'ordering',
  'period',
  'page',
  'thumbsize',
  'id',
];

/**
 * Única parte do projeto que fala com a Webmasters API.
 * Usa cache: resposta válida → cache; API falhou → usa a resposta expirada, se houver.
 */
export function createPornhubClient({ baseUrl, timeoutMs, cache, fetchFn = fetch }) {
  async function get(endpoint, params = {}) {
    const url = new URL(`${baseUrl.replace(/\/$/, '')}/${endpoint}`);
    for (const key of ALLOWED_PARAMS) {
      const value = params[key];
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
    const key = url.toString();

    const cached = cache?.get(key);
    if (cached?.fresh) return cached.value;

    try {
      const res = await fetchFn(key, {
        headers: { Accept: 'application/json', 'User-Agent': 'be-wiseup-one-api/0.1' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw upstreamUnavailable();
      const data = await res.json();
      cache?.set(key, data);
      return data;
    } catch (error) {
      if (cached) return cached.value; // melhor dado antigo do que erro
      if (error.name === 'TimeoutError' || error.name === 'AbortError')
        throw upstreamTimeout();
      throw upstreamUnavailable();
    }
  }

  return {
    search: (params) => get('search', { thumbsize: 'large_hd', ...params }),
    videoById: (id) => get('video_by_id', { id, thumbsize: 'large_hd' }),
    categories: () => get('categories'),

    /**
     * Ids que a plataforma de origem **apagou** (ADR-0017). O que saiu de lá
     * sai do nosso catálogo também: remoção na origem costuma ter motivo, e
     * não queremos ser o último lugar onde o vídeo segue listado.
     *
     * O formato é tolerante de propósito — a documentação da Webmasters API
     * descreve `{ videos: [...] }`, e já veio tanto objeto com `video_id`
     * quanto id solto. Formato inesperado vira lista vazia, não exceção: este
     * sincronismo roda sozinho em segundo plano.
     *
     * @returns {Promise<string[]>}
     */
    async deletedVideos(page = 1) {
      const data = await get('deleted', { page });
      const lista = Array.isArray(data?.videos) ? data.videos : [];
      return lista
        .map((item) => (typeof item === 'string' ? item : item?.video_id))
        .filter((id) => typeof id === 'string' && id.length > 0);
    },

    /**
     * O vídeo ainda existe na origem? Usado na análise de denúncia, para o
     * administrador saber se o problema já foi resolvido lá.
     *
     * Erro de rede devolve `null` (não sabemos), e não `false`: "não consegui
     * perguntar" é diferente de "não existe mais".
     *
     * @returns {Promise<boolean | null>}
     */
    async isVideoActive(id) {
      try {
        const data = await get('video_by_id', { id, thumbsize: 'large_hd' });
        return Boolean(data?.video?.video_id);
      } catch {
        return null;
      }
    },
  };
}
