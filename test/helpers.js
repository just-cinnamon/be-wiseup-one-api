import { readFileSync } from 'node:fs';

export const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));

/** Cliente falso que responde com as fixtures e registra as chamadas. */
export function fakeClient(overrides = {}) {
  const calls = [];
  return {
    calls,
    search: async (params) => (calls.push(['search', params]), fixture('search')),
    videoById: async (id) => (calls.push(['videoById', id]), fixture('video_by_id')),
    categories: async () => fixture('categories'),
    ...overrides,
  };
}
