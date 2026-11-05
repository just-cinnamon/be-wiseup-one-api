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
  };
}
